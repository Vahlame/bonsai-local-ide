/**
 * Calidad del modelo con KV cuantizado (q8_0 / q4_0) frente a f16 — prueba de GPU REAL.
 *
 *   node chat/prueba-calidad-kv.mjs --real
 *
 * Por qué existe: con visión y ~8 GB, 32K de contexto solo caben con KV q8_0 (f16 pide
 * ~8301 MiB y no arranca). La pregunta es si q8_0 es "suficientemente bueno" o si hay
 * que renunciar a contexto para usar f16. Esta prueba compara, con el MISMO modelo y la
 * MISMA máquina:
 *
 *   A) 32768 · KV q8_0 · visión      (la configuración recomendada)
 *   B) 16384 · KV f16  · visión      (la alternativa con más precisión de KV pero menos contexto)
 *   C) 32768 · KV f16  · sin visión  (mismo contexto que A, máxima precisión: aísla el KV)
 *
 * Mide dos cosas:
 *  1) NIAH (needle in a haystack): datos únicos escondidos al 15% y 85% de un texto real
 *     del proyecto (~4k tokens y ~12k tokens). Se pregunta por ellos y por extraerlos en
 *     JSON. Es lo que más castiga un KV impreciso.
 *  2) Dos tareas de código con verificación objetiva (Python y JavaScript): el código
 *     generado se ejecuta contra asserts fijos.
 *
 * Sin `--real` no arranca nada y termina bien (para poder estar en el grupo GPU del runner).
 * No usa estado de usuario: estado/carpetas temporales y puertos libres.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { estimateTokens } from "./context.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);

if (!process.argv.includes("--real")) {
  console.log("Calidad de KV omitida: usa --real explícitamente; carga el modelo en la GPU y tarda varios minutos.");
  process.exit(0);
}

const waiting = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- utilidades GPU
/** @returns {Promise<number>} */
async function puertoLibre() {
  const server = http.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}

/** @param {string} comando @param {string[]} args @returns {Promise<string>} */
function powershell(comando, args) {
  return new Promise((resolve, reject) => {
    execFile(comando, args, { cwd: PROJECT, windowsHide: true, timeout: 240_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim()));
      else resolve(String(stdout || ""));
    });
  });
}

/**
 * Arranca llama-server con la configuración pedida y espera a que /health conteste.
 * @param {{modelo: string, contexto: number, kv: string, vision: boolean, puerto: number}} cfg
 * @returns {Promise<{proc: import("node:child_process").ChildProcess, base: string, arranqueMs: number, nCtx: number}>}
 */
async function arrancar(cfg) {
  const inicio = Date.now();
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(PROJECT, "scripts", "start-server.ps1"), "-Modelo", cfg.modelo, "-ManagedByIDE", "-Port", String(cfg.puerto), "-ContextSize", String(cfg.contexto), "-KVCacheType", cfg.kv, "-Pensar", "0"];
  if (cfg.vision) args.push("-Vision");
  const proc = spawn("powershell.exe", args, { cwd: PROJECT, windowsHide: true, stdio: "ignore" });
  const base = `http://127.0.0.1:${cfg.puerto}`;
  const limite = Date.now() + 200_000;
  while (Date.now() < limite) {
    if (proc.exitCode !== null) throw new Error(`el servidor terminó con código ${proc.exitCode} al arrancar ${cfg.kv}/${cfg.contexto}`);
    try {
      const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        const props = await (await fetch(`${base}/props`, { signal: AbortSignal.timeout(5000) })).json();
        const nCtx = Number(props?.default_generation_settings?.n_ctx);
        return { proc, base, arranqueMs: Date.now() - inicio, nCtx, puerto: cfg.puerto };
      }
    } catch { /* cargando */ }
    await waiting(1500);
  }
  // Si no llegó a estar sano, no se deja un llama-server a medias ocupando la GPU.
  try {
    await powershell("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(PROJECT, "scripts", "stop-managed-server.ps1"), "-Port", String(cfg.puerto)]);
  } catch { /* no había nada que parar */ }
  proc.kill();
  throw new Error(`el servidor ${cfg.kv}/${cfg.contexto} no arrancó en 200 s`);
}

