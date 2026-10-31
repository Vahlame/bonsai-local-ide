/**
 * Búsqueda de código de alto rendimiento.
 *
 * - `buscarTexto`: ripgrep empaquetado por Microsoft (`@vscode/ripgrep`), con
 *   respeto a `.gitignore`, salida estable y fallback de Node si el binario no
 *   está disponible.
 * - `buscarEstructural`: ast-grep (`@ast-grep/napi`) para patrones AST con
 *   metavariables (`$X`, `$$$ARGS`) en JS/TS/TSX/HTML/CSS.
 *
 * Las dos dependencias son opcionales en runtime: la copia de evaluación y una
 * instalación mínima siguen arrancando; en ese caso se devuelve un error claro
 * o se usa el fallback.
 */

import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { projectFiles } from "./code-context.mjs";

const require = createRequire(import.meta.url);
const OMIT = new Set([".git", "node_modules", "models", "logs", "reports", ".venv", "venv", "__pycache__", "dist", "build", "target"]);

/** @type {any | null | undefined} */
let astGrepCache;
function cargarAstGrep() {
  if (astGrepCache !== undefined) return astGrepCache;
  try {
    astGrepCache = require("@ast-grep/napi");
  } catch {
    astGrepCache = null;
  }
  return astGrepCache;
}

/** @type {Promise<string | null> | null} */
let rgPathPromise = null;
function rutaRipgrep() {
  if (!rgPathPromise) {
    rgPathPromise = import("@vscode/ripgrep")
      .then((mod) => mod.rgPath || null)
      .catch(() => null);
  }
  return rgPathPromise;
}

/**
 * @param {string} root
 * @param {string} consulta
 * @param {{max?: number, glob?: string, fixed?: boolean, caseSensitive?: boolean, timeoutMs?: number}} [opciones]
 * @returns {Promise<{ok: boolean, motor: string, resultados: Array<{archivo: string, linea: number, texto: string}>, error?: string}>}
 */
