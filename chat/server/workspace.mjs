/**
 * Operaciones de carpeta de trabajo que no conocen el estado del servidor.
 *
 * Las funciones puras reciben la raíz. Las que dependen de la carpeta activa se
 * construyen con `createWorkspaceTools()` y reciben sus helpers por contexto:
 * este módulo no lee `workspaceRoot`, `SALIDA` ni ninguna variable de ui-server.
 */
import fs from "node:fs";
import path from "node:path";

export const SKIP_DIR = new Set(["bin", "models", ".git", "node_modules", "dist", "build"]);
export const SKIP_EXT = new Set([".dll", ".exe", ".gguf", ".zip", ".pdb", ".tmp", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".mp3", ".mp4", ".bin"]);

/**
 * @param {string} root
 * @param {string} rel
 * @param {Array<{rel: string, bytes: number}>} out
 * @param {number} depth
 * @returns {Array<{rel: string, bytes: number}>}
 */
export function listWorkspace(root, rel, out, depth, limit = 400) {
  if (out.length >= limit || depth > 8) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIR.has(entry.name)) listWorkspace(root, child, out, depth + 1, limit);
      continue;
    }
    if (SKIP_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    let bytes = 0;
    try {
      bytes = fs.statSync(path.join(root, child)).size;
    } catch {
      continue;
    }
    if (bytes > 1_500_000) continue;
    out.push({ rel: child, bytes });
  }
  return out;
}

/**
 * @param {string} root
 * @returns {Map<string, string>}
 */
export function snapshotFiles(root) {
  /** @type {Map<string, string>} */
  const found = new Map();
  // __pycache__: cada `python x.py` lo reescribe y llenaba el «Archivos:» de ruido.
  const skip = new Set([".venv", "node_modules", ".git", "__pycache__"]);
  /**
   * @param {string} dir
   * @param {string} rel
   */
  const walk = (dir, rel) => {
    /** @type {import("node:fs").Dirent[]} */
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, childRel);
        continue;
      }
      try {
        const stat = fs.statSync(abs);
        found.set(childRel, `${stat.size}:${Math.round(stat.mtimeMs)}`);
      } catch {
        /* el archivo pudo desaparecer entre el listado y el stat */
      }
    }
  };
  walk(root, "");
  return found;
}

/**
 * @param {Map<string, string>} before
 * @param {Map<string, string>} after
 * @returns {string}
 */
export function fileDelta(before, after) {
  /** @type {string[]} */
  const lines = [];
  for (const [rel, mark] of after) {
    const size = mark.split(":")[0];
    if (!before.has(rel)) lines.push(`nuevo ${rel} (${size} bytes)`);
    else if (before.get(rel) !== mark) lines.push(`modificado ${rel} (${size} bytes)`);
  }
  for (const rel of before.keys()) {
    if (!after.has(rel)) lines.push(`borrado ${rel}`);
  }
  // Un `pip install` o un build pueden tocar cientos de archivos: la lista no puede
  // comerse el hueco de la salida del comando.
  const MAX = 15;
  const visibles = lines.length > MAX ? [...lines.slice(0, MAX), `…y ${lines.length - MAX} archivos más`] : lines;
  return lines.length ? `Archivos:\n${visibles.join("\n")}` : "Ningún archivo de la carpeta cambió.";
}

/**
 * @typedef {Object} WorkspaceToolsContext
 * @property {() => string} getRoot carpeta de trabajo activa (puede cambiar en caliente)
 * @property {string} adjuntosDir carpeta segura de imágenes adjuntas
 * @property {(root: string, rel: string) => string | null} fileInside
 * @property {(root: string, rel: string, options?: {permitirRaiz?: boolean}) => string | null} rutaProyecto
 * @property {(root: string, rel: string) => string} resolveInside
 * @property {(abs: string, limite: number) => {ok: boolean, texto: string}} readLimited
 * @property {(text: string, maxTokens: number, estimate: (text: string) => number) => string} takeHeadByTokens
 * @property {(text: string) => number} estimateTokens
 */

