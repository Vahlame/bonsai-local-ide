/**
 * Pruebas de chat/terminal.mjs: terminal persistente con stdin y procesos en segundo
 * plano que sobreviven entre llamadas.
 *
 * Sin red externa, sin GPU y sin el servidor del IDE: usa os.tmpdir() como raíz, habla
 * solo con procesos locales y, si el caso del "servidor de prueba" usa `http`, escucha
 * en 127.0.0.1 con puerto 0 (efímero, nunca uno fijo).
 *
 * Cada caso imprime OK/FALLO y el script sale con código 1 si alguno falla. Todas las
 * esperas tienen tope defensivo (10 s) y el `finally` cierra SIEMPRE las sesiones y
 * borra el directorio temporal, aunque un caso falle a medias.
 *
 *   node chat\prueba-terminal.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Fondo, Terminales } from "./terminal.mjs";

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const t0 = Date.now();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-terminal-"));
const sub = path.join(dir, "sub");
fs.mkdirSync(sub);

/** @type {Terminales[]} */
const gestoresTerminales = [];
/** @type {Fondo[]} */
const gestoresFondo = [];
/** PIDs observados (shells e hijos) para el caso final de procesos residuales. @type {Set<number>} */
const pidsObservados = new Set();

let ok = 0;
/** @type {string[]} */
const fallos = [];

/**
 * Ejecuta un caso: si no lanza, cuenta OK; si lanza, cuenta FALLO y sigue con el resto.
 * @param {string} nombre
 * @param {() => Promise<void>} fn
 * @returns {Promise<void>}
 */
async function caso(nombre, fn) {
  try {
    await fn();
    ok += 1;
    console.log(`OK    ${nombre}`);
  } catch (error) {
    fallos.push(nombre);
    const mensaje = error instanceof Error ? error.message : String(error);
    console.log(`FALLO ${nombre}: ${mensaje}`);
  }
}

/**
 * @param {object} [opciones]
 * @param {number} [opciones.maxBuffer]
 * @returns {Terminales}
 */
function crearTerminales(opciones = {}) {
  const gestor = new Terminales({ root: dir, ...opciones });
  gestoresTerminales.push(gestor);
  return gestor;
}

/** @returns {Fondo} */
function crearFondo() {
  const gestor = new Fondo({ root: dir });
  gestoresFondo.push(gestor);
  return gestor;
}

/**
 * Comprueba si un PID existe. En Windows se usa `tasklist` (más fiable ante procesos
 * zombis del Árbol); en otros sistemas, `process.kill(pid, 0)`.
 * @param {number} pid
 * @returns {boolean}
 */
