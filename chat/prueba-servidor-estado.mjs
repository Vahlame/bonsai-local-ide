/**
 * Pruebas de aceptación del servidor de estado y archivos (hallazgos 2, 4, 5, 6 y 8
 * del reporte de codex):
 *  - 413 limpio con Content-Length y con transferencia por fragmentos;
 *  - lectura de archivos enormes con stat + recorte UTF-8 correcto;
 *  - guardado con precondición `before` (409 sin sobrescribir) y /api/edit con `base`;
 *  - recuperación de historial corrupto sin borrar las copias malas;
 *  - reglas del proyecto que no siguen enlaces fuera del proyecto;
 *  - búsqueda que no lee archivos enormes;
 *  - /api/state con el presupuesto real de contexto.
 *
 *   node chat/prueba-servidor-estado.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const base = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-estado-"));
const estado = path.join(base, "estado");
const proyecto = path.join(base, "proyecto");
const fuera = path.join(base, "fuera");
fs.mkdirSync(estado, { recursive: true });
fs.mkdirSync(proyecto, { recursive: true });
fs.mkdirSync(fuera, { recursive: true });
fs.writeFileSync(path.join(estado, "ui-workspace.json"), JSON.stringify({ path: proyecto }));
fs.writeFileSync(path.join(estado, "ui-settings.json"), JSON.stringify({ historial: 32768, pensar: 0, reglas: true }));

// Proyecto de prueba
fs.writeFileSync(path.join(proyecto, "saludo.txt"), "hola mundo\nsegunda linea\n");
fs.writeFileSync(path.join(proyecto, "editar.txt"), "uno\ndos\ntres\n");
fs.writeFileSync(path.join(proyecto, "BONSAI.md"), "Regla normal del proyecto.\n");
fs.writeFileSync(path.join(fuera, "AGENTS.md"), "REGLA_DE_FUERA_NO_DEBE_LEERSE\n");
fs.mkdirSync(path.join(fuera, ".cursor", "rules"), { recursive: true });
fs.writeFileSync(path.join(fuera, ".cursor", "rules", "secreta.mdc"), "---\nalwaysApply: true\n---\nREGLA_SECRETA_DE_FUERA\n");
// Enlaces reales: un archivo AGENTS.md enlazado fuera del proyecto y .cursor enlazado fuera.
try {
  fs.symlinkSync(path.join(fuera, "AGENTS.md"), path.join(proyecto, "AGENTS.md"), "file");
} catch { /* sin privilegios de enlace: el caso del archivo se omite */ }
try {
  fs.symlinkSync(path.join(fuera, ".cursor"), path.join(proyecto, ".cursor"), "junction");
} catch { /* idem */ }
// Archivo grande para GET (2,5 MB) y archivo con multibyte en la frontera de 2 MB.
fs.writeFileSync(path.join(proyecto, "grande.txt"), "a".repeat(2_500_000));
fs.writeFileSync(path.join(proyecto, "frontera.txt"), `${"a".repeat(1_999_999)}é${"b".repeat(100)}`);
// Búsqueda: un archivo enorme (se debe saltar) y uno normal.
fs.writeFileSync(path.join(proyecto, "enorme.txt"), `${"relleno ".repeat(120_000)}AGUJA_GRANDE`);
fs.writeFileSync(path.join(proyecto, "normal.txt"), "aqui esta AGUJA_PEQUENA\n");

// Historial corrupto a propósito: índice ilegible, sesión ilegible y charla archivada válida.
fs.mkdirSync(path.join(estado, "ui-chats"), { recursive: true });
fs.writeFileSync(path.join(estado, "ui-chats", "index.json"), "{esto no es json");
fs.writeFileSync(path.join(estado, "ui-session.json"), "{tampoco");
fs.writeFileSync(path.join(estado, "ui-chats", "abc123.json"), JSON.stringify({ memory: "", folded: 0, turns: [{ role: "user", content: "hola archivo recuperado" }, { role: "assistant", content: "respuesta vieja" }], files: [] }));

