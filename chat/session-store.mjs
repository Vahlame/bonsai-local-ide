/**
 * Persistencia de la sesión de chat: forma validada, metadatos y escritura
 * atómica. Antes vivía dentro de BonsaiChat; separarlo permite probar la
 * recuperación de una sesión corrupta sin arrancar el cliente HTTP.
 */
import { escribirJsonAtomico, leerJson } from "./almacen-json.mjs";

/**
 * Una sesión válida es un objeto JSON; los turnos se validan uno a uno después
 * (una sesión antigua puede tener turnos con formas distintas).
 * @param {unknown} dato
 * @returns {boolean}
 */
export function sesionValida(dato) {
  return Boolean(dato) && typeof dato === "object" && !Array.isArray(dato);
}

/**
 * Metadatos que no son turnos pero deben sobrevivir a la recarga: plan,
 * último motivo de parada y estado del CoderTask.
 * @param {any} raw
 * @returns {Record<string, any>}
 */
export function metadatosSesion(raw) {
  const meta = {};
  const plan = raw?.plan;
  if (plan && Array.isArray(plan.pasos) && plan.pasos.every((s) => typeof s === "string")
    && Array.isArray(plan.hechos) && plan.hechos.every(Number.isInteger)) {
    meta.plan = {
      pasos: [...plan.pasos],
      hechos: [...plan.hechos],
      ...(Number.isFinite(plan.ts) ? { ts: plan.ts } : {}),
    };
  }
  const stop = raw?.lastStop;
  if (stop && typeof stop.motivo === "string" && Number.isInteger(stop.saltos) && typeof stop.completo === "boolean") {
    meta.lastStop = {
      motivo: stop.motivo,
      saltos: stop.saltos,
      completo: stop.completo,
      ...(Number.isFinite(stop.ts) ? { ts: stop.ts } : {}),
    };
  }
  if (raw?.taskState && typeof raw.taskState.goal === "string" && typeof raw.taskState.phase === "string") {
    meta.taskState = structuredClone(raw.taskState);
  }
  return meta;
}

/** @returns {{memory: string, folded: number, turns: any[], draft: string, files: Array<{rel: string, bytes: number}>}} */
function sesionVacia() {
  return { memory: "", folded: 0, turns: [], draft: "", files: [] };
}

/**
 * Carga la sesión con recuperación desde `.bak`. Devuelve los avisos en vez de
 * escribirlos: el llamador decide cómo mostrarlos.
 * @param {string} sessionPath
 * @returns {{session: ReturnType<typeof sesionVacia> & Record<string, any>, notas: string[]}}
 */
export function cargarSesion(sessionPath) {
  const notas = [];
  const leido = leerJson(sessionPath, { validar: sesionValida });
  if (!leido.ok) {
    if (leido.code === "ENOENT") return { session: sesionVacia(), notas };
    notas.push(`sesión ilegible (${leido.error}); la aparto como .corrupto y empiezo vacía`);
    return { session: sesionVacia(), notas };
  }
  if (leido.origen !== sessionPath) notas.push("la sesión estaba ilegible; la recupero del respaldo .bak");
  const raw = /** @type {any} */ (leido.dato);
  const turns = Array.isArray(raw.turns) ? raw.turns : [];
  /** @type {any[]} */
  const clean = [];
  for (const turn of turns) {
    if (!turn || (turn.role !== "user" && turn.role !== "assistant" && turn.role !== "tool")) continue;
    if (typeof turn.content !== "string") continue;
    const storedCalls = Array.isArray(turn.toolCalls) ? turn.toolCalls.filter((call) => call && typeof call.name === "string") : [];
    const storedActions = Array.isArray(turn.actions) ? turn.actions.filter((action) => action && typeof action.title === "string" && typeof action.kind === "string") : [];
    if (!turn.content && !storedCalls.length && !storedActions.length) continue;
    const kept = { role: turn.role, content: turn.content };
    if (turn.role === "tool") kept.toolCallId = typeof turn.toolCallId === "string" ? turn.toolCallId : "";
    if (typeof turn.shown === "string") kept.shown = turn.shown;
    if (storedActions.length) kept.actions = storedActions;
    if (storedCalls.length) {
      kept.toolCalls = storedCalls.map((call) => ({
        id: typeof call.id === "string" ? call.id : "",
        name: call.name,
        arguments: call.arguments,
      }));
    }
    clean.push(kept);
  }
  const folded = Number.isInteger(raw.folded) ? Math.min(Math.max(0, raw.folded), clean.length) : 0;
  const memory = typeof raw.memory === "string" ? raw.memory : "";
  const draft = typeof raw.draft === "string" ? raw.draft : "";
  if (draft) clean.push({ role: "assistant", content: draft });
  /** @type {Array<{rel: string, bytes: number}>} */
  const files = [];
  if (Array.isArray(raw.files)) {
    for (const file of raw.files) {
      if (!file || typeof file.rel !== "string" || !file.rel) continue;
      files.push({ rel: file.rel, bytes: Number(file.bytes) || 0 });
    }
  }
  return {
    session: { memory, folded, turns: clean, draft: "", files, ...metadatosSesion(raw) },
    notas,
  };
}

/**
 * Guarda la sesión de forma atómica, con `.bak` de la versión anterior.
 * @param {string} sessionPath
 * @param {unknown} session
 */
export function guardarSesion(sessionPath, session) {
  escribirJsonAtomico(sessionPath, session, { copia: true, espacio: 0 });
}
