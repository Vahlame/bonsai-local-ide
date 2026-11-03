/**
 * Diff unificado acotado: búsqueda de anclas, LCS por regiones y filas legibles.
 */

/**
 * @param {string} text
 * @returns {string}
 */
/**
 * Tope de filas que se generan para un diff. Es alto a propósito: el llamador ya recorta
 * el texto a 8.000 caracteres, y un tope bajo cortaba el diff antes de llegar a un cambio
 * situado al final de un archivo grande. No se reserva memoria cuadrática: solo una fila
 * por línea recordada.
 */
const MAX_DIFF_ROWS = 200_000;
/** Tope de trabajo (líneas recorridas) para no bloquear con archivos enormes. */
const MAX_DIFF_TRABAJO = 2_000_000;
/** Tope de líneas por región para buscar el ancla menos repetida. */
const MAX_REGION_ANCLAS = 20_000;

/**
 * Cuenta las líneas de un rango: cuántas veces aparece cada una y dónde está la primera.
 * @param {string[]} lineas
 * @param {number} desde
 * @param {number} hasta
 * @returns {Map<string, {n: number, i: number}>}
 */
function contarLineasRango(lineas, desde, hasta) {
  /** @type {Map<string, {n: number, i: number}>} */
  const mapa = new Map();
  for (let i = desde; i < hasta; i += 1) {
    const linea = lineas[i];
    const previo = mapa.get(linea);
    if (previo) previo.n += 1;
    else mapa.set(linea, { n: 1, i });
  }
  return mapa;
}

/**
 * De los pares (posición vieja, posición nueva) que ya vienen ordenados por posición
 * nueva, devuelve la subsecuencia más larga con posiciones viejas crecientes. Patience
 * sort O(k log k): sin matrices N×M.
 * @param {Array<{a: number, b: number}>} pares
 * @returns {Array<{a: number, b: number}>}
 */
function subsecuenciaCreciente(pares) {
  if (pares.length <= 1) return pares.slice();
  /** @type {number[]} */
  const colas = [];
  /** @type {number[]} */
  const previos = new Array(pares.length).fill(-1);
  for (let i = 0; i < pares.length; i += 1) {
    const a = pares[i].a;
    let lo = 0;
    let hi = colas.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pares[colas[mid]].a < a) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previos[i] = colas[lo - 1];
    colas[lo] = i;
  }
  /** @type {Array<{a: number, b: number}>} */
  const resultado = [];
  let i = colas.length ? colas[colas.length - 1] : -1;
  while (i >= 0) {
    resultado.push(pares[i]);
    i = previos[i];
  }
  return resultado.reverse();
}

/**
 * Anclas para un bloque distinto: primero las líneas que aparecen UNA sola vez en cada
 * lado (patience diff). Si no hay ninguna, la línea menos repetida presente en ambos
 * lados (histogram diff), con un número acotado de anclas para no fragmentar de más.
 * @param {string[]} viejas
 * @param {number} a0
 * @param {number} a1
 * @param {string[]} nuevas
 * @param {number} b0
 * @param {number} b1
 * @returns {Array<{a: number, b: number}>}
 */
function buscarAnclas(viejas, a0, a1, nuevas, b0, b1) {
  const mapaViejas = contarLineasRango(viejas, a0, a1);
  const mapaNuevas = contarLineasRango(nuevas, b0, b1);
  /** @type {Array<{a: number, b: number}>} */
  const unicas = [];
  for (const [linea, info] of mapaViejas) {
    if (info.n !== 1) continue;
    const otra = mapaNuevas.get(linea);
    if (!otra || otra.n !== 1) continue;
    unicas.push({ a: info.i, b: otra.i });
  }
  if (unicas.length) {
    unicas.sort((x, y) => x.b - y.b);
    return subsecuenciaCreciente(unicas);
  }
  if (a1 - a0 > MAX_REGION_ANCLAS || b1 - b0 > MAX_REGION_ANCLAS) return [];
  /** @type {string | null} */
  let frecuente = null;
  let peso = Infinity;
  for (const [linea, info] of mapaViejas) {
    const otra = mapaNuevas.get(linea);
    if (!otra) continue;
    const candidato = Math.max(info.n, otra.n);
    if (candidato < peso) {
      peso = candidato;
      frecuente = linea;
    }
  }
  if (frecuente === null) return [];
  /** @type {number[]} */
  const posViejas = [];
  for (let i = a0; i < a1; i += 1) if (viejas[i] === frecuente) posViejas.push(i);
  /** @type {number[]} */
  const posNuevas = [];
  for (let i = b0; i < b1; i += 1) if (nuevas[i] === frecuente) posNuevas.push(i);
  const total = Math.min(posViejas.length, posNuevas.length);
  const cuantas = Math.min(total, 16);
  /** @type {Array<{a: number, b: number}>} */
  const anclas = [];
  for (let k = 0; k < cuantas; k += 1) {
    const indice = cuantas === 1 ? 0 : Math.round((k * (total - 1)) / (cuantas - 1));
    anclas.push({ a: posViejas[indice], b: posNuevas[indice] });
  }
  return anclas;
}

/**
 * Filas de un diff línea a línea sin matriz N×M: prefijo común, sufijo común y, en el
 * bloque distinto, anclas de líneas iguales para partirlo (recursivo, con pila). Si un
 * bloque no tiene anclas se emite quitado y añadido, que es lo que haría un diff
 * conservador sin gastar memoria cuadrática.
 * @param {string[]} viejas
 * @param {string[]} nuevas
 * @returns {string[]}
 */
