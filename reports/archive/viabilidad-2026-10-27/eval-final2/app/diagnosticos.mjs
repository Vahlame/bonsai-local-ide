/**
 * Motor de diagnósticos, outline de símbolos e «ir a definición» para Bonsai Local IDE.
 *
 * El IDE no tiene servidores LSP ni dependencias npm: este módulo implementa un motor
 * propio, honesto y rápido, usando solo la biblioteca estándar de Node.
 *
 * API PÚBLICA
 * -----------
 *  - `lenguajeDe(rel) -> "js" | "py" | "json" | "html" | "css" | "md" | ""`
 *      Deduce el lenguaje por extensión (js/mjs/cjs -> js, html/htm -> html, md/markdown -> md).
 *
 *  - `diagnosticarArchivo(abs, texto?) -> Promise<Diagnóstico[]>`
 *      Comprobadores REALES (pueden lanzar procesos, con timeout):
 *        · JS/MJS/CJS -> `node --check` sobre una copia temporal (nunca se ejecuta el código).
 *        · PY        -> `python -m py_compile` sobre una copia temporal (se borra todo).
 *        · JSON      -> `JSON.parse`, calculando línea/columna del error.
 *        · HTML      -> comprobación ligera de etiquetas desbalanceadas.
 *        · CSS       -> comprobación ligera de llaves ()/[]/{} desbalanceadas.
 *        · MD        -> bloques de código ``` sin cerrar.
 *      «Diagnóstico» = `{archivo, linea, columna, severidad: "error" | "aviso", mensaje, fuente}`,
 *      con `linea` y `columna` en base 1. `archivo` es la ruta `abs` tal como se recibió.
 *      `fuente` es "node" (JS), "py_compile" (PY), "json", "html", "css" o "markdown".
 *      Si se pasa `texto`, no se lee el archivo (útil para diagnósticos de un buffer).
 *      NUNCA lanza: si no se puede comprobar (archivo ilegible, binario, sin `python`,
 *      timeout, extensión desconocida...) devuelve `[]`. Un archivo vacío tampoco produce
 *      diagnósticos.
 *
 *  - `diagnosticarTexto(rel, texto) -> Diagnóstico[]` (SINCRÓNICO, sin spawn)
 *      Versión barata para el editor mientras se escribe: JSON (`JSON.parse`), llaves/
 *      paréntesis/corchetes desbalanceados en JS/PY/CSS y etiquetas desbalanceadas en HTML.
 *      `fuente` es "json" | "llaves" | "etiquetas" | "markdown". No detecta errores que solo
 *      ve un parser real (ni type-checking): para eso está `diagnosticarArchivo`.
 *
 *  - `simbolos(rel, texto) -> Símbolo[]`
 *      Outline con `{nombre, tipo, linea, columna}` en base 1:
 *        · JS: "funcion" (declaraciones y const/let/var con función o flecha), "clase",
 *          "variable", "metodo" (métodos dentro de una clase).
 *        · PY: "funcion" (`def`, también métodos) y "clase" (`class`).
 *        · JSON: "clave" (solo claves de primer nivel del objeto raíz).
 *        · HTML: "id" y "name" (atributos).
 *        · CSS: "selector" y "at-regla" (p. ej. `@media ...`).
 *
 *  - `indiceSimbolos(root, archivos?, opciones?) -> Map<string, Entrada[]>`
 *      Recorre (SINCRÓNICO) archivos de texto del proyecto y construye un índice
 *      nombre -> `[{archivo, linea, columna, tipo}]` con `archivo` relativo y separadores
 *      "/". Salta binarios, archivos de más de 2 MB, `node_modules/.git/bin/models/logs`
 *      (y `dist/build/__pycache__/.venv/venv`) y se detiene en `maxArchivos` (4000).
 *      `archivos` permite pasar una lista explícita de rutas (relativas a `root` o
 *      absolutas) y evitar el recorrido. `opciones`: `{maxArchivos, maxBytes, omitir}`.
 *
 *  - `buscarDefinicion(palabra, indice, archivoActual = "") -> {archivo, linea, columna, tipo} | null`
 *      Ignora palabras de menos de 2 caracteres. Prioriza definiciones del archivo actual
 *      y, si hay homónimos, las del mismo directorio y las rutas más cercanas.
 *      `archivoActual` se normaliza (también admite rutas absolutas, comparando por sufijo).
 *
 * TOLERANCIA
 * ----------
 *  - CRLF y BOM: las líneas se cuentan sobre "\n" y la columna sobre el contenido de la
 *    línea (el "\r" final no descuadra nada); el BOM se elimina antes de analizar.
 *  - Nunca se lanza código del proyecto: `node --check` y `py_compile` solo parsean.
 *  - Sin red, sin GPU, sin dependencias npm.
 *
 * LIMITACIONES REALES (a propósito, no se finge lo que no se comprueba)
 * ---------------------------------------------------------------------
 *  - Sin type-checking: TS/TSX/JSX no están soportados (no hay `typescript` ni parser JSX).
 *  - Python solo se comprueba con `py_compile` (sintaxis); nada de lint ni tipos.
 *  - HTML/CSS/MD son comprobaciones ESTRUCTURALES ligeras: no validan semántica, ni
 *    anidamiento correcto según el estándar, ni reglas CSS.
 *  - El chequeo sincrónico de llaves puede dar avisos transitorios mientras se escribe
 *    (p. ej. una llave a medio abrir) y no entiende JSX; las expresiones regulares se
 *    reconocen con una heurística (para no confundir "/" de división).
 *  - El outline es por líneas (regex sobre una versión «limpia» de comentarios/cadenas):
 *    no es un AST. No lista funciones anónimas, propiedades de objetos ni clases anidadas.
 *  - `indiceSimbolos` es sincrónico y puede tardar en proyectos enormes: usa los topes,
 *    o pásale la lista de archivos abiertos/recientes.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

/** Texto máximo que se analiza; por encima se devuelve [] en vez de bloquear el proceso. */
export const LIMITE_TEXTO = 2_000_000;
/** Archivos máximos que recorre `indiceSimbolos` por defecto. */
export const MAX_ARCHIVOS_INDICE = 4000;
/** Tamaño máximo de archivo que se indexa (2 MB). */
export const LIMITE_ARCHIVO_INDICE = 2_000_000;
/** Timeout de los comprobadores externos (node --check / py_compile). */
const TIMEOUT_COMPROBADOR = 8000;

/** Extensión -> lenguaje. */
const LENGUAJE_POR_EXT = new Map([
  [".js", "js"],
  [".mjs", "js"],
  [".cjs", "js"],
  [".py", "py"],
  [".json", "json"],
  [".html", "html"],
  [".htm", "html"],
  [".css", "css"],
  [".md", "md"],
  [".markdown", "md"],
]);

/** Extensiones de las que `indiceSimbolos` extrae símbolos. */
const EXTENSIONES_INDICE = new Set([".js", ".mjs", ".cjs", ".py", ".json", ".html", ".htm", ".css"]);

/** Carpetas que nunca se recorren en el índice (ruido, binarios o dependencias). */
const CARPETAS_OMITIDAS = new Set([
  "node_modules",
  ".git",
  "bin",
  "models",
  "logs",
  "dist",
  "build",
  "__pycache__",
  ".venv",
  "venv",
]);

/** Etiquetas HTML que no necesitan cierre. */
const ETIQUETAS_VACIAS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** Palabras que no son nombres de método aunque se escriban como `palabra(...) {`. */
const PALABRAS_NO_METODO = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "new",
  "delete",
  "typeof",
  "instanceof",
  "in",
  "of",
  "do",
  "else",
  "try",
  "finally",
  "yield",
  "await",
  "super",
  "this",
  "import",
  "export",
  "with",
  "throw",
  "case",
  "break",
  "continue",
  "default",
  "var",
  "let",
  "const",
  "class",
  "extends",
  "static",
]);

