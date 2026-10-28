/**
 * Escritura y lectura de JSON de estado con garantías mínimas.
 *
 * El proyecto guarda su estado en varios JSON (sesión, índice de conversaciones,
 * ajustes, puntos de deshacer, marcadores del servidor de modelo). Antes cada sitio
 * tenía su propia política: unos escribían con fs.writeFileSync (un corte a mitad
 * dejaba un archivo truncado y la sesión se perdía), otros con temporal + rename,
 * y los errores se tragaban con `catch {}`. Este módulo centraliza:
 *
 *  - `escribirJsonAtomico`: escribe a un temporal en la MISMA carpeta, hace fsync,
 *    y sustituye el destino con rename (atómico en NTFS/POSIX). Nunca deja el destino
 *    a medias. Antes de sustituir guarda una copia `.bak` de la versión anterior válida,
 *    que es de donde se recupera si el archivo actual aparece corrupto.
 *  - `leerJson`: devuelve un resultado explícito ({ok, dato, error}) en vez de lanzar
 *    o de tragarse el error. Si el archivo está corrupto, se aparta como
 *    `<nombre>.corrupto-<fecha>` (se conserva, nunca se borra) y se intenta el `.bak`.
 *  - `repararJson`: variante para usos donde el llamador quiere decidir qué hacer.
 *
 * No pretende ser una transacción entre varios archivos: dos escrituras separadas
 * siguen siendo dos escrituras. La fuente de verdad de cada dato la define su dueño
 * (ver ui-server.mjs, donde ui-session.json es la copia de trabajo y
 * ui-chats/<id>.json la copia archivada; gana la más nueva y válida al cargar).
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** Sufijo de los archivos apartados por ilegibles. Se conservan a propósito. */
const CORRUPTO = ".corrupto";

/** Nombres que nunca son datos de estado válidos (temporales de versiones anteriores). */
const TEMPORALES = /\.(tmp|partial)$/i;

/**
 * ¿Es un archivo JSON de estado normal (no un temporal)?
 * @param {string} nombre
 * @returns {boolean}
 */
export function esJsonDeEstado(nombre) {
  return /\.json$/i.test(nombre) && !TEMPORALES.test(nombre) && !/\.corrupto/i.test(nombre);
}

/**
 * Lee un JSON de estado sin lanzar.
 *
 * - Si el archivo no existe: `{ok:false, code:"ENOENT"}`.
 * - Si está corrupto: se aparta (rename a `.corrupto-<fecha>`) y se intenta el `.bak`
 *   (si el llamador lo permite). El archivo malo NUNCA se borra.
 * - `validar` opcional permite rechazar un JSON sintácticamente válido pero incoherente
 *   (p. ej. una sesión sin array de turnos); en ese caso también se aparta.
 *
 * @template T
 * @param {string} abs
 * @param {{respaldo?: boolean, validar?: (dato: unknown) => boolean}} [opts]
 * @returns {{ok: true, dato: T, origen: string, apartado?: string} | {ok: false, code: "ENOENT" | "CORRUPTO" | "ERROR", error: string, apartado?: string}}
 */
export function leerJson(abs, opts = {}) {
  const { respaldo = true, validar } = opts;
  let apartado;
  let texto;
  try {
    texto = fs.readFileSync(abs, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") return { ok: false, code: "ENOENT", error: "no existe" };
    return { ok: false, code: "ERROR", error: mensaje(err) };
  }
  try {
    const dato = JSON.parse(texto);
    if (validar && !validar(dato)) throw new Error("forma inesperada");
    return { ok: true, dato, origen: abs };
  } catch (err) {
    apartado = apartarCorrupto(abs);
    if (respaldo) {
      let textoBak;
      try {
        textoBak = fs.readFileSync(`${abs}.bak`, "utf8");
        const dato = JSON.parse(textoBak);
        if (!validar || validar(dato)) return { ok: true, dato, origen: `${abs}.bak`, apartado };
      } catch {
        /* el respaldo tampoco sirve: se informa del original */
      }
    }
    return { ok: false, code: "CORRUPTO", error: mensaje(err), apartado };
  }
}

/**
 * Aparta un archivo ilegible con un nombre único. Devuelve la ruta nueva o undefined.
 * @param {string} abs
 * @returns {string | undefined}
 */
export function apartarCorrupto(abs) {
  const fecha = new Date().toISOString().replace(/[:.]/g, "-");
  let destino = `${abs}${CORRUPTO}-${fecha}`;
  let n = 1;
  while (fs.existsSync(destino)) {
    destino = `${abs}${CORRUPTO}-${fecha}-${n}`;
    n += 1;
  }
  try {
    fs.renameSync(abs, destino);
    return destino;
  } catch {
    return undefined;
  }
}

/**
 * Escribe `dato` como JSON en `abs` de forma atómica.
 *
 * Pasos: temporal en la misma carpeta (mkdtemp no: nombre único propio) → escritura
 * completa → fsync → rename sobre el destino. Si `copia` es true y el destino existía,
 * antes del rename se deja `<abs>.bak` con la versión anterior.
 *
 * Lanza si no se puede escribir: el llamador decide si es un detalle o un fallo visible
 * (en este proyecto, un fallo al archivar historial SÍ se le dice al usuario).
 *
 * @param {string} abs
 * @param {unknown} dato
 * @param {{copia?: boolean, fsync?: boolean, espacio?: number}} [opts]
 * @returns {number} bytes escritos
 */
export function escribirJsonAtomico(abs, dato, opts = {}) {
  const { copia = true, fsync = true, espacio = 2 } = opts;
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify(dato, null, espacio);
  const tmp = path.join(dir, `.bonsai-${crypto.randomBytes(12).toString("hex")}.tmp`);
  let fd;
  try {
    let mode = 0o666;
    try {
      mode = fs.statSync(abs).mode & 0o777;
    } catch (err) {
      if (err && err.code !== "ENOENT") throw err;
    }
    fd = fs.openSync(tmp, "wx", mode);
    fs.writeFileSync(fd, payload);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    if (copia && fs.existsSync(abs)) {
      // Solo se respalda si el archivo actual es legible: no se pisa un .bak bueno
      // con una versión corrupta.
      try {
        JSON.parse(fs.readFileSync(abs, "utf8"));
        fs.copyFileSync(abs, `${abs}.bak`);
      } catch {
        /* si el actual no es válido, se conserva el .bak anterior */
      }
    }
    fs.renameSync(tmp, abs);
    return Buffer.byteLength(payload);
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ya cerrado */ }
    }
    try { fs.unlinkSync(tmp); } catch (err) { if (!err || err.code !== "ENOENT") { /* no es fatal */ } }
  }
}

/**
 * Lee un JSON; si está corrupto devuelve `defecto` y aparta el archivo.
 * Para datos secundarios (índice, ajustes) donde se prefiere seguir arrancando.
 * @template T
 * @param {string} abs
 * @param {T} defecto
 * @returns {{dato: T, error: string, apartado?: string}}
 */
export function leerJsonTolerante(abs, defecto) {
  const r = leerJson(abs);
  if (r.ok) return { dato: /** @type {T} */ (r.dato), error: "" };
  if (r.code === "ENOENT") return { dato: defecto, error: "" };
  return { dato: defecto, error: r.error, apartado: r.apartado };
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function mensaje(err) {
  return err instanceof Error ? err.message : String(err);
}
