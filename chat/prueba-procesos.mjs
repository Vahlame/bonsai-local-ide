/**
 * Pruebas del vigilante de procesos (chat/procesos.mjs). Sin red, sin GPU y sin
 * servidor HTTP: solo procesos de verdad.
 *
 * La prueba que importa es la del árbol: un comando que se pasa del tiempo tiene que
 * morir CON sus hijos. Cuando se mataba solo la shell (`child.kill()` sobre el
 * `cmd.exe` de `shell: true`), el proceso de verdad seguía vivo y el marcador
 * aparecía igualmente: eso hacía fallar esta prueba.
 *
 *   node chat\prueba-procesos.mjs
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { desescaparComillas, ejecutarComando, lanzarEnFondo, recortarCentro } from "./procesos.mjs";

/** @type {string[]} */
const fallos = [];
/**
 * @param {string} nombre
 * @param {boolean} cond
 */
function check(nombre, cond) {
  if (cond) {
    process.stdout.write(`ok    ${nombre}\n`);
    return;
  }
  fallos.push(nombre);
  process.stdout.write(`FALLA ${nombre}\n`);
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Comando de una línea que, pasados `ms`, escribe `destino`. Con `shell: true` esto
 * deja el árbol padre → cmd.exe → node.exe: matar solo el padre no basta.
 * @param {string} destino
 * @param {number} ms
 * @returns {string}
 */
function comandoQueEscribe(destino, ms) {
  const ruta = destino.replace(/\\/g, "/");
  return `node -e "setTimeout(()=>require('fs').writeFileSync('${ruta}','vivo'),${ms})"`;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-procesos-"));
try {
  // 1. El caso del bug: tiempo agotado.
  const marcaTiempo = path.join(dir, "sobrevivio-tiempo.txt");
  const porTiempo = await ejecutarComando(comandoQueEscribe(marcaTiempo, 2500), { cwd: dir, timeoutMs: 600 });
  check("el tiempo agotado se distingue", porTiempo.motivo === "timeout" && porTiempo.code === 1);
  check("la salida avisa del tiempo agotado", /tiempo agotado/.test(porTiempo.output));
  await esperar(4000);
  check("el hijo del comando NO sobrevive al tiempo agotado", !fs.existsSync(marcaTiempo));

  // 2. Cancelación del turno (el usuario cierra la pestaña).
  const marcaCancel = path.join(dir, "sobrevivio-cancel.txt");
  const ac = new AbortController();
  const enCurso = ejecutarComando(comandoQueEscribe(marcaCancel, 2500), { cwd: dir, signal: ac.signal, timeoutMs: 20000 });
  await esperar(500);
  ac.abort();
  const porCancel = await enCurso;
  check("la cancelación se distingue", porCancel.motivo === "cancelado" && porCancel.code === 1);
  await esperar(3500);
  check("el hijo del comando NO sobrevive a la cancelación", !fs.existsSync(marcaCancel));

  // 3. Un comando normal sigue funcionando (y no cuelga por los pipes).
  const normal = await ejecutarComando('node -e "console.log(1+1)"', { cwd: dir, timeoutMs: 20000 });
  check("un comando normal devuelve su salida y código 0", normal.code === 0 && normal.output.trim() === "2" && normal.motivo === "");

  // 4. Un comando que no existe se reporta, no se traga.
  const inexistente = await ejecutarComando("bonsai-no-existe-xyz --version", { cwd: dir, timeoutMs: 20000 });
  check("un comando inexistente devuelve código distinto de 0", inexistente.code !== 0);
  check("un comando inexistente deja su salida", inexistente.output.length > 0 && !/^\(sin salida/.test(inexistente.output));

  // 5. Un comando de varias líneas va a un temporal (.cmd: la misma shell que los de una
  // línea) y ese temporal se borra.
  const temporales = () => fs.readdirSync(os.tmpdir()).filter((n) => /^bonsai-.*\.(cmd|py|cjs|ps1)$/.test(n));
  const antes = new Set(temporales());
  const multilinea = await ejecutarComando("set X=41\necho valor %X%\necho uno && echo dos", { cwd: dir, timeoutMs: 30000 });
  check("un comando de varias líneas se ejecuta en cmd.exe", multilinea.code === 0 && /valor 41/.test(multilinea.output) && /uno\s+dos/.test(multilinea.output));

  // 5b. El caso real que fallaba: `python -c "…"` de varias líneas, SIN ruta delante y con
  // comillas escapadas `\"` dentro. Antes iba a PowerShell y salía un error de sintaxis.
  const pyMulti = await ejecutarComando('python -c "\nimport re\ns = \'<script src=\\"a.js\\"></script>\'\nfor m in re.finditer(r\'src=[\\"\\\']([^\\"\\\']+)\', s):\n    print(m.group(1))\n"', { cwd: dir, timeoutMs: 30000 });
  check("python -c de varias líneas con \\\" se ejecuta como .py", pyMulti.code === 0 && pyMulti.output.trim() === "a.js");
  const nodeMulti = await ejecutarComando('node -e "\nconst s = \\"hola\\";\nconsole.log(s.length)\n"', { cwd: dir, timeoutMs: 30000 });
  check("node -e de varias líneas se ejecuta como archivo", nodeMulti.code === 0 && nodeMulti.output.trim() === "4");
  check("los archivos temporales de los comandos se borran", temporales().every((n) => antes.has(n)));
  check("desescaparComillas sigue las reglas de Windows", desescaparComillas('a \\"b\\" c\\\\\\"d e\\\\f') === 'a "b" c\\"d e\\\\f');

  // 5c. Sin teclado: un script que pide datos (input()) recibe EOF al momento en vez de
  // quedarse esperando hasta el tope de tiempo.
  const t0 = Date.now();
  const pide = await ejecutarComando("node -e \"process.stdin.on('data',()=>{});process.stdin.on('end',()=>console.log('sin entrada'))\"", { cwd: dir, timeoutMs: 15000 });
  check("un comando que lee stdin no se queda colgado", pide.motivo === "" && Date.now() - t0 < 10000 && /sin entrada/.test(pide.output));

  // 5d. Una salida larga conserva el FINAL (donde va el traceback), no solo el principio.
  const larga = await ejecutarComando("node -e \"console.log('x'.repeat(20000)); console.log('ERROR_AL_FINAL')\"", { cwd: dir, timeoutMs: 20000 });
  check("una salida larga conserva la cola", /ERROR_AL_FINAL/.test(larga.output) && larga.output.length < 9000);
  check("recortarCentro guarda cabeza y cola", recortarCentro(`INICIO${"m".repeat(500)}FINAL`, 100).startsWith("INICIO") && recortarCentro(`INICIO${"m".repeat(500)}FINAL`, 100).endsWith("FINAL"));

  // 5e. En segundo plano: un servidor sigue vivo, devuelve su primera salida y `parar` lo mata
  // (con sus hijos). Un comando que muere enseguida devuelve su código.
  const marcaFondo = path.join(dir, "fondo-sigue.txt").replace(/\\/g, "/");
  const fondo = await lanzarEnFondo(`node -e "console.log('escuchando');setInterval(()=>require('fs').writeFileSync('${marcaFondo}',String(Date.now())),300)"`, { cwd: dir, esperaMs: 1500 });
  check("un comando en segundo plano sigue vivo y da su primera salida", fondo.vivo && /escuchando/.test(fondo.output));
  fondo.parar();
  await esperar(800);
  const tras = fs.existsSync(marcaFondo) ? fs.readFileSync(marcaFondo, "utf8") : "";
  await esperar(900);
  check("parar mata el proceso en segundo plano", (fs.existsSync(marcaFondo) ? fs.readFileSync(marcaFondo, "utf8") : "") === tras);
  const muere = await lanzarEnFondo("node -e \"console.error('roto');process.exit(4)\"", { cwd: dir, esperaMs: 3000 });
  check("si muere enseguida, se sabe su código", !muere.vivo && muere.code === 4 && /roto/.test(muere.output));

  // 6. Un AbortController ya cancelado no lanza nada raro.
  const ac2 = new AbortController();
  ac2.abort();
  const yaCancelado = await ejecutarComando('node -e "console.log(1)"', { cwd: dir, signal: ac2.signal, timeoutMs: 20000 });
  check("un turno ya cancelado no lanza el comando", yaCancelado.code === 1 && yaCancelado.motivo === "cancelado");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

if (fallos.length) {
  process.stderr.write(`FALLÓ:\n- ${fallos.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("prueba procesos ok\n");
}