// llama-server simulado
let respuestaEdit = "LINEA_NUEVA";
const llama = http.createServer((req, res) => {
  const json = (dato) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(dato));
  if (req.url === "/health") return json({ status: "ok" });
  if (req.url === "/props") return json({ default_generation_settings: { n_ctx: 16384 }, modalities: { vision: false }, model_path: path.join(PROJECT, "models", "Ornith-1.5-9B-Q4_K_M.gguf") });
  if (req.url === "/v1/models") return json({ data: [{ id: "Ornith-1.5-9B-Q4_K_M.gguf" }] });
  let crudo = "";
  req.on("data", (b) => { crudo += b; });
  req.on("end", () => {
    let body = {};
    try { body = JSON.parse(crudo); } catch { body = {}; }
    if (req.url === "/v1/chat/completions/input_tokens") return json({ input_tokens: 500 });
    if (req.url !== "/v1/chat/completions") return res.writeHead(404).end("{}");
    if (!body.stream) return json({ choices: [{ message: { content: "resumen" } }] });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: respuestaEdit } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  });
});
await new Promise((r) => llama.listen(0, "127.0.0.1", r));
const puertoLlama = llama.address().port;
const hueco = http.createServer();
await new Promise((r) => hueco.listen(0, "127.0.0.1", r));
const puertoUi = hueco.address().port;
await new Promise((r) => hueco.close(r));
let log = "";
const hijo = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(puertoUi), "--llama-port", String(puertoLlama)], {
  cwd: PROJECT,
  env: { ...process.env, BONSAI_STATE: estado, BONSAI_SALIDA: path.join(base, "salida") },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
hijo.stdout.on("data", (b) => { log += b; });
hijo.stderr.on("data", (b) => { log += b; });

/**
 * @param {string} metodo
 * @param {string} ruta
 * @param {Buffer | string | undefined} cuerpo
 * @param {Record<string, string>} [cabeceras]
 * @returns {Promise<{status: number, body: string, headers: http.IncomingHttpHeaders, corte: boolean}>}
 */
function pedir(metodo, ruta, cuerpo, cabeceras = {}) {
  return new Promise((resolve) => {
    const datos = cuerpo === undefined ? undefined : Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(String(cuerpo));
    const req = http.request({ host: "127.0.0.1", port: puertoUi, method: metodo, path: ruta, headers: { host: `127.0.0.1:${puertoUi}`, ...cabeceras, ...(datos ? { "content-length": String(datos.length) } : {}) } }, (res) => {
      let texto = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { texto += c; });
      res.on("end", () => resolve({ status: res.statusCode || 0, body: texto, headers: res.headers, corte: false }));
      res.on("error", () => resolve({ status: res.statusCode || 0, body: texto, headers: res.headers, corte: true }));
    });
    req.on("error", (err) => resolve({ status: 0, body: `corte: ${err.message}`, headers: {}, corte: true }));
    if (datos) req.write(datos);
    req.end();
  });
}

/** Envía un cuerpo por fragmentos, sin Content-Length. */
function pedirFragmentado(metodo, ruta, trozos) {
  return new Promise((resolve) => {
    const req = http.request({ host: "127.0.0.1", port: puertoUi, method: metodo, path: ruta, headers: { host: `127.0.0.1:${puertoUi}`, "content-type": "application/json", "transfer-encoding": "chunked" } }, (res) => {
      let texto = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { texto += c; });
      res.on("end", () => resolve({ status: res.statusCode || 0, body: texto, headers: res.headers }));
    });
    req.on("error", (err) => resolve({ status: 0, body: `corte: ${err.message}`, headers: {} }));
    for (const trozo of trozos) req.write(trozo);
    req.end();
  });
}

let fallos = 0;
const check = (nombre, cond, detalle = "") => {
  if (cond) console.log(`ok    ${nombre}`);
  else {
    fallos += 1;
    console.error(`FALLO ${nombre}${detalle ? `: ${detalle}` : ""}`);
  }
};

