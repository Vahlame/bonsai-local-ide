/**
 * Archivos y comandos que el modelo pide.
 * Las herramientas de archivos trabajan en el proyecto; ejecutar usa permisos del SO.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { rutaSegura, rutaProyecto, escribirAtomico } from "./archivos-seguros.mjs";
import { PC_TOOLS, argText, claveLectura, dispatchToolEffect, parseToolArgs } from "./tool-registry.mjs";
import { BINARY_EXTENSIONS, cleanRelative, extractCommands, extractReads, extractSearches, extractWrites, guessName, impliedAction, indexScope, stripIndex, stripSearches } from "./legacy-tool-parser.mjs";
export { PC_TOOLS, claveLectura, BINARY_EXTENSIONS, cleanRelative, extractCommands, extractReads, extractSearches, extractWrites, guessName, impliedAction, indexScope, stripIndex, stripSearches };

const BLOCKED_DIRS = new Set([".git"]);
const MAX_BYTES = 1_500_000;

/**
 * @param {string} root
 * @param {string} rel
 * @returns {string}
 */
export function resolveInside(root, rel) {
  const raw = String(rel || "").trim().replace(/^["'`]+|["'`]+$/g, "");
  const target = rutaProyecto(root, raw);
  if (!target) throw new Error("ruta fuera del proyecto o contiene un enlace");
  const cleaned = path.relative(path.resolve(root), target).replace(/\\/g, "/");
  if (!cleaned || cleaned.includes("\0")) throw new Error("ruta vacía");
  const parts = cleaned.split("/").filter(Boolean);
  // Windows no distingue mayúsculas (`BIN` ES `bin`) y además ignora el punto final: sin
  // normalizar, `MODELS/x.py`, `.GIT/hooks/x.py` o `bin./x.ps1` se colaban.
  const plano = (part) => part.replace(/[. ]+$/, "").toLowerCase();
  if (parts.some((part) => !plano(part) || BLOCKED_DIRS.has(plano(part)))) throw new Error("ruta no permitida");
  const ext = path.extname(parts[parts.length - 1] || "").slice(1).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) throw new Error(`archivo binario: usa ejecutar para generar ${ext}`);
  const abs = rutaSegura(root, parts.join("/"));
  if (!abs) throw new Error("ruta fuera del proyecto o contiene un enlace");
  return abs;
}

/**
 * ¿Es un objeto JSON válido? Sirve para distinguir "la llamada llegó CORTADA" (JSON a medias,
 * típico cuando el modelo escribe un archivo grande) de "la llamada vino vacía".
 * @param {string} texto
 * @returns {boolean}
 */
function esObjetoJson(texto) {
  try {
    const parsed = JSON.parse(texto);
    return Boolean(parsed) && typeof parsed === "object";
  } catch {
    return false;
  }
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
/**
 * Misma identidad aunque cambie el python del venv o las barras.
 * @param {string} command
 * @returns {string}
 */
export function commandKey(command) {
  return command
    .trim()
    .replace(/\\/g, "/")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\.venv\/scripts\/python(?:\.exe)?/g, "python")
    .replace(/\bpython\.exe\b/g, "python");
}

/**
 * @param {string} clave
 * @returns {{rel: string, desde: number, hasta: number}} hasta 0 = hasta donde quepa
 */
export function partirLectura(clave) {
  const m = String(clave).match(/^(.*):(\d+)-(\d*)$/);
  if (!m) return { rel: String(clave), desde: 0, hasta: 0 };
  return { rel: m[1], desde: Number(m[2]), hasta: m[3] ? Number(m[3]) : 0 };
}

/**
 * Traduce las tool calls a efectos. `ids` dice qué llamada pidió cada efecto (clave
 * `cmd:<comando>`, `read:<clave>`, `write:<ruta>`, `search:<consulta>`, `index`) y
 * `notesIds` va en paralelo a `notes`: así cada resultado vuelve a SU llamada.
 * @param {Array<{id?: string, name?: string, arguments?: unknown}>} calls
 * @returns {{navegaciones: Array<Record<string, unknown>>, commands: string[], searches: string[], reads: string[], writes: Array<{rel: string, content: string}>, edits: Array<{rel: string, buscar: string, poner: string}>, enFondo: Set<string>, scope: string | null, notes: string[], ids: Map<string, string>, notesIds: string[]}}
 */
export function nativeToolEffects(calls) {
  const navegaciones = [];
  /** @type {Array<{rel: string, buscar: string, poner: string}>} */
  const edits = [];
  /** Comandos pedidos con `segundo_plano: true`. */
  /** @type {Set<string>} */
  const enFondo = new Set();
  const repetir = new Set();
  /** @type {string[]} */
  const commands = [];
  /** @type {string[]} */
  const searches = [];
  const webs = [];
  /** @type {string[]} */
  const reads = [];
  /** @type {Array<{rel: string, content: string}>} */
  const writes = [];
  /** Procesos en segundo plano pedidos con `proceso`. @type {Array<{accion: string, id: string}>} */
  const procesos = [];
  /** Archivos o carpetas que el modelo pide borrar. @type {string[]} */
  const borrados = [];
  /** Movimientos o renombrados pedidos. @type {Array<{origen: string, destino: string}>} */
  const movidos = [];
  /** Plan de la tarea pedido con la función `plan` (null si no la llamó). @type {{pasos: string[], hechos: number[]} | null} */
  let plan = null;
  /** @type {string[]} */
  const notes = [];
  /** @type {string[]} */
  const notesIds = [];
  /** @type {Map<string, string>} */
  const ids = new Map();
  /** @type {string | null} */
  let scope = null;
  calls.forEach((call, index) => {
    // El mismo id que le pone apiTurn (context.mjs) al reenviar la llamada.
    const id = String(call?.id || `call_${index}`);
    /** @param {string} texto */
    const nota = (texto) => {
      notes.push(texto);
      notesIds.push(id);
    };
    /** @param {string} clave */
    const marca = (clave) => {
      if (!ids.has(clave)) ids.set(clave, id);
    };
    const name = String(call?.name || "").toLowerCase();
    const crudo = argText(call?.arguments);
    const cortada = crudo !== "" && !esObjetoJson(crudo);
    /** Nota para una llamada que llegó a medias: el modelo necesita saber qué pasó y cómo salir. */
    const notaCortada = (funcion) =>
      `la llamada a ${funcion} llegó CORTADA (el JSON no cierra: no cabía en el hueco de generación). Pide el trabajo en trozos más pequeños o divide el archivo en varios.`;
    const args = parseToolArgs(call?.arguments);
    const handled = dispatchToolEffect(name, {
      name, args, raw: crudo, cortada, note: nota, marca,
      commands, searches, reads, writes, edits, navegaciones, webs, procesos, borrados, movidos, enFondo, repetir,
      getScope: () => scope,
      setScope: (value) => { scope = value; },
      setPlan: (value) => { plan = value; },
      notaCortada,
    });
    if (!handled && name) nota(`función desconocida: ${name}. Las que hay: ejecutar, leer, indice, archivo, reemplazar, buscar, leer_web, navegador, proceso, plan, borrar, mover.`);
  });
  if (commands.length > 6) {
    notes.push(`quedaron ${commands.length - 6} comandos sin lanzar; pídelos en el siguiente paso`);
    notesIds.push(ids.get(`cmd:${commands[6]}`) || "");
  }
  if (searches.length > 4) {
    notes.push(`quedaron ${searches.length - 4} búsquedas sin hacer`);
    notesIds.push(ids.get(`search:${searches[4]}`) || "");
  }
  if (writes.length > 6) {
    notes.push(`quedaron ${writes.length - 6} escrituras sin lanzar; pídelas en el siguiente paso`);
    notesIds.push(ids.get(`write:${writes[6].rel}`) || "");
  }
  if (edits.length > 8) {
    notes.push(`quedaron ${edits.length - 8} ediciones sin lanzar; pídelas en el siguiente paso`);
    notesIds.push(ids.get(`edit:${edits.length - 9}`) || "");
  }
  if (borrados.length > 6) {
    notes.push(`quedaron ${borrados.length - 6} borrados sin lanzar; pídelos en el siguiente paso`);
    notesIds.push(ids.get(`del:${borrados[6]}`) || "");
  }
  if (movidos.length > 6) {
    notes.push(`quedaron ${movidos.length - 6} movimientos sin lanzar; pídelos en el siguiente paso`);
    notesIds.push(ids.get(`move:${movidos[6].origen}`) || "");
  }
  return {
    navegaciones,
    commands: commands.slice(0, 6),
    searches: searches.slice(0, 4),
    webs,
    reads: reads.slice(0, 8),
    writes: writes.slice(0, 6),
    edits: edits.slice(0, 8),
    borrados: borrados.slice(0, 6),
    movidos: movidos.slice(0, 6),
    procesos: procesos.slice(0, 6),
    plan,
    enFondo,
    repetir,
    scope,
    notes,
    ids,
    notesIds,
  };
}

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
export function esCharla(texto) {
  const t = String(texto || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!t || t.length > 400) return false;
  if (/^[¡¿\s]*(hola|hi|hello|hey|buenas|buenos dias|buenas tardes|buenas noches|gracias|muchas gracias|adios|hasta luego)[!¡?.\s]*$/.test(t)) return true;
  if (/[\w-]+\.[a-z0-9]{1,5}\b/.test(t)) return false; // nombra un archivo
  if (/\b(archivo|carpeta|proyecto|repo|repositorio|mi codigo|este codigo|el codigo de|script|tests?|error|falla|fallo|bug|arregl|corrig|crea|crear|creame|haz|hazme|escrib|ejecut|corre|instal|guard|modific|cambi|renombr|lee|leer|abre|abrir|busca|buscar|gener|implement|anad|agreg|borr|elimin|descarg|compil|prueb|calcula|convierte|traduce este)\w*/.test(t)) return false;
  return /^[¿¡\s]*(explica|explicame|que es|que son|que significa|que diferencia|cual es la diferencia|diferencia entre|por que|como funciona|como funcionan|para que sirve|cuando se usa|cuando usar|que opinas|define|resume)\b/.test(t);
}

/**
 * Un pedido que pide explícitamente un plan, una propuesta o preguntas antes de
 * implementar. En ese caso el primer turno debe responder sin inspeccionar el
 * proyecto por rutina; las herramientas quedan para cuando el usuario responda.
 * @param {string} texto
 * @returns {boolean}
 */
export function pideAclaraciones(texto) {
  const t = String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!t || t.length > 12000) return false;
  return /\b(?:hazme|haz|hacer|formula|formular|plantea|plantear)\b[^.\n]{0,60}\bpreguntas?\b|\bpreguntas? bloqueantes?\b|\bplan detallado\b|\bpropuesta (?:inicial|detallada)\b|\bantes de implementar\b|\bno implementes\b|\brequisitos y preguntas\b/i.test(t);
}