/**
 * Construye las operaciones que sí dependen de la carpeta activa y de las
 * políticas de rutas del servidor. Ninguna lee variables globales.
 * @param {WorkspaceToolsContext} ctx
 */
export function createWorkspaceTools(ctx) {
  const root = () => ctx.getRoot();

  /**
   * @param {string} scope
   * @returns {string}
   */
  function repoIndex(scope) {
    const workspaceRoot = root();
    const destino = ctx.rutaProyecto(workspaceRoot, scope || ".", { permitirRaiz: true });
    if (!destino) return "Ruta no permitida: usa una carpeta dentro del proyecto seleccionado.";
    const rootRel = path.relative(workspaceRoot, destino).replace(/\\/g, "/");
    if (rootRel.split("/").some((part) => part.toLowerCase() === ".git")) {
      return "Usa git para inspeccionar sus metadatos.";
    }
    if (rootRel && !ctx.fileInside(workspaceRoot, rootRel)) return "Ruta no permitida.";
    const base = rootRel ? path.join(workspaceRoot, rootRel) : workspaceRoot;
    if (rootRel && !fs.existsSync(base)) return `No existe ${rootRel}.`;
    const files = listWorkspace(base, "", [], 0, 2000).map((file) => ({
      rel: rootRel ? `${rootRel}/${file.rel}` : file.rel,
      bytes: file.bytes,
    }));
    const lines = files.map((file) => `${file.rel}  ${file.bytes}b`);
    const skipped = [...SKIP_DIR].filter((name) => fs.existsSync(path.join(workspaceRoot, name)));
    const head = rootRel ? `Índice de ${rootRel} (rutas, sin contenido):` : "Índice del repositorio (rutas, sin contenido):";
    const tail = skipped.length ? `\nCarpetas presentes y no listadas archivo por archivo: ${skipped.join(", ")}` : "";
    return `${head}\n${lines.join("\n") || "(vacío)"}${tail}`;
  }

  /**
   * @param {string} text
   * @param {unknown} rels
   * @returns {string}
   */
  function attachFiles(text, rels) {
    const workspaceRoot = root();
    if (!Array.isArray(rels) || rels.length === 0) return text;
    const chosen = rels.filter((rel) => typeof rel === "string").slice(0, 8);
    const budget = Math.max(200, Math.floor(2000 / chosen.length));
    const pieces = [];
    for (const rel of chosen) {
      const abs = ctx.fileInside(workspaceRoot, rel.replace(/\\/g, "/"));
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      if (SKIP_EXT.has(path.extname(abs).toLowerCase())) continue;
      const leido = ctx.readLimited(abs, 400_000);
      if (!leido.ok) continue;
      const clip = ctx.takeHeadByTokens(leido.texto, budget, ctx.estimateTokens);
      pieces.push(`Archivo ${rel.replace(/\\/g, "/")}:\n${clip}`);
    }
    if (!pieces.length) return text;
    return `${text}\n\n${pieces.join("\n\n")}`;
  }

  /**
   * @param {string} text
   * @param {unknown} snippets
   * @returns {string}
   */
  function attachSnippets(text, snippets) {
    const workspaceRoot = root();
    if (!Array.isArray(snippets) || snippets.length === 0) return text;
    const pieces = [];
    for (const snip of snippets.slice(0, 6)) {
      if (!snip || typeof snip !== "object") continue;
      const row = /** @type {{rel?: unknown, text?: unknown, start?: unknown, end?: unknown}} */ (snip);
      if (typeof row.rel !== "string" || typeof row.text !== "string" || !row.text.trim()) continue;
      const rel = row.rel.replace(/\\/g, "/");
      if (!ctx.fileInside(workspaceRoot, rel)) continue;
      const start = Number(row.start) || 1;
      const end = Number(row.end) || start;
      const clip = ctx.takeHeadByTokens(row.text, 400, ctx.estimateTokens);
      pieces.push(`Selección ${rel}:${start}-${end}:\n${clip}`);
    }
    if (!pieces.length) return text;
    return `${text}\n\n${pieces.join("\n\n")}`;
  }

  /**
   * Imágenes que el usuario adjuntó. Sin visión (mmproj) se guardan fuera del
   * proyecto y al modelo solo le llega el aviso de que no puede verlas; con
   * visión se mandan como data URL en el mensaje.
   * @param {string} text
   * @param {unknown} imagenes
   * @returns {string}
   */
  function attachImagenes(text, imagenes) {
    if (!Array.isArray(imagenes) || imagenes.length === 0) return text;
    /** @type {string[]} */
    const piezas = [];
    for (const rel of imagenes.slice(0, 6)) {
      if (typeof rel !== "string") continue;
      const abs = ctx.fileInside(ctx.adjuntosDir, rel.replace(/\\/g, "/"));
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      piezas.push(`- ${rel} (${fs.statSync(abs).size} bytes)`);
    }
    if (!piezas.length) return text;
    return `${text}\n\nEl usuario adjuntó ${piezas.length} imagen(es), guardadas en ${ctx.adjuntosDir}:\n${piezas.join("\n")}\nNo tienes visión, así que no puedes ver su contenido: no lo inventes. Si la respuesta depende de la imagen, dilo y pide que la describan o que se active la visión (mmproj).`;
  }

  /**
   * @param {string} text
   * @returns {string[]}
   */
  function filesNamedIn(text) {
    const files = listWorkspace(root(), "", [], 0);
    const lower = text.toLowerCase();
    /** @type {string[]} */
    const hits = [];
    for (const file of files) {
      const base = file.rel.split("/").pop()?.toLowerCase() || "";
      if (SKIP_EXT.has(path.extname(file.rel).toLowerCase())) continue;
      if (lower.includes(file.rel.toLowerCase()) || (base.length > 5 && lower.includes(base))) hits.push(file.rel);
      if (hits.length >= 6) break;
    }
    return hits;
  }

  /**
   * Ruta canónica dentro de la carpeta de trabajo: la MISMA que devuelve `writeOutputs`
   * (pasa por `resolveInside`, que quita `./`, barras repetidas y valida extensiones).
   * Hace falta porque las tool calls traen la ruta tal cual la escribió el modelo
   * (`./x.py`) y `writeOutputs` devuelve `x.py`; comparar ambas sin normalizar dejaba el
   * diff y el punto de deshacer apuntando a un archivo que "no existía antes".
   * @param {string} rel
   * @returns {string} "" si la ruta no es escribible
   */
  function relCanonica(rel) {
    try {
      return path.relative(root(), ctx.resolveInside(root(), rel)).split(path.sep).join("/");
    } catch {
      return "";
    }
  }

  /**
   * @param {string} output
   * @returns {string}
   */
  function pdfReady(output) {
    const workspaceRoot = root();
    /** @type {string[]} */
    const notes = [];
    for (const match of output.matchAll(/(?:nuevo|modificado) (\S+\.pdf) \((\d+) bytes\)/gi)) {
      const rel = match[1].replace(/\\/g, "/");
      const abs = ctx.fileInside(workspaceRoot, rel);
      let valid = false;
      if (abs && fs.existsSync(abs)) {
        valid = fs.readFileSync(abs).subarray(0, 5).toString("latin1").startsWith("%PDF");
      }
      notes.push(valid
        ? `${rel} es un PDF válido de ${match[2]} bytes y empieza por %PDF. No lo abras ni busques texto dentro. Si el usuario pidió otro dato, como el tamaño, llama solo ese comando.`
        : `${rel} cambió (${match[2]} bytes) pero no empieza por %PDF.`);
    }
    return notes.join("\n");
  }

  return { repoIndex, attachFiles, attachSnippets, attachImagenes, filesNamedIn, relCanonica, pdfReady };
}
