/**
 * Estado compartido de los trabajos de descarga. Lo usan el catálogo (para
 * listar) y el descargador (para crear/cancelar), sin crear un ciclo entre ellos.
 */

/** @type {Map<string, any>} */
export const trabajos = new Map();
/** @type {Map<string, AbortController>} */
export const abortos = new Map();

/** @param {any} t */
export function publicoTrabajo(t) {
  return {
    id: t.id,
    clave: t.clave,
    nombre: t.nombre,
    repo: t.repo,
    origen: t.origen,
    estado: t.estado,
    progreso: Math.round(t.progreso * 10) / 10,
    bytesHechos: t.bytesHechos,
    totalBytes: t.totalBytes,
    velocidad: Math.round(t.velocidad),
    eta: Math.round(t.eta),
    archivoActual: t.archivoActual,
    error: t.error,
    inicio: t.inicio,
    fin: t.fin,
  };
}

export function listarTrabajos() {
  return [...trabajos.values()].map(publicoTrabajo).sort((a, b) => b.inicio - a.inicio);
}

/**
 * Conserva solo los últimos trabajos terminados. Sin esto el Map crecía durante
 * toda la vida del proceso con cada descarga.
 * @param {number} [max]
 */
export function podarTrabajos(max = 50) {
  const terminados = [...trabajos.values()]
    .filter((t) => ["listo", "error", "cancelado"].includes(t.estado))
    .sort((a, b) => (b.fin || b.inicio || 0) - (a.fin || a.inicio || 0));
  for (const t of terminados.slice(max)) trabajos.delete(t.id);
}

/** @param {string} id */
export function cancelarTrabajo(id) {
  const t = trabajos.get(id);
  if (!t) throw new Error(`descarga desconocida: ${id}`);
  if (["listo", "error", "cancelado"].includes(t.estado)) return publicoTrabajo(t);
  t.cancelado = true;
  t.estado = "cancelado";
  t.fin = Date.now();
  abortos.get(id)?.abort();
  return publicoTrabajo(t);
}