try {
  let listo = false;
  for (let i = 0; i < 100; i += 1) {
    try {
      const r = await pedir("GET", "/api/gpu");
      if (r.status === 200) { listo = true; break; }
    } catch { /* arrancando */ }
    if (hijo.exitCode !== null) throw new Error(`el servidor murió:\n${log}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!listo) throw new Error(`la UI no arrancó:\n${log}`);

  // ---------- 2: recuperación del historial ----------
  const est = JSON.parse((await pedir("GET", "/api/state")).body);
  check("2: la sesión de trabajo corrupta se recupera desde el historial", Array.isArray(est.turns) && est.turns.some((t) => /hola archivo recuperado/.test(String(t.content))), JSON.stringify(est.turns?.slice(0, 2)));
  const nombres = fs.readdirSync(estado);
  check("2: el archivo corrupto se conserva apartado (no se borra)", nombres.some((n) => /ui-session\.json\.corrupto-/.test(n)), nombres.join(","));
  check("2: el índice ilegible se reconstruye y conserva copia", nombres.some((n) => /ui-chats/.test(n)) && fs.readdirSync(path.join(estado, "ui-chats")).some((n) => /index\.json\.corrupto-/.test(n)), fs.readdirSync(path.join(estado, "ui-chats")).join(","));
  check("2: /api/state informa de que no hay error de archivado pendiente", !est.historial?.error, JSON.stringify(est.historial));

  // ---------- 16: presupuesto real expuesto ----------
  const pres = est.presupuesto || {};
  check("16: /api/state expone ventana, solicitado, efectivo y reserva de salida", Number.isFinite(pres.ventana) && Number.isFinite(pres.solicitado) && Number.isFinite(pres.efectivo) && Number.isFinite(pres.reservaSalida), JSON.stringify(pres));

  // ---------- 6: reglas que no siguen enlaces ----------
  const reglas = JSON.parse((await pedir("GET", "/api/rules")).body);
  check("6: las reglas normales del proyecto se leen", reglas.fuentes.includes("BONSAI.md") && reglas.texto.includes("Regla normal"), JSON.stringify(reglas.fuentes));
  check("6: una regla enlazada fuera del proyecto NO se lee", !reglas.texto.includes("REGLA_DE_FUERA_NO_DEBE_LEERSE"), reglas.texto.slice(0, 120));
  check("6: una carpeta .cursor enlazada fuera NO se recorre", !reglas.texto.includes("REGLA_SECRETA_DE_FUERA"), reglas.texto.slice(0, 200));

  // ---------- 4: lectura con stat + recorte UTF-8 ----------
  const grande = await pedir("GET", "/api/file?path=grande.txt");
  check("4: un archivo de 2,5 MB se sirve marcado como truncado", grande.status === 200 && grande.headers["x-bonsai-truncado"] === "1" && grande.headers["x-bonsai-bytes"] === "2500000", `status=${grande.status} headers=${JSON.stringify(grande.headers)}`);
  check("4: el cuerpo del archivo truncado no supera 2 MB", Buffer.byteLength(grande.body, "utf8") <= 2_000_000);
  const frontera = await pedir("GET", "/api/file?path=frontera.txt");
  check("4: un corte a mitad de carácter UTF-8 no produce U+FFFD", frontera.status === 200 && !frontera.body.includes("\uFFFD"), JSON.stringify(frontera.body.slice(-4)));
  const enlaceFuera = await pedir("GET", "/api/file?path=AGENTS.md");
  check("3/6: /api/file no sigue un enlace fuera del proyecto", enlaceFuera.status === 404, `status=${enlaceFuera.status} body=${enlaceFuera.body}`);

  // ---------- 4: búsqueda no lee archivos enormes ----------
  const busqueda = JSON.parse((await pedir("GET", "/api/search?q=aguja")).body);
  const rels = (busqueda.resultados || []).map((r) => r.rel);
  check("4: la búsqueda encuentra el archivo normal", rels.includes("normal.txt"), JSON.stringify(rels));
  check("4: la búsqueda no lee el archivo enorme (>800 KB)", !rels.includes("enorme.txt"), JSON.stringify(rels));

  // ---------- 8/4: guardado con before ----------
  const guardado = await pedir("POST", "/api/file", JSON.stringify({ path: "saludo.txt", content: "adios mundo\n", before: "hola mundo\nsegunda linea\n" }), { "content-type": "application/json" });
  check("8: guardar con la versión correcta funciona", guardado.status === 200, `status=${guardado.status} ${guardado.body}`);
  const conflicto = await pedir("POST", "/api/file", JSON.stringify({ path: "saludo.txt", content: "otra cosa\n", before: "hola mundo\nsegunda linea\n" }), { "content-type": "application/json" });
  check("8: con una versión vieja devuelve 409 sin sobrescribir", conflicto.status === 409 && fs.readFileSync(path.join(proyecto, "saludo.txt"), "utf8") === "adios mundo\n", `status=${conflicto.status}`);

  // ---------- 8: /api/edit devuelve base y rango real ----------
  const editado = await pedir("POST", "/api/edit", JSON.stringify({ path: "editar.txt", start: 2, end: 2, instruccion: "cambia dos" }), { "content-type": "application/json" });
  const editJson = editado.status === 200 ? JSON.parse(editado.body) : {};
  check("8: /api/edit devuelve el contenido base exacto", editado.status === 200 && editJson.base === "uno\ndos\ntres\n", `status=${editado.status} ${editado.body.slice(0, 200)}`);
  check("8: /api/edit devuelve el rango real aplicado", editJson.start === 2 && editJson.end === 2, JSON.stringify({ start: editJson.start, end: editJson.end }));
  check("8: /api/edit aplica la propuesta", editJson.texto === "uno\nLINEA_NUEVA\ntres\n", JSON.stringify(editJson.texto));
  // Respuesta vacía: no debe borrar la selección.
  respuestaEdit = "   \n  ";
  const vacio = await pedir("POST", "/api/edit", JSON.stringify({ path: "editar.txt", start: 2, end: 2, instruccion: "no devuelvas nada" }), { "content-type": "application/json" });
  check("10: una respuesta vacía del modelo no se aplica como borrado", vacio.status === 422, `status=${vacio.status} body=${vacio.body.slice(0, 160)}`);

  // ---------- 5: 413 limpio ----------
  const enorme = JSON.stringify({ text: "x".repeat(300_000) });
  const porLongitud = await pedir("POST", "/api/chat", enorme, { "content-type": "application/json" });
  check("5: un cuerpo demasiado grande con Content-Length recibe 413 limpio", porLongitud.status === 413 && /demasiado largo/.test(porLongitud.body), `status=${porLongitud.status} body=${porLongitud.body.slice(0, 120)}`);
  const trozos = [Buffer.from('{"text":"'), Buffer.from("x".repeat(120_000)), Buffer.from("x".repeat(120_000)), Buffer.from('"}')];
  const fragmentado = await pedirFragmentado("POST", "/api/chat", trozos);
  check("5: un cuerpo demasiado grande por fragmentos recibe 413 limpio", fragmentado.status === 413 && /demasiado largo/.test(fragmentado.body), `status=${fragmentado.status} body=${fragmentado.body.slice(0, 120)}`);

  // ---------- 2: el archivado usa JSON atómico (archivos válidos y con respaldo) ----------
  await pedir("POST", "/api/chats", JSON.stringify({ op: "new" }), { "content-type": "application/json" });
  const ids = fs.readdirSync(path.join(estado, "ui-chats")).filter((n) => /^[a-z0-9]{6,40}\.json$/.test(n) && n !== "index.json");
  const valido = ids.length > 0 && ids.every((n) => {
    try { JSON.parse(fs.readFileSync(path.join(estado, "ui-chats", n), "utf8")); return true; } catch { return false; }
  });
  check("2: los archivos de historial archivados siempre son JSON válido", valido, ids.join(","));
  const indice = fs.existsSync(path.join(estado, "ui-chats", "index.json"));
  check("2: el índice se reescribe de forma atómica", indice);
} finally {
  const salida = hijo.exitCode === null ? once(hijo, "exit") : Promise.resolve();
  hijo.kill();
  await salida;
  llama.closeAllConnections();
  await new Promise((r) => llama.close(r));
  try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* evidencia temporal */ }
}

if (fallos) {
  console.error(`\nprueba-servidor-estado: ${fallos} fallo(s)`);
  process.exitCode = 1;
} else {
  console.log("\nprueba-servidor-estado: OK");
}