export function inventedToolResult(text) {
  return /(?:^|\n)\s*código\s+\d+\b/i.test(text)
    || /is not recognized as an internal or external command/i.test(text)
    || /(?:^|\n)\s*bloqueado\s*:/i.test(text);
}

/**
 * @param {string} text
 * @returns {string}
 */
function stripLooseCommands(text) {
  /** @type {string[]} */
  const out = [];
  let drop = "";
  for (const line of text.split(/\r?\n/)) {
    const tagged = line.match(/^(?:ejecutar|ejecutando)\s*:\s*(.+)$/i);
    if (tagged) {
      drop = (tagged[1] || "").trim();
      continue;
    }
    if (drop && line.trim() === drop) continue;
    if (line.trim() && line.trim() !== drop) drop = "";
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Quita las llamadas a función escritas como TEXTO (`<tool_call>…</tool_call>`).
 * Pasa cuando el servidor no las parsea (p. ej. con `tool_choice: "none"` en el turno
 * de cierre): el modelo, entrenado con esa plantilla, escribe la llamada y, sin esto,
 * el usuario acababa viendo el XML crudo como respuesta final.
 * @param {string} text
 * @returns {string}
 */
export function stripToolCallMarkup(text) {
  const out = String(text || "")
    .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
    .replace(/<tool_call>[\s\S]*$/i, "");
  return out
    .split(/\r?\n/)
    .filter((line) => !/^\s*<\/?(?:tool_call|function|parameter)\b[^>]*>\s*$/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * @param {string} text
 * @returns {string}
 */
export function stripFakeToolText(text) {
  /** @type {string[]} */
  const out = [];
  let skipping = false;
  for (const line of stripToolCallMarkup(text).split(/\r?\n/)) {
    const trim = line.trim();
    if (/^(?:ejecutar|ejecutando|buscar|bloqueado)\s*:/i.test(trim) || /^código\s+\d+\b/i.test(trim)) {
      skipping = true;
      continue;
    }
    if (skipping) {
      if (!trim) skipping = false;
      continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function stripCommands(text) {
  return stripLooseCommands(text
    .replace(/```ejecutar\s*\r?\n[\s\S]*?```/g, "")
    .replace(/```ejecutar[ \t]+[^\r\n`]+```/g, "")
    .replace(/```[ \t]*\r?\n[ \t]*ejecutar\b[\s\S]*?```/gi, ""))
    .trim();
}

/**
 * @param {string} command
 * @returns {boolean}
 */
export function commandAllowed(command, { trusted = false } = {}) {
  const text = command.trim();
  if (!text || text.includes("\0") || text.length > 32768) return false;
  // El modo autónomo no confunde rutas, taskkill, scripts o argumentos con ataques.
  // Esta comprobación evita accidentes evidentes; código arbitrario NO se aísla con regex.
  if (trusted) return !/(?:^|[&|;\r\n])\s*(?:shutdown|format|diskpart|bcdedit|(?:reg(?:\.exe)?\s+delete))(?=\s|$)/i.test(text);
  // Lo que NO se lanza desde aquí. Ojo con dos cosas: en Windows la ruta absoluta también
  // se escribe con barra normal (`C:/Users/...`), y los verbos de borrado/movimiento no
  // estaban: `del /s /q *.py` pasaba el filtro.
  // Y con otras dos al revés: la unidad tiene que ir SUELTA (`C:\`, `"D:/`), porque si no
  // el `p:/` de `http://` bloqueaba cualquier comando con una URL (no se podía probar una API
  // con curl ni con urllib); y `..` solo cuenta como ruta (`..\x`, `cd ..`), no dentro de un
  // texto como `print('...')`.
  return !/(^|[\s"'=(,;\\/])\.\.([\\/\s"';)]|$)|(^|[\s"'=(,;])[A-Za-z]:[\\/]|\/windows|system32|shutdown|format\s|cipher\s|reg\s+delete|(^|[\s&|])(del|erase|rd|rmdir|move|ren|takeown|icacls|taskkill|stop-process|remove-item|rm)(\s|$)/i.test(text);
}

/**
 * @param {string} text
 * @returns {string}
 */
export function stripReads(text) {
  return text
    .replace(/```leer[ \t]+[^\r\n`]+?\s*```/g, "")
    .replace(/```leer[ \t]*\r?\n[\s\S]*?```/gi, "")
    .replace(/```[ \t]*\r?\n[ \t]*leer\b[\s\S]*?```/gi, "")
    .trim();
}

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

export function stripFileBlocks(text) {
  return text
    .replace(/```archivo[^\n]*\n[\s\S]*?```/gi, "")
    .replace(/```[ \t]*\r?\n[ \t]*archivo\b[\s\S]*?```/gi, "")
    .replace(/```[ \t]*\r?\n[ \t]*[^\s`]+\.[a-z0-9]+\s*\r?\n[\s\S]*?```/gi, "")
    .replace(/```(?:html|css|js|mjs|svg|txt|md|json|py)\s*\n[\s\S]*?```/gi, "")
    .trim();
}

/**
 * @param {string} root
 * @param {Array<{rel: string, content: string}>} writes
 * @returns {Array<{rel: string, bytes: number, url: string}>}
 */
export function writeOutputs(root, writes) {
  /** @type {Array<{rel: string, bytes: number, url: string}>} */
  const saved = [];
  fs.mkdirSync(root, { recursive: true });
  for (const write of writes) {
    const abs = resolveInside(root, write.rel);
    const body = Buffer.from(write.content, "utf8");
    if (body.includes(0)) throw new Error(`archivo binario: usa ejecutar para generar ${write.rel}`);
    if (body.length > MAX_BYTES) throw new Error(`archivo demasiado grande: ${write.rel}`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (!rutaSegura(root, path.relative(root, abs))) throw new Error("ruta no permitida");
    escribirAtomico(abs, body);
    const rel = path.relative(root, abs).split(path.sep).join("/");
    saved.push({ rel, bytes: body.length, url: `/p/${rel.split("/").map(encodeURIComponent).join("/")}` });
  }
  return saved;
}

/** Publica un archivo nuevo sin sobrescribir otro creado durante la operación. */
export function writeNewOutput(root, rel, contenido) {
  const abs = resolveInside(root, rel), body = Buffer.from(contenido, "utf8");
  if (body.includes(0) || body.length > MAX_BYTES) throw new Error("Contenido binario o demasiado grande");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (!rutaSegura(root, path.relative(root, abs))) throw new Error("ruta no permitida");
  const tmp = path.join(path.dirname(abs), `.bonsai-${crypto.randomBytes(12).toString("hex")}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, "wx");
    fs.writeFileSync(fd, body); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.linkSync(tmp, abs); // link atómico: falla si el destino ya existe
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch (err) { if (err.code !== "ENOENT") throw err; }
  }
  const ruta = path.relative(root, abs).split(path.sep).join("/");
  return { rel: ruta, bytes: body.length, url: `/p/${ruta.split("/").map(encodeURIComponent).join("/")}` };
}

/**
 * @returns {string[]}
 */
export function selfTest() {
  /** @type {string[]} */
  const failures = [];
  /**
   * @param {string} name
   * @param {boolean} cond
   */
  const check = (name, cond) => {
    if (!cond) failures.push(name);
  };
  const sample = "Listo.\n```archivo juegos/serpiente.html\n<!DOCTYPE html><html></html>\n```\n";
  const got = extractWrites(sample, "haz la serpiente");
  check("lee el bloque archivo", got.length === 1 && got[0].rel === "juegos/serpiente.html" && got[0].content.includes("<html>"));
  const namedFile = extractWrites("```nota-prueba.txt\nping\n```", "crea");
  check("acepta el nombre en la cerca", namedFile[0]?.rel === "nota-prueba.txt" && namedFile[0]?.content === "ping");
  check("nombre serpiente", guessName("hazme el juego de la serpiente en html", "html") === "serpiente.html");
  check("con tool calls nativas, enseñar un resultado en una cerca no escribe nada", extractWrites("Resultado:\n```json\n{\"total\": 241, \"por_producto\": {\"manzana\": 90}}\n```", "Lee ventas.json", { soloExplicitas: true }).length === 0);
  check("con tool calls nativas, un ```archivo explícito sí cuenta", extractWrites(sample, "x", { soloExplicitas: true }).length === 1);
  const fallback = extractWrites("```html\n<!DOCTYPE html><html><body>hola</body></html>\n```", "un juego");
  check("cae a html", fallback.length === 1 && fallback[0].rel.endsWith(".html"));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-salida-"));
  try {
    const saved = writeOutputs(root, got);
    check("escribe dentro del proyecto", fs.existsSync(path.join(root, "juegos", "serpiente.html")) && saved[0].url === "/p/juegos/serpiente.html");
    let rejected = false;
    try {
      resolveInside(root, "../secreto.html");
    } catch {
      rejected = true;
    }
    check("rechaza salir de la carpeta", rejected);
    let rejectedExt = false;
    try {
      resolveInside(root, "malware.exe");
    } catch {
      rejectedExt = true;
    }
    check("rechaza ejecutables", rejectedExt);
  const reads = extractReads("voy ```leer test_math.py``` y ```leer ../x.py```");
  check("lee rutas pedidas", reads[0] === "test_math.py" && reads.length === 2);
  check("quita el pedido de lectura", !stripReads("antes ```leer a.py``` después").includes("leer"));
  check("pide el índice entero", indexScope("mira ```indice```") === "");
  check("pide una carpeta", indexScope("```indice scripts```") === "scripts");
  check("sin índice", indexScope("nada") === null);
  check("quita el índice", !stripIndex("antes ```indice``` después").includes("indice"));
  check("bin pertenece al proyecto seleccionado", resolveInside(root, "bin/x.py") === path.join(root, "bin", "x.py"));
  check("lee un comando", extractCommands("```ejecutar\r\nnode -e \"console.log(1)\"\r\n```")[0]?.startsWith("node"));
  const loose = "ahora\n```\nejecutar\ndel main.py README.md\n```\n";
  const diffCambio = unifiedDiff("a.txt", "a\nb", "a\nc");
  check("diff marca el cambio", diffCambio.includes("-b") && diffCambio.includes("+c"));
  check("diff conserva el contexto", diffCambio.includes(" a"));
  check("diff sin cambios", unifiedDiff("a.txt", "a\nb", "a\nb").endsWith(" sin cambios"));
  const diffCreado = unifiedDiff("n.txt", "", "uno\ndos");
  check("diff de archivo nuevo", diffCreado.startsWith("--- /dev/null") && diffCreado.includes("+uno") && diffCreado.includes("+dos"));
  const largo = Array.from({ length: 4000 }, (_, i) => `linea ${i}`).join("\n");
  const largoEditado = largo.replace("linea 2000", "linea 2000 CAMBIADA").replace("linea 3950", "linea 3950 AL_FINAL");
  const t0 = Date.now();
  const diffLargo = unifiedDiff("l.txt", largo, largoEditado);
  const msDiff = Date.now() - t0;
  check(
    "diff grande sin matriz y con contexto",
    msDiff < 800 &&
      diffLargo.includes("-linea 2000") &&
      diffLargo.includes("+linea 2000 CAMBIADA") &&
      diffLargo.includes(" linea 1999") &&
      diffLargo.includes("+linea 3950 AL_FINAL"),
  );
  const base30 = Array.from({ length: 30 }, (_, i) => `L${i}`).join("\n");
  const dosCambios = base30.replace("L2", "L2X").replace("L25", "L25X");
  const diffDos = unifiedDiff("d.txt", base30, dosCambios);
  check("diff separa grupos con @@", diffDos.includes("@@") && diffDos.includes(" L1") && diffDos.includes(" L3"));
  const reproA = ["x", "x", "y", "x", "x"].join("\n");
  const reproB = ["x", "x", "y2", "x", "x"].join("\n");
  const diffRepro = unifiedDiff("r.txt", reproA, reproB);
  check("diff con líneas repetidas usa un ancla", diffRepro.includes("-y") && diffRepro.includes("+y2") && diffRepro.includes(" x"));
  const antesRen = Array.from({ length: 200 }, (_, i) => `const foo${i} = foo(${i});`).join("\n");
  const despuesRen = antesRen.replaceAll("foo", "bar");
  const t1 = Date.now();
  const diffRen = unifiedDiff("r.txt", antesRen, despuesRen);
  const msRen = Date.now() - t1;
  check("diff masivo termina rápido", msRen < 800);
  check("diff masivo enseña quitar y poner", diffRen.includes("-const foo0 = foo(0);") && diffRen.includes("+const bar0 = bar(0);"));
  check("lee ejecutar dentro de la cerca", extractCommands(loose)[0] === "del main.py README.md");
  check("quita esa cerca", !stripCommands(loose).includes("ejecutar") && stripCommands(loose).includes("ahora"));
  check("leer vacío lista la carpeta", indexScope("```\nleer\n```") === "");
  const looseWrite = "Perfecto.\n```\narchivo\nserpiente.html\n<!DOCTYPE html><html></html>\n```\n";
  const looseGot = extractWrites(looseWrite, "serpiente");
  check("archivo en dos líneas", looseGot[0]?.rel === "serpiente.html" && looseGot[0]?.content.includes("<html>"));
  check("quita ese bloque del texto", !stripFileBlocks(looseWrite).includes("DOCTYPE") && stripFileBlocks(looseWrite).includes("Perfecto"));
  const splitTag = "```archivo\nserpiente.html\n<!DOCTYPE html><html></html>\n```";
  check("ruta bajo la etiqueta", extractWrites(splitTag, "x")[0]?.rel === "serpiente.html");
  const namedLoose = "Listo.\n```\nserpiente.html\nserpiente.html\n<!DOCTYPE html><html></html>\n```\n";
  const namedGot = extractWrites(namedLoose, "x");
  check("el nombre va en la primera línea", namedGot[0]?.rel === "serpiente.html" && namedGot[0]?.content.startsWith("<!DOCTYPE"));
  check("ese bloque sale del texto", !stripFileBlocks(namedLoose).includes("DOCTYPE") && stripFileBlocks(namedLoose).includes("Listo"));
  check("leer con ruta suelta", extractReads("```\nleer\nmain.py\n```")[0] === "main.py");
  check("bloquea salir del disco", !commandAllowed("type C:\\Windows\\win.ini"));
  check("permite node", commandAllowed("node -e \"console.log(1)\""));
  check("permite comandos con URL (probar una API)", commandAllowed("curl http://127.0.0.1:8099/tareas") && commandAllowed("python -c \"import urllib.request; print(urllib.request.urlopen('http://localhost:8099/tareas').read())\""));
  check("permite puntos suspensivos en un texto", commandAllowed("python -c \"print('cargando...')\""));
  check("sigue bloqueando rutas absolutas y subir de carpeta", !commandAllowed("type \"C:/Users/x.txt\"") && !commandAllowed("python ..\\fuera.py") && !commandAllowed("copy a.txt ../b.txt") && !commandAllowed("cd .. && dir") && !commandAllowed("node -e \"require('fs').writeFileSync('../x','y')\""));
  const spoken = "Voy a instalar.\n\nejecutar: pip install reportlab\npip install reportlab\npip install reportlab\n";
  check("lee ejecutar suelto", extractCommands(spoken)[0] === "pip install reportlab" && extractCommands(spoken).length === 1);
  check("quita el comando repetido", stripCommands(spoken) === "Voy a instalar.");
  const look = "mira\n```\nbuscar\nclima en mexico\n```\n";
  check("lee una búsqueda", extractSearches(look)[0] === "clima en mexico");
  check("quita la búsqueda", !stripSearches(look).includes("buscar") && stripSearches(look).includes("mira"));
  check("busca en la etiqueta", extractSearches("```buscar hora actual```")[0] === "hora actual");
  const copied = "Voy a intentar.\n\ncódigo 1\n'python' is not recognized as an internal or external command,\noperable program or batch file.";
  check("detecta la salida inventada", inventedToolResult(copied));
  check("quita la salida inventada", stripFakeToolText(copied) === "Voy a intentar.");
  const xmlCall = "Voy a lanzarlo.\n<tool_call>\n<function=ejecutar>\n<parameter=comando>\npython lru.py\n</parameter>\n</function>\n</tool_call>";
  check("quita la llamada escrita en XML", stripFakeToolText(xmlCall) === "Voy a lanzarlo.");
  check("quita una llamada XML cortada a medias", stripToolCallMarkup("Listo.\n<tool_call>\n<function=ejecutar>") === "Listo.");
  check("el XML pegado a texto no se come el texto", stripToolCallMarkup("antes <tool_call><function=leer></function></tool_call> después") === "antes  después");
  check("sin XML no toca nada", stripToolCallMarkup("hola\nmundo") === "hola\nmundo");
  const blocked = "Busco.\n\nbloqueado: python --version\n'python' is not recognized as an internal or external command,";
  check("lee el comando bajo bloqueado", extractCommands(blocked)[0] === "python --version");
  check("lee buscar en una línea", extractSearches("Voy.\nbuscar: python pdf windows")[0] === "python pdf windows");
  check("una frase de búsqueda sí busca", impliedAction("Voy a buscar cómo ejecutar Python en este entorno.")?.query === "cómo ejecutar Python en este entorno");
  check("una frase de python sí ejecuta", impliedAction("Voy a intentar ejecutar Python directamente.")?.command === "python --version");
  const native = nativeToolEffects([{ name: "ejecutar", arguments: "{\"comando\":\"python --version\"}" }]);
  check("lee la tool call nativa", native.commands[0] === "python --version" && native.searches.length === 0);
  const sinRuta = nativeToolEffects([{ name: "leer", arguments: {} }, { name: "leer", arguments: "{\"ruta\":\".\"}" }]);
  check("leer sin ruta o con . lista la carpeta (no es un error)", sinRuta.scope === "" && sinRuta.reads.length === 0 && sinRuta.notes.length === 0);
  check("una explicación que dice buscar no lanza una búsqueda", impliedAction("La función `buscar` implementa una búsqueda binaria sobre una lista ordenada.").query === "");
  check("una explicación que habla de Python no lanza un comando", impliedAction("Python es un lenguaje interpretado y de tipado dinámico.").command === "");
  check("un anuncio largo no cuenta", impliedAction(`Voy a buscar ${"algo ".repeat(100)}`).query === "");
  check("el python del venv es el mismo comando", commandKey(".venv\\Scripts\\python audit/hola.py") === commandKey("python audit/hola.py"));
  const many = nativeToolEffects([
    { name: "leer", arguments: { ruta: "audit/uno.txt" } },
    { name: "leer", arguments: { ruta: "audit/hola.py" } },
    { name: "ejecutar", arguments: {} },
  ]);
  check("varias lecturas y avisa el comando vacío", many.reads.length === 2 && many.notes.some((note) => note.includes("sin `comando`")));
  const conIds = nativeToolEffects([
    { id: "c1", name: "ejecutar", arguments: { comando: "python a.py" } },
    { id: "c2", name: "leer", arguments: { ruta: "big.html", desde: 100, hasta: 180 } },
    { id: "c3", name: "archivo", arguments: { contenido: "x" } },
    { name: "archivo", arguments: { ruta: "b.txt", contenido: "y" } },
  ]);
  check("cada efecto sabe qué llamada lo pidió", conIds.ids.get("cmd:python a.py") === "c1" && conIds.ids.get("read:big.html:100-180") === "c2" && conIds.ids.get("write:b.txt") === "call_3");
  check("las notas van con el id de su llamada", conIds.notesIds[conIds.notes.findIndex((n) => /sin `ruta`/.test(n))] === "c3");
  check("leer con desde/hasta lleva el rango en la clave", conIds.reads[0] === "big.html:100-180" && partirLectura("big.html:100-180").desde === 100 && partirLectura("big.html:100-180").hasta === 180);
  check("leer sin rango es la ruta sola", partirLectura("a.py").rel === "a.py" && partirLectura("a.py").desde === 0 && claveLectura("a.py") === "a.py");
  check("leer solo con desde llega hasta donde quepa", claveLectura("a.py", 50) === "a.py:50-" && partirLectura("a.py:50-").hasta === 0);
  check("una pregunta conceptual es charla", esCharla("Explica qué es una closure en JavaScript y dame un ejemplo corto.") && esCharla("¿Qué es un decorador en Python?") && esCharla("¿Cuál es la diferencia entre let y var?"));
  check("si nombra un archivo no es charla", !esCharla("Explícame en 3 frases qué hace la función de algoritmo.py y cuál es su complejidad."));
  check("si hay algo que hacer no es charla", !esCharla("¿En qué archivo está definida la función conectar_db?") && !esCharla("Explica el error y arréglalo") && !esCharla("Crea un ejemplo de closure") && !esCharla("¿Qué es lo que falla en mis tests?"));
  check("un pedido normal no es charla", !esCharla("necesito que me hagas un modelo 3d en un archivo html") && esCharla("hola"));
  check("un pedido de plan/preguntas pide aclaraciones primero", pideAclaraciones("Diseña e implementa el proyecto; dame un plan detallado y 5 preguntas bloqueantes antes de empezar.") && pideAclaraciones("Hazme 3 preguntas antes de tocar archivos.") && !pideAclaraciones("Implementa el plan y crea los archivos."));
  check("saludos breves no activan tareas", esCharla("hi") && esCharla("Hello!") && !esCharla("hi, crea un archivo"));
  const conEdit = nativeToolEffects([{ id: "e1", name: "reemplazar", arguments: { ruta: "a.py", buscar: "x = 1", poner: "x = 2" } }, { id: "e2", name: "reemplazar", arguments: { ruta: "a.py" } }]);
  check("reemplazar llega como edición con su id", conEdit.edits.length === 1 && conEdit.edits[0].poner === "x = 2" && conEdit.ids.get("edit:0") === "e1");
  check("reemplazar sin buscar/poner avisa", conEdit.notes.some((n) => /reemplazar necesita/.test(n)) && conEdit.notesIds[0] === "e2");
  const conFs = nativeToolEffects([
    { id: "b1", name: "borrar", arguments: { ruta: "viejo.txt" } },
    { id: "m1", name: "mover", arguments: { origen: "a.py", destino: "src/a.py" } },
    { id: "p1", name: "plan", arguments: { pasos: ["crear modulo", "testear", "borrar temporal"], hechos: [1] } },
    { id: "b2", name: "borrar", arguments: {} },
  ]);
  check("borrar llega como borrado con su id", conFs.borrados.includes("viejo.txt") && conFs.ids.get("del:viejo.txt") === "b1");
  check("mover llega con origen y destino", conFs.movidos.length === 1 && conFs.movidos[0].origen === "a.py" && conFs.movidos[0].destino === "src/a.py" && conFs.ids.get("move:a.py") === "m1");
  check("plan llega con pasos y hechos", conFs.plan?.pasos.length === 3 && conFs.plan?.hechos[0] === 1 && conFs.ids.get("plan") === "p1");
  check("borrar sin ruta avisa", conFs.notes.some((n) => /borrar llegó sin/.test(n)) && conFs.notesIds[conFs.notes.findIndex((n) => /borrar llegó sin/.test(n))] === "b2");
  const planTexto = nativeToolEffects([{ name: "plan", arguments: { plan: "uno\ndos" } }]);
  check("plan acepta texto con líneas como respaldo", planTexto.plan?.pasos.length === 2);
  const conProc = nativeToolEffects([
    { id: "pr1", name: "proceso", arguments: { accion: "listar" } },
    { id: "pr2", name: "proceso", arguments: { accion: "detener", id: "bg123" } },
    { id: "pr3", name: "proceso", arguments: { accion: "detener" } },
  ]);
  check("proceso lista y detiene con su id", conProc.procesos[0].accion === "listar" && conProc.procesos[1].id === "bg123" && conProc.ids.get("proc:listar") === "pr1");
  check("proceso sin id avisa", conProc.notes.some((n) => /proceso necesita/.test(n)) && conProc.notesIds[0] === "pr3");
  const r1 = aplicarReemplazo("a\nb\nc\n", "b", "B");
  check("reemplazo único", r1.ok && r1.texto === "a\nB\nc\n" && r1.linea === 2);
  check("reemplazo ambiguo o ausente no toca nada", !aplicarReemplazo("b b", "b", "x").ok && aplicarReemplazo("b b", "b", "x").veces === 2 && aplicarReemplazo("abc", "z", "x").veces === 0);
  const crlf = aplicarReemplazo("uno\r\ndos\r\ntres\r\n", "dos\ntres", "DOS\nTRES");
  check("reemplazo con CRLF en el archivo y LF en la llamada", crlf.ok && crlf.texto === "uno\r\nDOS\r\nTRES\r\n");
  const parecido = trozoParecido("function a() {\n  controls.enableDamping = true;\n  return 1;\n}\n", "  controls.enableDamping=true;");
  check("si no está, enseña el trozo real más parecido", /línea 2/.test(parecido) && parecido.includes("  controls.enableDamping = true;"), parecido);
  check("sin nada parecido no inventa", trozoParecido("abc\ndef\n", "zzz qqq") === "");
  check("poner vacío borra el trozo", aplicarReemplazo("a\nquitar\nb", "quitar\n", "").ok && aplicarReemplazo("a\nquitar\nb", "quitar\n", "").texto === "a\nb");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  return failures;
}

if (process.argv[1] && process.argv[1].endsWith("actions.mjs")) {
  const failures = selfTest();
  if (failures.length) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("actions ok\n");
  }
}
