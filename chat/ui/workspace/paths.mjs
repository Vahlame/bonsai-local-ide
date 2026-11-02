/** Rutas relativas del explorador, sin tocar el sistema de archivos. */

/**
 * Normaliza una ruta escrita por el usuario o devuelta por la API.
 * @param {unknown} rel
 * @returns {string}
 */
export function rutaLimpia(rel) {
  return String(rel || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Último segmento de una ruta (nombre visible).
 * @param {unknown} rel
 * @returns {string}
 */
export function nombreDeRuta(rel) {
  return rutaLimpia(rel).split("/").filter(Boolean).pop() || "";
}
