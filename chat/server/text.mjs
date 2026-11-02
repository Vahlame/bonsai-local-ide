/**
 * Texto de presentación del servidor: títulos, resúmenes y recortes. No conoce
 * el estado del agente ni toca disco; solo depende de `turnoInterno`.
 */
import { turnoInterno } from "../context.mjs";

/**
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function clipText(text, max = 1600) {
  const clean = String(text || "").replace(/\s+$/g, "");
  if (!clean) return "(sin salida)";
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}\n…`;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeEdit(text) {
  return /\b(cambia|arregla|modifica|actualiza|corrige|ponle|añade|agrega|quita|color)\b/i.test(text);
}

/**
 * ¿La respuesta es solo el anuncio de una acción futura ("voy a leer…",
 * "déjame comprobar…")? Se exige que empiece así y que no sea una pregunta:
 * "Hecho. Ahora calcula…" es una respuesta válida, no un anuncio pendiente.
 * @param {string} texto
 * @returns {boolean}
 */
export function anunciaAccion(texto) {
  const t = String(texto || "").trim();
  if (!t || t.length >= 320 || /[?¿]/.test(t)) return false;
  return /^(?:voy a|ahora (?:voy a|reviso|leo|ejecuto|escribo|busco|abro|creo)|siguiente paso|d[eé]jame|procedo a|leer[eé]|ejecutar[eé]|escribir[eé]|buscar[eé])\b/i.test(t);
}

/** Instrucción que acompaña a un resultado cuando NO viaja como role "tool". */
export const AVISO_SEGUIR = "Sigue con lo que pedí. Abajo está solo el resultado de esta herramienta. Si con esto ya está todo lo pedido y comprobado, responde al usuario con un resumen breve y sin más acciones. Si falta algo o hubo un error, haz la siguiente acción. No repitas comandos ni vuelvas a leer lo que ya salió bien, y no des por bueno un resultado solo porque el comando terminó: la salida tiene que ser la pedida.";

export function hiddenTurn(turn) {
  // Resultados de herramientas (role "tool") y empujones internos: no los escribió el usuario.
  return turnoInterno(turn);
}

/**
 * Cierre de respaldo cuando el modelo no dio un resumen legible: lo que se hizo desde el
 * último pedido del usuario, a partir de las tarjetas de acción (lo único fiable).
 * @param {Array<{role: string, content: string, actions?: Array<{kind?: string, title?: string, state?: string, code?: number}>}>} turns
 * @returns {string}
 */
export function resumenDeAcciones(turns) {
  let desde = 0;
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    if (turns[i].role === "user" && !turnoInterno(turns[i])) {
      desde = i;
      break;
    }
  }
  /** @type {string[]} */
  const hechas = [];
  for (const turn of turns.slice(desde)) {
    for (const action of turn.actions || []) {
      if (action.state === "denied") continue;
      const titulo = String(action.title || "").split("\n")[0].slice(0, 80);
      if (action.kind === "write") hechas.push(`guardé \`${titulo}\``);
      else if (action.kind === "cmd") hechas.push(`ejecuté \`${titulo}\`${typeof action.code === "number" ? ` (código ${action.code})` : ""}`);
      else if (action.kind === "read") hechas.push(`leí \`${titulo}\``);
    }
  }
  const unicas = [...new Set(hechas)];
  if (!unicas.length) return "No llegué a terminar lo que pediste y no hice ningún cambio. Prueba a pedírmelo de otra forma o por partes.";
  const ultimas = unicas.slice(-8);
  return `No llegué a cerrar con un resumen (el modelo quería seguir con otra acción). Lo que hice:\n${ultimas.map((linea) => `- ${linea}`).join("\n")}${unicas.length > ultimas.length ? `\n- …y ${unicas.length - ultimas.length} más` : ""}`;
}

/**
 * @param {{turns?: Array<{role?: string, content?: string}>}} session
 * @returns {string}
 */
export function chatTitle(session) {
  const first = (session.turns || []).find((turn) => turn.role === "user" && typeof turn.content === "string" && !turnoInterno(turn));
  const text = (first?.content || "").replace(/\s+/g, " ").trim();
  return text.slice(0, 48) || "Nueva conversación";
}
