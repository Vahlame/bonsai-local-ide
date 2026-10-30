/** Estado de Git con rutas literales, sin dividir ni reinterpretar nombres con espacios. */
export function analizarEstadoGit(salida) {
  const partes = String(salida || "").split("\0");
  const archivos = [];
  for (let i = 0; i < partes.length; i += 1) {
    const fila = partes[i];
    if (!fila || fila.length < 4) continue;
    const estado = fila.slice(0, 2);
    const rel = fila.slice(3);
    const anterior = /[RC]/.test(estado) ? partes[++i] : "";
    archivos.push({ estado: estado.trim(), rel, ...(anterior ? { anterior } : {}) });
  }
  return archivos;
}

/** Solo se aceptan nombres que Git acaba de anunciar; se incluye el origen de renombrados. */
export function elegirRutasGit(archivos, seleccion) {
  if (!Array.isArray(seleccion) || !seleccion.length || seleccion.length > 2000) throw new Error("Selecciona los archivos que quieres incluir en el commit.");
  const permitidos = new Map(archivos.map((archivo) => [archivo.rel, archivo]));
  const rutas = new Set();
  for (const rel of seleccion) {
    if (typeof rel !== "string" || !rel || rel.includes("\0") || !permitidos.has(rel)) throw new Error("La selección cambió. Actualiza el estado de Git y vuelve a elegir los archivos.");
    const archivo = permitidos.get(rel);
    rutas.add(archivo.rel);
    if (archivo.anterior) rutas.add(archivo.anterior);
  }
  return [...rutas];
}