/** @param {{proc: import("node:child_process").ChildProcess, puerto: number}} srv */
async function parar(srv) {
  try {
    await powershell("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(PROJECT, "scripts", "stop-managed-server.ps1"), "-Port", String(srv.puerto)]);
  } catch { /* se intenta igualmente matar el wrapper */ }
  const salida = srv.proc.exitCode === null ? once(srv.proc, "exit") : Promise.resolve();
  await Promise.race([salida, waiting(30_000)]);
  if (srv.proc.exitCode === null) srv.proc.kill();
  // Red de seguridad: que no quede nada escuchando en ese puerto antes de medir la
  // siguiente configuración (si quedara, la VRAM libre falsearía el siguiente arranque).
  for (let intento = 0; intento < 10; intento += 1) {
    try {
      await powershell("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(PROJECT, "scripts", "stop-managed-server.ps1"), "-Port", String(srv.puerto)]);
    } catch { /* ya no hay nada */ }
    const libre = await new Promise((resolve) => {
      const probe = http.createServer();
      probe.once("error", () => resolve(false));
      probe.listen(srv.puerto, "127.0.0.1", () => probe.close(() => resolve(true)));
    });
    if (libre) break;
    await waiting(1000);
  }
}

// ---------------------------------------------------------------- NIAH
/** Texto real del proyecto para el pajar (documentación y auditorías). */
function textoDelProyecto() {
  const candidatos = ["README.md", "AUDITORIA-HANDOFF.md", "ARQUITECTURA-Y-PLAN-MAESTRO.md", "AUDITORIA-BUGS-Y-REFACTORIZACION.md", "INTEGRACION-MODELO.md", "HANDOFF.md"].map((rel) => path.join(PROJECT, rel)).filter((abs) => fs.existsSync(abs));
  const partes = [];
  for (const abs of candidatos) {
    try { partes.push(fs.readFileSync(abs, "utf8")); } catch { /* ilegible */ }
  }
  return partes.join("\n\n");
}

/**
 * Construye un pajar de ~`tokensObjetivo` tokens (estimación conservadora) e inserta
 * dos datos únicos al 15% y 85%.
 * @param {string} fuente
 * @param {number} tokensObjetivo
 * @returns {{texto: string, alfa: string, gamma: string}}
 */
function pajar(fuente, tokensObjetivo) {
  const chars = tokensObjetivo * 3;
  let base = fuente;
  while (base.length < chars) base += `\n\n${fuente}`;
  base = base.slice(0, chars);
  const alfa = "DATO-ANCLA-ALFA: el código de la caja fuerte es AMBAR-7391.";
  const gamma = "DATO-ANCLA-GAMMA: el PIN del almacén es CEDRO-8155.";
  /**
   * Inserta la aguja en el TEXTO ACTUAL (no en la base original: encadenar dos
   * inserciones sobre `base` borraba la primera y el dato alfa desaparecía).
   * @param {string} texto
   * @param {number} pos
   * @param {string} aguja
   * @returns {string}
   */
  const insertar = (texto, pos, aguja) => {
    const desde = Math.max(0, Math.min(pos, texto.length));
    let corte = texto.indexOf("\n\n", desde);
    if (corte < 0) corte = desde;
    return `${texto.slice(0, corte)}\n\n${aguja}${texto.slice(corte)}`;
  };
  let texto = insertar(base, Math.floor(chars * 0.15), alfa);
  texto = insertar(texto, Math.floor(texto.length * 0.85), gamma);
  return { texto, alfa: "AMBAR-7391", gamma: "CEDRO-8155" };
}

/** @param {string} texto */
function normalizar(texto) {
  return String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/\s+/g, " ");
}

/**
 * Una petición de chat determinista.
 * @param {string} base @param {string} contenido @param {number} maxTokens
 * @returns {Promise<{texto: string, ms: number, promptTokens: number | null}>}
 */
async function preguntar(base, contenido, maxTokens) {
  const inicio = Date.now();
  const r = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "local", messages: [{ role: "user", content: contenido }], temperature: 0, max_tokens: maxTokens, stream: false, chat_template_kwargs: { enable_thinking: false } }),
    signal: AbortSignal.timeout(300_000),
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(datos).slice(0, 200)}`);
  return { texto: String(datos?.choices?.[0]?.message?.content || ""), ms: Date.now() - inicio, promptTokens: Number.isFinite(datos?.usage?.prompt_tokens) ? datos.usage.prompt_tokens : null };
}

/**
 * Corre el NIAH de un pajar concreto.
 * @param {string} base
 * @param {{texto: string, alfa: string, gamma: string}} datos
 * @returns {Promise<{alfa: boolean, gamma: boolean, json: boolean, detalle: Record<string, string>, ms: number}>}
 */
async function niah(base, datos) {
  const inicio = Date.now();
  const intro = "Lee el TEXTO y responde. No expliques nada.";
  const p1 = await preguntar(base, `${intro}\n\nTEXTO:\n<<<\n${datos.texto}\n>>>\n\nPregunta: ¿cuál es el código de la caja fuerte (DATO-ANCLA-ALFA)? Responde SOLO la palabra y el número.`, 30);
  const p2 = await preguntar(base, `${intro}\n\nTEXTO:\n<<<\n${datos.texto}\n>>>\n\nPregunta: ¿cuál es el PIN del almacén (DATO-ANCLA-GAMMA)? Responde SOLO la palabra y el número.`, 30);
  const p3 = await preguntar(base, `${intro}\n\nTEXTO:\n<<<\n${datos.texto}\n>>>\n\nExtrae en un JSON con claves "alfa" y "gamma" los valores de DATO-ANCLA-ALFA y DATO-ANCLA-GAMMA. Responde SOLO el JSON.`, 120);
  const alfa = normalizar(p1.texto).includes(datos.alfa) || normalizar(p3.texto).includes(datos.alfa);
  const gamma = normalizar(p2.texto).includes(datos.gamma) || normalizar(p3.texto).includes(datos.gamma);
  const json = normalizar(p3.texto).includes(datos.alfa) && normalizar(p3.texto).includes(datos.gamma);
  return { alfa, gamma, json, ms: Date.now() - inicio, detalle: { alfaResp: p1.texto.trim().slice(0, 120), gammaResp: p2.texto.trim().slice(0, 120), jsonResp: p3.texto.trim().slice(0, 200) } };
}

// ---------------------------------------------------------------- tareas de código
/** Quita cercas de markdown y preámbulos "Aquí está…". @param {string} bruto */
function limpiarCodigo(bruto) {
  let texto = String(bruto || "").replace(/\r\n/g, "\n");
  const cerca = texto.match(/```[A-Za-z0-9+#.-]*[ \t]*\n([\s\S]*?)\n?```/);
  if (cerca) texto = cerca[1];
  texto = texto.replace(/^\s*```[A-Za-z0-9+#.-]*[ \t]*\n?/, "").replace(/\n?```\s*$/, "");
  return texto.trim();
}

