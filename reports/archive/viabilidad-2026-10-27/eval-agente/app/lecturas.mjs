/**
 * Lectura de archivos para el agente y para el editor.
 *
 * Vive fuera de `ui-server.mjs` para poder probarse sin arrancar el servidor y para que
 * la política de lectura (límites, rangos, líneas gigantes) sea una sola.
 *
 * Reglas de oro:
 *  - Se mira el tamaño con `stat` ANTES de leer: un archivo enorme nunca se carga entero
 *    para luego recortarlo (eso bloqueaba el event loop).
 *  - Un archivo grande se recorre por bloques con TextDecoder incremental, no con
 *    `readFileSync` (memoria + bloqueo).
 *  - Si una línea es gigante, se entrega un trozo y se INFORMA del recorte interno, con
 *    la sintaxis exacta para pedir el resto (`ruta:linea:c<ini>-<fin>`). No se presenta
 *    como completa una lectura que no lo es.
 *  - Si el rango pedido se entregó entero, NO se invita a seguir leyendo el archivo: el
 *    agente no debe recorrer 60 líneas porque pidió la línea 1.
 */

import fs from "node:fs";
import path from "node:path";
import { rutaSegura } from "./archivos-seguros.mjs";

/** Tope duro para leer un archivo entero en memoria (editor, comparación, undo). */
export const LIMITE_TEXTO = 2_000_000;
/** Tope de escaneo por streaming para describir un archivo enorme sin cargarlo entero. */
export const LIMITE_ESCANEO = 8_000_000;
/** Cuánto texto de un archivo se le pasa al modelo en una lectura (estimado a 3 car./token). */
export const LECTURA_TOKENS = 2000;

/**
 * Interpreta una clave de lectura:
 *  - `ruta`                      → archivo entero (o hasta donde quepa)
 *  - `ruta:desde-hasta`          → rango de líneas (1-based, inclusive)
 *  - `ruta:linea:c<ini>-<fin>`   → rango de caracteres dentro de UNA línea
 * @param {string} clave
 * @returns {{rel: string, desde: number, hasta: number, linea: number, colDesde: number, colHasta: number}}
 */
export function parseLectura(clave) {
  const texto = String(clave || "");
  const porColumna = texto.match(/^(.*):(\d+):c(\d+)-(\d+)$/);
  if (porColumna) {
    const ini = Math.max(1, Number(porColumna[3]));
    return { rel: porColumna[1], desde: 0, hasta: 0, linea: Number(porColumna[2]), colDesde: ini, colHasta: Math.max(ini, Number(porColumna[4])) };
  }
  const porLinea = texto.match(/^(.*):(\d+)-(\d*)$/);
  if (porLinea) return { rel: porLinea[1], desde: Number(porLinea[2]), hasta: porLinea[3] ? Number(porLinea[3]) : 0, linea: 0, colDesde: 0, colHasta: 0 };
  return { rel: texto, desde: 0, hasta: 0, linea: 0, colDesde: 0, colHasta: 0 };
}

/**
 * Lee como máximo `max` bytes del principio de un archivo, sin cargarlo entero.
 * @param {string} abs
 * @param {number} max
 * @returns {Buffer}
 */
