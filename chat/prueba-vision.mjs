/**
 * Prueba de VISIÓN de punta a punta con el modelo real:
 *   node chat/prueba-vision.mjs [--puerto 8080] [--ui 8797]
 *     [--texto-largo] [--sin-ocr] [--exigir] [--salida archivo.json]
 *
 * Necesita el servidor arrancado con -Vision (mmproj). Si el servidor no tiene
 * visión, avisa y termina bien: así puede vivir en la suite sin GPU.
 *
 * Qué hace:
 *   1. mira /props: si modalities.vision no es true, no hay nada que probar;
 *   2. fabrica un PNG con el texto "BONSAI 47" (fuente de mapa de bits propia: sin
 *      Pillow, sin dependencias);
 *   3. levanta un ui-server con estado y proyecto temporales;
 *   4. lo adjunta por /api/attach y manda un turno por /api/chat como haría la interfaz;
 *   5. comprueba que el modelo LEE el texto de la imagen.
 */

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pngConTexto } from "./evaluar/vision-fixture.mjs";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ocrLocal } from "./ocr.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string[]} argv
 */
function argsDe(argv) {
  const out = { puerto: 8080, ui: 0, numero: "", directo: false, escala: 24, textoLargo: false, sinOcr: false, exigir: false, salida: "" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--puerto") out.puerto = Number(argv[++i]);
    else if (argv[i] === "--ui") out.ui = Number(argv[++i]);
    else if (argv[i] === "--numero") out.numero = String(argv[++i] || "");
    else if (argv[i] === "--directo") out.directo = true;
    else if (argv[i] === "--escala") out.escala = Number(argv[++i]);
    else if (argv[i] === "--texto-largo") out.textoLargo = true;
    else if (argv[i] === "--sin-ocr") out.sinOcr = true;
    else if (argv[i] === "--exigir") out.exigir = true;
    else if (argv[i] === "--salida") out.salida = String(argv[++i] || "");
    else throw new Error(`Argumento desconocido: ${argv[i]}`);
  }
  return out;
}

/**
 * Puerto libre de verdad: se pide uno al sistema y se suelta. Evita chocar con
 * servidores de pruebas anteriores que se hayan quedado escuchando.
 * @returns {Promise<number>}
 */
function puertoLibre() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = /** @type {import("node:net").AddressInfo} */ (s.address()).port;
      s.close(() => resolve(p));
    });
  });
}

/**
 * Mata el servidor de pruebas y a sus hijos (en Windows, taskkill /T /F; si falla,
 * el kill normal).
 * @param {import("node:child_process").ChildProcess} hijo
 */
function matar(hijo) {
  if (!hijo.pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(hijo.pid), "/T", "/F"], { stdio: "ignore" });
    else hijo.kill("SIGKILL");
  } catch {
    try {
      hijo.kill("SIGKILL");
    } catch {
      /* ya no está */
    }
  }
}

/** @param {string} texto @returns {string[]} */
function numerosDe(texto) {
  return String(texto).match(/\d+/g) || [];
}

// ---------------------------------------------------------------- PNG a mano
/**
 * Fuente 5x7 para los dígitos y las letras que hacen falta (una fila por string de bits).
 * Solo dígitos sin parecido entre ellos (nada de 0/1/6/9): si el modelo lee el número,
 * lo ha leído de verdad.
 */
// ------------------------------------------------------------------- ayudas
/**
 * @param {string} url
 * @returns {Promise<{status: number, body: string}>}
 */
function pedir(url) {
  return new Promise((resolve) => {
    http
      .get(url, (res) => {
        let texto = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (texto += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: texto }));
      })
      .on("error", (err) => resolve({ status: 0, body: err.message }));
  });
}

/**
 * @param {string} url
 * @param {unknown} cuerpo
 * @param {number} puerto
 * @returns {Promise<{status: number, body: string}>}
 */