/** @returns {Promise<boolean>} */
function ejecutarPython(codigo) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "calidad-kv-py-"));
  try {
    fs.writeFileSync(path.join(tmp, "sol.py"), `${codigo}\n`, "utf8");
    fs.writeFileSync(path.join(tmp, "test.py"), "import runpy\nns = runpy.run_path(r'sol.py')\nf = ns.get('es_primo')\nassert callable(f), 'no definió es_primo'\nassert f(2) is True and f(3) is True and f(17) is True\nassert f(1) is False and f(20) is False and f(21) is False and f(25) is False\nprint('OK')\n", "utf8");
    return new Promise((resolve) => {
      execFile("python", [path.join(tmp, "test.py")], { cwd: tmp, windowsHide: true, timeout: 30_000 }, (err, stdout) => resolve(!err && /OK/.test(String(stdout))));
    });
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temporal */ }
  }
}

/** @returns {Promise<boolean>} */
function ejecutarJavaScript(codigo) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "calidad-kv-js-"));
  try {
    fs.writeFileSync(path.join(tmp, "sol.mjs"), `${codigo}\n`, "utf8");
    fs.writeFileSync(path.join(tmp, "test.mjs"), "import fs from 'node:fs'\nconst code = fs.readFileSync('sol.mjs','utf8')\nconst f = new Function(`${code}; return contarVocales;`)()\nif (typeof f !== 'function') throw new Error('no definió contarVocales')\nif (f('hola') !== 2 || f('murcielago') !== 5 || f('xyz') !== 0 || f('AEIOU') !== 5) throw new Error('resultado incorrecto')\nconsole.log('OK')\n", "utf8");
    return new Promise((resolve) => {
      execFile(process.execPath, [path.join(tmp, "test.mjs")], { cwd: tmp, windowsHide: true, timeout: 30_000 }, (err, stdout) => resolve(!err && /OK/.test(String(stdout))));
    });
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* temporal */ }
  }
}

/**
 * @param {string} base
 * @returns {Promise<{python: boolean, javascript: boolean, ms: number}>}
 */
async function tareasCodigo(base) {
  const inicio = Date.now();
  const py = await preguntar(base, "Escribe código Python que defina la función es_primo(n) (True si n es primo, False si no, incluye n=1 como False). Devuelve SOLO el código, sin ejemplos, sin explicaciones y sin cercas de markdown.", 400);
  const js = await preguntar(base, "Escribe código JavaScript que defina la función contarVocales(s), que cuenta las vocales (a,e,i,o,u; mayúsculas o minúsculas) de s. Devuelve SOLO el código, sin ejemplos, sin explicaciones y sin cercas de markdown.", 400);
  const [python, javascript] = await Promise.all([ejecutarPython(limpiarCodigo(py.texto)), ejecutarJavaScript(limpiarCodigo(js.texto))]);
  return { python, javascript, ms: Date.now() - inicio };
}