/** Caracteres tras los que un "/" inicia una expresión regular (heurística). */
const ANTES_DE_REGEX = new Set([
  "(",
  "[",
  "{",
  ",",
  ";",
  ":",
  "=",
  "!",
  "&",
  "|",
  "?",
  "+",
  "-",
  "*",
  "%",
  "<",
  ">",
  "~",
  "^",
]);

/** Palabras tras las que un "/" inicia una expresión regular. */
const PALABRAS_ANTES_DE_REGEX = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "do",
  "else",
  "yield",
  "await",
  "case",
  "throw",
]);

/**
 * Deduce el lenguaje de un archivo por su extensión.
 * @param {string} rel ruta o nombre del archivo
 * @returns {"js" | "py" | "json" | "html" | "css" | "md" | ""}
 */
export function lenguajeDe(rel) {
  try {
    const ext = path.extname(String(rel || "")).toLowerCase();
    return LENGUAJE_POR_EXT.get(ext) || "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Utilidades de texto y posiciones
// ---------------------------------------------------------------------------

/**
 * Quita el BOM UTF-8 si lo hay.
 * @param {string} texto
 * @returns {string}
 */
function quitarBom(texto) {
  return texto.length > 0 && texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

/**
 * Índices de inicio de cada línea (base 0) para calcular posiciones rápido.
 * @param {string} texto
 * @returns {number[]}
 */
function iniciosDeLinea(texto) {
  const inicios = [0];
  for (let i = 0; i < texto.length; i += 1) {
    if (texto[i] === "\n") inicios.push(i + 1);
  }
  return inicios;
}

/**
 * Convierte un índice de carácter en línea/columna base 1.
 * @param {number[]} inicios resultado de `iniciosDeLinea`
 * @param {number} indice
 * @returns {{linea: number, columna: number}}
 */
function posicionDe(inicios, indice) {
  const objetivo = Math.max(0, Number.isFinite(indice) ? indice : 0);
  let lo = 0;
  let hi = inicios.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (inicios[mid] <= objetivo) lo = mid;
    else hi = mid - 1;
  }
  return { linea: lo + 1, columna: objetivo - inicios[lo] + 1 };
}

/**
 * Línea/columna base 1 para un índice sobre el texto original (sin tabla previa).
 * @param {string} texto
 * @param {number} indice
 * @returns {{linea: number, columna: number}}
 */
function posicionLineaColumna(texto, indice) {
  const corte = Math.max(0, Math.min(Number.isFinite(indice) ? indice : 0, texto.length));
  const antes = texto.slice(0, corte);
  const lineas = antes.split("\n");
  return { linea: lineas.length, columna: lineas[lineas.length - 1].length + 1 };
}

/**
 * Sustituye por espacios un rango de caracteres, conservando "\n" y "\r" (así las
 * posiciones de la versión «limpia» coinciden exactamente con el texto original).
 * @param {string[]} chars
 * @param {number} desde
 * @param {number} hasta
 */
function blanquearRango(chars, desde, hasta) {
  const fin = Math.min(hasta, chars.length);
  for (let k = Math.max(0, desde); k < fin; k += 1) {
    const c = chars[k];
    if (c !== "\n" && c !== "\r") chars[k] = " ";
  }
}

/**
 * Copia el texto a un array de caracteres listo para blanquear.
 * @param {string} texto
 * @returns {string[]}
 */
function aCaracteres(texto) {
  const chars = new Array(texto.length);
  for (let k = 0; k < texto.length; k += 1) chars[k] = texto[k];
  return chars;
}

/**
 * Recorta un mensaje largo de un error externo (nunca enorme).
 * @param {string} mensaje
 * @returns {string}
 */
function recortarMensaje(mensaje) {
  const limpio = String(mensaje || "").replace(/\s+/g, " ").trim();
  return limpio.length > 300 ? `${limpio.slice(0, 297)}...` : limpio;
}

// ---------------------------------------------------------------------------
// Limpiadores: dejan el código «desnudo» (sin cadenas ni comentarios) conservando
// longitudes y saltos de línea, para que los balances/outline no se confundan.
// ---------------------------------------------------------------------------

/**
 * Heurística: ¿el "/" en esta posición inicia una expresión regular (y no es división)?
 * @param {string[]} chars texto ya blanqueado hasta la posición
 * @param {number} i
 * @returns {boolean}
 */
function esInicioDeRegex(chars, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(chars[k])) k -= 1;
  if (k < 0) return true;
  const prev = chars[k];
  if (ANTES_DE_REGEX.has(prev)) return true;
  if (!/[A-Za-z0-9_$]/.test(prev)) return false;
  let j = k;
  while (j >= 0 && /[A-Za-z0-9_$]/.test(chars[j])) j -= 1;
  return PALABRAS_ANTES_DE_REGEX.has(chars.slice(j + 1, k + 1).join(""));
}

/**
 * Índice inmediatamente después de una expresión regular que empieza en `i`, o -1.
 * @param {string} texto
 * @param {number} i
 * @returns {number}
 */
function finDeRegex(texto, i) {
  let j = i + 1;
  let enClase = false;
  while (j < texto.length) {
    const c = texto[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "\n" || c === "\r") return -1;
    if (c === "[") enClase = true;
    else if (c === "]") enClase = false;
    else if (c === "/" && !enClase) return j + 1;
    j += 1;
  }
  return -1;
}

/**
 * Limpia comentarios, cadenas, plantillas y (con heurística) regex de JavaScript.
 * @param {string} texto
 * @returns {string} texto de la misma longitud con esos contenidos en blanco
 */
function limpiarJs(texto) {
  const n = texto.length;
  const chars = aCaracteres(texto);
  /** @type {Array<{tipo: "plantilla" | "expr", llaves?: number}>} */
  const pila = [];
  let i = 0;
  while (i < n) {
    const cima = pila.length > 0 ? pila[pila.length - 1] : null;
    if (cima && cima.tipo === "plantilla") {
      const c = texto[i];
      if (c === "\\") {
        blanquearRango(chars, i, i + 2);
        i += 2;
        continue;
      }
      if (c === "`") {
        pila.pop();
        blanquearRango(chars, i, i + 1);
        i += 1;
        continue;
      }
      if (c === "$" && texto[i + 1] === "{") {
        pila.push({ tipo: "expr", llaves: 0 });
        blanquearRango(chars, i, i + 2);
        i += 2;
        continue;
      }
      blanquearRango(chars, i, i + 1);
      i += 1;
      continue;
    }
    const c = texto[i];
    if (c === "/" && texto[i + 1] === "/") {
      let j = i;
      while (j < n && texto[j] !== "\n") j += 1;
      blanquearRango(chars, i, j);
      i = j;
      continue;
    }
    if (c === "/" && texto[i + 1] === "*") {
      const fin = texto.indexOf("*/", i + 2);
      const j = fin < 0 ? n : fin + 2;
      blanquearRango(chars, i, j);
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (texto[j] === "\\") {
          j += 2;
          continue;
        }
        if (texto[j] === c) {
          j += 1;
          break;
        }
        if (texto[j] === "\n") break;
        j += 1;
      }
      blanquearRango(chars, i, j);
      i = j;
      continue;
    }
    if (c === "`") {
      pila.push({ tipo: "plantilla" });
      blanquearRango(chars, i, i + 1);
      i += 1;
      continue;
    }
    if (c === "/" && esInicioDeRegex(chars, i)) {
      const fin = finDeRegex(texto, i);
      if (fin > 0) {
        blanquearRango(chars, i, fin);
        i = fin;
        continue;
      }
    }
    if (cima && cima.tipo === "expr") {
      if (c === "{") {
        cima.llaves = (cima.llaves || 0) + 1;
        i += 1;
        continue;
      }
      if (c === "}") {
        if (!cima.llaves) {
          pila.pop();
          blanquearRango(chars, i, i + 1);
          i += 1;
          continue;
        }
        cima.llaves -= 1;
        i += 1;
        continue;
      }
    }
    i += 1;
  }
  return chars.join("");
}