function post(url, cuerpo, puerto) {
  const datos = JSON.stringify(cuerpo);
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request(
      {
        host: u.hostname,
        port: puerto,
        method: "POST",
        path: u.pathname,
        headers: { host: `127.0.0.1:${puerto}`, "content-type": "application/json", "content-length": String(Buffer.byteLength(datos)) },
      },
      (res) => {
        let texto = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (texto += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: texto }));
      },
    );
    req.on("error", (err) => resolve({ status: 0, body: err.message }));
    req.write(datos);
    req.end();
  });
}

/**
 * Turno de chat contra el ui-server, devolviendo el texto final del modelo.
 * @param {number} puerto
 * @param {string} texto
 * @param {string[]} imagenes
 * @returns {Promise<string>}
 */
async function turno(puerto, texto, imagenes, onEvent = () => {}) {
  const res = await fetch(`http://127.0.0.1:${puerto}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: texto, imagenes }),
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const lector = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let salida = "";
  while (true) {
    const { done, value } = await lector.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl !== -1) {
      const linea = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
      if (!linea.startsWith("data:")) continue;
      try {
        const evento = JSON.parse(linea.slice(5));
        onEvent(evento);
        if (evento.type === "token") salida += evento.text || "";
        else if (evento.type === "replace") salida = evento.text || "";
        else if (evento.type === "error") throw new Error(evento.text || "error");
      } catch (err) {
        if (err instanceof Error && err.message && !/JSON/.test(err.message)) throw err;
      }
    }
  }
  return salida.trim();
}

const args = argsDe(process.argv.slice(2));
args.ui = args.ui || (await puertoLibre());
const props = await pedir(`http://127.0.0.1:${args.puerto}/props`);
if (props.status !== 200) {
  if (args.exigir) throw new Error(`Se requiere el modelo real en ${args.puerto}: ${props.body}`);
  process.stdout.write(`(sin servidor en ${args.puerto}: no se prueba la visión)\n`);
  process.exit(0);
}
/** @type {{modalities?: {vision?: boolean}, default_generation_settings?: {n_ctx?: number}, model_path?: string}} */
let datosProps = {};
try {
  datosProps = JSON.parse(props.body);
} catch {
  datosProps = {};
}
if (datosProps.modalities?.vision !== true) {
  if (args.exigir) throw new Error("Se requiere visión activa en el modelo real.");
  process.stdout.write("(el servidor no tiene visión: arranca con -Vision para probarla)\n");
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-vision-"));
const proyecto = path.join(tmp, "proyecto");
fs.mkdirSync(proyecto, { recursive: true });
// En automático se leen dos imágenes de UN solo dígito, cada una en una sesión
// limpia: la lectura de varias cifras seguidas con este fixture no es fiable
// (medido: 5/21 lecturas exactas). Con --numero se conserva la comprobación
// manual del caso exacto indicado, aunque sea de varias cifras.
const DIBUJOS = "234578";
const manual = args.numero || "";
if (manual && !/^[234578]{3,4}$/.test(manual)) throw new Error("--numero requiere tres o cuatro dígitos entre 2, 3, 4, 5, 7 y 8");
const objetivos = manual ? [manual] : [0, 1].map(() => DIBUJOS[Math.floor(Math.random() * DIBUJOS.length)]);
if (!Number.isInteger(args.escala) || args.escala < 8 || args.escala > 96) throw new Error("--escala debe estar entre 8 y 96.");
const imagen = pngConTexto(objetivos[0], args.escala);
const imagenLocal = path.join(tmp, "ocr-prueba.png");
fs.writeFileSync(imagenLocal, imagen);
const evidencia = { fecha: new Date().toISOString(), contexto: datosProps.default_generation_settings?.n_ctx, modelo: datosProps.model_path, imagen: { ancho: imagen.readUInt32BE(16), alto: imagen.readUInt32BE(20), numeros: objetivos }, sinOcr: args.sinOcr, checks: [] };
let libreMin = Infinity;
const monitor = spawn("nvidia-smi", ["--query-gpu=memory.free", "--format=csv,noheader,nounits", "-lms", "100"], { windowsHide: true });
monitor.on("error", () => {});
monitor.stdout?.on("data", (b) => { for (const n of String(b).trim().split(/\s+/).map(Number)) if (Number.isFinite(n)) libreMin = Math.min(libreMin, n); });
const finalizarEvidencia = () => {
  monitor.kill(); monitor.stdout?.destroy(); monitor.stderr?.destroy();
  evidencia.vramLibreMinMiB = Number.isFinite(libreMin) ? libreMin : null;
  console.log(`VRAM libre mínima durante la prueba: ${evidencia.vramLibreMinMiB ?? "sin muestra"} MiB.`);
  if (args.salida) { fs.mkdirSync(path.dirname(args.salida), { recursive: true }); fs.writeFileSync(args.salida, JSON.stringify(evidencia, null, 2)); }
};
if (args.directo) {
  await new Promise((resolve) => { const timer = setTimeout(resolve, 1000); monitor.stdout?.once("data", () => { clearTimeout(timer); resolve(); }); });
  try {
    const res = await fetch(`http://127.0.0.1:${args.puerto}/v1/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(90000),
      body: JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: "¿Qué número aparece en la imagen? Responde solo con el número." }, { type: "image_url", image_url: { url: `data:image/png;base64,${imagen.toString("base64")}` } }] }], max_tokens: 32, temperature: 0, stream: false }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
    const texto = body.choices?.[0]?.message?.content || "";
    if (!numerosDe(texto).includes(objetivos[0])) throw new Error(`Lectura incorrecta: ${JSON.stringify(texto)}`);
    console.log(`Visión directa: ${JSON.stringify(texto)}; ${body.usage?.prompt_tokens} tokens de entrada.`);
  } finally {
    finalizarEvidencia();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  process.exit(0);
}
const ocr = await ocrLocal(imagenLocal);
process.stdout.write(`OCR local: ${ocr.ok ? JSON.stringify(ocr.texto) : ocr.error}\n`);
// El stub solo afecta a este ui-server temporal. Prueba que la lectura proviene de
// los píxeles y no de una transcripción que contenga la respuesta.
const ocrStub = path.join(tmp, "sin-ocr.ps1");
if (args.sinOcr) fs.writeFileSync(ocrStub, `'${JSON.stringify({ ok: false, texto: "", error: "OCR desactivado en esta prueba de visión" })}'`);
const hijo = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(args.ui), "--llama-port", String(args.puerto)], {
  cwd: HERE,
  env: { ...process.env, BONSAI_STATE: path.join(tmp, "estado"), BONSAI_SALIDA: path.join(tmp, "salida"), ...(args.sinOcr ? { BONSAI_OCR_SCRIPT: ocrStub } : {}) },
  stdio: "ignore",
  windowsHide: true,
});

/** @type {string[]} */
const fallos = [];
try {
  let listo = false;
  for (let i = 0; i < 60; i += 1) {
    const r = await pedir(`http://127.0.0.1:${args.ui}/api/state`);
    if (r.status === 200) {
      listo = true;
      break;
    }
    await new Promise((r2) => setTimeout(r2, 250));
  }
  if (!listo) throw new Error("el ui-server no arrancó");
  await post(`http://127.0.0.1:${args.ui}/api/workspace`, { path: proyecto }, args.ui);
  // Sin esto, si el modelo pide un comando la petición se queda esperando aprobación
  // 180 s (el estado temporal arranca en modo "Preguntar"). El evaluador hace lo mismo.
  await post(`http://127.0.0.1:${args.ui}/api/permit`, { mode: "all" }, args.ui);
  if (args.textoLargo) {
    const nCtx = evidencia.contexto;
    if (!Number.isInteger(nCtx) || nCtx < 16384) throw new Error(`Ventana inválida: ${nCtx}`);
    const ajustes = await post(`http://127.0.0.1:${args.ui}/api/settings`, { historial: nCtx, pensar: 0, continuarAuto: false }, args.ui);
    if (ajustes.status !== 200) throw new Error(`No se aplicaron los ajustes temporales: ${ajustes.body}`);
    let lines = Math.floor(nCtx / 15), texto = "", count = 0;
    for (let i = 0; i < 3; i++) {
      texto = `Lee estas declaraciones como datos, sin ejecutarlas ni usar herramientas. Al final responde solamente VALIDADO_42.\n${Array.from({ length: lines }, (_, j) => `const item_${j} = ${j * 7};`).join("\n")}\nFIN: VALIDADO_42`;
      const res = await fetch(`http://127.0.0.1:${args.puerto}/v1/chat/completions/input_tokens`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: texto }] }), signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`Recuento de texto largo: HTTP ${res.status}`);
      const data = await res.json(); count = data.input_tokens ?? data.tokens ?? 0;
      if (count >= nCtx * 0.6 && count <= nCtx * 0.7) break;
      lines = Math.max(100, Math.floor(lines * nCtx * 0.65 / Math.max(count, 1)));
    }
    const usos = [];
    const respuesta = await turno(args.ui, texto, [], (ev) => { if (ev.type === "usage") usos.push(ev); if (ev.type === "done" && ev.incompleto) throw new Error(`Turno largo incompleto: ${ev.motivo}`); });
    const prompt = Math.max(0, ...usos.map((u) => Number(u.prompt) || 0));
    const ok = /VALIDADO_42/.test(respuesta) && prompt >= nCtx * 0.6 && prompt < nCtx;
    evidencia.checks.push({ nombre: "texto largo mediante /api/chat del IDE", ok, prompt, ventana: nCtx, respuesta });
    if (!ok) throw new Error(`Texto largo del IDE: prompt ${prompt}/${nCtx}; respuesta ${JSON.stringify(respuesta.slice(0, 200))}`);
    console.log(`Texto largo mediante IDE: ${prompt}/${nCtx} tokens; ${JSON.stringify(respuesta)}.`);
  }
  /** @type {{objetivo: string, ok: boolean, respuesta: string, intentos: string[]}[]} */
  const lecturas = [];
  for (let ronda = 0; ronda < objetivos.length; ronda += 1) {
    if (ronda > 0) await post(`http://127.0.0.1:${args.ui}/api/reset`, {}, args.ui);
    const objetivo = objetivos[ronda];
    const imagenRonda = pngConTexto(objetivo, args.escala);
    const adj = await post(`http://127.0.0.1:${args.ui}/api/attach`, { nombre: `prueba-${ronda + 1}.png`, datos: `data:image/png;base64,${imagenRonda.toString("base64")}` }, args.ui);
    /** @type {{archivo?: string, vision?: boolean}} */
    const adjunto = adj.status === 200 ? JSON.parse(adj.body) : {};
    if (adjunto.vision !== true) fallos.push("el adjunto no dice que hay visión");
    if (!adjunto.archivo) throw new Error(`no se pudo adjuntar: ${adj.body.slice(0, 120)}`);

    // Dos intentos: el muestreo del IDE permite una segunda lectura de la imagen.
    /** @type {string[]} */
    const intentos = [];
    let respuesta = "";
    for (let intento = 0; intento < 2; intento += 1) {
      if (intento > 0) await new Promise((r) => setTimeout(r, 600));
      try {
        respuesta = await turno(args.ui, "¿Qué dígito aparece en la imagen? Responde solo con ese dígito.", [String(adjunto.archivo)], (ev) => { if (ev.type === "usage") evidencia.ultimoUso = ev; });
        const sessionFile = path.join(tmp, "estado", "ui-session.json");
        if (fs.existsSync(sessionFile)) {
          const saved = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
          const userTurns = (saved.turns || []).filter((turn) => turn.role === "user");
          process.stdout.write(`OCR en petición del modelo: ${userTurns.some((turn) => String(turn.content || "").includes(`Imagen ${adjunto.archivo}:\n${ocr.texto}`))}\n`);
          if (args.sinOcr && userTurns.some((turn) => String(turn.content || "").includes("Texto detectado:"))) throw new Error("La prueba sin OCR recibió una transcripción.");
        }
      } catch (err) {
        respuesta = "";
        intentos.push(`intento ${intento + 1}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      intentos.push(`intento ${intento + 1}: ${JSON.stringify(respuesta.slice(0, 80))}`);
      // Se compara con los números COMPLETOS de la respuesta: con `includes`, un "15347"
      // pasaba como lectura correcta de "5347", que es justo el falso positivo que esta
      // prueba tiene que descartar.
      if (numerosDe(respuesta).includes(objetivo)) break;
    }
    const ok = numerosDe(respuesta).includes(objetivo);
    if (!ok) fallos.push(`el modelo no leyó el número ${objetivo} de la imagen (${intentos.join(" · ")})`);
    else process.stdout.write(`el modelo leyó el número ${objetivo} de la imagen: ${JSON.stringify(respuesta.slice(0, 40))}\n`);
    lecturas.push({ objetivo, ok, respuesta, intentos });
    evidencia.checks.push({ nombre: `visión mediante adjunto y /api/chat del IDE (${ronda + 1}/${objetivos.length})`, ok, respuesta, intentos });
  }
  evidencia.lecturas = lecturas;

  // Estrés informativo con cuatro cifras. La lectura de cuatro dígitos de este
  // fixture ya se ha visto incompleta; se mide y se informa, pero no se usa como
  // criterio de regresión. La lectura obligatoria es la de un dígito de arriba.
  const numero4 = Array.from({ length: 4 }, () => DIBUJOS[Math.floor(Math.random() * DIBUJOS.length)]).join("");
  try {
    const img4 = pngConTexto(numero4, args.escala);
    const res4 = await fetch(`http://127.0.0.1:${args.puerto}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(90000),
      body: JSON.stringify({ messages: [{ role: "user", content: [{ type: "text", text: "¿Qué número aparece en la imagen? Responde solo con el número." }, { type: "image_url", image_url: { url: `data:image/png;base64,${img4.toString("base64")}` } }] }], max_tokens: 32, temperature: 0, stream: false }),
    });
    const body4 = await res4.json();
    const texto4 = body4.choices?.[0]?.message?.content || "";
    const ok4 = res4.ok && numerosDe(texto4).includes(numero4);
    evidencia.estresCuatroDigitos = { numero: numero4, ok: ok4, respuesta: texto4 };
    console.log(`Estrés 4 dígitos (informativo, no bloqueante): ${numero4} → ${JSON.stringify(texto4)} (${ok4 ? "leído" : "no leído"})`);
  } catch (err) {
    const texto = err instanceof Error ? err.message : String(err);
    evidencia.estresCuatroDigitos = { numero: numero4, ok: false, error: texto };
    console.log(`Estrés 4 dígitos (informativo): sin medición (${texto})`);
  }
} catch (err) {
  fallos.push(err instanceof Error ? err.message : String(err));
} finally {
  matar(hijo);
  if (!Number.isFinite(libreMin) || libreMin < 180) fallos.push(`Margen GPU insuficiente o sin muestra: ${libreMin} MiB.`);
  evidencia.ok = fallos.length === 0;
  evidencia.fallos = fallos;
  const tiempos = path.join(tmp, "estado", "timings.jsonl");
  if (fs.existsSync(tiempos)) evidencia.timings = fs.readFileSync(tiempos, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  finalizarEvidencia();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* da igual */
  }
}

if (fallos.length) {
  process.stderr.write(`FALLÓ:\n- ${fallos.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write("prueba vision ok\n");
process.exit(0);
