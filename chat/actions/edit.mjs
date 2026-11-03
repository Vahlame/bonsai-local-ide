/**
 * Edición de texto: búsqueda del trozo más parecido y reemplazo exacto.
 */

/**
 * Cuando `reemplazar` no encuentra el texto (el modelo lo "recuerda" con otros espacios o
 * con alguna palabra cambiada), lo más útil es enseñarle el trozo REAL más parecido para que
 * lo copie exacto. Busca la línea del archivo que mejor encaja con la primera línea con
 * contenido de `buscar` y devuelve ese trozo con su número de línea.
 * @param {string} texto contenido del archivo
 * @param {string} buscar
 * @returns {string} "" si no hay nada parecido
 */
export function trozoParecido(texto, buscar) {
  const norm = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const pedidas = buscar.split(/\r?\n/).map(norm).filter(Boolean);
  if (!pedidas.length) return "";
  const lineas = texto.split(/\r?\n/);
  const palabras = (s) => new Set(s.split(/[^\p{L}\p{N}_]+/u).filter((p) => p.length > 1));
  const objetivo = palabras(pedidas[0]);
  let mejor = -1;
  let puntos = 0;
  lineas.forEach((linea, i) => {
    const n = norm(linea);
    if (!n) return;
    let p = n === pedidas[0] ? 1000 : 0;
    if (!p) for (const w of palabras(n)) if (objetivo.has(w)) p += 1;
    if (p > puntos) {
      puntos = p;
      mejor = i;
    }
  });
  if (mejor < 0 || puntos < Math.min(2, objetivo.size)) return "";
  const alto = Math.max(1, buscar.split(/\r?\n/).length);
  const desde = Math.max(0, mejor - 1);
  const hasta = Math.min(lineas.length, mejor + alto + 1);
  return `Lo más parecido está en la línea ${mejor + 1}; el texto EXACTO de las líneas ${desde + 1}-${hasta} es:\n${lineas.slice(desde, hasta).join("\n")}`;
}

/**
 * Aplica un `reemplazar` sobre el texto de un archivo. El texto a buscar tiene que aparecer
 * UNA vez (si aparece más, el cambio sería ambiguo). Tolera que el archivo use CRLF y el
 * modelo escriba LF, que es lo normal en Windows.
 * @param {string} texto contenido actual
 * @param {string} buscar
 * @param {string} poner
 * @returns {{ok: true, texto: string, linea: number} | {ok: false, veces: number}}
 */
export function aplicarReemplazo(texto, buscar, poner) {
  const contar = (aguja) => (aguja ? texto.split(aguja).length - 1 : 0);
  let aguja = buscar;
  let nuevo = poner;
  let veces = contar(aguja);
  if (veces === 0 && texto.includes("\r\n") && !buscar.includes("\r\n")) {
    aguja = buscar.replace(/\n/g, "\r\n");
    nuevo = poner.replace(/\r?\n/g, "\r\n");
    veces = contar(aguja);
  }
  if (veces !== 1) return { ok: false, veces };
  const at = texto.indexOf(aguja);
  return { ok: true, texto: texto.slice(0, at) + nuevo + texto.slice(at + aguja.length), linea: texto.slice(0, at).split("\n").length };
}

/**
 * ¿Es una pregunta de conversación pura (explica, qué es, diferencia…) sin nada que hacer
 * en el PC? Entonces el turno va sin herramientas: el modelo abliterado tiende a crear y
 * ejecutar archivos para explicar algo (corridas 2 y 6 del evaluador, tarea solo-chat) y la
 * instrucción del sistema no basta. Es CONSERVADOR: cualquier archivo, código del proyecto o
 * verbo de acción deja las herramientas puestas.
 * @param {string} texto
 * @returns {boolean}
 */
