/**
 * Rutas, permisos de comandos y escritura de archivos del agente.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { rutaSegura, rutaProyecto, escribirAtomico } from "../archivos-seguros.mjs";
import { BINARY_EXTENSIONS } from "../legacy-tool-parser.mjs";

const BLOCKED_DIRS = new Set([".git"]);
const MAX_BYTES = 1_500_000;

/**
 * @param {string} root
 * @param {string} rel
 * @returns {string}
 */
export function resolveInside(root, rel) {
  const raw = String(rel || "").trim().replace(/^["'`]+|["'`]+$/g, "");
  const target = rutaProyecto(root, raw);
  if (!target) throw new Error("ruta fuera del proyecto o contiene un enlace");
  const cleaned = path.relative(path.resolve(root), target).replace(/\\/g, "/");
  if (!cleaned || cleaned.includes("\0")) throw new Error("ruta vacía");
  const parts = cleaned.split("/").filter(Boolean);
  // Windows no distingue mayúsculas (`BIN` ES `bin`) y además ignora el punto final: sin
  // normalizar, `MODELS/x.py`, `.GIT/hooks/x.py` o `bin./x.ps1` se colaban.
  const plano = (part) => part.replace(/[. ]+$/, "").toLowerCase();
  if (parts.some((part) => !plano(part) || BLOCKED_DIRS.has(plano(part)))) throw new Error("ruta no permitida");
  const ext = path.extname(parts[parts.length - 1] || "").slice(1).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) throw new Error(`archivo binario: usa ejecutar para generar ${ext}`);
  const abs = rutaSegura(root, parts.join("/"));
  if (!abs) throw new Error("ruta fuera del proyecto o contiene un enlace");
  return abs;
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
/**
 * Misma identidad aunque cambie el python del venv o las barras.
 * @param {string} command
 * @returns {string}
 */
export function commandKey(command) {
  return command
    .trim()
    .replace(/\\/g, "/")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\.venv\/scripts\/python(?:\.exe)?/g, "python")
    .replace(/\bpython\.exe\b/g, "python");
}

/**
 * @param {string} clave
 * @returns {{rel: string, desde: number, hasta: number}} hasta 0 = hasta donde quepa
 */
export function partirLectura(clave) {
  const m = String(clave).match(/^(.*):(\d+)-(\d*)$/);
  if (!m) return { rel: String(clave), desde: 0, hasta: 0 };
  return { rel: m[1], desde: Number(m[2]), hasta: m[3] ? Number(m[3]) : 0 };
}

export function commandAllowed(command, { trusted = false } = {}) {
  const text = command.trim();
  if (!text || text.includes("\0") || text.length > 32768) return false;
  // El modo autónomo no confunde rutas, taskkill, scripts o argumentos con ataques.
  // Esta comprobación evita accidentes evidentes; código arbitrario NO se aísla con regex.
  if (trusted) return !/(?:^|[&|;\r\n])\s*(?:shutdown|format|diskpart|bcdedit|(?:reg(?:\.exe)?\s+delete))(?=\s|$)/i.test(text);
  // Lo que NO se lanza desde aquí. Ojo con dos cosas: en Windows la ruta absoluta también
  // se escribe con barra normal (`C:/Users/...`), y los verbos de borrado/movimiento no
  // estaban: `del /s /q *.py` pasaba el filtro.
  // Y con otras dos al revés: la unidad tiene que ir SUELTA (`C:\`, `"D:/`), porque si no
  // el `p:/` de `http://` bloqueaba cualquier comando con una URL (no se podía probar una API
  // con curl ni con urllib); y `..` solo cuenta como ruta (`..\x`, `cd ..`), no dentro de un
  // texto como `print('...')`.
  return !/(^|[\s"'=(,;\\/])\.\.([\\/\s"';)]|$)|(^|[\s"'=(,;])[A-Za-z]:[\\/]|\/windows|system32|shutdown|format\s|cipher\s|reg\s+delete|(^|[\s&|])(del|erase|rd|rmdir|move|ren|takeown|icacls|taskkill|stop-process|remove-item|rm)(\s|$)/i.test(text);
}

/**
 * @param {string} text
 * @returns {string}
 */

/**
 * @param {string} root
 * @param {Array<{rel: string, content: string}>} writes
 * @returns {Array<{rel: string, bytes: number, url: string}>}
 */
export function writeOutputs(root, writes) {
  /** @type {Array<{rel: string, bytes: number, url: string}>} */
  const saved = [];
  fs.mkdirSync(root, { recursive: true });
  for (const write of writes) {
    const abs = resolveInside(root, write.rel);
    const body = Buffer.from(write.content, "utf8");
    if (body.includes(0)) throw new Error(`archivo binario: usa ejecutar para generar ${write.rel}`);
    if (body.length > MAX_BYTES) throw new Error(`archivo demasiado grande: ${write.rel}`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (!rutaSegura(root, path.relative(root, abs))) throw new Error("ruta no permitida");
    escribirAtomico(abs, body);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    saved.push({ rel, bytes: body.length, url: `/p/${rel.split("/").map(encodeURIComponent).join("/")}` });
  }
  return saved;
}

/** Publica un archivo nuevo sin sobrescribir otro creado durante la operación. */
export function writeNewOutput(root, rel, contenido) {
  const abs = resolveInside(root, rel), body = Buffer.from(contenido, "utf8");
  if (body.includes(0) || body.length > MAX_BYTES) throw new Error("Contenido binario o demasiado grande");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (!rutaSegura(root, path.relative(root, abs))) throw new Error("ruta no permitida");
  const tmp = path.join(path.dirname(abs), `.bonsai-${crypto.randomBytes(12).toString("hex")}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, "wx");
    fs.writeFileSync(fd, body); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.linkSync(tmp, abs); // link atómico: falla si el destino ya existe
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch (err) { if (err.code !== "ENOENT") throw err; }
  }
  const ruta = path.relative(root, abs).split(path.sep).join("/");
  return { rel: ruta, bytes: body.length, url: `/p/${ruta.split("/").map(encodeURIComponent).join("/")}` };
}
