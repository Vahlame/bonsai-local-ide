/**
 * Texto del modelo: clasificación de charla, detección de resultados inventados y
 * limpieza de llamadas/bloques que el modelo escribe como prosa.
 */

/**
 * ¿Es un objeto JSON válido? Sirve para distinguir "la llamada llegó CORTADA" (JSON a medias,
 * típico cuando el modelo escribe un archivo grande) de "la llamada vino vacía".
 * @param {string} texto
 * @returns {boolean}
 */
export function esObjetoJson(texto) {
  try {
    const parsed = JSON.parse(texto);
    return Boolean(parsed) && typeof parsed === "object";
  } catch {
    return false;
  }
}

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

export function stripReads(text) {
  return text
    .replace(/```leer[ \t]+[^\r\n`]+?\s*```/g, "")
    .replace(/```leer[ \t]*\r?\n[\s\S]*?```/gi, "")
    .replace(/```[ \t]*\r?\n[ \t]*leer\b[\s\S]*?```/gi, "")
    .trim();
}

export function stripFileBlocks(text) {
  return text
    .replace(/```archivo[^\n]*\n[\s\S]*?```/gi, "")
    .replace(/```[ \t]*\r?\n[ \t]*archivo\b[\s\S]*?```/gi, "")
    .replace(/```[ \t]*\r?\n[ \t]*[^\s`]+\.[a-z0-9]+\s*\r?\n[\s\S]*?```/gi, "")
    .replace(/```(?:html|css|js|mjs|svg|txt|md|json|py)\s*\n[\s\S]*?```/gi, "")
    .trim();
}
