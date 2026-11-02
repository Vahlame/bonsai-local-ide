/**
 * Legacy tool-call compatibility layer.
 *
 * The source of truth for tool arguments is the native tool-calling path:
 * JSON Schema / Zod validation plus `nativeToolEffects()` in actions.mjs.
 *
 * Older local models sometimes write tool calls as text (```ejecutar,
 * <tool_call>, "voy a ejecutar..."), and the old regex parser still exists for
 * those models. It is deliberately isolated here and can be disabled with:
 *
 *     BONSAI_LEGACY_TOOL_PARSER=0
 *
 * Do not add new regexes for a specific model. If a model needs a new tool,
 * add a native schema and a handler; do not grow this file.
 *
 * RETIRADA PLANIFICADA: 2027-06-30. Antes de esa fecha, el parser debe quedar
 * apagado por defecto o eliminarse junto con sus métricas y pruebas. El flag
 * `BONSAI_LEGACY_TOOL_PARSER=0` ya permite probar la retirada sin borrar código.
 */
/**
 * @param {string} rel
 * @returns {string}
 */
export function cleanRelative(rel) {
  let name = rel.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\\/g, "/");
  name = name.replace(/^\.?\//, "");
  return name;
}


// Solo texto (código, datos, configuración). Faltaban formatos corrientes y el agente no
// podía escribir, p. ej., un `.cjs` (CommonJS) ni un `.htm`: la escritura salía «bloqueada».
// Binarios y ejecutables (.exe, .dll…) siguen fuera.
export const ALLOWED = new Set([
  "html", "htm", "css", "scss", "sass", "less", "js", "mjs", "cjs", "svg", "txt", "md", "json", "jsonl", "py", "pyi", "ps1", "csv", "tsv",
  "ts", "tsx", "jsx", "c", "h", "cpp", "hpp", "cc", "cs", "java", "kt", "go", "rs", "rb", "php", "lua", "dart", "swift", "r",
  "yml", "yaml", "toml", "ini", "cfg", "conf", "properties", "xml", "sql", "vue", "svelte", "graphql", "proto",
  "bat", "cmd", "sh", "tex", "log",
]);
export const BINARY_EXTENSIONS = new Set(["exe", "dll", "gguf", "pdb", "zip", "7z", "png", "jpg", "jpeg", "gif", "webp", "ico", "woff", "woff2", "mp3", "mp4", "pdf", "bin"]);
/**
 * @param {string} userText
 * @param {string} ext
 * @returns {string}
 */
export function guessName(userText, ext) {
  const raw = userText.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if ((ext === "html" || ext === "htm") && /serpiente|snake/.test(raw)) return "serpiente.html";
  const skip = new Set(["hazme", "haz", "crea", "crear", "un", "una", "el", "la", "los", "las", "juego", "en", "html", "por", "favor", "que", "me", "de", "del", "mi", "archivo", "clasico", "clásico"]);
  const words = (raw.match(/[a-z0-9]+/g) || []).filter((word) => !skip.has(word)).slice(0, 3);
  return `${words.join("-") || "archivo"}.${ext}`;
}

/**
 * @param {string} head
 * @param {string} body
 * @returns {{rel: string, content: string} | null}
 */
function archivoFence(head, body) {
  const tag = head.trim();
  const lines = body.replace(/\s+$/g, "").split(/\r?\n/);
  while (lines.length && !lines[0].trim()) lines.shift();
  const first = (lines[0] || "").trim();
  const tagged = /^archivo\b/i.test(tag);
  const loose = !tag && /^archivo\b/i.test(first);
  if (!tagged && !loose) return null;
  let rel = (tagged ? tag : first).replace(/^archivo\s*/i, "").trim();
  /** @type {string[]} */
  let rest = tagged ? lines : lines.slice(1);
  if (!rel) {
    rel = (rest[0] || "").trim();
    rest = rest.slice(1);
  }
  const cleaned = cleanRelative(rel);
  const ext = cleaned.split(".").pop()?.toLowerCase() || "";
  const content = rest.join("\n").replace(/\s+$/, "");
  if (!cleaned || BINARY_EXTENSIONS.has(ext) || !content.trim()) return null;
  return { rel: cleaned, content };
}

/**
 * @param {string} text
 * @returns {Array<{rel: string, content: string}>}
 */
