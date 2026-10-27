/**
 * Prueba de VISIÓN de punta a punta con el modelo real:
 *   node chat/prueba-vision.mjs [--puerto 8080] [--ui 8797]
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
import zlib from "node:zlib";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ocrLocal } from "./ocr.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string[]} argv
 */
function argsDe(argv) {
  const out = { puerto: 8080, ui: 0, numero: "" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--puerto") out.puerto = Number(argv[++i]);
    else if (argv[i] === "--ui") out.ui = Number(argv[++i]);
    else if (argv[i] === "--numero") out.numero = String(argv[++i] || "");
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
const FUENTE = {
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  B: ["11110", "10001", "11110", "10001", "11110", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  N: ["10001", "11001", "11001", "10101", "10011", "10011", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
};

/**
 * PNG en blanco y negro con el texto dibujado. Sin dependencias.
 * @param {string} texto
 * @param {number} escala
 * @returns {Buffer}
 */
function pngConTexto(texto, escala = 24) {
  const ALTO_MAPA = 7;
  const ancho = (texto.length * 6 + 1) * escala;
  const alto = (ALTO_MAPA + 4) * escala;
  const filas = [];
  for (let y = 0; y < alto; y += 1) {
    const fila = Buffer.alloc(1 + ancho); // 1 byte de filtro + 1 byte por pixel (gris)
    fila[0] = 0;
    fila.fill(255, 1);
    for (let x = 0; x < ancho; x += 1) {
      const glifo = Math.floor(x / escala / 6);
      const dentroX = Math.floor((x - glifo * 6 * escala) / escala);
      const dentroY = Math.floor((y - 2 * escala) / escala);
      const mapa = FUENTE[texto[glifo]] || FUENTE[" "];
      if (dentroY >= 0 && dentroY < ALTO_MAPA && dentroX >= 0 && dentroX < 5 && mapa[dentroY][dentroX] === "1") {
        fila[1 + x] = 0;
      }
    }
    filas.push(fila);
  }
  const crudo = Buffer.concat(filas);
  /**
   * @param {string} tipo
   * @param {Buffer} datos
   * @returns {Buffer}
   */
  const trozo = (tipo, datos) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo) >>> 0);
    return Buffer.concat([largo, cuerpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 0; // escala de grises
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", ihdr),
    trozo("IDAT", zlib.deflateSync(crudo)),
    trozo("IEND", Buffer.alloc(0)),
  ]);
}

/** @type {number[]} */
const TABLA_CRC = (() => {
  /** @type {number[]} */
  const tabla = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[n] = c;
  }
  return tabla;
})();

/** @param {Buffer} buf */
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

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
async function turno(puerto, texto, imagenes) {
  const res = await fetch(`http://127.0.0.1:${puerto}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: texto, imagenes }),
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
  process.stdout.write(`(sin servidor en ${args.puerto}: no se prueba la visión)\n`);
  process.exit(0);
}
/** @type {{modalities?: {vision?: boolean}}} */
let datosProps = {};
try {
  datosProps = JSON.parse(props.body);
} catch {
  datosProps = {};
}
if (datosProps.modalities?.vision !== true) {
  process.stdout.write("(el servidor no tiene visión: arranca con -Vision para probarla)\n");
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-vision-"));
const proyecto = path.join(tmp, "proyecto");
fs.mkdirSync(proyecto, { recursive: true });
// Número aleatorio (solo dígitos que no se confunden entre sí): si el modelo lo dice,
// es que lo ha leído de la imagen.
const DIBUJOS = "234578";
const numero = args.numero || Array.from({ length: 4 }, () => DIBUJOS[Math.floor(Math.random() * DIBUJOS.length)]).join("");
if (!/^[234578]{4}$/.test(numero)) throw new Error("--numero requiere cuatro dígitos entre 2, 3, 4, 5, 7 y 8");
const imagen = pngConTexto(numero);
const imagenLocal = path.join(tmp, "ocr-prueba.png");
fs.writeFileSync(imagenLocal, imagen);
const ocr = await ocrLocal(imagenLocal);
process.stdout.write(`OCR local: ${ocr.ok ? JSON.stringify(ocr.texto) : ocr.error}\n`);
const hijo = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(args.ui), "--llama-port", String(args.puerto)], {
  cwd: HERE,
  env: { ...process.env, BONSAI_STATE: path.join(tmp, "estado"), BONSAI_SALIDA: path.join(tmp, "salida") },
  stdio: "ignore",
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
  const adj = await post(`http://127.0.0.1:${args.ui}/api/attach`, { nombre: "prueba.png", datos: `data:image/png;base64,${imagen.toString("base64")}` }, args.ui);
  /** @type {{archivo?: string, vision?: boolean}} */
  const adjunto = adj.status === 200 ? JSON.parse(adj.body) : {};
  if (adjunto.vision !== true) fallos.push("el adjunto no dice que hay visión");
  if (!adjunto.archivo) throw new Error(`no se pudo adjuntar: ${adj.body.slice(0, 120)}`);

  // Dos intentos: la temperatura es 0.5 y un fallo de lectura no debería ser un falso negativo.
  /** @type {string[]} */
  const intentos = [];
  let respuesta = "";
  for (let intento = 0; intento < 2; intento += 1) {
    if (intento > 0) await new Promise((r) => setTimeout(r, 600));
    try {
      respuesta = await turno(args.ui, "¿Qué número aparece en la imagen? Responde solo con ese número.", [String(adjunto.archivo)]);
      const sessionFile = path.join(tmp, "estado", "ui-session.json");
      if (fs.existsSync(sessionFile)) {
        const saved = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
        const userTurns = (saved.turns || []).filter((turn) => turn.role === "user");
        process.stdout.write(`OCR en petición del modelo: ${userTurns.some((turn) => String(turn.content || "").includes(`Imagen ${adjunto.archivo}:\n${ocr.texto}`))}\n`);
      }
    } catch (err) {
      intentos.push(`intento ${intento + 1}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    intentos.push(`intento ${intento + 1}: ${JSON.stringify(respuesta.slice(0, 80))}`);
    // Se compara con los números COMPLETOS de la respuesta: con `includes`, un "15347"
    // pasaba como lectura correcta de "5347", que es justo el falso positivo que esta
    // prueba tiene que descartar.
    if (numerosDe(respuesta).includes(numero)) break;
  }
  if (!numerosDe(respuesta).includes(numero)) fallos.push(`el modelo no leyó el número ${numero} de la imagen (${intentos.join(" · ")})`);
  else process.stdout.write(`el modelo leyó el número ${numero} de la imagen: ${JSON.stringify(respuesta.slice(0, 40))}\n`);} catch (err) {
  fallos.push(err instanceof Error ? err.message : String(err));
} finally {
  matar(hijo);
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