/**
 * Limpia comentarios (#...) y cadenas (incluidas triples) de Python.
 * @param {string} texto
 * @returns {string}
 */
function limpiarPy(texto) {
  const n = texto.length;
  const chars = aCaracteres(texto);
  let i = 0;
  while (i < n) {
    const c = texto[i];
    if (c === "#") {
      let j = i;
      while (j < n && texto[j] !== "\n") j += 1;
      blanquearRango(chars, i, j);
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      const triple = texto[i + 1] === c && texto[i + 2] === c;
      const cierre = triple ? c + c + c : c;
      let j = i + cierre.length;
      while (j < n) {
        if (texto[j] === "\\") {
          j += 2;
          continue;
        }
        if (texto.startsWith(cierre, j)) {
          j += cierre.length;
          break;
        }
        if (!triple && texto[j] === "\n") break;
        j += 1;
      }
      blanquearRango(chars, i, j);
      i = j;
      continue;
    }
    i += 1;
  }
  return chars.join("");
}

/**
 * Limpia comentarios y cadenas de CSS.
 * @param {string} texto
 * @returns {string}
 */
function limpiarCss(texto) {
  const n = texto.length;
  const chars = aCaracteres(texto);
  let i = 0;
  while (i < n) {
    const c = texto[i];
    if (c === "/" && texto[i + 1] === "*") {
      const fin = texto.indexOf("*/", i + 2);
      const j = fin < 0 ? n : fin + 2;
      blanquearRango(chars, i, j);
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (texto[j] === "\\") {
          j += 2;
          continue;
        }
        if (texto[j] === c) {
          j += 1;
          break;
        }
        if (texto[j] === "\n") break;
        j += 1;
      }
      blanquearRango(chars, i, j);
      i = j;
      continue;
    }
    i += 1;
  }
  return chars.join("");
}

/**
 * Limpia comentarios HTML y bloques <script>/<style> completos (solo para el outline).
 * @param {string} texto
 * @returns {string}
 */
function limpiarHtml(texto) {
  const n = texto.length;
  const chars = aCaracteres(texto);
  const minusculas = texto.toLowerCase();
  let i = 0;
  while (i < n) {
    const c = texto[i];
    if (c === "<" && texto.startsWith("<!--", i)) {
      const fin = texto.indexOf("-->", i + 4);
      const j = fin < 0 ? n : fin + 3;
      blanquearRango(chars, i, j);
      i = j;
      continue;
    }
    if (c === "<") {
      const trozo = minusculas.slice(i, i + 9);
      if (trozo.startsWith("<script") || trozo.startsWith("<style")) {
        const etiqueta = trozo.startsWith("<script") ? "</script" : "</style";
        const iniCierre = minusculas.indexOf(etiqueta, i + 1);
        const j = iniCierre < 0 ? n : iniCierre;
        blanquearRango(chars, i, j);
        i = j;
        continue;
      }
    }
    i += 1;
  }
  return chars.join("");
}

// ---------------------------------------------------------------------------
// Comprobaciones estructurales ligeras (HTML / CSS / delimitadores)
// ---------------------------------------------------------------------------

/**
 * Busca el ">" que cierra una etiqueta, respetando comillas.
 * @param {string} texto
 * @param {number} desde
 * @returns {number} índice del ">" o -1
 */
function finDeEtiqueta(texto, desde) {
  let i = desde;
  let comilla = "";
  while (i < texto.length) {
    const c = texto[i];
    if (comilla) {
      if (c === comilla) comilla = "";
    } else if (c === '"' || c === "'") {
      comilla = c;
    } else if (c === ">") {
      return i;
    }
    i += 1;
  }
  return -1;
}

/**
 * Comprobación ligera de etiquetas HTML desbalanceadas.
 * @param {string} archivo
 * @param {string} texto
 * @param {string} fuente
 * @returns {Array<object>}
 */
function comprobarHtml(archivo, texto, fuente) {
  /** @type {Array<object>} */
  const diags = [];
  const inicios = iniciosDeLinea(texto);
  /** @type {Array<{nombre: string, indice: number}>} */
  const pila = [];
  const n = texto.length;
  let i = 0;
  /** @param {number} indice @param {string} mensaje */
  const aviso = (indice, mensaje) => {
    if (diags.length >= 20) return;
    const pos = posicionDe(inicios, indice);
    diags.push({ archivo, linea: pos.linea, columna: pos.columna, severidad: "aviso", mensaje, fuente });
  };
  while (i < n && diags.length < 20) {
    const lt = texto.indexOf("<", i);
    if (lt < 0) break;
    i = lt;
    if (texto.startsWith("<!--", i)) {
      const fin = texto.indexOf("-->", i + 4);
      i = fin < 0 ? n : fin + 3;
      continue;
    }
    if (texto.startsWith("<!", i) || texto.startsWith("<?", i)) {
      const fin = texto.indexOf(">", i + 2);
      i = fin < 0 ? n : fin + 1;
      continue;
    }
    const esCierre = texto[i + 1] === "/";
    const inicioNombre = i + (esCierre ? 2 : 1);
    const m = /^[A-Za-z][A-Za-z0-9:._-]*/.exec(texto.slice(inicioNombre));
    if (!m) {
      i += 1;
      continue;
    }
    const nombre = m[0].toLowerCase();
    const fin = finDeEtiqueta(texto, inicioNombre + m[0].length);
    if (fin < 0) {
      aviso(i, `Etiqueta <${nombre}> sin cerrar con ">"`);
      break;
    }
    const cuerpo = texto.slice(inicioNombre + m[0].length, fin);
    const autocierre = /\/\s*$/.test(cuerpo);
    i = fin + 1;
    if (esCierre) {
      if (pila.length > 0 && pila[pila.length - 1].nombre === nombre) {
        pila.pop();
        continue;
      }
      let k = pila.length - 1;
      while (k >= 0 && pila[k].nombre !== nombre) k -= 1;
      if (k < 0) {
        aviso(lt, `Etiqueta </${nombre}> sin la apertura correspondiente`);
        continue;
      }
      while (pila.length - 1 > k) {
        const abierta = pila.pop();
        if (!abierta) break;
        const pos = posicionDe(inicios, abierta.indice);
        aviso(abierta.indice, `Falta cerrar <${abierta.nombre}> (abierto en la línea ${pos.linea})`);
      }
      pila.pop();
      continue;
    }
    if (autocierre || ETIQUETAS_VACIAS.has(nombre)) continue;
    pila.push({ nombre, indice: lt });
    if (nombre === "script" || nombre === "style") {
      // El contenido de script/style es texto plano: no se parsean etiquetas dentro.
      const minusculas = texto.toLowerCase();
      const iniCierre = minusculas.indexOf(`</${nombre}`, i);
      if (iniCierre < 0) {
        aviso(lt, `Falta cerrar <${nombre}> (abierto en la línea ${posicionDe(inicios, lt).linea})`);
        pila.pop();
        break;
      }
      i = iniCierre;
    }
  }
  for (const abierta of pila.slice(0, Math.max(0, 20 - diags.length))) {
    const pos = posicionDe(inicios, abierta.indice);
    aviso(abierta.indice, `Falta cerrar <${abierta.nombre}> (abierto en la línea ${pos.linea})`);
  }
  return diags;
}

