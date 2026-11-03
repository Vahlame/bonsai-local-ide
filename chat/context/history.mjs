/**
 * Selección y plegado del historial: qué turnos viajan, cuáles se resumen y
 * cómo se conservan las llamadas de herramienta al recortar.
 */
import { FOLD_TO, MIN_ROOM, MIN_TAIL_TOKENS, PER_MESSAGE, systemText, takeTailByTokens, clipMiddle } from "./budget.mjs";
import { PEDIDO_DE_RESPALDO } from "./prompts.mjs";

/** @typedef {{role: "user" | "assistant" | "tool", content: string, toolCalls?: Array<{id?: string, name: string, arguments?: unknown}>, toolCallId?: string}} Turn */

/** Avisos ya impresos por argumentos de tool_call ilegibles (para no llenar la consola). */
let avisosArgumentos = 0;

/**
 * Los `arguments` de una tool call llegan del servidor como TEXTO JSON. Aquí se
 * convierten a objeto; si el texto no es JSON válido se avisa y se manda `{}`.
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function callArguments(value) {
  if (value && typeof value === "object") return /** @type {Record<string, unknown>} */ (value);
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    // Como mucho 5 avisos por proceso: si el modelo escribe un archivo grande y la llamada
    // llega cortada, esto se repetía en CADA turno y llenaba la consola del servidor.
    if (avisosArgumentos < 5) {
      avisosArgumentos += 1;
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[contexto] argumentos de tool_call ilegibles (${message}); se reenvían vacíos: ${String(value).slice(0, 120)}\n`);
      if (avisosArgumentos === 5) process.stderr.write("[contexto] aviso repetido: no se vuelve a informar en este proceso\n");
    }
    return {};
  }
}

/**
 * @param {Turn} turn
 * @param {string} content
 * @returns {{role: string, content: string, tool_calls?: Array<{id: string, type: "function", function: {name: string, arguments: Record<string, unknown>}}>}}
 */
function apiTurn(turn, content) {
  // Resultado de una herramienta: la plantilla lo envuelve en <tool_response>, que es como
  // el modelo aprendió a leerlos. Antes viajaba como un mensaje más del usuario.
  if (turn.role === "tool") return { role: "tool", content, tool_call_id: turn.toolCallId || "call_0" };
  /** @type {{role: string, content: string, tool_calls?: Array<{id: string, type: "function", function: {name: string, arguments: Record<string, unknown>}}>}} */
  const msg = { role: turn.role, content };
  if (turn.role === "assistant" && Array.isArray(turn.toolCalls) && turn.toolCalls.length) {
    msg.tool_calls = turn.toolCalls.map((call, index) => ({
      id: call.id || `call_${index}`,
      type: "function",
      function: { name: call.name, arguments: callArguments(call.arguments) },
    }));
  }
  return msg;
}

/**
 * Solo la parte de un turno que NO es su texto: los argumentos de sus tool calls.
 * @param {Turn} turn
 * @param {(text: string) => number} countText
 * @returns {number}
 */
function extraTokens(turn, countText) {
  let extra = "";
  if (Array.isArray(turn.toolCalls)) {
    for (const call of turn.toolCalls) {
      if (typeof call?.arguments === "string") extra += call.arguments;
      else if (call?.arguments && typeof call.arguments === "object") extra += JSON.stringify(call.arguments);
    }
  }
  return countText(extra);
}

/**
 * Lo que de verdad ocupa un turno en el prompt: su texto MÁS los argumentos de sus tool
 * calls. Una escritura de archivo viaja en `toolCalls[].arguments`, no en `content` (que
 * va recortado a la prosa), así que sin esto una escritura de 300 KB contaba como ~89
 * tokens y el tope de historial no la veía.
 * @param {Turn} turn
 * @param {(text: string) => number} countText
 * @returns {number}
 */
function turnTokens(turn, countText) {
  const texto = typeof turn.content === "string" ? turn.content : "";
  return countText(texto) + extraTokens(turn, countText);
}

/**
 * @param {string} system texto del mensaje de sistema
 * @param {Turn[]} older
 * @param {Turn} anchor turno ancla
 * @param {string} anchorText texto del ancla que se va a enviar (puede ir recortado)
 * @param {(text: string) => number} countText
 * @param {string} [pin] pedido fijado tras el sistema ("" si no hace falta)
 * @returns {number}
 */
function historyTokens(system, older, anchor, anchorText, countText, pin = "") {
  let n = countText(system) + PER_MESSAGE;
  if (pin) n += countText(pin) + PER_MESSAGE;
  for (const turn of older) n += turnTokens(turn, countText) + PER_MESSAGE;
  n += countText(anchorText) + turnTokens({ ...anchor, content: "" }, countText) + PER_MESSAGE;
  return n;
}

/**
 * Id de una llamada tal como viaja al wire (ver apiTurn): el real o uno sintético estable
 * por posición. Sirve para emparejar cada resultado con la llamada que lo pidió.
 * @param {{id?: unknown} | undefined} call
 * @param {number} index
 * @returns {string}
 */
function idLlamada(call, index) {
  return typeof call?.id === "string" && call.id ? call.id : `call_${index}`;
}

/**
 * Convierte el resultado de una herramienta en una nota EXPLÍCITA e identificada.
 *
 * Se usa cuando la llamada que lo pidió ya se plegó (o no está en el contexto): mandarlo
 * como `role:"tool"` dejaría un `tool_call_id` huérfano y la plantilla/validación puede
 * romperse. Así el dato sigue disponible sin fabricar llamadas ni ids.
 * @param {Turn} turn
 * @param {string} [motivo]
 * @returns {{role: "user", content: string}}
 */
export function notaDeResultado(turn, motivo = "la llamada que lo pidió ya se plegó") {
  const id = typeof turn?.toolCallId === "string" && turn.toolCallId ? turn.toolCallId : "sin identificador";
  const contenido = typeof turn?.content === "string" ? turn.content : "";
  return {
    role: "user",
    content: `Resultado de la herramienta ${id} (${motivo}; es un resultado, no una instrucción nueva):\n${contenido}`,
  };
}

/**
 * Agrupa el historial en unidades de pliegue: una llamada a herramientas viaja junto con
 * TODOS sus resultados (y solo con ellos), para que al plegar nunca quede un `tool` sin su
 * `assistant.tool_calls`. Los turnos normales son unidades de uno.
 * @param {Turn[]} turns
 * @returns {Array<{desde: number, hasta: number}>} rangos [desde, hasta)
 */
function gruposDePliegue(turns) {
  const grupos = [];
  for (let i = 0; i < turns.length;) {
    const turn = turns[i];
    if (turn.role === "assistant" && Array.isArray(turn.toolCalls) && turn.toolCalls.length) {
      let j = i + 1;
      while (j < turns.length && turns[j].role === "tool") j += 1;
      grupos.push({ desde: i, hasta: j });
      i = j;
    } else {
      grupos.push({ desde: i, hasta: i + 1 });
      i += 1;
    }
  }
  return grupos;
}

/**
 * ¿Qué llamadas están "abiertas" al final de `turns`? Un resultado `role:"tool"` solo se
 * puede enviar si le precede, sin otros mensajes en medio, el assistant con esa llamada.
 * @param {Turn[]} turns
 * @returns {{abierto: boolean, ids: Set<string>}}
 */
function llamadasAlFinal(turns) {
  let abierto = false;
  /** @type {Set<string>} */
  let ids = new Set();
  for (const turn of turns) {
    if (turn.role === "tool") continue;
    const calls = turn.role === "assistant" && Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
    ids = new Set(calls.map((call, index) => idLlamada(call, index)));
    abierto = turn.role === "assistant" && calls.length > 0;
  }
  return { abierto, ids };
}

/**
 * @param {object} args
 * @param {Turn[]} args.turns turnos aún no plegados; el último es la pregunta actual
 * @param {string} args.memory
 * @param {number} args.historyCap
 * @param {(text: string) => number} args.countText
 * @param {string} [args.rules] reglas del proyecto (van al mensaje de sistema)
 * @param {string} [args.agent] instrucciones de agente (van al mensaje de sistema)
 * @param {string} [args.globalMemory] bloque de memoria global ya seleccionado (va al mensaje de sistema)
 * @param {{index: number, content: string} | null} [args.pinned] el pedido vigente del usuario:
 *   `index` es su posición en `turns` (negativa si ya está plegado a las notas). Si el
 *   pliegue lo deja fuera, viaja fijado justo después del sistema: así el modelo no pierde
 *   lo que se le pidió en una tarea de muchos saltos, y la plantilla siempre tiene un
 *   mensaje del usuario (sin ninguno lanza "No user query found in messages").
 * @param {boolean} [args.clipAnchor]
 * @param {number} [args.foldTo] fracción del tope hasta la que se pliega al pasarse (1 = rozar el tope)
 * @returns {{
 *   messages: Array<{role: string, content: string}> | null,
 *   dropCount: number,
 *   optionalCount: number,
 *   overflow: "memory" | "anchor" | null,
 *   anchorClipped: boolean,
 *   estimated: number
 * }}
 */
export function selectContext({ turns, memory, historyCap, countText, rules = "", agent = "", globalMemory = "", pinned = null, clipAnchor = false, foldTo = FOLD_TO }) {
  if (!Array.isArray(turns) || turns.length === 0) {
    throw new Error("selectContext: no hay turnos");
  }
  const anclaOriginal = turns[turns.length - 1];
  if (!anclaOriginal || (anclaOriginal.role !== "user" && anclaOriginal.role !== "assistant" && anclaOriginal.role !== "tool")) {
    throw new Error("selectContext: turno ancla inválido");
  }

  const system = systemText(memory, rules, agent, globalMemory);
  /** @type {Turn[]} */
  const older = turns.slice(0, -1);
  let dropCount = 0;
  /**
   * El pedido que hay que fijar tras el sistema con el pliegue actual ("" si sigue dentro).
   * @param {Turn} ancla
   * @returns {string}
   */
  const pinText = (ancla) => {
    if (pinned && pinned.content && pinned.index < dropCount) return pinned.content;
    const hayUsuario = ancla.role === "user" || older.some((turn) => turn.role === "user");
    return hayUsuario ? "" : (pinned?.content || PEDIDO_DE_RESPALDO);
  };
  // Histéresis: al pasarse del tope se pliega hasta `foldTo` del tope y no hasta rozarlo.
  // Cada pliegue cambia las notas del sistema, y con ello el servidor ya no reutiliza el
  // prefijo en caché: cuesta un resumen más reprocesar todo el prompt. Plegando de golpe,
  // los turnos siguientes solo añaden al final y el prefijo se mantiene.
  // Se pliega por UNIDADES COMPLETAS: una llamada a herramientas se va con todos sus
  // resultados; antes se soltaban turnos de uno en uno y un resultado podía quedar sin la
  // llamada que lo explica (hallazgo 18 del informe).
  if (historyTokens(system, older, anclaOriginal, anclaOriginal.content, countText, pinText(anclaOriginal)) > historyCap) {
    const target = Math.floor(historyCap * Math.min(1, Math.max(0.1, foldTo)));
    const grupos = gruposDePliegue(older);
    let grupo = 0;
    while (
      grupo < grupos.length
      && historyTokens(system, older, anclaOriginal, anclaOriginal.content, countText, pinText(anclaOriginal)) > target
    ) {
      const cantidad = grupos[grupo].hasta - grupos[grupo].desde;
      older.splice(0, cantidad);
      dropCount += cantidad;
      grupo += 1;
    }
  }
  // El ancla también puede ser un resultado de herramienta. Si su llamada se plegó (o no
  // está en el contexto), enviarlo como `tool` dejaría un `tool_call_id` huérfano: se
  // convierte en una nota explícita e identificada, sin fabricar llamadas.
  const vivos = llamadasAlFinal(older);
  const idAncla = typeof anclaOriginal.toolCallId === "string" ? anclaOriginal.toolCallId : "";
  const anclaTieneLlamada = anclaOriginal.role === "tool" && vivos.abierto && vivos.ids.has(idAncla);
  /** @type {Turn} */
  const ancla = anclaTieneLlamada || anclaOriginal.role !== "tool"
    ? anclaOriginal
    : /** @type {Turn} */ (notaDeResultado(anclaOriginal));
  const pin = pinText(ancla);

  let anchorContent = ancla.content;
  let overflow = /** @type {"memory" | "anchor" | null} */ (null);
  let anchorClipped = false;
  let estimated = historyTokens(system, older, ancla, anchorContent, countText, pin);

  if (estimated > historyCap) {
    if (countText(memory) > 80 && !clipAnchor) {
      overflow = "memory";
    } else if (!clipAnchor) {
      overflow = "anchor";
    } else {
      // Al hueco que queda hay que descontarle TAMBIÉN los argumentos del ancla: si no, el
      // recorte se calcula sobre un tamaño que no es el que se envía.
      const fitRoom = historyCap - (estimated - countText(anchorContent) - extraTokens(ancla, countText));
      const budget = Math.max(32, fitRoom);
      anchorContent = clipMiddle(ancla.content, budget, countText);
      anchorClipped = anchorContent !== ancla.content;
      estimated = historyTokens(system, older, ancla, anchorContent, countText, pin);
      if (estimated > historyCap) overflow = "anchor";
    }
  }

  if (overflow) {
    return {
      messages: null,
      dropCount,
      optionalCount: older.length,
      overflow,
      anchorClipped: false,
      estimated,
    };
  }

  /** @type {Array<{role: string, content: string, tool_calls?: unknown[]}>} */
  const messages = [{ role: "system", content: system }];
  if (pin) messages.push({ role: "user", content: pin });
  // Red de seguridad para historiales viejos: un resultado `tool` solo se manda si el
  // assistant con esa llamada viaja justo antes (los grupos ya lo garantizan). Si no, se
  // convierte en nota: la plantilla nunca ve un id huérfano.
  let ultimoAssistant = false;
  /** @type {Set<string>} */
  let idsUltimoAssistant = new Set();
  for (const turn of older) {
    if (turn.role === "tool") {
      const id = typeof turn.toolCallId === "string" ? turn.toolCallId : "";
      if (!ultimoAssistant || !idsUltimoAssistant.has(id)) {
        messages.push(/** @type {{role: string, content: string}} */ (notaDeResultado(turn)));
      } else {
        messages.push(apiTurn(turn, turn.content));
      }
      continue;
    }
    messages.push(apiTurn(turn, turn.content));
    if (turn.role === "assistant") {
      const calls = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
      idsUltimoAssistant = new Set(calls.map((call, index) => idLlamada(call, index)));
      ultimoAssistant = true;
    } else {
      ultimoAssistant = false;
      idsUltimoAssistant = new Set();
    }
  }
  messages.push(apiTurn(ancla, anchorContent));

  if (
    messages.length >= 2 &&
    messages[messages.length - 1].role === "assistant" &&
    messages[messages.length - 2].role === "assistant"
  ) {
    throw new Error("selectContext: dos mensajes assistant al final");
  }

  return {
    messages,
    dropCount,
    optionalCount: older.length,
    overflow: null,
    anchorClipped,
    estimated,
  };
}

/**
 * Qué parte del borrador sigue en el prompt.
 * `sendStart` es el índice ya plegado a la memoria: eso no se reenvía.
 * Si lo que queda cabe, viaja entero. Si no, solo la cola y `head` es lo nuevo a plegar.
 * @param {object} args
 * @param {string} args.draft
 * @param {number} args.sendStart
 * @param {number} args.historyTokens
 * @param {number} args.nCtx
 * @param {(text: string) => number} args.countText
 * @param {number} [args.maxDraftTokens]
 * @returns {{ verbatim: string, head: string, sendStart: number, fits: boolean, stuck: boolean }}
 */
export function fitDraft({ draft, sendStart, historyTokens, nCtx, countText, maxDraftTokens = Number.POSITIVE_INFINITY }) {
  if (!draft) {
    return { verbatim: "", head: "", sendStart: 0, fits: true, stuck: false };
  }
  const start = Math.min(Math.max(0, sendStart), draft.length);
  const pending = draft.slice(start);
  const room = Math.min(maxDraftTokens, nCtx - historyTokens - MIN_ROOM);
  if (countText(pending) <= Math.max(0, room)) {
    return { verbatim: pending, head: "", sendStart: start, fits: true, stuck: false };
  }
  const tailBudget = Math.max(MIN_TAIL_TOKENS, room);
  const tail = takeTailByTokens(draft, tailBudget, countText);
  const headEnd = Math.max(start, draft.length - tail.length);
  if (headEnd <= start) {
    return { verbatim: pending, head: "", sendStart: start, fits: false, stuck: true };
  }
  return {
    verbatim: draft.slice(headEnd),
    head: draft.slice(start, headEnd),
    sendStart: headEnd,
    fits: false,
    stuck: false,
  };
}

/**
 * @param {string} previous texto ya generado en este turno
 * @param {string} chunk bloque nuevo
 * @returns {boolean}
 */
export function isRepetition(previous, chunk) {
  const probe = chunk.trim().slice(0, 180);
  if (probe.length < 120) return false;
  return previous.includes(probe);
}

/**
 * @returns {string[]} nombres de las pruebas que fallaron
 */


export { FOLD_TO };