/**
 * @param {string} head
 * @param {string} body
 * @returns {{rel: string, content: string} | null}
 */
function namedLooseFence(head, body) {
  if (head.trim()) return null;
  const lines = body.replace(/\s+$/g, "").split(/\r?\n/);
  while (lines.length && !lines[0].trim()) lines.shift();
  const first = (lines[0] || "").trim();
  if (!/^[^\s]+\.[a-z0-9]{1,12}$/i.test(first)) return null;
  /** @type {string[]} */
  let rest = lines.slice(1);
  if ((rest[0] || "").trim() === first) rest = rest.slice(1);
  const cleaned = cleanRelative(first);
  const ext = cleaned.split(".").pop()?.toLowerCase() || "";
  const content = rest.join("\n").replace(/\s+$/, "");
  if (!cleaned || !ALLOWED.has(ext) || !content.trim()) return null;
  return { rel: cleaned, content };
}

function archivoBlocks(text) {
  /** @type {Array<{rel: string, content: string}>} */
  const found = [];
  const re = /```([^\n`]*)\r?\n([\s\S]*?)```/g;
  for (const match of text.matchAll(re)) {
    const got = archivoFence(match[1] || "", match[2] || "") || namedLooseFence(match[1] || "", match[2] || "");
    if (got && !found.some((item) => item.rel === got.rel)) found.push(got);
  }
  return found;
}

/**
 * Escrituras pedidas en el TEXTO (modelos sin tool calls nativas).
 * Con `soloExplicitas` solo cuentan los bloques ```archivo ruta: un modelo que SÍ llama
 * funciones y enseña un resultado en una cerca (```json …) no está pidiendo guardar nada, y
 * antes la app lo guardaba con un nombre inventado (corrida 7, json-resumen: apareció
 * `lee-ventas-json.json` y el turno siguió varios saltos más).
 * @param {string} text
 * @param {string} userText
 * @param {{soloExplicitas?: boolean}} [opciones]
 * @returns {Array<{rel: string, content: string}>}
 */
export function extractWrites(text, userText, opciones = {}) {
  /** @type {Array<{rel: string, content: string}>} */
  const explicit = archivoBlocks(text);
  if (opciones.soloExplicitas) return explicit;
  const named = /```([^\r\n`]*\.[a-zA-Z0-9]+)\s*\r?\n([\s\S]*?)```/g;
  for (const match of text.matchAll(named)) {
    const header = (match[1] || "").trim().replace(/^archivo\s+/i, "");
    if (/^leer\b/i.test(header)) continue;
    const rel = cleanRelative(header);
    const content = (match[2] || "").replace(/\s+$/, "");
    const ext = rel.split(".").pop()?.toLowerCase() || "";
    if (rel && !BINARY_EXTENSIONS.has(ext) && content.trim() && !explicit.some((item) => item.rel === rel)) {
      explicit.push({ rel, content });
    }
  }
  if (explicit.length) return explicit;

  /** @type {Array<{ext: string, content: string}>} */
  const fences = [];
  const fence = /```([a-zA-Z0-9]+)\s*\r?\n([\s\S]*?)```/g;
  for (const match of text.matchAll(fence)) {
    const ext = (match[1] || "").toLowerCase();
    const content = (match[2] || "").replace(/\s+$/, "");
    if (ALLOWED.has(ext) && content.trim().length > 40) fences.push({ ext: ext === "htm" ? "html" : ext, content });
  }
  fences.sort((a, b) => b.content.length - a.content.length);
  if (fences[0]) return [{ rel: guessName(userText, fences[0].ext), content: fences[0].content }];

  const loose = text.match(/<!DOCTYPE html[\s\S]*<\/html>/i);
  if (loose && loose[0].length > 80) return [{ rel: guessName(userText, "html"), content: loose[0].trim() }];
  return [];
}

/**
 * @param {string} text
 * @returns {string}
 */
/**
 * @param {string} text
 * @returns {string[]}
 */
/**
 * @param {string} text
 * @returns {string | null} carpeta pedida, o "" si pide el repo entero. null si no lo pidió.
 */

/**
 * @param {string} text
 * @returns {Array<{name: string, arg: string}>}
 */
function looseTools(text) {
  /** @type {Array<{name: string, arg: string}>} */
  const found = [];
  const re = /```[ \t]*\r?\n([\s\S]*?)```/g;
  for (const match of text.matchAll(re)) {
    const lines = (match[1] || "").replace(/^\s+|\s+$/g, "").split(/\r?\n/);
    const raw = (lines[0] || "").trim();
    const name = raw.toLowerCase();
    const inline = raw.replace(/^(ejecutar|leer|indice|índice|buscar)\s*/i, "").trim();
    const arg = [inline, ...lines.slice(1)].map((line) => line.trim()).filter(Boolean).join("\n").trim();
    if (/^(ejecutar|leer|indice|índice|buscar)\b/i.test(name)) found.push({ name: name.split(/\s/)[0], arg });
  }
  return found;
}

export function indexScope(text) {
  const match = text.match(/```(?:indice|índice)(?:[ \t]+([^\r\n`]+))?```/i);
  if (match) return (match[1] || "").trim();
  for (const tool of looseTools(text)) {
    if (tool.name === "indice" || tool.name === "índice") return tool.arg;
    if (tool.name === "leer" && !tool.arg) return "";
  }
  return null;
}

/**
 * @param {string} text
 * @returns {string}
 */
export function stripIndex(text) {
  return text
    .replace(/```(?:indice|índice)(?:[ \t]+[^\r\n`]+)?```/gi, "")
    .replace(/```[ \t]*\r?\n[ \t]*(?:indice|índice)\b[\s\S]*?```/gi, "")
    .trim();
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractReads(text) {
  /** @type {string[]} */
  const found = [];
  const re = /```leer[ \t]+([^\r\n`]+?)\s*```/g;
  for (const match of text.matchAll(re)) {
    const rel = cleanRelative(match[1] || "");
    if (rel && !found.includes(rel)) found.push(rel);
  }
  const block = /```leer[ \t]*\r?\n([^\r\n`]+)\s*```/gi;
  for (const match of text.matchAll(block)) {
    const rel = cleanRelative(match[1] || "");
    if (rel && !found.includes(rel)) found.push(rel);
  }
  for (const tool of looseTools(text)) {
    if (tool.name !== "leer" || !tool.arg) continue;
    const rel = cleanRelative(tool.arg.split(/\r?\n/)[0] || "");
    if (rel && !found.includes(rel)) found.push(rel);
  }
  return found.slice(0, 8);
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractCommands(text) {
  /** @type {string[]} */
  const found = [];
  const block = /```ejecutar\s*\r?\n([\s\S]*?)```/g;
  for (const match of text.matchAll(block)) {
    const command = (match[1] || "").trim();
    if (command) found.push(command);
  }
  const inline = /```ejecutar[ \t]+([^\r\n`]+?)```/g;
  for (const match of text.matchAll(inline)) {
    const command = (match[1] || "").trim();
    if (command && !found.includes(command)) found.push(command);
  }
  for (const tool of looseTools(text)) {
    if (tool.name === "ejecutar" && tool.arg && !found.includes(tool.arg)) found.push(tool.arg);
  }
  for (const line of text.split(/\r?\n/)) {
    const tagged = line.match(/^(?:ejecutar|ejecutando|bloqueado)\s*:\s*(.+)$/i);
    const command = tagged?.[1]?.trim() || "";
    if (!command || /not recognized|comando no permitido/i.test(command) || found.includes(command)) continue;
    found.push(command);
  }
  return found.slice(0, 2);
}

/**
 * @param {string} text
 * @returns {{command: string, query: string}}
 */
export function impliedAction(text) {
  const said = text.replace(/\s+/g, " ").trim();
  // Solo cuenta si ANUNCIA la acción ("Voy a buscar…"). Antes bastaba con que apareciera la palabra:
  // una explicación como «la función `buscar` implementa una búsqueda binaria» lanzaba una búsqueda web.
  if (said.length > 400) return { command: "", query: "" };
  const announce = "(?:voy a|vamos a|d[eé]jame|perm[ií]teme|necesito|debo|puedo|quiero|procedo a|primero|ahora)";
  const search = said.match(new RegExp(`\\b${announce}\\b[^.!?\\n]{0,60}?\\b(buscar)\\b`, "i"));
  if (search && search.index !== undefined) {
    const at = said.indexOf(search[1], search.index);
    let query = said.slice(at).replace(/^\S+\s+/, "").replace(/[.]/g, "").trim();
    if (query.length < 3) query = "cómo ejecutar python en windows";
    return { command: "", query: query.slice(0, 180) };
  }
  if (new RegExp(`\\b${announce}\\b[^.!?\\n]{0,60}?\\bpython\\b`, "i").test(said)) return { command: "python --version", query: "" };
  return { command: "", query: "" };
}


/**
 * @param {string} text
 * @returns {string}
 */
function cleanQuery(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractSearches(text) {
  /** @type {string[]} */
  const found = [];
  const push = (query) => {
    const clean = cleanQuery(query);
    if (clean && !found.includes(clean)) found.push(clean);
  };
  const block = /```buscar\s*\r?\n([\s\S]*?)```/gi;
  for (const match of text.matchAll(block)) push(match[1] || "");
  const inline = /```buscar[ \t]+([^\r\n`]+?)```/gi;
  for (const match of text.matchAll(inline)) push(match[1] || "");
  for (const tool of looseTools(text)) {
    if (tool.name === "buscar") push(tool.arg);
  }
  for (const line of text.split(/\r?\n/)) {
    const tagged = line.match(/^buscar\s*:\s*(.+)$/i);
    if (tagged) push(tagged[1] || "");
  }
  return found.slice(0, 2);
}

/**
 * @param {string} text
 * @returns {string}
 */
export function stripSearches(text) {
  return text
    .replace(/```buscar\s*\r?\n[\s\S]*?```/gi, "")
    .replace(/```buscar[ \t]+[^\r\n`]+```/gi, "")
    .replace(/```[ \t]*\r?\n[ \t]*buscar\b[\s\S]*?```/gi, "")
    .trim();
}


/** Fecha de retirada del parser legacy (no se borra antes). */
export const LEGACY_TOOL_PARSER_RETIRO = "2027-06-30";

const metricas = {
  llamadas: 0,
  bloqueadas: 0,
  resultados: 0,
  porHerramienta: /** @type {Record<string, number>} */ ({}),
};

/**
 * @param {string} herramienta
 * @param {unknown} resultado
 */
function contar(herramienta, resultado) {
  metricas.llamadas += 1;
  metricas.porHerramienta[herramienta] = (metricas.porHerramienta[herramienta] || 0) + 1;
  metricas.resultados += Array.isArray(resultado) ? resultado.length : (resultado ? 1 : 0);
  return resultado;
}

export function legacyToolParserEnabled() {
  return String(process.env.BONSAI_LEGACY_TOOL_PARSER ?? "1") !== "0";
}

/** Métricas de uso para decidir la retirada sin adivinar. */
export function metricasLegacyToolParser() {
  return {
    habilitado: legacyToolParserEnabled(),
    retiro: LEGACY_TOOL_PARSER_RETIRO,
    llamadas: metricas.llamadas,
    bloqueadas: metricas.bloqueadas,
    resultados: metricas.resultados,
    porHerramienta: { ...metricas.porHerramienta },
  };
}

/** @param {string} text */
export function legacyCommands(text) {
  if (!legacyToolParserEnabled()) { metricas.bloqueadas += 1; return []; }
  return contar("commands", extractCommands(text));
}

/** @param {string} text @param {string} userText @param {{soloExplicitas?: boolean}} [opciones] */
export function legacyWrites(text, userText, opciones = {}) {
  if (!legacyToolParserEnabled()) { metricas.bloqueadas += 1; return []; }
  return contar("writes", extractWrites(text, userText, opciones));
}

/** @param {string} text */
export function legacyReads(text) {
  if (!legacyToolParserEnabled()) { metricas.bloqueadas += 1; return []; }
  return contar("reads", extractReads(text));
}

/** @param {string} text */
export function legacySearches(text) {
  if (!legacyToolParserEnabled()) { metricas.bloqueadas += 1; return []; }
  return contar("searches", extractSearches(text));
}

/** @param {string} text */
export function legacyIndexScope(text) {
  if (!legacyToolParserEnabled()) { metricas.bloqueadas += 1; return ""; }
  return contar("index", indexScope(text));
}

/** @param {string} text */
export function legacyImpliedAction(text) {
  if (!legacyToolParserEnabled()) { metricas.bloqueadas += 1; return { command: "", query: "" }; }
  return contar("implied", impliedAction(text));
}
