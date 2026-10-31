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
 */
import {
  extractCommands,
  extractReads,
  extractSearches,
  extractWrites,
  impliedAction,
  indexScope,
} from "./actions.mjs";

export function legacyToolParserEnabled() {
  return String(process.env.BONSAI_LEGACY_TOOL_PARSER ?? "1") !== "0";
}

export function legacyCommands(text) {
  return legacyToolParserEnabled() ? extractCommands(text) : [];
}

export function legacyWrites(text, userText, opciones = {}) {
  return legacyToolParserEnabled() ? extractWrites(text, userText, opciones) : [];
}

export function legacyReads(text) {
  return legacyToolParserEnabled() ? extractReads(text) : [];
}

export function legacySearches(text) {
  return legacyToolParserEnabled() ? extractSearches(text) : [];
}

export function legacyIndexScope(text) {
  return legacyToolParserEnabled() ? indexScope(text) : "";
}

export function legacyImpliedAction(text) {
  return legacyToolParserEnabled() ? impliedAction(text) : { command: "", query: "" };
}