function filasDiffLineal(viejas, nuevas) {
  /** @type {string[]} */
  const filas = [];
  const lleno = () => filas.length >= MAX_DIFF_ROWS;
  /**
   * @typedef {{tipo: "rango", a0: number, a1: number, b0: number, b1: number} | {tipo: "fila", texto: string}} Tarea
   */
  /** @type {Tarea[]} */
  const pila = [{ tipo: "rango", a0: 0, a1: viejas.length, b0: 0, b1: nuevas.length }];
  let trabajo = 0;
  while (pila.length && !lleno()) {
    const tarea = pila.pop();
    if (!tarea) break;
    if (tarea.tipo === "fila") {
      filas.push(tarea.texto);
      continue;
    }
    let { a0, a1, b0, b1 } = tarea;
    while (a0 < a1 && b0 < b1 && viejas[a0] === nuevas[b0]) {
      filas.push(` ${viejas[a0]}`);
      a0 += 1;
      b0 += 1;
      if (lleno()) break;
    }
    if (lleno()) break;
    let sufijo = 0;
    while (a1 - sufijo > a0 && b1 - sufijo > b0 && viejas[a1 - 1 - sufijo] === nuevas[b1 - 1 - sufijo]) sufijo += 1;
    const finA = a1 - sufijo;
    const finB = b1 - sufijo;
    // El sufijo se emite al final del bloque: se deja preparado debajo en la pila.
    if (sufijo > 0) pila.push({ tipo: "rango", a0: finA, a1, b0: finB, b1 });
    if (a0 >= finA && b0 >= finB) continue;
    if (a0 >= finA) {
      for (let b = b0; b < finB && !lleno(); b += 1) filas.push(`+${nuevas[b]}`);
      continue;
    }
    if (b0 >= finB) {
      for (let a = a0; a < finA && !lleno(); a += 1) filas.push(`-${viejas[a]}`);
      continue;
    }
    trabajo += finA - a0 + (finB - b0);
    /** @type {Array<{a: number, b: number}>} */
    let anclas = [];
    if (trabajo <= MAX_DIFF_TRABAJO) anclas = buscarAnclas(viejas, a0, finA, nuevas, b0, finB);
    if (!anclas.length) {
      // Sin anclas (o demasiado trabajo): todo el bloque cambia. Se acota a MAX_DIFF_ROWS.
      for (let a = a0; a < finA && !lleno(); a += 1) filas.push(`-${viejas[a]}`);
      for (let b = b0; b < finB && !lleno(); b += 1) filas.push(`+${nuevas[b]}`);
      continue;
    }
    // Se empuja en orden inverso: la pila LIFO emite hueco, ancla, hueco, ancla…
    pila.push({
      tipo: "rango",
      a0: anclas[anclas.length - 1].a + 1,
      a1: finA,
      b0: anclas[anclas.length - 1].b + 1,
      b1: finB,
    });
    for (let k = anclas.length - 1; k >= 0; k -= 1) {
      const ancla = anclas[k];
      pila.push({ tipo: "fila", texto: ` ${viejas[ancla.a]}` });
      pila.push({
        tipo: "rango",
        a0: k === 0 ? a0 : anclas[k - 1].a + 1,
        a1: ancla.a,
        b0: k === 0 ? b0 : anclas[k - 1].b + 1,
        b1: ancla.b,
      });
    }
  }
  return filas;
}

/**
 * @param {string} rel
 * @param {string} before
 * @param {string} after
 * @returns {string}
 */
export function unifiedDiff(rel, before, after) {
  const oldLines = String(before).replace(/\s+$/, "").split(/\r?\n/);
  const newLines = String(after).replace(/\s+$/, "").split(/\r?\n/);
  const header = before ? [`--- ${rel}`, `+++ ${rel}`] : ["--- /dev/null", `+++ ${rel}`];
  if (!before) return [...header, ...newLines.map((line) => `+${line}`)].join("\n");
  /** @type {string[]} */
  let rows;
  try {
    rows = filasDiffLineal(oldLines, newLines);
  } catch {
    // Si algo inesperado falla, un diff posicional acotado es mejor que no enseñar nada.
    rows = [];
    const max = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < max && rows.length < 240; i += 1) {
      if (oldLines[i] === newLines[i]) continue;
      if (oldLines[i] !== undefined) rows.push(`-${oldLines[i]}`);
      if (newLines[i] !== undefined) rows.push(`+${newLines[i]}`);
    }
  }
  const keep = rows.map(() => false);
  for (let k = 0; k < rows.length; k += 1) {
    if (rows[k].startsWith(" ")) continue;
    for (let t = Math.max(0, k - 2); t <= Math.min(rows.length - 1, k + 2); t += 1) keep[t] = true;
  }
  /** @type {string[]} */
  const body = [];
  let skipped = false;
  for (let k = 0; k < rows.length; k += 1) {
    if (!keep[k]) {
      skipped = true;
      continue;
    }
    if (skipped) {
      body.push("@@");
      skipped = false;
    }
    body.push(rows[k]);
  }
  return [...header, ...(body.length ? body : [" sin cambios"])].join("\n");
}
