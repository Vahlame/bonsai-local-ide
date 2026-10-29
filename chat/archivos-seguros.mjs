import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * POLITICA DE RUTAS DEL PROYECTO Y ALCANCE REAL DE LA PROTECCION (hallazgo 7)
 *
 * `rutaSegura()` RECHAZA ENLACES: recorre con `lstat` cada componente que ya existe
 * (tambien junctions y enlaces colgantes) y devuelve null si alguno es un enlace
 * simbolico. La raiz del proyecto puede ser un enlace; sus descendientes no.
 *
 * QUE GARANTIZA
 *  - corta el caso estatico: un proyecto que ya contiene un enlace hacia fuera (o
 *    hacia `.git`, `node_modules`…) no sirve para leer/escribir fuera de la raiz;
 *  - normaliza y limita la ruta (nada de `..`, unidades de Windows, nombres
 *    reservados ni rutas absolutas) antes de tocar el disco.
 *
 * QUE **NO** GARANTIZA (importante, no presentarlo como mas de lo que es)
 * La comprobacion es `lstat` y DESPUES se usa la ruta: entre comprobar y abrir/
 * leer/escribir queda una ventana en la que OTRO PROCESO LOCAL puede sustituir un
 * directorio por un junction o un archivo por un symlink. Por tanto esto es
 * BEST-EFFORT y **NO ES UNA BARRERA TOCTOU** frente a procesos locales concurrentes
 * con permiso de escritura en el proyecto. `escribirAtomico()` tampoco lo es: evita
 * archivos a medias y deja intacto el destino si falla, no carreras de enlaces.
 *
 * No se puede cerrar del todo con la API portable de Node: haria falta abrir por
 * handle/identificador con primitivas del SO (openat2/RESOLVE_NO_SYMLINKS en Linux,
 * FILE_FLAG_OPEN_REPARSE_POINT en Windows) que Node no expone de forma uniforme.
 * La amenaza que cubre este modulo es un ENLACE ya presente en el proyecto (o creado
 * por el agente a traves de la propia API, que tambien valida), no un atacante local
 * compitiendo en el tiempo con la comprobacion. Cualquier futuro helper que prometa
 * mas que esto debe demostrarlo con una prueba de carrera controlada.
 *
 * IMPORTANTE: la semantica de `rutaSegura` es contrato de `ui-server.mjs` y
 * `actions.mjs`; no cambiarla sin actualizar a sus consumidores y sus pruebas.
 */

// Reject links at every existing component, including dangling links and junctions.
// The selected root itself may be a link; its descendants may not be.
export function rutaSegura(root, rel) {
  if (typeof rel !== "string" || !rel || rel.includes("\0") || path.isAbsolute(rel)) return null;
  const parts = rel.replace(/\\/g, "/").split("/");
  if (parts.some((p) => p === ".." || (process.platform === "win32" && (p.includes(":") || (/[. ]$/.test(p) && p !== ".") || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))))) return null;
  const base = path.resolve(root);
  const abs = path.resolve(base, rel);
  const relative = path.relative(base, abs);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  let current = base;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return null;
    } catch (err) {
      if (err.code === "ENOENT") break;
      return null;
    }
  }
  return abs;
}

/** Adaptador para herramientas del agente: acepta una ruta absoluta contenida en root.
 * Mantiene el contrato estricto de rutaSegura para las APIs del editor y deshacer. */
export function rutaProyecto(root, valor, { permitirRaiz = false } = {}) {
  if (typeof valor !== "string" || valor.includes("\0")) return null;
  const base = path.resolve(root);
  const normal = valor.trim().replace(/\\/g, "/");
  const rel = path.isAbsolute(normal) ? path.relative(base, normal) : normal;
  if (permitirRaiz && (rel === "" || rel === "." || rel === "./")) return base;
  return rutaSegura(base, rel);
}

// Flush a temporary sibling before replacing the destination. A failure leaves
// the original untouched, and cleanup never deletes the destination.
export function escribirAtomico(abs, contenido) {
  const dir = path.dirname(abs);
  const tmp = path.join(dir, `.bonsai-${crypto.randomBytes(12).toString("hex")}.tmp`);
  let fd;
  try {
    let mode = 0o666;
    try { mode = fs.statSync(abs).mode & 0o777; } catch (err) { if (err.code !== "ENOENT") throw err; }
    fd = fs.openSync(tmp, "wx", mode);
    fs.writeFileSync(fd, contenido);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, abs);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch (err) { if (err.code !== "ENOENT") throw err; }
  }
}