export function leerPrimerosBytes(abs, max) {
  const fd = fs.openSync(abs, "r");
  try {
    const tamano = fs.fstatSync(fd).size;
    const bufsize = Math.max(0, Math.min(max, tamano));
    const buf = Buffer.allocUnsafe(bufsize);
    let off = 0;
    while (off < bufsize) {
      const n = fs.readSync(fd, buf, off, bufsize - off, off);
      if (!n) break;
      off += n;
    }
    return buf.subarray(0, off);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Decodifica un trozo que puede cortar a mitad de un carácter UTF-8: si el final tiene
 * una secuencia incompleta se descarta, en vez de producir el carácter de reemplazo.
 * @param {Buffer} buf
 * @returns {string}
 */
export function decodificarRecorteUtf8(buf) {
  let fin = buf.length;
  let i = fin - 1;
  let continuacion = 0;
  while (i >= 0 && continuacion < 4 && (buf[i] & 0xc0) === 0x80) {
    i -= 1;
    continuacion += 1;
  }
  if (i >= 0) {
    const b = buf[i];
    const esperado = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    if (fin - i < esperado) fin = i;
  }
  return buf.subarray(0, fin).toString("utf8");
}

/**
 * Lee un archivo de texto con un límite estricto (mira el tamaño con `stat` antes).
 * @param {string} abs
 * @param {number} [maxBytes]
 * @returns {{ok: true, texto: string, bytes: number, truncado: boolean} | {ok: false, motivo: "binario" | "ilegible"}}
 */
export function leerTextoAcotado(abs, maxBytes = LIMITE_TEXTO) {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return { ok: false, motivo: "ilegible" };
    const buf = st.size > maxBytes ? leerPrimerosBytes(abs, maxBytes) : fs.readFileSync(abs);
    if (buf.includes(0)) return { ok: false, motivo: "binario" };
    return {
      ok: true,
      texto: st.size > maxBytes ? decodificarRecorteUtf8(buf) : buf.toString("utf8"),
      bytes: st.size,
      truncado: st.size > maxBytes,
    };
  } catch {
    return { ok: false, motivo: "ilegible" };
  }
}

/**
 * Recorre las líneas de un archivo por bloques (TextDecoder incremental), sin cargarlo
 * entero en memoria y sin bloquear con un `readFileSync` de cientos de MB.
 * El callback devuelve `false` para dejar de leer; con `completarTotal` se sigue contando
 * las líneas que quedan (barato en archivos pequeños) para poder informar del total real.
 * @param {string} abs
 * @param {(linea: string, numero: number) => boolean | void} alLinea
 * @param {{maxBytes?: number, completarTotal?: boolean}} [opts]
 * @returns {{total: number | null, bytes: number, escaneado: number}}
 */
export function recorrerLineas(abs, alLinea, opts = {}) {
  const maxBytes = Number.isFinite(opts.maxBytes) ? /** @type {number} */ (opts.maxBytes) : LIMITE_ESCANEO;
  const completarTotal = opts.completarTotal === true;
  const st = fs.statSync(abs);
  const bytes = st.size;
  if (bytes === 0) return { total: 0, bytes: 0, escaneado: 0 };
  const fd = fs.openSync(abs, "r");
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const buffer = Buffer.allocUnsafe(256 * 1024);
  let pos = 0;
  let resto = "";
  let numero = 0;
  let parado = false;
  /** @param {string} parte */
  const contar = (parte) => {
    numero += 1;
    if (parado) return;
    if (alLinea(parte.endsWith("\r") ? parte.slice(0, -1) : parte, numero) === false) parado = true;
  };
  try {
    while (pos < bytes) {
      const leido = fs.readSync(fd, buffer, 0, buffer.length, pos);
      if (!leido) break;
      pos += leido;
      const texto = resto + decoder.decode(buffer.subarray(0, leido), { stream: true });
      const partes = texto.split("\n");
      resto = partes.pop() ?? "";
      for (const parte of partes) contar(parte);
      if (pos >= bytes) {
        const cola = resto + decoder.decode();
        if (cola.length) contar(cola);
        return { total: numero, bytes, escaneado: pos };
      }
      if (parado && !completarTotal) return { total: null, bytes, escaneado: pos };
      if (!parado && pos >= maxBytes) return { total: null, bytes, escaneado: pos };
    }
    return { total: numero, bytes, escaneado: pos };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Lee un archivo para el modelo (ruta/rango de líneas/rango de caracteres) e informa
 * SIEMPRE de qué parte exacta se entregó y qué falta.
 * @param {object} args
 * @param {string} args.root carpeta del proyecto
 * @param {string} args.clave
 * @param {Set<string>} [args.skipExt] extensiones binarias que no se pegan
 * @param {number} [args.presupuestoTokens]
 * @returns {string}
 */
export function describirLectura({ root, clave, skipExt = new Set(), presupuestoTokens = LECTURA_TOKENS }) {
  const { rel, desde, hasta, linea, colDesde, colHasta } = parseLectura(clave);
  const clean = rel.replace(/\\/g, "/");
  const abs = rutaSegura(root, clean);
  if (!abs) return `leer ${clean}: ruta no permitida`;
  let st;
  try {
    st = fs.statSync(abs);
  } catch {
    return `leer ${clean}: no existe`;
  }
  if (st.isDirectory()) {
    const names = fs.readdirSync(abs).filter((name) => !name.startsWith(".")).slice(0, 40);
    return `leer ${clean}: es una carpeta.\n${names.join("\n") || "(vacía)"}`;
  }
  if (!st.isFile()) return `leer ${clean}: no existe`;
  if (skipExt.has(path.extname(abs).toLowerCase())) return `leer ${clean}: binario, ${st.size} bytes. No se pega el contenido.`;
  const muestra = st.size > 8192 ? leerPrimerosBytes(abs, 8192) : fs.readFileSync(abs);
  if (muestra.includes(0)) return `leer ${clean}: binario, ${st.size} bytes. No se pega el contenido.`;
  if (st.size === 0) return `Archivo ${clean} (vacío, 0 bytes):\n`;
  const PRESUPUESTO = presupuestoTokens * 3;

  // ---- caracteres de una línea concreta (sufijo de una línea gigante) ----
  if (linea > 0) {
    const ini = Math.max(1, colDesde);
    const finPedido = Math.max(ini, colHasta);
    const limite = Math.min(finPedido, ini + PRESUPUESTO - 1);
    let visto = false;
    /** @type {number | null} */
    let largo = null;
    let entregado = "";
    let hayMas = false;
    const meta = recorrerLineas(abs, (texto, numero) => {
      if (numero < linea) return undefined;
      if (numero > linea) return false;
      visto = true;
      largo = texto.length;
      const desdeIdx = Math.min(ini - 1, texto.length);
      const hastaIdx = Math.min(limite, texto.length);
      entregado = texto.slice(desdeIdx, hastaIdx);
      // Solo falta contenido si el rango de caracteres PEDIDO no cupo en el presupuesto;
      // que la línea siga más allá de lo pedido no convierte la lectura en incompleta.
      hayMas = finPedido > limite;
      return false;
    }, { completarTotal: st.size <= LIMITE_TEXTO });
    if (!visto) {
      const total = meta.total !== null ? `el archivo tiene ${meta.total} líneas` : `no se encontró en los primeros ${Math.round(meta.escaneado / 1024)} KB`;
      return `leer ${clean}: la línea ${linea} no existe (${total}).`;
    }
    const hastaTxt = largo !== null ? ` de ${largo}` : "";
    const cabecera = `Archivo ${clean} (línea ${linea}, caracteres ${ini}-${ini + Math.max(0, entregado.length - 1)}${hastaTxt}, ${st.size} bytes):`;
    if (!hayMas) return `${cabecera}\n${entregado}\n[rango pedido completo]`;
    const siguienteIni = ini + entregado.length;
    const siguienteFin = Math.min(/** @type {number} */ (largo) ?? siguienteIni + PRESUPUESTO - 1, siguienteIni + PRESUPUESTO - 1);
    return `${cabecera}\n${entregado}\n[…recorte dentro de la línea ${linea}: se entregaron los caracteres ${ini}-${ini + Math.max(0, entregado.length - 1)}${hastaTxt}. Para el resto llama leer con ruta "${clean}:${linea}:c${siguienteIni}-${siguienteFin}".]`;
  }

  // ---- rango de líneas ----
  const ini = Math.max(1, desde || 1);
  const finPedido = hasta > 0 ? hasta : Number.POSITIVE_INFINITY;
  /** @type {string[]} */
  const tomadas = [];
  let usados = 0;
  let ultima = 0;
  /** @type {{linea: number, entregados: number, total: number} | null} */
  let lineaCortada = null;
  let motivo = "";
  const meta = recorrerLineas(abs, (texto, numero) => {
    if (numero < ini) return undefined;
    if (numero > finPedido) return false;
    const espacio = PRESUPUESTO - usados;
    if (texto.length + 1 > espacio) {
      if (!tomadas.length && espacio > 0) {
        const trozo = texto.slice(0, espacio);
        tomadas.push(trozo);
        usados += trozo.length;
        ultima = numero;
        lineaCortada = { linea: numero, entregados: trozo.length, total: texto.length };
      } else if (!tomadas.length) {
        motivo = "presupuesto";
      } else {
        motivo = "presupuesto";
      }
      return false;
    }
    tomadas.push(texto);
    usados += texto.length + 1;
    ultima = numero;
    if (numero === finPedido) return false;
    return undefined;
  }, { completarTotal: st.size <= LIMITE_TEXTO });
  if (!tomadas.length) {
    if (meta.total !== null && ini > meta.total) return `leer ${clean}: el archivo tiene ${meta.total} líneas; no hay líneas desde ${ini}.`;
    if (motivo === "presupuesto") return `leer ${clean}: no se pudo entregar ninguna línea dentro del presupuesto (la línea ${ini} es gigante). Prueba con ruta "${clean}:${ini}:c1-${PRESUPUESTO}".`;
    return `leer ${clean}: no se encontró el rango pedido en los primeros ${Math.round(meta.escaneado / 1024)} KB del archivo.`;
  }
  const fin = ultima;
  const totalNum = meta.total;
  const totalTxt = totalNum !== null ? String(totalNum) : `≥${fin}`;
  // Una lectura con una línea cortada NUNCA es completa, aunque se haya llegado al EOF.
  const completo = !lineaCortada && totalNum !== null && ini === 1 && fin >= totalNum;
  const rangoCompleto = totalNum !== null
    ? fin >= Math.min(finPedido === Number.POSITIVE_INFINITY ? totalNum : finPedido, totalNum)
    : fin >= finPedido;
  const detalleCorte = lineaCortada
    ? `; la línea ${lineaCortada.linea} se cortó a ${lineaCortada.entregados} de ${lineaCortada.total} caracteres`
    : "";
  const cabecera = completo
    ? `Archivo ${clean} (${totalNum} líneas, ${st.size} bytes):`
    : `Archivo ${clean} (líneas ${ini}-${fin} de ${totalTxt}${detalleCorte}, ${st.size} bytes):`;
  /** @type {string[]} */
  const notas = [];
  if (lineaCortada) {
    const nextIni = lineaCortada.entregados + 1;
    notas.push(`[…recorte dentro de la línea ${lineaCortada.linea}: se entregaron los caracteres 1-${lineaCortada.entregados} de ${lineaCortada.total}. Para el resto llama leer con ruta "${clean}:${lineaCortada.linea}:c${nextIni}-${Math.min(lineaCortada.total, nextIni + PRESUPUESTO - 1)}".]`);
  } else if (!rangoCompleto) {
    // Si se pidió un rango de líneas, lo que falta es hasta ESE rango; si se pidió
    // «desde hasta el final», lo que falta es el resto del archivo (total conocido o no).
    const hastaNota = hasta > 0 ? String(hasta) : (totalNum !== null ? String(totalNum) : "");
    const resto = hastaNota || "el final";
    notas.push(`[…recortado por presupuesto: faltan las líneas ${fin + 1}-${resto}. Para verlas llama leer con ruta "${clean}", desde ${fin + 1}${hastaNota ? ` y hasta ${hastaNota}` : ""}.]`);
  } else if (finPedido !== Number.POSITIVE_INFINITY && totalNum !== null && fin < totalNum) {
    notas.push(`[rango pedido completo. El archivo sigue hasta la línea ${totalNum}.]`);
  } else if (totalNum === null) {
    notas.push("[rango pedido completo; no se recorrió el resto del archivo.]");
  }
  return `${cabecera}\n${tomadas.join("\n")}${notas.length ? `\n${notas.join("\n")}` : ""}`;
}