function existeProceso(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (process.platform === "win32") {
    try {
      const salida = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"], {
        encoding: "utf8",
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      return salida.includes(`"${pid}"`);
    } catch {
      // Sin tasklist se cae al método estándar.
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && /** @type {{ code?: string }} */ (error).code === "EPERM";
  }
}

/**
 * Espera a que se cumpla una condición, con tope defensivo.
 * @param {() => boolean | Promise<boolean>} condicion
 * @param {{ ms?: number, intervalo?: number }} [opciones]
 * @returns {Promise<boolean>}
 */
async function esperarA(condicion, { ms = 10000, intervalo = 50 } = {}) {
  const inicio = Date.now();
  while (Date.now() - inicio < ms) {
    if (await condicion()) return true;
    await esperar(intervalo);
  }
  return false;
}

/**
 * Espera a que aparezca un texto en la salida de la sesión, leyendo por offsets.
 * @param {Terminales | Fondo} gestor
 * @param {string} id
 * @param {string} texto
 * @param {{ desde?: number, ms?: number }} [opciones]
 * @returns {Promise<{ salida: string, siguiente: number }>}
 */
async function esperarSalida(gestor, id, texto, { desde = 0, ms = 10000 } = {}) {
  let offset = desde;
  let acumulado = "";
  const inicio = Date.now();
  while (Date.now() - inicio < ms) {
    const { salida, siguiente } = gestor.leer(id, offset);
    acumulado += salida;
    offset = siguiente;
    if (acumulado.includes(texto)) return { salida: acumulado, siguiente: offset };
    await esperar(50);
  }
  throw new Error(
    `no apareció ${JSON.stringify(texto)} en ${ms} ms; último fragmento leído: ${JSON.stringify(acumulado.slice(-400))}`,
  );
}

/**
 * Espera a que la sesión termine (vivo=false) y devuelve su estado.
 * @param {Terminales | Fondo} gestor
 * @param {string} id
 * @param {{ ms?: number }} [opciones]
 * @returns {Promise<{ salida: string, siguiente: number, vivo: boolean, codigo: number | null }>}
 */
async function esperarFin(gestor, id, { ms = 10000 } = {}) {
  const inicio = Date.now();
  while (Date.now() - inicio < ms) {
    const estado = gestor.leer(id);
    if (!estado.vivo) return estado;
    await esperar(50);
  }
  throw new Error(`la sesión ${id} no terminó en ${ms} ms`);
}

/**
 * Espera a que la salida se quede quieta (sin bloques nuevos) y devuelve el offset
 * absoluto alcanzado. Sirve para no confundir el prompt/banner de la shell con el
 * resultado del comando.
 * @param {Terminales | Fondo} gestor
 * @param {string} id
 * @param {{ quietoMs?: number, ms?: number }} [opciones]
 * @returns {Promise<number>}
 */
async function esperarQuieto(gestor, id, { quietoMs = 300, ms = 5000 } = {}) {
  let offset = 0;
  let ultimoCambio = Date.now();
  const inicio = Date.now();
  while (Date.now() - inicio < ms) {
    const { salida, siguiente } = gestor.leer(id, offset);
    if (salida) {
      offset = siguiente;
      ultimoCambio = Date.now();
    } else if (Date.now() - ultimoCambio >= quietoMs) {
      return offset;
    }
    await esperar(50);
  }
  return offset;
}

/**
 * Comprueba que la sesión está viva y que su PID de shell existe.
 * @param {Terminales | Fondo} gestor
 * @param {string} id
 * @returns {void}
 */
function comprobarVivo(gestor, id) {
  const estado = gestor.leer(id);
  assert.equal(estado.vivo, true, `la sesión ${id} debería seguir viva`);
  assert.equal(estado.codigo, null, `sin código de salida mientras vive (${id})`);
}

try {
  // 1. Shell persistente: ejecuta un comando y SIGUE viva (no es un proceso por comando).
  await caso("Terminales: shell persistente ejecuta un comando y sigue viva", async () => {
    const t = crearTerminales();
    const { id, cwd, shell } = t.abrir({});
    assert.equal(cwd, dir, "el cwd por defecto es la raíz");
    assert.match(shell, /cmd|sh/i, "se informa la shell que se está usando");
    assert.equal(t.escribir(id, `node -e "console.log('hola-terminal')"\r\n`), true, "escribir acepta el comando");
    const visto = await esperarSalida(t, id, "hola-terminal");
    assert.match(visto.salida, /hola-terminal/);
    const estado = t.leer(id);
    assert.equal(estado.vivo, true, "tras el comando, la shell sigue viva");
    assert.ok(estado.siguiente > 0, "el offset avanza");
    const fila = t.listar().find((fila) => fila.id === id);
    assert.ok(fila, "la terminal aparece en listar()");
    assert.equal(fila.vivo, true);
    assert.equal(fila.cwd, dir);
    assert.ok(Number.isInteger(fila.pid) && fila.pid > 0, "listar() informa el PID");
    assert.equal(typeof fila.inicio, "string");
    pidsObservados.add(fila.pid);
    t.cerrarTodo();
    assert.deepEqual(t.listar(), [], "cerrarTodo vacía la lista");
  });

  // 2. stdin real: los datos CRUDOS llegan al proceso que está escuchando por stdin.
  await caso("Terminales: stdin crudo llega al proceso hijo", async () => {
    const t = crearTerminales();
    const { id } = t.abrir({});
    const guion = `node -e "console.log('LISTO_STDIN');process.stdin.once('data',(d)=>{console.log('ECO:'+String(d).trim());process.exit(0)})"`;
    assert.equal(t.escribir(id, `${guion}\r\n`), true);
    // Se espera la señal del hijo antes de escribir: cmd.exe comparte el stdin del pipe
    // y, si se escriben dos líneas seguidas, la segunda puede consumirla la shell.
    await esperarSalida(t, id, "LISTO_STDIN");
    assert.equal(t.escribir(id, "abc\r\n"), true, "escribir acepta datos crudos");
    const visto = await esperarSalida(t, id, "ECO:abc");
    assert.match(visto.salida, /ECO:abc/);
  });

  // 3. Proceso largo: sigue vivo a los 2 s y `cerrar` mata el árbol entero (no solo cmd).
  await caso("Terminales: proceso largo vivo a los 2 s y cerrar mata el árbol", async () => {
    const t = crearTerminales();
    const { id } = t.abrir({});
    t.escribir(id, `node -e "console.log('pid:'+process.pid);setInterval(()=>{},1000)"\r\n`);
    const visto = await esperarSalida(t, id, "pid:");
    const pid = Number((visto.salida.match(/pid:(\d+)/) ?? [])[1]);
    assert.ok(Number.isInteger(pid) && pid > 0, "se conoce el PID del proceso que se lanzó");
    const shellPid = t.listar().find((fila) => fila.id === id)?.pid ?? 0;
    assert.ok(Number.isInteger(shellPid) && shellPid > 0, "se conoce el PID de la shell");
    pidsObservados.add(pid);
    pidsObservados.add(shellPid);
    assert.ok(existeProceso(pid), "el proceso hijo está vivo");
    await esperar(2000);
    comprobarVivo(t, id);
    assert.ok(existeProceso(pid), "el proceso hijo sigue vivo a los 2 s (sin tope de 60 s)");
    assert.equal(t.cerrar(id), true, "cerrar devuelve true");
    const tras = t.leer(id);
    assert.equal(tras.vivo, false, "tras cerrar, vivo=false");
    assert.equal(typeof tras.codigo, "number", "tras cerrar se informa un código");
    assert.equal(t.escribir(id, "echo no-deberia\r\n"), false, "escribir tras cerrar devuelve false");
    assert.ok(await esperarA(() => !existeProceso(pid)), "el proceso hijo murió con el árbol");
    assert.ok(await esperarA(() => !existeProceso(shellPid)), "la shell murió");
  });

  // 4. Buffer circular: no crece sin límite, conserva la cola y los offsets son absolutos.
  await caso("Terminales: buffer circular acotado y offsets coherentes", async () => {
    const t = crearTerminales({ maxBuffer: 1500 });
    const { id } = t.abrir({});
    t.escribir(id, `node -e "process.stdout.write('x'.repeat(5000));console.log('FIN_BUFFER')"\r\n`);
    await esperarSalida(t, id, "FIN_BUFFER");
    await esperarQuieto(t, id);
    const r = t.leer(id, 0);
    assert.ok(r.salida.length <= 1500, `el buffer no pasa del tope (${r.salida.length} <= 1500)`);
    assert.ok(r.siguiente > 1500, "el offset absoluto refleja todo lo escrito");
    assert.ok(r.siguiente - r.salida.length > 0, "se deduce cuánto se recortó (offset absoluto)");
    assert.ok(r.salida.includes("FIN_BUFFER"), "la última salida se conserva");
    assert.equal(t.leer(id, r.siguiente).salida, "", "desde el final no hay nada nuevo");
    assert.equal(t.leer(id, r.siguiente).siguiente, r.siguiente, "el offset se repite sin cambios");
    t.escribir(id, "echo NUEVO_OFFSET\r\n");
    const nuevo = await esperarSalida(t, id, "NUEVO_OFFSET", { desde: r.siguiente });
    assert.ok(!nuevo.salida.includes("FIN_BUFFER"), "desde un offset solo llega lo nuevo");
    // `exit` cierra la shell sola: se informa el código real y no queda proceso.
    t.escribir(id, "exit\r\n");
    const fin = await esperarFin(t, id);
    assert.equal(fin.codigo, 0, "exit termina la shell con código 0");
  });

  // 5. Fondo: un servidor local sigue vivo (sin timeout), se lee su salida y detener lo mata.
  await caso("Fondo: servidor en segundo plano sobrevive 2 s y detener lo mata", async () => {
    const f = crearFondo();
    const guion = `node -e "const http=require('http');const s=http.createServer((peticion,respuesta)=>respuesta.end('ok'));s.listen(0,'127.0.0.1',()=>console.log('LISTO_FONDO:'+process.pid))"`;
    const { id, pid, comando } = f.iniciar({ comando: guion });
    assert.equal(comando, guion);
    assert.ok(Number.isInteger(pid) && pid > 0, "iniciar devuelve el PID de la shell");
    pidsObservados.add(pid);
    const visto = await esperarSalida(f, id, "LISTO_FONDO:");
    const hijoPid = Number((visto.salida.match(/LISTO_FONDO:(\d+)/) ?? [])[1]);
    assert.ok(Number.isInteger(hijoPid) && hijoPid > 0, "el servidor informa su propio PID");
    pidsObservados.add(hijoPid);
    comprobarVivo(f, id);
    await esperar(2000);
    comprobarVivo(f, id);
    assert.ok(existeProceso(hijoPid), "el servidor sigue vivo a los 2 s (no hay timeout)");
    assert.equal(f.detener(id), true, "detener devuelve true");
    const tras = f.leer(id);
    assert.equal(tras.vivo, false, "tras detener, vivo=false");
    assert.equal(typeof tras.codigo, "number", "tras detener se informa un código");
    const fila = f.listar().find((fila) => fila.id === id);
    assert.ok(fila, "la sesión de fondo sigue en listar() como historial");
    assert.equal(fila.vivo, false);
    assert.equal(typeof fila.codigo, "number");
    assert.ok(await esperarA(() => !existeProceso(hijoPid)), "el servidor murió");
    assert.ok(await esperarA(() => !existeProceso(pid)), "la shell de fondo murió");
  });

  // 6. Fondo: comando que termina solo -> código 0; y respeta cwd/env explícitos.
  await caso("Fondo: comando que termina deja código 0, y respeta cwd/env", async () => {
    const f = crearFondo();
    const { id } = f.iniciar({ comando: `node -e "console.log('fondo-fin')"` });
    const fin = await esperarFin(f, id);
    assert.equal(fin.codigo, 0, "el comando que termina deja código 0");
    assert.match(f.leer(id, 0).salida, /fondo-fin/);
    const { id: id2 } = f.iniciar({
      comando: `node -e "console.log('ENV:'+process.env.BONSAI_PRUEBA+' CWD:'+process.cwd())"`,
      cwd: "sub",
      env: { BONSAI_PRUEBA: "valor-env" },
    });
    const fin2 = await esperarFin(f, id2);
    assert.equal(fin2.codigo, 0);
    const salida2 = f.leer(id2, 0).salida;
    assert.match(salida2, /ENV:valor-env/, "el proceso hereda el env pedido");
    assert.ok(
      salida2.toLowerCase().includes(sub.toLowerCase()),
      `el proceso arranca en el cwd pedido (${JSON.stringify(salida2)})`,
    );
    const fila = f.listar().find((fila) => fila.id === id2);
    assert.match(fila.comando, /BONSAI_PRUEBA/);
    assert.equal(fila.cwd, sub);
  });

  // 7. Seguridad básica: el cwd no puede salirse de la raíz y los ids desconocidos fallan.
  await caso("rutas: rechaza cwd fuera de la raíz y acepta subcarpetas", async () => {
    const t = crearTerminales();
    assert.throws(() => t.abrir({ cwd: ".." }), /fuera del proyecto/);
    assert.throws(() => t.abrir({ cwd: os.tmpdir() }), /fuera del proyecto/);
    assert.throws(() => t.abrir({ cwd: "no-existe" }), /no existe/);
    const { id, cwd } = t.abrir({ cwd: "sub" });
    assert.equal(cwd, sub, "una subcarpeta de la raíz sí se acepta");
    assert.equal(t.listar().find((fila) => fila.id === id)?.cwd, sub);
    assert.throws(() => t.leer("t-inexistente"), /no existe/);
    assert.throws(() => t.escribir("t-inexistente", "x"), /no existe/);
    assert.equal(t.cerrar("t-inexistente"), false);
    const f = crearFondo();
    assert.throws(() => f.iniciar({ comando: "echo x", cwd: ".." }), /fuera del proyecto/);
    assert.throws(() => f.iniciar({ comando: "   " }), /comando vacío/);
    assert.equal(f.detener("f-inexistente"), false);
    t.cerrarTodo();
    assert.deepEqual(t.listar(), []);
  });

  // 8. Eventos: "salida" con el texto y "fin" una sola vez con el código.
  await caso("eventos: 'salida' y 'fin' se emiten correctamente", async () => {
    const t = crearTerminales();
    /** @type {string[]} */
    const textos = [];
    /** @type {{ id: string, codigo: number }[]} */
    const fines = [];
    t.on("salida", (evento) => textos.push(evento.texto));
    t.on("fin", (evento) => fines.push(evento));
    const { id } = t.abrir({});
    t.escribir(id, `node -e "console.log('evento-salida')"\r\n`);
    await esperarSalida(t, id, "evento-salida");
    assert.ok(textos.join("").includes("evento-salida"), "el evento 'salida' lleva el texto decodificado");
    assert.equal(fines.length, 0, "no hay 'fin' mientras la terminal sigue viva");
    t.cerrar(id);
    await esperar(100);
    assert.equal(fines.length, 1, "'fin' se emite una sola vez al cerrar");
    assert.equal(fines[0].id, id);
    assert.equal(typeof fines[0].codigo, "number");
    t.cerrar(id);
    assert.equal(fines.length, 1, "cerrar dos veces no duplica 'fin'");
  });

  // 9. UTF-8 incremental: un carácter de 3 bytes partido en dos bloques no se rompe.
  await caso("codificación: UTF-8 incremental no rompe caracteres partidos", async () => {
    const t = crearTerminales();
    const { id } = t.abrir({});
    t.escribir(
      id,
      `node -e "process.stdout.write(Buffer.from([0xe2]));setTimeout(()=>process.stdout.write(Buffer.from([0x82,0xac])),80)"\r\n`,
    );
    const visto = await esperarSalida(t, id, "€");
    assert.ok(visto.salida.includes("€"), "el carácter multibyte llega entero");
    assert.ok(!visto.salida.includes("\uFFFD"), "sin caracteres de reemplazo");
  });

  // 10. Al final no puede quedar ningún proceso hijo vivo.
  await caso("sin procesos residuales tras cerrarTodo/detenerTodo", async () => {
    for (const gestor of gestoresTerminales) gestor.cerrarTodo();
    for (const gestor of gestoresFondo) gestor.detenerTodo();
    for (const pid of pidsObservados) {
      assert.ok(await esperarA(() => !existeProceso(pid), { ms: 10000, intervalo: 100 }), `el proceso ${pid} sigue vivo`);
    }
  });
} finally {
  // Limpieza defensiva: aunque un caso fallara antes de cerrar, no quedan procesos.
  for (const gestor of gestoresTerminales) {
    try {
      gestor.cerrarTodo();
    } catch {
      /* ya cerrado */
    }
  }
  for (const gestor of gestoresFondo) {
    try {
      gestor.detenerTodo();
    } catch {
      /* ya cerrado */
    }
  }
  // Windows puede devolver EBUSY en rmSync si un hijo aún usa el cwd: se espera a que
  // taskkill termine de bajar los árboles (con tope) y se reintenta el borrado.
  await esperarA(() => [...pidsObservados].every((pid) => !existeProceso(pid)), { ms: 5000, intervalo: 100 });
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

const transcurrido = ((Date.now() - t0) / 1000).toFixed(2);
const total = ok + fallos.length;
if (fallos.length) {
  console.log(`\nprueba terminal: ${ok}/${total} OK, ${fallos.length} FALLO en ${transcurrido} s`);
  console.log(`fallaron: ${fallos.join(" | ")}`);
  process.exitCode = 1;
} else {
  console.log(`\nprueba terminal OK: ${ok}/${total} casos en ${transcurrido} s`);
}