/** Pares apertura -> cierre y nombre legible de cada delimitador. */
const PAREJAS_DELIMITADOR = new Map([
  ["{", "}"],
  ["(", ")"],
  ["[", "]"],
]);
const NOMBRE_DELIMITADOR = new Map([
  ["{", "llave"],
  ["}", "llave"],
  ["(", "paréntesis"],
  [")", "paréntesis"],
  ["[", "corchete"],
  ["]", "corchete"],
]);

/**
 * Comprueba delimitadores desbalanceados sobre un texto ya «limpio» (sin cadenas).
 * @param {string} archivo
 * @param {string} limpio texto de la misma longitud que el original
 * @param {string} fuente
 * @returns {Array<object>}
 */
function comprobarDelimitadores(archivo, limpio, fuente) {
  /** @type {Array<object>} */
  const diags = [];
  const inicios = iniciosDeLinea(limpio);
  /** @type {Array<{c: string, indice: number}>} */
  const pila = [];
  for (let i = 0; i < limpio.length && diags.length < 20; i += 1) {
    const c = limpio[i];
    if (c === "{" || c === "(" || c === "[") {
      pila.push({ c, indice: i });
      continue;
    }
    if (c !== "}" && c !== ")" && c !== "]") continue;
    const abre = c === "}" ? "{" : c === ")" ? "(" : "[";
    if (pila.length > 0 && pila[pila.length - 1].c === abre) {
      pila.pop();
      continue;
    }
    const pos = posicionDe(inicios, i);
    diags.push({
      archivo,
      linea: pos.linea,
      columna: pos.columna,
      severidad: "error",
      mensaje: `Cierre «${NOMBRE_DELIMITADOR.get(c)}» (${c}) sin la apertura correspondiente`,
      fuente,
    });
  }
  for (const abierto of pila.slice(0, Math.max(0, 20 - diags.length))) {
    const pos = posicionDe(inicios, abierto.indice);
    diags.push({
      archivo,
      linea: pos.linea,
      columna: pos.columna,
      severidad: "aviso",
      mensaje: `Falta cerrar «${NOMBRE_DELIMITADOR.get(abierto.c)}» (${abierto.c}) abierto en la línea ${pos.linea}`,
      fuente,
    });
  }
  return diags;
}

/**
 * Comprobación ligera de Markdown: bloques de código sin cerrar.
 * @param {string} archivo
 * @param {string} texto
 * @param {string} fuente
 * @returns {Array<object>}
 */
