/**
 * Preparación de imágenes para el modelo de visión.
 *
 * La UI guarda el adjunto original tal como llegó (hasta 8 MB). Enviarlo
 * directamente a llama.cpp multiplica el peso por ~1,33 al pasar a base64 y
 * mete en el proyector píxeles que el modelo no necesita. Aquí se normaliza:
 *
 *   - se corrige la orientación EXIF;
 *   - se limita el lado mayor a 1600 px sin ampliar;
 *   - se aplana la transparencia sobre blanco;
 *   - se convierte a JPEG 4:4:4 (texto y capturas nítidas);
 *   - se respeta un tope total de body base64 (12 MB por defecto).
 *
 * Si `sharp` no puede abrir el archivo, se conserva el original: la visión es
 * una mejora, nunca un motivo para romper el turno.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * `sharp` es opcional: si falta (copia de evaluación, instalación mínima o
 * binario nativo incompatible), se envía la imagen original. Así el IDE sigue
 * arrancando aunque el módulo nativo no esté disponible.
 * @type {Promise<any | null> | null}
 */
let sharpPromise = null;
function cargarSharp() {
  if (!sharpPromise) {
    sharpPromise = import("sharp")
      .then((mod) => mod.default || mod)
      .catch(() => null);
  }
  return sharpPromise;
}

const MAX_ENTRADA = 8_000_000;
const MAX_TOTAL_B64 = 12_000_000;
const MAX_LADO = 1600;
const CALIDAD_JPEG = 88;

/** @type {Record<string, string>} */
const MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
};

/**
 * @param {string} abs
 * @returns {string}
 */
function mimeDe(abs) {
  return MIME[path.extname(abs).toLowerCase()] || "image/png";
}

/**
 * Optimiza una imagen y devuelve bytes listos para base64.
 *
 * @param {string} abs
 * @param {{maxLado?: number, calidad?: number}} [opciones]
 * @returns {Promise<{datos: Buffer, mime: string, optimizada: boolean, bytesEntrada: number}>}
 */
export async function optimizarImagen(abs, opciones = {}) {
  const bytesEntrada = fs.statSync(abs).size;
  const datos = fs.readFileSync(abs);
  if (!datos.length || datos.length > MAX_ENTRADA) {
    return { datos, mime: mimeDe(abs), optimizada: false, bytesEntrada };
  }
  const maxLado = Math.max(256, Math.min(4096, Number(opciones.maxLado) || MAX_LADO));
  const calidad = Math.max(40, Math.min(95, Number(opciones.calidad) || CALIDAD_JPEG));
  const sharp = await cargarSharp();
  if (!sharp) return { datos, mime: mimeDe(abs), optimizada: false, bytesEntrada };
  try {
    const salida = await sharp(datos, { failOn: "none", animated: false })
      .rotate()
      .resize({ width: maxLado, height: maxLado, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: calidad, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toBuffer();
    if (!salida.length) return { datos, mime: mimeDe(abs), optimizada: false, bytesEntrada };
    return { datos: salida, mime: "image/jpeg", optimizada: true, bytesEntrada };
  } catch {
    return { datos, mime: mimeDe(abs), optimizada: false, bytesEntrada };
  }
}

/**
 * Convierte rutas absolutas de adjuntos en data URLs para `/v1/chat/completions`.
 * Ignora archivos ausentes, vacíos o demasiado grandes, y corta al alcanzar el
 * presupuesto total. El orden de entrada se conserva.
 *
 * @param {unknown} rutas
 * @param {{maxLado?: number, calidad?: number, maxTotalB64?: number}} [opciones]
 * @returns {Promise<string[]>}
 */
export async function imagenesParaModelo(rutas, opciones = {}) {
  /** @type {string[]} */
  const out = [];
  if (!Array.isArray(rutas)) return out;
  const maxTotal = Math.max(1_000_000, Number(opciones.maxTotalB64) || MAX_TOTAL_B64);
  let total = 0;
  for (const abs of rutas.slice(0, 6)) {
    if (typeof abs !== "string") continue;
    let preparada;
    try {
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      preparada = await optimizarImagen(abs, opciones);
    } catch {
      continue;
    }
    if (!preparada.datos.length) continue;
    const b64 = preparada.datos.toString("base64");
    if (total + b64.length > maxTotal) break;
    total += b64.length;
    out.push(`data:${preparada.mime};base64,${b64}`);
  }
  return out;
}

export const LIMITES_IMAGEN = Object.freeze({
  maxEntrada: MAX_ENTRADA,
  maxTotalB64: MAX_TOTAL_B64,
  maxLado: MAX_LADO,
  calidadJpeg: CALIDAD_JPEG,
});
