/** Reglas de saltos de línea del editor: no reescribir un archivo sin guardar. */

/**
 * @param {string} texto
 * @returns {{eol: string, mixto: boolean}}
 */
export function analizarSaltos(texto) {
  const crlf = (texto.match(/\r\n/g) || []).length;
  const lf = (texto.match(/(^|[^\r])\n/g) || []).length;
  return { eol: crlf > lf ? "\r\n" : "\n", mixto: crlf > 0 && lf > 0 };
}

/** @param {string} texto */
export function normalizarSaltos(texto) {
  return texto.replace(/\r\n/g, "\n");
}

/** @param {string} texto @param {string} eol */
export function restaurarSaltos(texto, eol) {
  return eol === "\r\n" ? texto.replace(/\n/g, "\r\n") : texto;
}