export async function buscarTexto(root, consulta, opciones = {}) {
  const q = String(consulta || "");
  if (!q) return { ok: false, motor: "ripgrep", resultados: [], error: "consulta vacía" };
  const max = Math.max(1, Math.min(200, Number(opciones.max) || 60));
  const rg = await rutaRipgrep();
  if (!rg) return buscarTextoFallback(root, q, { ...opciones, max });
  const args = [
    "--line-number", "--no-heading", "--color", "never", "--hidden",
    "--glob", "!**/.git/**", "--glob", "!**/node_modules/**",
    "--max-filesize", "800K",
    "--max-count", String(max),
  ];
  if (!opciones.caseSensitive) args.push("-i");
  if (opciones.fixed !== false) args.push("-F");
  if (opciones.glob) args.push("--glob", String(opciones.glob));
  // Sin una ruta explícita, ripgrep lee stdin (y `execFile` deja el pipe
  // abierto): el `.` final es obligatorio para buscar en el proyecto.
  args.push("--", q, ".");
  try {
    const stdout = await new Promise((resolve, reject) => {
      execFile(rg, args, {
        cwd: path.resolve(root),
        encoding: "utf8",
        timeout: Math.max(1000, Math.min(30000, Number(opciones.timeoutMs) || 8000)),
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
      }, (error, salida) => {
        // ripgrep usa código 1 para "sin coincidencias": no es un fallo.
        if (error && /** @type {{code?: number}} */ (error).code !== 1) reject(error);
        else resolve(String(salida || ""));
      });
    });
    const resultados = [];
    for (const linea of stdout.split(/\r?\n/)) {
      if (!linea) continue;
      const m = linea.match(/^(.+?):(\d+):(.*)$/);
      if (!m) continue;
      resultados.push({
        archivo: m[1].replace(/\\/g, "/").replace(/^\.\//, ""),
        linea: Number(m[2]),
        texto: m[3].slice(0, 500),
      });
      if (resultados.length >= max) break;
    }
    return { ok: true, motor: "ripgrep", resultados };
  } catch (error) {
    return {
      ok: false,
      motor: "ripgrep",
      resultados: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Fallback sin binario: recorre archivos de texto acotados y busca literal.
 * No pretende sustituir a ripgrep; solo evita que la UI se quede sin búsqueda.
 * @param {string} root
 * @param {string} consulta
 * @param {{max: number, caseSensitive?: boolean}} opciones
 * @returns {{ok: boolean, motor: string, resultados: Array<{archivo: string, linea: number, texto: string}>}}
 */
function buscarTextoFallback(root, consulta, opciones) {
  const base = path.resolve(root);
  const aguja = opciones.caseSensitive ? consulta : consulta.toLowerCase();
  const resultados = [];
  const pila = [""];
  let archivos = 0;
  while (pila.length && resultados.length < opciones.max && archivos < 3000) {
    const rel = pila.pop();
    if (rel === undefined) break;
    const abs = path.join(base, rel);
    let entradas;
    try {
      entradas = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entrada of entradas) {
      if (entrada.isSymbolicLink()) continue;
      const hijo = rel ? `${rel}/${entrada.name}` : entrada.name;
      if (entrada.isDirectory()) {
        if (!OMIT.has(entrada.name) && !entrada.name.startsWith(".")) pila.push(hijo);
        continue;
      }
      if (!entrada.isFile() || archivos++ >= 3000) continue;
      const archivo = path.join(base, hijo);
      let texto;
      try {
        if (fs.statSync(archivo).size > 1_000_000) continue;
        texto = fs.readFileSync(archivo, "utf8");
      } catch {
        continue;
      }
      if (texto.includes("\0")) continue;
      const lineas = texto.split(/\r?\n/);
      for (let i = 0; i < lineas.length; i += 1) {
        const comparable = opciones.caseSensitive ? lineas[i] : lineas[i].toLowerCase();
        if (comparable.includes(aguja)) {
          resultados.push({ archivo: hijo.replace(/\\/g, "/"), linea: i + 1, texto: lineas[i].slice(0, 500) });
          if (resultados.length >= opciones.max) break;
        }
      }
    }
  }
  return { ok: true, motor: "node-fallback", resultados };
}

const LENGUAJES = {
  ts: "TypeScript",
  tsx: "Tsx",
  js: "JavaScript",
  jsx: "Tsx",
  html: "Html",
  css: "Css",
};

const EXTENSIONES = {
  ts: [".ts"],
  tsx: [".tsx"],
  js: [".js", ".mjs", ".cjs"],
  jsx: [".jsx"],
  html: [".html", ".htm"],
  css: [".css"],
};

/**
 * @param {string} root
 * @param {string} patron
 * @param {string} lenguaje
 * @param {{max?: number}} [opciones]
 * @returns {Promise<{ok: boolean, motor: string, lenguaje: string, resultados: Array<{archivo: string, linea: number, columna: number, texto: string}>, error?: string}>}
 */
export async function buscarEstructural(root, patron, lenguaje, opciones = {}) {
  const lang = LENGUAJES[String(lenguaje || "").toLowerCase()];
  if (!lang) {
    return {
      ok: false,
      motor: "ast-grep",
      lenguaje: String(lenguaje || ""),
      resultados: [],
      error: `lenguaje no soportado: usa ${Object.keys(LENGUAJES).join(", ")}`,
    };
  }
  const sg = cargarAstGrep();
  if (!sg) {
    return { ok: false, motor: "ast-grep", lenguaje, resultados: [], error: "ast-grep no está instalado en esta copia" };
  }
  const max = Math.max(1, Math.min(200, Number(opciones.max) || 60));
  /** @type {Array<{archivo: string, linea: number, columna: number, texto: string}>} */
  const resultados = [];
  const base = path.resolve(root);
  try {
    const matcher = sg.pattern(sg.Lang[lang], String(patron || ""));
    const extensiones = EXTENSIONES[String(lenguaje).toLowerCase()] || [];
    const paths = projectFiles(base, 3000)
      .filter((rel) => extensiones.some((ext) => rel.toLowerCase().endsWith(ext)))
      .map((rel) => path.join(base, rel));
    if (!paths.length) return { ok: true, motor: "ast-grep", lenguaje, resultados: [] };
    await sg.findInFiles(sg.Lang[lang], { paths, matcher }, (error, nodos) => {
      if (error || !Array.isArray(nodos)) return;
      for (const nodo of nodos) {
        if (resultados.length >= max) return;
        const rango = nodo.range();
        let archivo = "";
        try {
          archivo = path.relative(base, nodo.getRoot().filename()).replace(/\\/g, "/");
        } catch {
          archivo = "";
        }
        resultados.push({
          archivo,
          linea: rango.start.line + 1,
          columna: rango.start.column + 1,
          texto: nodo.text().slice(0, 500),
        });
      }
    });
    return { ok: true, motor: "ast-grep", lenguaje, resultados };
  } catch (error) {
    return {
      ok: false,
      motor: "ast-grep",
      lenguaje,
      resultados,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const LENGUAJES_ESTRUCTURALES = Object.freeze(Object.keys(LENGUAJES));