function comprobarMarkdown(archivo, texto, fuente) {
  /** @type {Array<object>} */
  const diags = [];
  const lineas = texto.split("\n");
  let abierto = 0;
  for (let n = 0; n < lineas.length; n += 1) {
    if (!/^\s*(?:`{3,}|~{3,})/.test(lineas[n])) continue;
    abierto = abierto ? 0 : n + 1;
  }
  if (abierto) {
    diags.push({
      archivo,
      linea: abierto,
      columna: 1,
      severidad: "aviso",
      mensaje: "Bloque de código sin cerrar (faltan las triples comillas invertidas)",
      fuente,
    });
  }
  return diags;
}

// ---------------------------------------------------------------------------
// JSON: error con línea/columna
// ---------------------------------------------------------------------------

/**
 * Busca la posición del primer error de sintaxis JSON con un parser mínimo (respaldo
 * para cuando V8 no informa de la posición, p. ej. "Unexpected end of JSON input").
 * @param {string} texto
 * @returns {number} índice del error (puede ser texto.length)
 */
function indiceErrorJson(texto) {
  const n = texto.length;
  let i = 0;
  let profundidad = 0;

  /** @param {number} indice */
  const fallo = (indice) => {
    throw { indiceErrorJson: Math.max(0, Math.min(indice, n)) };
  };

  const ws = () => {
    while (i < n && (texto[i] === " " || texto[i] === "\t" || texto[i] === "\n" || texto[i] === "\r")) i += 1;
  };

  function cadena() {
    i += 1;
    while (i < n) {
      const c = texto[i];
      if (c === '"') {
        i += 1;
        return;
      }
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === "\n" || c === "\r") fallo(i);
      i += 1;
    }
    fallo(n);
  }

  function numero() {
    const m = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(texto.slice(i));
    if (!m) fallo(i);
    i += m[0].length;
  }

  /** @param {string} palabra */
  function literal(palabra) {
    if (texto.startsWith(palabra, i)) i += palabra.length;
    else fallo(i);
  }

  function objeto() {
    i += 1;
    profundidad += 1;
    if (profundidad > 200) fallo(i);
    ws();
    if (texto[i] === "}") {
      i += 1;
      profundidad -= 1;
      return;
    }
    while (true) {
      ws();
      if (texto[i] !== '"') fallo(i);
      cadena();
      ws();
      if (texto[i] !== ":") fallo(i);
      i += 1;
      valor();
      ws();
      if (texto[i] === ",") {
        i += 1;
        continue;
      }
      if (texto[i] === "}") {
        i += 1;
        profundidad -= 1;
        return;
      }
      fallo(i);
    }
  }

  function arreglo() {
    i += 1;
    profundidad += 1;
    if (profundidad > 200) fallo(i);
    ws();
    if (texto[i] === "]") {
      i += 1;
      profundidad -= 1;
      return;
    }
    while (true) {
      valor();
      ws();
      if (texto[i] === ",") {
        i += 1;
        continue;
      }
      if (texto[i] === "]") {
        i += 1;
        profundidad -= 1;
        return;
      }
      fallo(i);
    }
  }

  function valor() {
    ws();
    const c = texto[i];
    if (c === "{") return objeto();
    if (c === "[") return arreglo();
    if (c === '"') return cadena();
    if (c === "t") return literal("true");
    if (c === "f") return literal("false");
    if (c === "n") return literal("null");
    if (c === "-" || (c >= "0" && c <= "9")) return numero();
    return fallo(i);
  }

  try {
    ws();
    if (i >= n) return n;
    valor();
    ws();
    if (i < n) fallo(i);
    return n;
  } catch (err) {
    if (err && typeof err === "object" && "indiceErrorJson" in err) return err.indiceErrorJson;
    return n;
  }
}

/**
 * Acorta el mensaje de JSON.parse para mostrarlo cómodo en el editor.
 * @param {string} mensaje
 * @returns {string}
 */
function acortarMensajeJson(mensaje) {
  let texto = String(mensaje || "");
  if (texto.startsWith("Unexpected token")) {
    // V8 añade un fragmento del texto (a veces abreviado con "..."); se descarta.
    const m = /^Unexpected token ('(?:[^'\\]|\\.)*'|[^,\s]+)/.exec(texto);
    if (m) texto = `Unexpected token ${m[1]}`;
  }
  texto = texto.replace(/\s+in JSON at position \d+(?: \(line \d+ column \d+\))?$/, "");
  return recortarMensaje(texto) || "JSON no válido";
}

/**
 * Diagnóstico de JSON roto, con línea/columna calculadas.
 * @param {string} archivo
 * @param {string} contenido
 * @param {string} [fuente]
 * @returns {Array<object>}
 */
function diagnosticoJson(archivo, contenido, fuente = "json") {
  try {
    JSON.parse(contenido);
    return [];
  } catch (error) {
    const mensajeCrudo = error && error.message ? String(error.message) : "JSON no válido";
    const mensaje = acortarMensajeJson(mensajeCrudo);
    let pos = null;
    const mLinea = /\(line (\d+) column (\d+)\)/.exec(mensajeCrudo);
    if (mLinea) {
      pos = { linea: Number(mLinea[1]), columna: Number(mLinea[2]) };
    } else {
      const mPos = /\bposition (\d+)\b/.exec(mensajeCrudo);
      pos = mPos ? posicionLineaColumna(contenido, Number(mPos[1])) : posicionLineaColumna(contenido, indiceErrorJson(contenido));
    }
    return [{ archivo, linea: pos.linea, columna: pos.columna, severidad: "error", mensaje, fuente }];
  }
}

// ---------------------------------------------------------------------------
// Comprobadores reales (procesos externos, con timeout y temporales limpios)
// ---------------------------------------------------------------------------

/**
 * Ejecuta un proceso y devuelve su salida, sin lanzar nunca.
 * @param {string} comando
 * @param {string[]} args
 * @param {{cwd?: string, timeoutMs?: number}} [opciones]
 * @returns {Promise<{status: number | null, stdout: string, stderr: string, fallo: boolean}>}
 */
function ejecutar(comando, args, opciones = {}) {
  const timeoutMs = Number.isFinite(opciones.timeoutMs) ? /** @type {number} */ (opciones.timeoutMs) : TIMEOUT_COMPROBADOR;
  return new Promise((resolve) => {
    let terminado = false;
    /** @param {{status: number | null, stdout: string, stderr: string, fallo: boolean}} resultado */
    const fin = (resultado) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(temporizador);
      resolve(resultado);
    };
    let hijo;
    try {
      hijo = spawn(comando, args, { cwd: opciones.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      resolve({ status: null, stdout: "", stderr: "", fallo: true });
      return;
    }
    let stdout = "";
    let stderr = "";
    hijo.stdout?.on("data", (dato) => {
      if (stdout.length < 65536) stdout += dato;
    });
    hijo.stderr?.on("data", (dato) => {
      if (stderr.length < 65536) stderr += dato;
    });
    const temporizador = setTimeout(() => {
      try {
        hijo.kill("SIGKILL");
      } catch {
        /* el proceso ya no existe */
      }
      fin({ status: null, stdout, stderr, fallo: true });
    }, timeoutMs);
    hijo.on("error", () => fin({ status: null, stdout, stderr, fallo: true }));
    hijo.on("close", (codigo) => fin({ status: typeof codigo === "number" ? codigo : null, stdout, stderr, fallo: false }));
  });
}

/**
 * Crea un archivo temporal con el contenido, ejecuta `fn` y borra TODO el directorio.
 * @template T
 * @param {string} contenido
 * @param {string} extension
 * @param {(ruta: string) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function conArchivoTemporal(contenido, extension, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-diag-"));
  try {
    const tmp = path.join(dir, `revision${extension}`);
    fs.writeFileSync(tmp, contenido, "utf8");
    return await fn(tmp);
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* limpieza best-effort */
    }
  }
}

/**
 * Interpreta la salida de `node --check`.
 * @param {string} stderr
 * @param {string} archivo ruta que se informa en el diagnóstico
 * @returns {object | null}
 */
function interpretarErrorNode(stderr, archivo) {
  const texto = String(stderr || "");
  const lineas = texto.split(/\r?\n/);
  let linea = 0;
  let indiceCabecera = -1;
  for (let k = 0; k < lineas.length; k += 1) {
    if (/^\s/.test(lineas[k])) continue;
    const m = /^(.+):(\d+)$/.exec(lineas[k]);
    if (m) {
      linea = Number(m[2]);
      indiceCabecera = k;
      break;
    }
  }
  if (!linea) return null;
  let columna = 1;
  for (let k = indiceCabecera + 1; k <= indiceCabecera + 3 && k < lineas.length; k += 1) {
    const m = /^(\s*)\^/.exec(lineas[k]);
    if (m) {
      columna = m[1].length + 1;
      break;
    }
  }
  let mensaje = "";
  for (const l of lineas) {
    const m = /^([A-Za-z_]\w*Error):\s*(.+)$/.exec(l);
    if (m) {
      mensaje = `${m[1]}: ${m[2]}`;
      break;
    }
  }
  return { archivo, linea, columna, severidad: "error", mensaje: recortarMensaje(mensaje || "Error de sintaxis"), fuente: "node" };
}

/**
 * Interpreta la salida de `python -m py_compile`.
 * @param {string} stderr
 * @param {string} archivo
 * @returns {object | null}
 */
function interpretarErrorPython(stderr, archivo) {
  const texto = String(stderr || "");
  const mFile = /File "[^"]*", line (\d+)/.exec(texto);
  let linea = mFile ? Number(mFile[1]) : 0;
  let tipo = "";
  let mensaje = "";
  const mSorry = /Sorry:\s*([A-Za-z_]\w*):\s*([^\n]*)/.exec(texto);
  if (mSorry) {
    tipo = mSorry[1];
    mensaje = mSorry[2].trim();
    const mLinea = /\([^)]*?line (\d+)\)\s*$/.exec(mensaje);
    if (mLinea) {
      if (!linea) linea = Number(mLinea[1]);
      mensaje = mensaje.slice(0, mLinea.index).trim();
    }
  } else {
    const mError = /^([A-Za-z_]\w*(?:Error|Exception)):\s*(.+)$/m.exec(texto);
    if (mError) {
      tipo = mError[1];
      mensaje = mError[2].trim();
    }
  }
  if (!tipo || !linea) return null;
  let columna = 1;
  const mCaret = /^(\s*)\^/m.exec(texto);
  if (mCaret) columna = mCaret[1].length + 1;
  return { archivo, linea, columna, severidad: "error", mensaje: recortarMensaje(`${tipo}: ${mensaje}`), fuente: "py_compile" };
}

/**
 * Comprueba JS/MJS/CJS con `node --check` sobre una copia temporal (sin ejecutar nada).
 * @param {string} archivo
 * @param {string} contenido
 * @returns {Promise<Array<object>>}
 */
async function diagnosticarJs(archivo, contenido) {
  const ext = path.extname(archivo).toLowerCase();
  const extension = ext === ".cjs" ? ".cjs" : ext === ".mjs" ? ".mjs" : ".js";
  const salida = await conArchivoTemporal(contenido, extension, (tmp) =>
    ejecutar(process.execPath, ["--check", tmp], { cwd: path.dirname(tmp) })
  );
  if (salida.fallo || salida.status === null || salida.status === 0) return [];
  const diag = interpretarErrorNode(salida.stderr, archivo);
  return diag ? [diag] : [];
}

/**
 * Comprueba Python con `python -m py_compile` sobre una copia temporal.
 * @param {string} archivo
 * @param {string} contenido
 * @returns {Promise<Array<object>>}
 */
async function diagnosticarPy(archivo, contenido) {
  const salida = await conArchivoTemporal(contenido, ".py", (tmp) =>
    ejecutar("python", ["-m", "py_compile", tmp], { cwd: path.dirname(tmp) })
  );
  if (salida.fallo || salida.status === null || salida.status === 0) return [];
  const diag = interpretarErrorPython(salida.stderr, archivo);
  return diag ? [diag] : [];
}

// ---------------------------------------------------------------------------
// API: diagnósticos
// ---------------------------------------------------------------------------

/**
 * Diagnósticos con comprobadores reales para un archivo (o para un texto dado).
 * NUNCA lanza: devuelve [] si no hay nada que comprobar o no se puede comprobar.
 * @param {string} abs ruta absoluta del archivo (informativa: puede no existir si pasas texto)
 * @param {string} [texto] contenido a comprobar; si falta se lee de `abs`
 * @returns {Promise<Array<{archivo: string, linea: number, columna: number, severidad: "error" | "aviso", mensaje: string, fuente: string}>>}
 */
export async function diagnosticarArchivo(abs, texto) {
  try {
    const archivo = String(abs || "");
    if (!archivo) return [];
    const lenguaje = lenguajeDe(archivo);
    if (!lenguaje) return [];
    let contenido;
    if (typeof texto === "string") {
      contenido = quitarBom(texto);
    } else {
      try {
        const st = fs.statSync(archivo);
        if (!st.isFile() || st.size > LIMITE_TEXTO) return [];
        const buf = fs.readFileSync(archivo);
        if (buf.includes(0)) return []; // binario
        contenido = quitarBom(buf.toString("utf8"));
      } catch {
        return [];
      }
    }
    if (!contenido.trim()) return [];
    if (contenido.length > LIMITE_TEXTO) return [];
    switch (lenguaje) {
      case "js":
        return await diagnosticarJs(archivo, contenido);
      case "py":
        return await diagnosticarPy(archivo, contenido);
      case "json":
        return diagnosticoJson(archivo, contenido, "json");
      case "html":
        return comprobarHtml(archivo, contenido, "html");
      case "css":
        return comprobarDelimitadores(archivo, limpiarCss(contenido), "css");
      case "md":
        return comprobarMarkdown(archivo, contenido, "markdown");
      default:
        return [];
    }
  } catch {
    return [];
  }
}

/**
 * Diagnósticos rápidos y sincrónicos para el editor (SIN lanzar procesos).
 * JSON, llaves/paréntesis/corchetes desbalanceados (JS/PY/CSS) y etiquetas (HTML).
 * @param {string} rel ruta relativa (se usa también como `archivo` del diagnóstico)
 * @param {string} texto
 * @returns {Array<{archivo: string, linea: number, columna: number, severidad: "error" | "aviso", mensaje: string, fuente: string}>}
 */
export function diagnosticarTexto(rel, texto) {
  try {
    const archivo = String(rel || "");
    const lenguaje = lenguajeDe(archivo);
    if (!lenguaje || typeof texto !== "string") return [];
    const contenido = quitarBom(texto);
    if (!contenido.trim() || contenido.length > LIMITE_TEXTO) return [];
    switch (lenguaje) {
      case "json":
        return diagnosticoJson(archivo, contenido, "json");
      case "html":
        return comprobarHtml(archivo, contenido, "etiquetas");
      case "md":
        return comprobarMarkdown(archivo, contenido, "markdown");
      case "js":
        return comprobarDelimitadores(archivo, limpiarJs(contenido), "llaves");
      case "py":
        return comprobarDelimitadores(archivo, limpiarPy(contenido), "llaves");
      case "css":
        return comprobarDelimitadores(archivo, limpiarCss(contenido), "llaves");
      default:
        return [];
    }
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// API: outline de símbolos
// ---------------------------------------------------------------------------

/** @type {RegExp} */
const RE_JS_FUNCION = /^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/;
const RE_JS_CLASE = /^\s*(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/;
const RE_JS_VAR_FUNCION =
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/;
const RE_JS_VAR = /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/;
const RE_JS_METODO =
  /^(\s*)(?:(?:static|async|get|set|public|private|protected|readonly|override)\s+)*\*?\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?:\{|$)/;
const RE_PY_FUNCION = /^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/;
const RE_PY_CLASE = /^(\s*)class\s+([A-Za-z_]\w*)/;
const RE_HTML_ATRIBUTO = /(?:\s|<)(id|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g;

/**
 * Localiza un identificador en una línea exigiendo que no sea parte de otro
 * identificador (p. ej. la «s» dentro de «const» no cuenta como el nombre `s`).
 * @param {string} linea
 * @param {string} nombre
 * @param {number} [desde]
 * @returns {number} índice (base 0) o -1
 */
function buscarNombreIdentificador(linea, nombre, desde = 0) {
  let idx = linea.indexOf(nombre, Math.max(0, desde));
  while (idx >= 0) {
    const antes = idx > 0 ? linea[idx - 1] : "";
    const despues = idx + nombre.length < linea.length ? linea[idx + nombre.length] : "";
    if (!/[A-Za-z0-9_$]/.test(antes) && !/[A-Za-z0-9_$]/.test(despues)) return idx;
    idx = linea.indexOf(nombre, idx + 1);
  }
  return -1;
}

/**
 * Símbolos de JavaScript (funciones, clases, variables y métodos de clase).
 * @param {string} contenido
 * @returns {Array<{nombre: string, tipo: string, linea: number, columna: number}>}
 */
function simbolosJs(contenido) {
  /** @type {Array<{nombre: string, tipo: string, linea: number, columna: number}>} */
  const res = [];
  const limpio = limpiarJs(contenido);
  const lineas = limpio.split("\n");
  let profundidad = 0;
  /** @type {{prof: number, restantes: number} | null} */
  let clasePendiente = null;
  /** @type {{prof: number} | null} */
  let claseActiva = null;
  for (let n = 0; n < lineas.length; n += 1) {
    const cruda = lineas[n];
    const linea = cruda.endsWith("\r") ? cruda.slice(0, -1) : cruda;
    const profAntes = profundidad;
    let reconocida = false;
    const mFuncion = RE_JS_FUNCION.exec(linea);
    const mClase = mFuncion ? null : RE_JS_CLASE.exec(linea);
    const mVarFuncion = mFuncion || mClase ? null : RE_JS_VAR_FUNCION.exec(linea);
    const mVar = !mFuncion && !mClase && !mVarFuncion ? RE_JS_VAR.exec(linea) : null;
    const agregar = (nombre, tipo) => {
      const indiceNombre = buscarNombreIdentificador(linea, nombre);
      res.push({ nombre, tipo, linea: n + 1, columna: (indiceNombre < 0 ? 0 : indiceNombre) + 1 });
      reconocida = true;
    };
    if (mFuncion) agregar(mFuncion[1], "funcion");
    else if (mClase) {
      agregar(mClase[1], "clase");
      clasePendiente = { prof: profAntes + 1, restantes: 2 };
    } else if (mVarFuncion) agregar(mVarFuncion[1], "funcion");
    else if (mVar) agregar(mVar[1], "variable");
    if (!reconocida && claseActiva && profAntes === claseActiva.prof) {
      const mMetodo = RE_JS_METODO.exec(linea);
      if (mMetodo && !PALABRAS_NO_METODO.has(mMetodo[2])) {
        agregar(mMetodo[2], "metodo");
      }
    }
    // Profundidad de llaves después de esta línea (el texto ya está limpio de cadenas).
    let abre = 0;
    let cierra = 0;
    for (const c of linea) {
      if (c === "{") abre += 1;
      else if (c === "}") cierra += 1;
    }
    profundidad += abre - cierra;
    if (clasePendiente) {
      if (profundidad >= clasePendiente.prof && clasePendiente.prof > profAntes) {
        claseActiva = { prof: clasePendiente.prof };
        clasePendiente = null;
      } else {
        clasePendiente.restantes -= 1;
        if (clasePendiente.restantes < 0) clasePendiente = null;
      }
    }
    if (claseActiva && profundidad < claseActiva.prof) claseActiva = null;
  }
  return res;
}

/**
 * Símbolos de Python (`def` y `class`).
 * @param {string} contenido
 * @returns {Array<{nombre: string, tipo: string, linea: number, columna: number}>}
 */
function simbolosPy(contenido) {
  /** @type {Array<{nombre: string, tipo: string, linea: number, columna: number}>} */
  const res = [];
  const lineas = limpiarPy(contenido).split("\n");
  for (let n = 0; n < lineas.length; n += 1) {
    const linea = lineas[n].endsWith("\r") ? lineas[n].slice(0, -1) : lineas[n];
    const mFuncion = RE_PY_FUNCION.exec(linea);
    if (mFuncion) {
      const indice = buscarNombreIdentificador(linea, mFuncion[2]);
      res.push({ nombre: mFuncion[2], tipo: "funcion", linea: n + 1, columna: (indice < 0 ? 0 : indice) + 1 });
      continue;
    }
    const mClase = RE_PY_CLASE.exec(linea);
    if (mClase) {
      const indice = buscarNombreIdentificador(linea, mClase[2]);
      res.push({ nombre: mClase[2], tipo: "clase", linea: n + 1, columna: (indice < 0 ? 0 : indice) + 1 });
    }
  }
  return res;
}

/**
 * Devuelve el índice tras la comilla de cierre de una cadena JSON, o -1.
 * @param {string} texto
 * @param {number} inicio
 * @returns {number}
 */
function finDeCadenaJson(texto, inicio) {
  let i = inicio + 1;
  while (i < texto.length) {
    const c = texto[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === '"') return i + 1;
    if (c === "\n") return -1;
    i += 1;
  }
  return -1;
}

/**
 * Índice tras un valor JSON (útil para saltar valores anidados).
 * @param {string} texto
 * @param {number} desde
 * @returns {number} índice o -1 si no se puede delimitar
 */
function indiceTrasValorJson(texto, desde) {
  const n = texto.length;
  let i = desde;
  const saltar = () => {
    while (i < n && /\s/.test(texto[i])) i += 1;
  };
  saltar();
  const c = texto[i];
  if (c === '"') {
    const fin = finDeCadenaJson(texto, i);
    return fin < 0 ? -1 : fin;
  }
  if (c === "{" || c === "[") {
    let prof = 0;
    while (i < n) {
      const ch = texto[i];
      if (ch === '"') {
        const fin = finDeCadenaJson(texto, i);
        if (fin < 0) return -1;
        i = fin;
        continue;
      }
      if (ch === "{" || ch === "[") prof += 1;
      else if (ch === "}" || ch === "]") {
        prof -= 1;
        if (prof === 0) return i + 1;
      }
      i += 1;
    }
    return -1;
  }
  while (i < n && texto[i] !== "," && texto[i] !== "}" && texto[i] !== "]") i += 1;
  return i;
}

/**
 * Claves de primer nivel de un objeto JSON (con línea/columna).
 * @param {string} contenido
 * @returns {Array<{nombre: string, tipo: string, linea: number, columna: number}>}
 */
function simbolosJson(contenido) {
  const texto = quitarBom(contenido);
  const inicios = iniciosDeLinea(texto);
  /** @type {Array<{nombre: string, tipo: string, linea: number, columna: number}>} */
  const res = [];
  let i = 0;
  const n = texto.length;
  const saltar = () => {
    while (i < n && /\s/.test(texto[i])) i += 1;
  };
  saltar();
  if (texto[i] !== "{") return res;
  i += 1;
  while (i < n) {
    saltar();
    if (texto[i] === "}") break;
    if (texto[i] !== '"') break;
    const inicioCadena = i;
    const finCadena = finDeCadenaJson(texto, i);
    if (finCadena < 0) break;
    let nombre;
    try {
      nombre = JSON.parse(texto.slice(inicioCadena, finCadena));
    } catch {
      nombre = texto.slice(inicioCadena + 1, finCadena - 1);
    }
    i = finCadena;
    saltar();
    if (texto[i] !== ":") break;
    i += 1;
    const pos = posicionDe(inicios, inicioCadena);
    res.push({ nombre: String(nombre), tipo: "clave", linea: pos.linea, columna: pos.columna });
    const siguiente = indiceTrasValorJson(texto, i);
    if (siguiente < 0) break;
    i = siguiente;
    saltar();
    if (texto[i] === ",") {
      i += 1;
      continue;
    }
    break;
  }
  return res;
}

/**
 * Símbolos HTML: atributos `id` y `name`.
 * @param {string} contenido
 * @returns {Array<{nombre: string, tipo: string, linea: number, columna: number}>}
 */
function simbolosHtml(contenido) {
  const texto = quitarBom(contenido);
  const limpio = limpiarHtml(texto);
  const inicios = iniciosDeLinea(texto);
  /** @type {Array<{nombre: string, tipo: string, linea: number, columna: number}>} */
  const res = [];
  RE_HTML_ATRIBUTO.lastIndex = 0;
  let m;
  while ((m = RE_HTML_ATRIBUTO.exec(limpio)) !== null) {
    const nombre = m[2] ?? m[3] ?? m[4] ?? "";
    if (!nombre) continue;
    const desplazamiento = m[0].indexOf(m[1]);
    const pos = posicionDe(inicios, m.index + Math.max(0, desplazamiento));
    res.push({ nombre, tipo: m[1], linea: pos.linea, columna: pos.columna });
  }
  return res;
}

/**
 * Símbolos CSS: selectores y at-reglas (el texto antes de cada "{").
 * @param {string} contenido
 * @returns {Array<{nombre: string, tipo: string, linea: number, columna: number}>}
 */
function simbolosCss(contenido) {
  const texto = quitarBom(contenido);
  const limpio = limpiarCss(texto);
  const inicios = iniciosDeLinea(texto);
  /** @type {Array<{nombre: string, tipo: string, linea: number, columna: number}>} */
  const res = [];
  let desde = 0;
  for (let i = 0; i < limpio.length; i += 1) {
    const c = limpio[i];
    if (c === "{") {
      const bruto = limpio.slice(desde, i);
      const nombre = bruto.trim().replace(/\s+/g, " ");
      if (nombre) {
        let k = 0;
        while (k < bruto.length && /\s/.test(bruto[k])) k += 1;
        const pos = posicionDe(inicios, desde + k);
        res.push({ nombre, tipo: nombre.startsWith("@") ? "at-regla" : "selector", linea: pos.linea, columna: pos.columna });
      }
      desde = i + 1;
    } else if (c === "}" || c === ";") {
      desde = i + 1;
    }
  }
  return res;
}

/**
 * Outline de símbolos de un archivo.
 * @param {string} rel ruta o nombre del archivo (solo importa la extensión)
 * @param {string} texto
 * @returns {Array<{nombre: string, tipo: string, linea: number, columna: number}>}
 */
export function simbolos(rel, texto) {
  try {
    const lenguaje = lenguajeDe(rel);
    if (!lenguaje || typeof texto !== "string") return [];
    const contenido = quitarBom(texto);
    if (!contenido.trim()) return [];
    /** @type {Array<{nombre: string, tipo: string, linea: number, columna: number}>} */
    let res = [];
    switch (lenguaje) {
      case "js":
        res = simbolosJs(contenido);
        break;
      case "py":
        res = simbolosPy(contenido);
        break;
      case "json":
        res = simbolosJson(contenido);
        break;
      case "html":
        res = simbolosHtml(contenido);
        break;
      case "css":
        res = simbolosCss(contenido);
        break;
      default:
        return [];
    }
    return res.sort((a, b) => a.linea - b.linea || a.columna - b.columna);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// API: índice de símbolos del proyecto e «ir a definición»
// ---------------------------------------------------------------------------

/**
 * Normaliza una ruta a la forma relativa con separadores "/".
 * @param {string} root
 * @param {string} entrada
 * @returns {string} ruta relativa, o "" si queda fuera del proyecto
 */
function normalizarRel(root, entrada) {
  const absoluta = path.isAbsolute(entrada) ? entrada : path.resolve(root, entrada);
  const rel = path.relative(root, absoluta);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return "";
  return rel.split(path.sep).join("/");
}

/**
 * Recorre el proyecto y devuelve rutas relativas de archivos indexables.
 * @param {string} root
 * @param {{maxArchivos: number, omitir: Set<string>}} opciones
 * @returns {string[]}
 */
function recorrerProyecto(root, opciones) {
  /** @type {string[]} */
  const encontrados = [];
  /** @type {string[]} */
  const pendientes = [""];
  while (pendientes.length > 0 && encontrados.length < opciones.maxArchivos) {
    const relDir = /** @type {string} */ (pendientes.pop());
    let entradas;
    try {
      entradas = fs.readdirSync(path.join(root, relDir), { withFileTypes: true });
    } catch {
      continue;
    }
    entradas.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entrada of entradas) {
      if (encontrados.length >= opciones.maxArchivos) break;
      if (entrada.name.startsWith(".")) continue;
      const rel = relDir ? `${relDir}/${entrada.name}` : entrada.name;
      if (entrada.isDirectory()) {
        if (!opciones.omitir.has(entrada.name)) pendientes.push(rel);
        continue;
      }
      if (!entrada.isFile()) continue; // symlinks y similares: no se siguen
      if (!EXTENSIONES_INDICE.has(path.extname(entrada.name).toLowerCase())) continue;
      encontrados.push(rel);
    }
  }
  return encontrados;
}

/**
 * Construye el índice de símbolos del proyecto: nombre -> definiciones.
 * ES SINCRÓNICO (con topes para no bloquear demasiado); puede tardar en proyectos
 * enormes, así que conviene cachear el resultado o pasar `archivos`.
 * @param {string} root carpeta del proyecto
 * @param {string[] | Set<string> | null} [archivos] lista explícita de rutas; si falta se recorre `root`
 * @param {{maxArchivos?: number, maxBytes?: number, omitir?: Set<string>}} [opciones]
 * @returns {Map<string, Array<{archivo: string, linea: number, columna: number, tipo: string}>>}
 */
export function indiceSimbolos(root, archivos = null, opciones = {}) {
  const indice = new Map();
  try {
    const raiz = path.resolve(String(root || "."));
    const maxArchivos = Number.isFinite(opciones.maxArchivos) ? /** @type {number} */ (opciones.maxArchivos) : MAX_ARCHIVOS_INDICE;
    const maxBytes = Number.isFinite(opciones.maxBytes) ? /** @type {number} */ (opciones.maxBytes) : LIMITE_ARCHIVO_INDICE;
    const omitir = opciones.omitir instanceof Set ? opciones.omitir : CARPETAS_OMITIDAS;
    /** @type {string[]} */
    let lista;
    if (archivos && typeof archivos[Symbol.iterator] === "function") {
      lista = [];
      for (const entrada of archivos) {
        const rel = normalizarRel(raiz, String(entrada));
        if (!rel) continue;
        if (!EXTENSIONES_INDICE.has(path.extname(rel).toLowerCase())) continue;
        lista.push(rel);
        if (lista.length >= maxArchivos) break;
      }
    } else {
      lista = recorrerProyecto(raiz, { maxArchivos, omitir });
    }
    for (const rel of lista) {
      const abs = path.join(raiz, rel.split("/").join(path.sep));
      try {
        const st = fs.statSync(abs);
        if (!st.isFile() || st.size > maxBytes || st.size === 0) continue;
        const buf = fs.readFileSync(abs);
        if (buf.includes(0)) continue; // binario
        const texto = quitarBom(buf.toString("utf8"));
        for (const simbolo of simbolos(rel, texto)) {
          const listaSimbolos = indice.get(simbolo.nombre);
          const entrada = { archivo: rel, linea: simbolo.linea, columna: simbolo.columna, tipo: simbolo.tipo };
          if (listaSimbolos) listaSimbolos.push(entrada);
          else indice.set(simbolo.nombre, [entrada]);
        }
      } catch {
        /* archivo ilegible: se omite */
      }
    }
  } catch {
    /* proyecto ilegible: índice vacío */
  }
  return indice;
}

/**
 * Devuelve las definiciones de `palabra` desde un índice (Map) o un objeto equivalente.
 * @param {Map<string, Array<object>> | Record<string, Array<object>> | null} indice
 * @param {string} palabra
 * @returns {Array<{archivo: string, linea: number, columna: number, tipo: string}>}
 */
function entradasDeIndice(indice, palabra) {
  if (!indice) return [];
  try {
    if (typeof indice.get === "function") {
      const lista = indice.get(palabra);
      return Array.isArray(lista) ? lista : [];
    }
    const lista = indice[palabra];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

/**
 * Cercanía entre dos rutas relativas: más segmentos comunes = más cerca.
 * @param {string} actual
 * @param {string} candidato
 * @returns {number}
 */
function cercaniaArchivo(actual, candidato) {
  const da = path.posix.dirname(actual).split("/").filter(Boolean);
  const dc = path.posix.dirname(candidato).split("/").filter(Boolean);
  let comunes = 0;
  while (comunes < da.length && comunes < dc.length && da[comunes] === dc[comunes]) comunes += 1;
  return comunes * 1000 - Math.abs(da.length - dc.length);
}

/**
 * «Ir a definición»: busca la mejor definición de una palabra en el índice.
 * Prioriza el archivo actual y, entre homónimos, el mismo directorio y las rutas más
 * cercanas. Ignora palabras de menos de 2 caracteres.
 * @param {string} palabra
 * @param {Map<string, Array<object>> | Record<string, Array<object>> | null} indice
 * @param {string} [archivoActual]
 * @returns {{archivo: string, linea: number, columna: number, tipo: string} | null}
 */
export function buscarDefinicion(palabra, indice, archivoActual = "") {
  try {
    const buscada = String(palabra || "").trim();
    if (buscada.length < 2) return null;
    const entradas = entradasDeIndice(indice, buscada).filter(
      (entrada) => entrada && typeof entrada.archivo === "string" && Number.isFinite(Number(entrada.linea))
    );
    if (entradas.length === 0) return null;
    // El índice usa rutas relativas al proyecto; si llega una absoluta se compara por sufijo.
    const actual = String(archivoActual || "").replace(/\\/g, "/").replace(/^\.\//, "");
    const actualAbsoluta = /^(?:[A-Za-z]:\/|\/)/.test(actual);
    const esArchivoActual = (archivo) =>
      actual !== "" && (archivo === actual || (actualAbsoluta && actual.endsWith(`/${archivo}`)));
    const candidatos = entradas.map((entrada) => ({
      archivo: entrada.archivo,
      linea: Number(entrada.linea),
      columna: Number(entrada.columna) || 1,
      tipo: String(entrada.tipo || ""),
    }));
    // Para medir cercanía con una ruta absoluta, se descarta el prefijo hasta el archivo
    // del índice que coincida (así se comparan directorios relativos al proyecto).
    const actualRelativo = actualAbsoluta
      ? candidatos.find((candidato) => esArchivoActual(candidato.archivo))?.archivo || ""
      : actual;
    candidatos.sort((a, b) => {
      const aActual = esArchivoActual(a.archivo);
      const bActual = esArchivoActual(b.archivo);
      if (aActual !== bActual) return aActual ? -1 : 1;
      if (actualRelativo !== "") {
        const ca = cercaniaArchivo(actualRelativo, a.archivo);
        const cb = cercaniaArchivo(actualRelativo, b.archivo);
        if (ca !== cb) return cb - ca;
      }
      if (a.archivo.length !== b.archivo.length) return a.archivo.length - b.archivo.length;
      return a.linea - b.linea || a.columna - b.columna;
    });
    return candidatos[0];
  } catch {
    return null;
  }
}