// ---------------------------------------------------------------- ejecución
const CONFIGS = [
  { nombre: "A · 32K · q8_0 · visión", contexto: 32768, kv: "q8_0", vision: true },
  { nombre: "B · 16K · f16 · visión", contexto: 16384, kv: "f16", vision: true },
  { nombre: "C · 32K · f16 · sin visión", contexto: 32768, kv: "f16", vision: false },
];
const fuente = textoDelProyecto();
const corto = pajar(fuente, 4000);
const largo = pajar(fuente, 12000);
const resultados = [];
let fallos = 0;

for (const cfg of CONFIGS) {
  const puerto = await puertoLibre();
  process.stdout.write(`\n▶ ${cfg.nombre} (puerto ${puerto})\n`);
  let srv = null;
  try {
    srv = await arrancar({ ...cfg, modelo: "ornith9b", puerto });
    process.stdout.write(`   cargado en ${(srv.arranqueMs / 1000).toFixed(1)} s · n_ctx=${srv.nCtx}\n`);
    const niahCorto = await niah(srv.base, corto);
    const codigo = await tareasCodigo(srv.base);
    /** @type {null | {alfa: boolean, gamma: boolean, json: boolean, detalle: Record<string,string>, ms: number}} */
    const niahLargo = cfg.contexto >= 32768 ? await niah(srv.base, largo) : null;
    const fila = {
      config: cfg.nombre,
      nCtx: srv.nCtx,
      arranqueMs: srv.arranqueMs,
      niahCorto: { alfa: niahCorto.alfa, gamma: niahCorto.gamma, json: niahCorto.json, detalle: niahCorto.detalle },
      niahLargo: niahLargo ? { alfa: niahLargo.alfa, gamma: niahLargo.gamma, json: niahLargo.json, detalle: niahLargo.detalle } : null,
      codigo,
    };
    resultados.push(fila);
    const marca = (v) => (v ? "OK " : "FALLA ");
    process.stdout.write(`   NIAH 4k:   alfa ${marca(niahCorto.alfa)} gamma ${marca(niahCorto.gamma)} json ${marca(niahCorto.json)}\n`);
    if (niahLargo) process.stdout.write(`   NIAH 12k:  alfa ${marca(niahLargo.alfa)} gamma ${marca(niahLargo.gamma)} json ${marca(niahLargo.json)}\n`);
    process.stdout.write(`   código:    python ${marca(codigo.python)} javascript ${marca(codigo.javascript)}\n`);
  } catch (err) {
    fallos += 1;
    process.stderr.write(`FALLO ${cfg.nombre}: ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    if (srv) await parar(srv);
    await waiting(1500);
  }
}

// ---------------------------------------------------------------- informe
const salida = path.join(PROJECT, "salida", `calidad-kv-${new Date().toISOString().slice(0, 10)}`);
fs.mkdirSync(salida, { recursive: true });
fs.writeFileSync(path.join(salida, "resultados.json"), JSON.stringify({ fecha: new Date().toISOString(), modelo: "ornith9b", resultados }, null, 2));
process.stdout.write(`\nResultados: ${path.join(salida, "resultados.json")}\n`);

const a = resultados.find((r) => r.config.startsWith("A"));
const c = resultados.find((r) => r.config.startsWith("C"));
const b = resultados.find((r) => r.config.startsWith("B"));
if (!a) {
  process.stderr.write("No se pudo medir la configuración recomendada (A).\n");
  process.exitCode = 1;
} else {
  // Aceptación mínima: q8_0 recupera TODO lo que recupera f16 en el mismo contexto y
  // las tareas de código pasan. Si q8_0 fallara algo que f16 acierta, habría que avisar.
  const total = (fila) => (fila ? [fila.niahCorto.alfa, fila.niahCorto.gamma, fila.niahCorto.json, fila.codigo.python, fila.codigo.javascript, ...(fila.niahLargo ? [fila.niahLargo.alfa, fila.niahLargo.gamma, fila.niahLargo.json] : [])].filter(Boolean).length : 0);
  const posible = (fila) => (fila ? 5 + (fila.niahLargo ? 3 : 0) : 0);
  process.stdout.write(`\nq8_0/32K: ${total(a)}/${posible(a)} · f16/32K sin visión: ${total(c)}/${posible(c)} · f16/16K con visión: ${total(b)}/${posible(b)}\n`);
  if (total(a) < posible(a)) {
    process.stderr.write("La configuración recomendada (q8_0 32K visión) no superó todas las pruebas: revisa el informe antes de mantenerla.\n");
    process.exitCode = 1;
  } else {
    process.stdout.write("Calidad q8_0/32K: sin fallos en esta batería (misma calidad que f16 en estas pruebas).\n");
  }
}
assert.ok(resultados.length > 0, "no se midió ninguna configuración");
if (fallos) process.exitCode = 1;
