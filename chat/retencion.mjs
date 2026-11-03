/**
 * Retención de estado operativo. Las sesiones ya se podan al guardar
 * (`session-store.mjs`); aquí se evita que logs, trazas y chats archivados
 * crezcan sin límite durante meses de uso.
 *
 * La poda es conservadora: solo toca los directorios indicados, respeta los
 * nombres de `keep`, no sigue enlaces y nunca borra el archivo más reciente.
 */
import fs from "node:fs";
import path from "node:path";

const DIA = 24 * 60 * 60 * 1000;

/**
 * @param {string} archivo
 * @returns {boolean}
 */
function esRegular(archivo) {
  try {
    const st = fs.lstatSync(archivo);
    return st.isFile() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * @param {string} dir
 * @returns {Array<{abs: string, mtime: number, bytes: number}>}
 */
export function listarArchivos(dir) {
  /** @type {Array<{abs: string, mtime: number, bytes: number}>} */
  const out = [];
  /** @param {string} actual */
  const walk = (actual) => {
    let entradas;
    try { entradas = fs.readdirSync(actual, { withFileTypes: true }); } catch { return; }
    for (const entrada of entradas) {
      if (entrada.isSymbolicLink()) continue;
      const abs = path.join(actual, entrada.name);
      if (entrada.isDirectory()) { walk(abs); continue; }
      if (!entrada.isFile()) continue;
      try {
        const st = fs.statSync(abs);
        out.push({ abs, mtime: st.mtimeMs, bytes: st.size });
      } catch { /* desapareció entre listar y stat */ }
    }
  };
  walk(dir);
  return out;
}

/**
 * @param {string} dir
 * @param {{maxAgeMs?: number, maxFiles?: number, maxBytes?: number, keep?: (rel: string) => boolean, conservarReciente?: boolean, now?: number}} [opciones]
 * @returns {{borrados: number, bytes: number, quedan: number}}
 */
export function podarDirectorio(dir, opciones = {}) {
  const maxAgeMs = Number(opciones.maxAgeMs) || Infinity;
  const maxFiles = Math.max(1, Number(opciones.maxFiles) || Infinity);
  const maxBytes = Math.max(1, Number(opciones.maxBytes) || Infinity);
  const keep = opciones.keep || (() => false);
  const conservarReciente = opciones.conservarReciente !== false;
  const now = opciones.now ?? Date.now();
  const archivos = listarArchivos(dir).filter((f) => !keep(path.relative(dir, f.abs).replace(/\\/g, "/")));
  if (!archivos.length) return { borrados: 0, bytes: 0, quedan: 0 };
  archivos.sort((a, b) => a.mtime - b.mtime);
  /** @type {Set<string>} */
  const borrar = new Set();
  for (const f of archivos) {
    if (maxAgeMs !== Infinity && now - f.mtime > maxAgeMs) borrar.add(f.abs);
  }
  // Nunca se borra el más reciente: deja siempre una pista de lo último que pasó.
  const reciente = archivos[archivos.length - 1];
  if (conservarReciente) borrar.delete(reciente.abs);
  const restantes = archivos.filter((f) => !borrar.has(f.abs));
  let total = restantes.reduce((sum, f) => sum + f.bytes, 0);
  let cantidad = restantes.length;
  for (const f of restantes) {
    if (cantidad <= maxFiles && total <= maxBytes) break;
    if (conservarReciente && f.abs === reciente.abs) continue;
    borrar.add(f.abs);
    cantidad -= 1;
    total -= f.bytes;
  }
  let bytes = 0;
  for (const abs of borrar) {
    try {
      bytes += fs.statSync(abs).size;
      fs.rmSync(abs, { force: true });
    } catch { /* otro proceso lo borró o está bloqueado */ }
  }
  return { borrados: borrar.size, bytes, quedan: Math.max(0, archivos.length - borrar.size) };
}

/**
 * Poda los directorios operativos del IDE. Se llama al arrancar y no debe
 * impedir que el servidor abra si un archivo está bloqueado.
 * @param {{stateDir: string, logsDir: string}} ctx
 * @returns {{logs: any, trazas: any, chats: any}}
 */
export function podarEstadoOperativo({ stateDir, logsDir }) {
  const resultado = { logs: null, trazas: null, chats: null };
  try {
    resultado.logs = podarDirectorio(logsDir, { maxAgeMs: 30 * DIA, maxFiles: 2000, maxBytes: 512 * 1024 * 1024 });
  } catch { /* sin logs o sin permisos */ }
  try {
    resultado.trazas = podarDirectorio(path.join(stateDir, "agent-traces"), { maxAgeMs: 30 * DIA, maxFiles: 500, maxBytes: 256 * 1024 * 1024 });
  } catch { /* sin trazas */ }
  try {
    resultado.chats = podarDirectorio(path.join(stateDir, "ui-chats"), {
      maxAgeMs: 365 * DIA,
      maxFiles: 1000,
      maxBytes: 512 * 1024 * 1024,
      keep: (rel) => rel === "index.json" || rel.endsWith(".corrupto.json"),
    });
  } catch { /* sin chats archivados */ }
  return resultado;
}
