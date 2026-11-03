/**
 * Chat local contra llama-server. No es Cursor: no hay herramientas ni reglas de IDE.
 * El historial que se envía tiene tope. Si la respuesta llena la ventana, el mismo
 * turno sigue: la cabeza pasa a notas y la cola se continúa con continue_final_message.
 */

import fs from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  DEFAULT_HISTORY_CAP,
  MEMORY_CAP_TOKENS,
  MIN_ROOM,
  MIN_TAIL_TOKENS,
  SLICE_TOKENS,
  agentText,
  clipMiddle,
  describirLlamadas,
  estimateTokens,
  fitDraft,
  isRepetition,
  limpiarNotas,
  notaDeResultado,
  sampleText,
  selectContext,
  selfTest,
  takeHeadByTokens,
  takeTailByTokens,
  turnoInterno,
} from "./context.mjs";
import { PC_TOOLS, stripFakeToolText } from "./actions.mjs";
import { leerSSE } from "./sse.mjs";
import { MODELO, muestreo } from "./modelo.mjs";
import { CODER_CONFIG, CODER_SYSTEM, CODER_TOOLS } from "./coder-harness.mjs";
import { contextoEntorno } from "./entorno.mjs";
import { parseHarmony, createHarmonyProgress } from "./harmony.mjs";
import { cargarSesion, guardarSesion } from "./session-store.mjs";
import { ApiError, isContextError, LlamaClient } from "./llama-client.mjs";
import { PromptPolicy } from "./prompting.mjs";
import { Compactor } from "./compaction.mjs";
export { metadatosSesion } from "./session-store.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = path.join(ROOT, "session.json");
const TIMINGS_PATH = path.join(ROOT, "timings.jsonl");
/** Hueco por tanda cuando el modelo puede escribir archivos con una tool call. */
export const AGENT_SLICE_TOKENS = 16384;

/**
 * Reserva de salida (en tokens) de cada fase del salto. Se aparta de la ventana ANTES de
 * calcular el tope de historial: no es una bolsa de VRAM, es el hueco que necesita la
 * respuesta. Una lectura o un plan son respuestas cortas (no desplazan evidencia); una
 * escritura puede ser un archivo entero; un cierre es un resumen breve.
 * @type {Readonly<Record<"plan" | "lectura" | "escritura" | "final" | "charla", number>>}
 */
export const RESERVA_POR_FASE = Object.freeze({
  plan: 3072,
  lectura: 2048,
  escritura: AGENT_SLICE_TOKENS,
  final: 4096,
  charla: SLICE_TOKENS,
});

// El resumidor es el MISMO modelo que hace la tarea y, con la transcripción delante, tendía a
// seguir con ella («Creo test_api.py: ```python…»). De ahí que se le diga qué NO hacer y que
// la transcripción vaya entre marcas: es material para archivar, no un pedido.

/**
 * @param {string[]} argv
 * @returns {{ host: string, port: number, historyCap: number, selfTest: boolean, once: string | null, think: number, perfil: string }}
 */
function parseArgs(argv) {
  /** @type {{ host: string, port: number, historyCap: number, selfTest: boolean, once: string | null, think: number, perfil: string }} */
  const out = {
    host: "127.0.0.1",
    port: 8080,
    historyCap: DEFAULT_HISTORY_CAP,
    selfTest: false,
    once: null,
    think: 0,
    perfil: "codigo",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-test") out.selfTest = true;
    else if (arg === "--host") out.host = argv[++i] ?? out.host;
    else if (arg === "--port") out.port = Number(argv[++i]);
    else if (arg === "--prompt-cap" || arg === "--history-cap") out.historyCap = Number(argv[++i]);
    else if (arg === "--once") out.once = argv[++i] ?? "";
    else if (arg === "--think") out.think = Number(argv[++i]);
    else if (arg === "--perfil") out.perfil = argv[++i] ?? out.perfil;
    else throw new Error(`Argumento desconocido: ${arg}`);
  }
  if (!Number.isInteger(out.port) || out.port <= 0) throw new Error("Puerto inválido");
  if (!Number.isInteger(out.historyCap) || out.historyCap < 0) {
    throw new Error("El tope de historial tiene que ser un entero >= 0 (0 = automático: ventana menos salida)");
  }
  if (!Number.isInteger(out.think) || out.think < 0) throw new Error("--think es un presupuesto en tokens (0 = apagado)");
  muestreo(out.perfil);
  return out;
}

/** Huellas de un fallo o de una verificación pendiente: eso no se puede perder al recortar. */

/**
 * @param {string} msg
 */
function status(msg) {
  process.stderr.write(`\x1b[90m${msg}\x1b[0m\n`);
}

export class BonsaiChat extends LlamaClient {
  /**
   * @param {{ host: string, port: number, historyCap: number, sessionPath?: string, think?: number, perfil?: string, parallelTools?: boolean, timingsPath?: string | null, faseSalto?: "plan" | "lectura" | "escritura" | "final" | "charla" }} opts
   */
  constructor(opts) {
    super(opts);
    this.promptPolicy = new PromptPolicy(this);
    this.compactor = new Compactor(this);
    this.configuredCap = opts.historyCap;
    this.sessionPath = opts.sessionPath || SESSION_PATH;
    /**
     * Fase del salto que se está por pedir, si el controlador la conoce. Decide cuánta
     * ventana se reserva para la respuesta (ver reservaSalida): una lectura o un plan
     * necesitan poco; una escritura, una slice entera. `undefined` = no se sabe (se usa la
     * reserva conservadora de siempre).
     * @type {"plan" | "lectura" | "escritura" | "final" | "charla" | undefined}
     */
    this.faseSalto = opts.faseSalto === undefined ? undefined : opts.faseSalto;
    /** Razonamiento APAGADO por defecto: solo se enciende con un presupuesto explícito (tokens). */
    this.thinkBudget = Number.isInteger(opts.think) && (/** @type {number} */ (opts.think) === -1 || /** @type {number} */ (opts.think) > 0) ? /** @type {number} */ (opts.think) : 0;
    this.razonamientoEsfuerzo = "";
    /**
     * ¿Razona la próxima generación? Solo cuenta si hay presupuesto (thinkBudget > 0). El
     * agente lo apaga en los saltos rutinarios y lo enciende al planificar y tras un fallo:
     * pensar en CADA salto eran hasta ~75 s más por salto a 27 t/s.
     */
    this.pensarEsteSalto = true;
    this.perfil = opts.perfil || "codigo";
    // Varias herramientas por turno (llama.cpp lo trae apagado). BONSAI_PARALLEL_TOOLS=0 lo desactiva.
    this.parallelTools = opts.parallelTools !== false && process.env.BONSAI_PARALLEL_TOOLS !== "0";
    /** Comando de Python que se le dice al modelo (la interfaz pone el del .venv solo si existe). */
    this.pythonCmd = "python";
    /** "none" deja las herramientas definidas (el prompt no cambia y la caché sirve) pero impide llamarlas. */
    this.toolChoice = "auto";
    this.timingsPath = opts.timingsPath === undefined ? TIMINGS_PATH : opts.timingsPath;
    // Diagnóstico de GPT-OSS: BONSAI_RAW_STREAM=1 guarda cada evento SSE tal cual
    // (content, reasoning_content, tool_calls) para ver el dialecto real del modelo.
    // También acepta una ruta explícita.
    const rawEnv = process.env.BONSAI_RAW_STREAM || "";
    this.rawStreamPath = opts.rawStreamPath || (rawEnv === "1"
      ? path.join(path.dirname(this.sessionPath), "raw-stream.jsonl")
      : (rawEnv ? path.resolve(rawEnv) : ""));
    /** @type {{cache_n?: number, prompt_n?: number, prompt_per_second?: number, predicted_n?: number, predicted_per_second?: number} | null} */
    this.lastTimings = null;
    this.tighten = 0;
    this.silent = false;
    this.actOnPc = false;
    /** @type {((event: {type: string, text?: string}) => void) | null} */
    this.push = null;
    /** @type {{ memory: string, folded: number, turns: Array<{role: "user"|"assistant"|"tool", content: string, toolCallId?: string}>, draft: string, files: Array<{rel: string, bytes: number}> }} */
    this.session = { memory: "", folded: 0, turns: [], draft: "", files: [] };
    this.livePrompt = 0;
    this.liveGenerated = 0;
    this.usageTick = 0;
    /** @type {{prompt: number, generated: number, cap: number, nCtx: number, folded: number, turns: number, memory: number} | null} */
    this.usage = null;
    /** @type {string} */
    this.projectMap = "";
    /** Reglas del proyecto (BONSAI.md, AGENTS.md, .cursor/rules) que van al mensaje de sistema. */
    this.rules = "";
    /**
     * Bloque de memoria global ya seleccionado para ESTE turno. Lo pone ui-server
     * al empezar cada petición; vacío significa que no se inyecta nada.
     */
    this.globalMemory = "";
    /** @type {string[]} ids de las notas globales inyectadas (diagnóstico). */
    this.globalMemoryIds = [];
    /** Presupuesto de tokens con el que se seleccionó la memoria global. */
    this.globalMemoryBudget = 0;
    /** Tope de tokens por imagen (--image-max-tokens); se reserva en la ventana al mandar imágenes. */
    this.imageMaxTokens = 1024;
    this.agentProfile = opts.agentProfile || process.env.BONSAI_AGENT_PROFILE || "legacy";
    this.coderTask = null;
  }

  /**
   * Mete las imágenes adjuntas en el último mensaje del usuario, en el formato que
   * entiende el servidor (`image_url` con data URL). Solo el último: son del turno
   * en curso y así no se reenvían en cada turno del historial.
   * @param {Array<{role: string, content: unknown, tool_call_id?: string}>} messages
   * @param {string[]} imagenes data URLs
   * @param {string} [toolCallId] solo el resultado de esta llamada; vacío = último mensaje user
   * @returns {Array<{role: string, content: unknown}>}
   */
  aplicarImagenes(messages, imagenes, toolCallId = "") {
    if (!this.vision || !Array.isArray(imagenes) || imagenes.length === 0) return messages;
    const original = !toolCallId ? messages.findIndex(msg => msg.role === "user" && typeof msg.content === "string" && /\(Adjuntos?: /.test(msg.content)) : -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (typeof msg.content !== "string") continue;
      if (toolCallId ? msg.role !== "tool" || msg.tool_call_id !== toolCallId : msg.role !== "user") continue;
      if (original >= 0 && i !== original) continue;
      // El OCR se sitúa después de los píxeles: el modelo recibe la transcripción
      // junto a la imagen y puede contrastarla sin dar preferencia automática a su visión.
      const marker = toolCallId ? "\nOCR local (" : "\n\nPara transcribir texto o cifras";
      const ocrAt = msg.content.indexOf(marker);
      const antes = ocrAt < 0 ? msg.content : msg.content.slice(0, ocrAt);
      const despues = ocrAt < 0 ? "" : msg.content.slice(ocrAt).trim();
      msg.content = [
        { type: "text", text: antes },
        ...imagenes.map((url) => ({ type: "image_url", image_url: { url } })),
        ...(despues ? [{ type: "text", text: despues }] : []),
      ];
      break;
    }
    return messages;
  }

  /**
   * @param {number} prompt
   * @param {number} generated
   */
  reportUsage(prompt, generated) {
    this.livePrompt = prompt;
    this.liveGenerated = generated;
    // El perfil de código no usa session.memory: su compactación es extractiva y
    // vive en contextDiagnostics. Si el medidor leyera solo session.memory mostraría
    // 0 aunque el prompt llevara miles de tokens de extractos y grupos plegados.
    const compact = this.contextDiagnostics?.compactionDetails;
    const coder = this.agentProfile === "small-local-coder";
    const memoria = coder && Number.isFinite(Number(compact?.memoryTokensEstimate))
      ? Number(compact.memoryTokensEstimate)
      : estimateTokens(this.session.memory);
    const folded = coder && Number.isFinite(Number(this.contextDiagnostics?.discardedGroups))
      ? Number(this.contextDiagnostics.discardedGroups)
      : this.session.folded;
    this.usage = {
      prompt,
      generated,
      cap: this.historyCap(),
      nCtx: this.nCtx,
      folded,
      foldedUnit: coder ? "grupos" : "turnos",
      turns: this.session.turns.length,
      memory: memoria,
      memoryMode: coder ? "extractiva" : "resumen",
      globalMemory: estimateTokens(this.globalMemory),
      globalMemoryEntries: this.globalMemoryIds.length,
    };
    this.emit({ type: "usage", ...this.usage });
  }

  /**
   * @param {{type: string, text?: string}} event
   */
  emit(event) {
    this.push?.(event);
  }

  /**
   * @param {string} msg
   */
  note(msg) {
    if (!this.silent) status(msg);
    this.emit({ type: "status", text: String(msg).replace(/^\[|\]$/g, "") });
  }

  /**
   * @param {string} token
   */
  emitToken(token) {
    if (!this.silent) process.stdout.write(token);
    this.emit({ type: "token", text: token });
    this.liveGenerated += estimateTokens(token);
    this.usageTick += 1;
    if (this.usageTick % 8 === 0) this.reportUsage(this.livePrompt, this.liveGenerated);
  }

  /**
   * @param {Array<{role: string, content: string}>} messages
   * @returns {Array<{role: string, content: string}>}
   */
  outgoing(messages) {
    // AQUÍ NO SE LE DICE AL MODELO CÓMO LLAMAR A LAS HERRAMIENTAS. Los esquemas viajan en
    // `tools` (toolFields) y el modelo emite la llamada como su plantilla se lo enseñó;
    // bonsai la reconoce tal cual (chat/adaptadores.mjs para el texto crudo, delta.tool_calls
    // cuando el servidor la parsea). Meter aquí una instrucción de formato era imponerle un
    // dialecto: justo lo que no se quiere.
    return messages.map((msg) => {
      if (msg.role === "assistant") {
        const content = stripFakeToolText(msg.content);
        return content === msg.content ? msg : { ...msg, content };
      }
      return msg;
    });
  }

  /**
   * Tokens que se apartan de la ventana para la respuesta de ESTE salto.
   *
   * Antes con herramientas siempre se reservaba media ventana (con nCtx=16384 el historial
   * quedaba en 8064 aunque el usuario pidiera 32768) porque la reserva era una constante.
   * Una lectura o un plan no necesitan desplazar tanta evidencia: su respuesta es corta.
   * Una escritura sí puede ser un archivo grande. Reglas:
   *  - Nunca menos de MIN_ROOM (siempre hay hueco para terminar la frase).
   *  - Nunca más de media ventana (el resto no se usaría: el tope de historial ya no baja).
   *  - Sin fase conocida se conserva la reserva de siempre (compatibilidad).
   *  - El pensamiento va DENTRO de la reserva: si se reserva solo la respuesta, el
   *    razonamiento se come el hueco de la respuesta (ventana = entrada + pensar + salida).
   * @returns {number}
   */
  reservaSalida() {
    if (Number.isFinite(this.overrideOutputReservation)) return this.overrideOutputReservation;
    if (this.consultation) return Math.min(SLICE_TOKENS + 512, Math.floor((this.nCtx || 8192) / 2));
    const pensar = this.reservaPensamiento();
    if (this.agentProfile === "small-local-coder") {
      const c = this.coderTask?.config || this.coderConfig || CODER_CONFIG;
      const total = Math.max(0, Number(c.outputTokens) || 0) + pensar;
      return Math.min(total, Math.max(256, Math.floor((this.nCtx || c.contextTokens) / 2) - 128));
    }
    const fase = this.faseSalto;
    const conHerramientas = this.actOnPc && this.toolChoice !== "none";
    const reservaFase = conHerramientas
      ? (fase && Object.prototype.hasOwnProperty.call(RESERVA_POR_FASE, fase) ? RESERVA_POR_FASE[fase] : AGENT_SLICE_TOKENS)
      : SLICE_TOKENS;
    const mediaVentana = this.nCtx > 0 ? Math.floor(this.nCtx / 2) : Number.POSITIVE_INFINITY;
    return Math.max(MIN_ROOM, Math.floor(Math.min(reservaFase + pensar, mediaVentana)));
  }

  /**
   * Tokens de razonamiento que hay que apartar junto a la respuesta. No puede llamar a
   * effectiveThinkingBudget() (esa usa reservaSalida y sería recursivo): se limita por el
   * presupuesto del usuario y por el tope del perfil de agente.
   * @returns {number}
   */
  reservaPensamiento() {
    if (!(this.thinkBudget > 0)) return 0;
    const config = this.coderTask?.config || this.coderConfig || CODER_CONFIG;
    const topePerfil = Number(config.thinkingTokens);
    return Number.isFinite(topePerfil) && topePerfil > 0
      ? Math.min(this.thinkBudget, topePerfil)
      : this.thinkBudget;
  }

  /**
   * Presupuesto de la memoria compactada: ~6 % de la ventana (1k–8k tokens).
   * Es el "summary" que sustituye a los turnos plegados.
   * @returns {number}
   */
  memoryCapTokens() {
    const w = this.nCtx > 0 ? this.nCtx : 16384;
    return Math.max(1024, Math.min(8192, Math.round(w * 0.06)));
  }

  historyCap() {
    // configuredCap = 0 -> automático: todo el historial que quepa dejando la
    // reserva de salida (como los modelos frontera: ventana = entrada + salida).
    const reserva = this.reservaSalida();
    const coderConfig = this.coderTask?.config || this.coderConfig || CODER_CONFIG;
    const ventana = this.agentProfile === "small-local-coder" ? Math.min(this.nCtx || coderConfig.contextTokens, coderConfig.contextTokens) : this.nCtx;
    const ceiling = ventana > 0 ? Math.max(512, ventana - reserva - 128 - (this.pendingImageTokens || 0)) : (this.configuredCap > 0 ? this.configuredCap : 512);
    const cap = this.configuredCap > 0 ? this.configuredCap : Number.POSITIVE_INFINITY;
    return Math.max(512, Math.min(cap, ceiling) - this.tighten);
  }

  /**
   * Presupuesto de contexto REAL, en tokens, para mostrarlo en la interfaz:
   *  - ventana: `n_ctx` que cargó el servidor (0 si aún no se sabe).
   *  - solicitado: tope de historial que pidió el usuario (configuredCap).
   *  - efectivo: historial que de verdad se puede mandar ahora (historyCap()).
   *  - reservaSalida: presupuesto para la generación; el espacio restante también puede
   *    incluir el margen de 128 tokens, imágenes y capacidad no solicitada.
   * @returns {{ventana: number, solicitado: number, efectivo: number, reservaSalida: number}}
   */
  presupuestoContexto() {
    const ventana = this.nCtx;
    const efectivo = this.historyCap();
    return {
      ventana,
      // 0 = automático (ventana - salida). Se expone como null para que la UI lo muestre.
      solicitado: this.configuredCap > 0 ? this.configuredCap : null,
      auto: this.configuredCap <= 0,
      efectivo,
      reservaSalida: this.reservaSalida(),
    };
  }

  /**
   * Desglose explícito para las trazas y el panel de diagnóstico. Separa lo solicitado
   * de lo efectivo y deja claro qué se reserva para salida, pensamiento, imágenes y el
   * margen fijo; `inputUsed` puede ser exacto (input_tokens de llama-server) o una
   * estimación, según `countMethod` del diagnóstico que lo contiene.
   * @param {number} inputUsed
   */
  budgetSnapshot(inputUsed) {
    const coderConfig = this.coderTask?.config || this.coderConfig || CODER_CONFIG;
    const ventana = this.agentProfile === "small-local-coder"
      ? Math.min(this.nCtx || coderConfig.contextTokens, coderConfig.contextTokens)
      : this.nCtx;
    const outputReserved = this.reservaSalida();
    return {
      window: this.nCtx,
      effectiveWindow: ventana,
      configuredInput: this.configuredCap,
      effectiveInput: this.historyCap(),
      inputUsed,
      inputRemaining: Math.max(0, this.historyCap() - inputUsed),
      outputReserved,
      thinkingReserved: this.thinkBudget < 0 && this.pensarEsteSalto ? -1
        : this.thinkBudget > 0 && this.pensarEsteSalto ? this.effectiveThinkingBudget() : 0,
      thinkingIncludedInOutput: true,
      imagesReserved: this.pendingImageTokens || 0,
      safetyMargin: 128,
      tighten: this.tighten,
      globalMemoryBudget: this.globalMemoryBudget || 0,
      globalMemoryTokens: estimateTokens(this.globalMemory),
      globalMemoryEntries: this.globalMemoryIds.length,
      formula: "effectiveInput = max(512, min(configuredInput, max(512, effectiveWindow - outputReserved - 128 - imagesReserved)) - tighten)",
    };
  }

  loadSession() {
    // Lectura con respaldo `.bak` y apartado de corruptos: un corte a mitad de
    // escritura no pierde la conversación y el archivo malo se conserva.
    const { session, notas } = cargarSesion(this.sessionPath);
    for (const nota of notas) this.note(nota);
    this.session = session;
  }

  saveSession() {
    // Escritura atómica con copia `.bak` de la versión anterior. Si falla, el
    // error sube: no se finge que se guardó.
    guardarSesion(this.sessionPath, this.session);
  }

  templateFields(think = false) { return this.promptPolicy.templateFields(think); }
  thinkingLimit() { return this.promptPolicy.thinkingLimit(); }
  effectiveThinkingBudget() { return this.promptPolicy.effectiveThinkingBudget(); }
  samplingFields(think = false) { return this.promptPolicy.samplingFields(think); }
  toolFields(choiceOverride, incluirTools = true) { return this.promptPolicy.toolFields(choiceOverride, incluirTools); }
  puedeFallbackTexto() { return this.promptPolicy.puedeFallbackTexto(); }
  mensajesSinParser(messages) { return this.promptPolicy.mensajesSinParser(messages); }
  guiaHerramientas() { return this.promptPolicy.guiaHerramientas(); }
  mensajesReintentoNativo(messages) { return this.promptPolicy.mensajesReintentoNativo(messages); }
  estimateMessages(messages) {
    let n = 0;
    for (const message of messages) {
      // Con visión, el contenido puede ser una lista de partes: el texto se cuenta y
      // los tokens de la imagen los reserva quien la manda (imageMaxTokens).
      const contenido = Array.isArray(message.content)
        ? message.content.map((parte) => (parte && typeof parte.text === "string" ? parte.text : "")).join("\n")
        : message.content;
      n += estimateTokens(contenido) + 8;
    }
    return n;
  }

  async summarize(...args) { return this.compactor.summarize(...args); }
  fallbackNotes(...args) { return this.compactor.fallbackNotes(...args); }
  modelTurn(...args) { return this.compactor.modelTurn(...args); }
  agentRules() { return this.compactor.agentRules(); }
  pinnedRequest() { return this.compactor.pinnedRequest(); }
  async packHistory() { return this.compactor.packHistory(); }
  async packCoderHistory() { return this.compactor.packCoderHistory(); }
  async streamSlice(messages, maxTokens, continueFinal, signal, opciones = {}) {
    const requestStarted = performance.now();
    let firstUsefulDelta = null;
    // El razonamiento (si está encendido) solo acompaña a una generación nueva: una
    // continuación ya viene con el bloque de pensamiento cerrado en la plantilla.
    const think = !continueFinal && this.thinkBudget !== 0;
    const sinParser = opciones.sinParserNativo === true;
    /** @type {Record<string, unknown>} */
    const body = {
      model: this.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      cache_prompt: this.agentProfile === "small-local-coder" ? (this.coderTask?.config || this.coderConfig || CODER_CONFIG).promptCache !== false : true,
      max_tokens: this.agentProfile === "small-local-coder" && this.thinkBudget >= 0
        ? Math.min(maxTokens, this.reservaSalida())
        : maxTokens,
      ...this.samplingFields(think),
      ...this.templateFields(think),
      ...this.toolFields(sinParser ? "none" : undefined, !sinParser),
    };
    if (this.contextDiagnostics) {
      this.contextDiagnostics.maxOutput = body.max_tokens;
      this.contextDiagnostics.thinkingBudget = think ? this.effectiveThinkingBudget() : 0;
      this.contextDiagnostics.thinkingIncludedInOutput = true;
    }
    if (continueFinal) {
      body.continue_final_message = true;
      body.add_generation_prompt = false;
    }

    const res = await this.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const text = await res.text();
      /** @type {{error?: {message?: string, type?: string}}} */
      let data = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = {};
      }
      const message = data.error?.message || text || res.statusText;
      if (this.allowThinkingKw && /enable_thinking/i.test(message)) {
        this.allowThinkingKw = false;
        return this.streamSlice(messages, maxTokens, continueFinal, signal);
      }
      // llama.cpp puede rechazar el turno completo con el parser PEG nativo
      // (varias tool calls o texto antes de la llamada). En vez de perder el
      // turno, se reintenta sin tools nativas y con el catálogo como texto:
      // GPT-OSS devuelve JSON puro y `llamadasCrudas` lo ejecuta igual.
      if (!sinParser && !continueFinal && !signal.aborted && this.puedeFallbackTexto() &&
          /peg-native|does not match the expected .*format/i.test(message)) {
        if (!opciones.reintentoNativo) {
          this.note("[parser nativo rechazó la salida; reintento con una sola tool call]");
          return this.streamSlice(this.mensajesReintentoNativo(messages), maxTokens, false, signal, { reintentoNativo: true });
        }
        this.note("[parser nativo rechazó la salida otra vez; reintento en modo JSON]");
        return this.streamSlice(this.mensajesSinParser(messages), maxTokens, false, signal, { sinParserNativo: true });
      }
      throw new ApiError(message, res.status, data.error?.type || "");
    }
    if (!res.body) throw new Error("El servidor no devolvió un stream");

    let chunk = "";
    const harmonyCandidate = this.puedeFallbackTexto();
    let reason = "stop";
    let thinking = false;
    /** @type {Record<string, number> | null} */
    let timings = null;
    /** @type {Record<string, number> | null} */
    let usage = null;
    /** @type {Map<number, {index: number, id: string, name: string, arguments: string}>} */
    const calls = new Map();
    let ultimoProgreso = 0;
    let ultimoHarmony = 0;
    const harmonyProgress = createHarmonyProgress({
      reasoning: (text) => {
        const visible = text.slice(0, Math.max(0, 65536 - (this.currentReasoning || "").length));
        if (visible) { this.currentReasoning = (this.currentReasoning || "") + visible; this.emit({ type: "reasoning", text: visible }); }
      },
      final: (text) => this.emitToken(text),
      commentary: (text) => this.emit({ type: "status", text: text.slice(-240) }),
      tool: (progress) => this.emit({ type: "tool_progress", ...progress }),
    });
    /** @type {{completo: boolean, motivo: string, finishReason: string}} */
    let cierre = { completo: false, motivo: "cierre_sin_fin", finishReason: "" };
    try {
      // Un ÚNICO lector SSE (chat/sse.mjs). Antes el bucle de aquí se tragaba los finales
      // raros: un JSON inválido se ignoraba y una conexión cortada tras un trozo válido
      // parecía una respuesta completa (hallazgo 1). Ahora fragmentos, CRLF, UTF-8 partido,
      // `data:` multilínea, [DONE] y el último evento sin salto se manejan una sola vez.
      const fin = await leerSSE(res.body, {
        señal: signal,
        alEvento: (json) => {
          if (this.rawStreamPath) {
            try {
              try {
                if (fs.statSync(this.rawStreamPath).size > 5 * 1024 * 1024) fs.renameSync(this.rawStreamPath, `${this.rawStreamPath}.1`);
              } catch { /* aún no existe */ }
              fs.appendFileSync(this.rawStreamPath, JSON.stringify({ t: new Date().toISOString(), ...json }) + "\n");
            } catch { /* diagnóstico best-effort */ }
          }
          if (json.error?.message) {
            const apiErr = new ApiError(json.error.message, 400, json.error.type || "");
            apiErr.partial = chunk;
            throw apiErr;
          }
          if (json.timings && typeof json.timings === "object") timings = json.timings;
          if (json.usage && typeof json.usage === "object") usage = json.usage;
          const choice = json.choices?.[0];
          const delta = choice?.delta || {};
          if (firstUsefulDelta === null && (delta.content || delta.tool_calls?.length)) firstUsefulDelta = performance.now();
          const token = delta.content ?? "";
          if (token) {
            chunk += token;
            // GPT-OSS puede venir en Harmony crudo (--skip-chat-parsing). No se
            // pinta el marcador <|channel|> en la UI; se parsea al final.
            if (!harmonyCandidate) this.emitToken(token);
            else if (Date.now() - ultimoHarmony >= 300) { harmonyProgress(chunk); ultimoHarmony = Date.now(); }
          }
          if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
            const visible = delta.reasoning_content.slice(0, Math.max(0, 65536 - (this.currentReasoning || "").length));
            if (visible) {
              this.currentReasoning = (this.currentReasoning || "") + visible;
              this.emit({ type: "reasoning", text: visible });
            }
            if (!thinking) {
              thinking = true;
              this.note("[pensando…]");
            }
            this.liveGenerated += estimateTokens(delta.reasoning_content);
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const call of delta.tool_calls) {
              const index = Number.isInteger(call?.index) ? call.index : 0;
              // `index` viaja con la fila para poder fundir los trozos que llegan en slices
              // distintas (ver el bucle de runTurn): sin él, un archivo grande escrito por el
              // modelo se partía en dos llamadas y ninguna era JSON válido.
              const row = calls.get(index) || { index, id: "", name: "", arguments: "" };
              if (typeof call?.id === "string" && call.id) row.id = call.id;
              if (typeof call?.function?.name === "string") row.name += call.function.name;
              if (typeof call?.function?.arguments === "string") {
                row.arguments += call.function.arguments;
                this.liveGenerated += estimateTokens(call.function.arguments);
              }
              calls.set(index, row);
              // Progreso de una llamada larga (un archivo grande): antes no salía NADA hacia la
              // interfaz mientras el modelo escribía el archivo dentro de la llamada (minutos),
              // la pantalla parecía colgada y un cliente con tope de inactividad cortaba el turno.
              const ahora = Date.now();
              if (ahora - ultimoProgreso > 1000) {
                ultimoProgreso = ahora;
                const ruta = row.arguments.match(/"(?:ruta|path)"\s*:\s*"([^"]{1,200})"/)?.[1] || "";
                this.emit({ type: "tool_progress", name: row.name, ruta, chars: row.arguments.length });
                this.reportUsage(this.livePrompt, this.liveGenerated);
              }
            }
          }
          if (choice?.finish_reason) reason = choice.finish_reason;
        },
      });
      if (fin.finishReason) reason = fin.finishReason;
      cierre = { completo: fin.completo, motivo: fin.motivo, finishReason: fin.finishReason };
    } catch (err) {
      // La API de retorno para el llamador no cambia: `partial` sigue siendo el texto de ESTA
      // slice. Un cierre prematuro o un JSON inválido llegan como ErrorSSE con `motivo` y
      // `parcial`; runTurn conserva lo recibido en el borrador y el error sube (no se finge
      // una respuesta completa).
      if (err instanceof Error) {
        const yaHay = typeof /** @type {{partial?: unknown}} */ (err).partial === "string" && /** @type {{partial?: string}} */ (err).partial;
        if (!yaHay) {
          const parcial = typeof /** @type {{parcial?: unknown}} */ (err).parcial === "string" ? /** @type {{parcial: string}} */ (err).parcial : "";
          Object.defineProperty(err, "partial", { value: chunk || parcial, configurable: true });
        }
      }
      throw err;
    }
    // Un trozo de continuación puede venir SIN `name` (solo `arguments`): si se tirara aquí,
    // la llamada se quedaría cortada para siempre. Vale con que traiga nombre o argumentos.
    // GPT-OSS con --skip-chat-parsing entrega Harmony crudo. Se separa el
    // análisis de la respuesta final y se convierten sus canales `to=functions.*`
    // en tool calls nativas para el mismo camino de siempre.
    if (harmonyCandidate && chunk.includes("<|channel|>")) {
      harmonyProgress(chunk);
      const parsed = parseHarmony(chunk);
      let indice = calls.size;
      for (const call of parsed.calls) {
        const args = typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments ?? {});
        calls.set(indice, { index: indice, id: `harmony_${randomUUID()}`, name: call.name, arguments: args });
        const ruta = args.match(/"(?:ruta|path)"\s*:\s*"([^"]{1,200})"/)?.[1] || "";
        this.emit({ type: "tool_progress", name: call.name, ruta, chars: args.length });
        indice += 1;
      }
      chunk = parsed.final;
    }
    const latencyMs = performance.now() - requestStarted, ttftMs = firstUsefulDelta === null ? null : firstUsefulDelta - requestStarted;
    if (this.contextDiagnostics) Object.assign(this.contextDiagnostics, { latencyMs, ttftMs });
    this.coderTask?.trace("llm_result", {latencyMs,ttftMs,promptTokens:usage?.prompt_tokens,generatedTokens:usage?.completion_tokens,timings});
    const registered = new Set((this.agentProfile === "small-local-coder" ? CODER_TOOLS : PC_TOOLS).map((t) => t.function.name));
    const normalized = [...calls.values()].filter((call) => call.name || call.arguments).map((call) => {
      const name = call.name.replace(/^functions\./, "");
      return registered.has(name) ? { ...call, name } : call;
    });
    return { chunk, reason, toolCalls: normalized, timings, usage, completo: cierre.completo, motivo: cierre.motivo };
  }

  /**
   * Una línea por petición con lo que midió el servidor. Sirve para ver si la caché de prompt
   * reutiliza el prefijo (cache_n alto, prompt_n bajo) o reprocesa todo el prompt en cada turno.
   * @param {Record<string, number> | null} timings
   * @param {Record<string, number> | null} usage
   * @param {boolean} continued
   */
  recordTimings(timings, usage, continued) {
    if (!timings) return;
    this.lastTimings = timings;
    if (this.contextDiagnostics) {
      this.contextDiagnostics.promptTokensReported = usage?.prompt_tokens ?? null;
      this.contextDiagnostics.generatedTokens = usage?.completion_tokens ?? timings.predicted_n ?? null;
      this.contextDiagnostics.promptMs = timings.prompt_ms ?? null;
      this.contextDiagnostics.generationMs = timings.predicted_ms ?? null;
      this.contextDiagnostics.promptTokensPerSecond = timings.prompt_per_second ?? null;
      this.contextDiagnostics.generationTokensPerSecond = timings.predicted_per_second ?? null;
    }
    const round = (n) => (typeof n === "number" ? Math.round(n * 10) / 10 : undefined);
    const row = {
      t: new Date().toISOString(),
      cache_n: timings.cache_n,
      prompt_n: timings.prompt_n,
      prompt_ps: round(timings.prompt_per_second),
      prompt_ms: timings.prompt_ms,
      predicted_n: timings.predicted_n,
      predicted_ps: round(timings.predicted_per_second),
      predicted_ms: timings.predicted_ms,
      prompt_tokens: usage?.prompt_tokens,
      n_ctx: this.nCtx,
      continued,
    };
    this.emit({ type: "speed", ...row });
    if (!this.timingsPath) return;
    try {
      // Rotación simple: el diagnóstico no debe crecer sin límite durante meses.
      try {
        if (fs.statSync(this.timingsPath).size > 5 * 1024 * 1024) fs.renameSync(this.timingsPath, `${this.timingsPath}.1`);
      } catch { /* aún no existe */ }
      fs.appendFileSync(this.timingsPath, `${JSON.stringify(row)}\n`);
    } catch {
      /* es solo diagnóstico */
    }
  }

  /**
   * @param {string} userText
   * @param {AbortSignal} signal
   * @param {string[]} [imagenes] data URLs de las imágenes adjuntas (solo con visión)
   * @param {{toolCallId?: string, resultados?: Array<{toolCallId: string, content: string, imagenes?: string[]}>}} [opts]
   *   con `toolCallId`, el texto es el RESULTADO de esa llamada y viaja como role "tool" (la
   *   plantilla lo envuelve en <tool_response>). Con `resultados` va UN mensaje "tool" por
   *   llamada (cada uno con su id) y, si además hay texto, después un mensaje del usuario.
   *   Antes, con dos llamadas a la vez, las dos salidas iban juntas con el id de la primera
   *   y la segunda se quedaba sin respuesta: el modelo la repetía.
   * @returns {Promise<void>}
   */
  async runTurn(userText, signal, imagenes = [], opts = {}) {
    this.currentReasoning = "";
    this.contextDiagnostics = null;
    this.overrideOutputReservation = undefined;
    const text = String(userText || "").trim();
    const resultados = Array.isArray(opts.resultados) ? opts.resultados.filter((r) => r && typeof r.toolCallId === "string") : [];
    if (this.vision && this.coderTask && imagenes.length) this.coderTask.images = [...imagenes];
    const taskImages = this.coderTask?.images || this.turnImages || imagenes;
    this.pendingImageTokens = this.vision ? (taskImages.length + resultados.reduce((n,r)=>n+(r.imagenes?.length || 0),0)) * (this.imageMaxTokens + 64) : 0;
    // Las imágenes de herramientas se adjuntan solo a SU resultado y solo en este salto.
    // No se guardan data URLs en el historial ni se atribuyen al pedido del usuario.
    const adjuntar = (messages) => {
      let total = taskImages.length;
      this.aplicarImagenes(this.coderTask ? messages.slice(0,2) : messages, taskImages);
      for (const r of resultados) {
        if (this.vision && Array.isArray(r.imagenes) && r.imagenes.length) {
          this.aplicarImagenes(messages, r.imagenes, r.toolCallId);
          total += r.imagenes.length;
        }
      }
      return this.vision ? total * (this.imageMaxTokens + 64) : 0;
    };
    if (!text && !resultados.length) return;
    for (const r of resultados) {
      this.session.turns.push({ role: "tool", content: String(r.content || "").trim() || "(hecho, sin salida)", toolCallId: r.toolCallId });
    }
    if (text) {
      this.session.turns.push(typeof opts.toolCallId === "string"
        ? { role: "tool", content: text, toolCallId: opts.toolCallId }
        : { role: "user", content: text });
    }

    let draft = "";
    this.session.draft = "";
    let sendStart = 0;
    let seams = 0;
    let maxDraftTokens = Number.POSITIVE_INFINITY;
    /** @type {Array<{role: string, content: string}>} */
    let history = [];
    let historyTokens = 0;
    /** @type {unknown} */
    let failure = null;
    let started = false;
    /** @type {Array<{index: number, id: string, name: string, arguments: string}>} */
    const toolCalls = [];
    /** Nombres de las llamadas que se quedaron a medias y no se van a ejecutar. */
    /** @type {string[]} */
    const cortadas = [];
    // Presupuesto de la slice actual. Si el modelo se queda a medias escribiendo una llamada
    // (un archivo grande no cabe en una slice y el servidor corta con finish_reason "length"),
    // se amplía y se repite en vez de perder la escritura. Vale para CUALQUIER lenguaje o
    // tamaño: no depende de que sea Python, HTML o un JSON.
    // Con herramientas se empieza ya con hueco para un archivo grande: con 2048 tokens un
    // HTML mediano no cabía, y cada intento tirado eran 1-4 minutos de generación perdida.
    // El tope real lo pone igualmente `room` (lo que queda en la ventana).
    // Con razonamiento libre el modelo puede consumir más de la slice corta de
    // charla antes de escribir la respuesta. La reserva de salida ya acota el
    // turno; no se recorta a 2048 cuando hay pensamiento.
    const pensamientoLibre = this.thinkBudget < 0;
    let sliceCap = this.actOnPc && this.toolChoice !== "none"
      ? Math.max(AGENT_SLICE_TOKENS, this.reservaSalida())
      : (pensamientoLibre ? Math.max(SLICE_TOKENS, this.nCtx - 128)
        : (this.thinkBudget !== 0 ? Math.max(SLICE_TOKENS, this.reservaSalida()) : SLICE_TOKENS));
    let escalados = 0;
    /**
     * ¿Los `arguments` de esta llamada llegaron cortados? (JSON que no cierra)
     * @param {{arguments?: string}} call
     * @returns {boolean}
     */
    const callIncompleta = (call) => {
      if (call?.arguments && typeof call.arguments === "object") return false;
      const texto = String(call?.arguments || "");
      if (!texto.trim()) return true;
      try {
        JSON.parse(texto);
        return false;
      } catch {
        return true;
      }
    };
    try {
      const base = await this.packHistory();
      history = base.messages;
      historyTokens = base.promptTokens;
      historyTokens += adjuntar(history);
      if (!this.contextDiagnostics) {
        const textOf = m => typeof m.content === "string" ? m.content : (Array.isArray(m.content) ? m.content.map(p => p.text || "").join("\n") : "");
        this.contextDiagnostics = { model:this.model, contextWindow:this.nCtx, inputTokens:base.promptTokens, countMethod:this.lastCountMethod || "estimación", maxOutput:this.reservaSalida(), systemTokensEstimate:estimateTokens(history.filter(m=>m.role === "system").map(textOf).join("\n")), historyTokensEstimate:estimateTokens(history.filter(m=>m.role !== "system" && m.role !== "tool").map(textOf).join("\n")), toolDefinitionTokensEstimate:estimateTokens(JSON.stringify(this.toolFields())), toolResultTokensEstimate:estimateTokens(history.filter(m=>m.role === "tool").map(textOf).join("\n")), imageTokensReserved:this.pendingImageTokens || 0, imageCountMethod:"reserva estimada, no conteo multimodal real", remainingContext:Math.max(0,this.nCtx-historyTokens-this.reservaSalida()), globalMemoryTokensEstimate:estimateTokens(this.globalMemory), globalMemoryEntries:this.globalMemoryIds.length, globalMemoryBudget:this.globalMemoryBudget, budget:this.budgetSnapshot(base.promptTokens), compaction:base.changed ? "historial compactado por presupuesto" : "ninguna", compactionDetails:base.changed ? this.compactionInfo : null, foldedMessages:this.session.folded };
      }
      if (base.changed) this.note(`[memoria al día · historial ${historyTokens} tok]`);
      if (base.anchorClipped) this.note("[tu mensaje no cabía entero; envié los extremos]");
      if (!this.silent) process.stdout.write("\x1b[33mbonsai>\x1b[0m ");
      this.emit({ type: "start" });
      this.reportUsage(historyTokens, 0);
      started = true;
      for (let slice = 0; slice < 32; slice += 1) {
        if (signal.aborted) break;
        let plan = fitDraft({
          draft,
          sendStart,
          historyTokens,
          nCtx: this.nCtx,
          countText: estimateTokens,
          maxDraftTokens,
        });
        let seamGuard = 0;
        while (!plan.fits && seamGuard < 3) {
          if (plan.stuck || seams >= 8) {
            this.note("[no queda hueco en la ventana]");
            plan = { ...plan, stuck: true };
            break;
          }
          this.note("[contexto lleno: el turno sigue]");
          if (plan.head) {
            this.session.memory = await this.summarize(this.session.memory, [], plan.head);
            const repacked = await this.packHistory();
            history = repacked.messages;
            historyTokens = repacked.promptTokens;
            historyTokens += adjuntar(history);
          }
          sendStart = plan.sendStart;
          seams += 1;
          seamGuard += 1;
          maxDraftTokens = Number.POSITIVE_INFINITY;
          plan = fitDraft({
            draft,
            sendStart,
            historyTokens,
            nCtx: this.nCtx,
            countText: estimateTokens,
          });
        }
        if (plan.stuck || !plan.fits) {
          if (!plan.stuck) this.note("[no queda hueco en la ventana]");
          break;
        }

        const verbatim = plan.verbatim;
        /** @type {Array<{role: string, content: string}>} */
        const messages = this.outgoing(verbatim
          ? [...history, { role: "assistant", content: verbatim }]
          : history);
        const continueFinal = verbatim.length > 0;
        let used = historyTokens + estimateTokens(verbatim) + (verbatim ? 8 : 0);
        const nearCeiling = estimateTokens(verbatim) > (this.nCtx - historyTokens) * 0.45;
        if (nearCeiling || used + SLICE_TOKENS + 256 >= this.nCtx) {
          used = await this.countPrompt(messages, continueFinal);
        }
        const room = this.nCtx - used - 8;
        if (room < MIN_ROOM && verbatim && seams < 8) {
          const nextCap = Math.max(MIN_TAIL_TOKENS, Math.floor(estimateTokens(verbatim) * 0.6));
          if (nextCap >= maxDraftTokens) {
            this.note("[no queda hueco en la ventana]");
            break;
          }
          maxDraftTokens = nextCap;
          continue;
        }
        if (room < 1) {
          this.note("[no queda hueco en la ventana]");
          break;
        }
        // `sliceCap` ya incluye la reserva de pensamiento cuando está activo;
        // sumarla otra vez duplicaba el presupuesto de la tanda.
        const maxTokens = Math.min(sliceCap, room);
        this.livePrompt = historyTokens;
        this.liveGenerated = estimateTokens(draft);
        try {
          const { chunk, reason, toolCalls: sliceCalls, timings, usage } = await this.streamSlice(messages, maxTokens, continueFinal, signal);
          this.recordTimings(timings, usage, continueFinal);
          draft += chunk;
          // Trozos de una MISMA llamada en slices distintas (la generación se cortó a medias):
          // se funden por `index`. Antes se apilaban como llamadas SEPARADAS, ninguna era JSON
          // válido y la escritura se perdía sin que nadie lo notara.
          for (const call of sliceCalls) {
            const ya = toolCalls.find((c) => c.index === call.index);
            if (ya) {
              if (!ya.name && call.name) ya.name = call.name;
              if (!ya.id && call.id) ya.id = call.id;
              ya.arguments += call.arguments;
            } else {
              toolCalls.push({ ...call });
            }
          }
          this.reportUsage(historyTokens, estimateTokens(draft));
          this.session.draft = draft;
          this.saveSession();
          if (reason !== "length") break;
          // El hueco se acabó escribiendo una llamada: sus `arguments` llegan cortados y no
          // son JSON válido. Una llamada a medias NO se puede continuar: lo que se reenvía
          // para seguir es solo el TEXTO del turno (la llamada no viaja en el prefill), así
          // que el modelo la vuelve a empezar desde cero y, fundida con el trozo anterior,
          // salía un JSON inválido y la escritura se perdía. Se tira lo cortado, se amplía
          // el presupuesto y se repite; el texto ya escrito se conserva y se sigue tras él.
          if (sliceCalls.some(callIncompleta)) {
            // Si ALGUNA llamada sí llegó entera (p. ej. el primer archivo de dos), se
            // conserva y se ejecuta: repetir todo tiraba un archivo bueno de miles de
            // tokens. La cortada no se ejecuta y el modelo recibe aviso de repetirla.
            const completas = toolCalls.filter((c) => !callIncompleta(c));
            if (completas.length) {
              for (const c of toolCalls) if (callIncompleta(c)) cortadas.push(c.name || "una función");
              toolCalls.splice(0, toolCalls.length, ...completas);
              this.note(`[${cortadas.length} llamada(s) no cabían en la respuesta: se ejecutan las enteras y se avisa]`);
              break;
            }
            toolCalls.length = 0;
            if (escalados < 2) {
              escalados += 1;
              sliceCap *= 3;
              this.note(`[la llamada no cabía en la slice: la repito con ${sliceCap} tokens de hueco]`);
              continue;
            }
            this.note("[la llamada no cupo ni ampliando el hueco: se descarta]");
            break;
          }
          if (!chunk.trim()) {
            if (verbatim && seams < 8) {
              maxDraftTokens = MIN_TAIL_TOKENS;
              continue;
            }
            break;
          }
          if (isRepetition(draft.slice(0, -chunk.length), chunk)) {
            this.note("[paro: la respuesta empezó a repetirse]");
            break;
          }
        } catch (err) {
          const partial = err instanceof Error && "partial" in err && typeof err.partial === "string" ? err.partial : "";
          if (partial) {
            draft += partial;
            this.session.draft = draft;
          }
          if (signal.aborted || (err instanceof Error && err.name === "AbortError")) {
            this.note("[turno cortado]");
            break;
          }
          if (isContextError(err) && seams < 8) {
            maxDraftTokens = Math.max(MIN_TAIL_TOKENS, Math.floor(estimateTokens(verbatim || draft) * 0.5));
            this.note("[el servidor no tenía hueco: compacto y sigo]");
            continue;
          }
          throw err;
        }
      }
    } catch (err) {
      if (signal.aborted || (err instanceof Error && err.name === "AbortError")) {
        this.note("[turno cortado]");
      } else {
        failure = err;
      }
    }

    const spoken = /^sin respuesta\.?$/i.test(draft.trim()) ? "" : draft;
    // Con --skip-chat-parsing el servidor no marca `length` cuando el modelo corta
    // una llamada: llega con finish_reason "stop" y argumentos JSON truncados. Esa
    // llamada no debe guardarse en el historial, porque el template la vuelve a
    // serializar y llama.cpp falla al parsear los argumentos en el siguiente turno.
    const validas = toolCalls.filter((call) => !callIncompleta(call));
    if (validas.length !== toolCalls.length) {
      for (const call of toolCalls) if (callIncompleta(call)) cortadas.push(call.name || "una función");
      toolCalls.splice(0, toolCalls.length, ...validas);
      this.note(`[${cortadas.length} llamada(s) con JSON incompleto: no se guardan; se piden de nuevo]`);
    }
    if (spoken.trim() || toolCalls.length || cortadas.length || this.currentReasoning) {
      /** @type {{role: "assistant", content: string, toolCalls?: Array<{id: string, name: string, arguments: string}>, cortadas?: string[]}} */
      const turn = { role: "assistant", content: spoken };
      if (this.currentReasoning) turn.reasoning = this.currentReasoning;
      if (toolCalls.length) turn.toolCalls = toolCalls;
      if (cortadas.length) turn.cortadas = cortadas;
      this.session.turns.push(turn);
    }
    this.session.draft = "";
    this.saveSession();
    if (started && !this.silent) process.stdout.write("\n");
    if (failure) throw failure;
  }
}

function printHelp() {
  process.stdout.write(
    [
      "comandos:",
      "  /salir          cierra",
      "  /nuevo          borra memoria e historial",
      "  /memoria        enseña las notas comprimidas",
      "  /ctx            ventana, tope y tokens guardados",
      "  /vel            velocidad de la última petición y cuánto prompt reutilizó la caché",
      "  /tope <n>       tope de tokens del historial (mínimo 512)",
      "  /ayuda",
      "",
    ].join("\n"),
  );
}

/**
 * @param {BonsaiChat} chat
 */
async function repl(chat) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const ask = () => new Promise((resolve) => {
    rl.question("\x1b[36mtú>\x1b[0m ", resolve);
  });
  printHelp();
  while (true) {
    const line = await ask();
    const text = String(line ?? "");
    const cmd = text.trim().toLowerCase();
    if (!text.trim()) continue;
    if (cmd === "/salir" || cmd === "/exit" || cmd === "/quit") break;
    if (cmd === "/ayuda" || cmd === "/help") {
      printHelp();
      continue;
    }
    if (cmd === "/nuevo" || cmd === "/clear") {
      chat.session = { memory: "", folded: 0, turns: [], draft: "", files: [] };
      chat.tighten = 0;
      chat.saveSession();
      status("[sesión vacía]");
      continue;
    }
    if (cmd === "/memoria") {
      process.stdout.write(`${chat.session.memory.trim() || "(vacía)"}\n`);
      continue;
    }
    if (cmd === "/ctx") {
      const active = chat.session.turns.slice(chat.session.folded);
      process.stdout.write(
        `ventana ${chat.nCtx} tok · tope historial ${chat.historyCap()} tok · memoria ${estimateTokens(chat.session.memory)} tok · turnos ${chat.session.turns.length} · plegados ${chat.session.folded} · en vivo ${active.length}\n`,
      );
      continue;
    }
    if (cmd === "/vel") {
      const t = chat.lastTimings;
      process.stdout.write(
        t
          ? `prompt ${t.prompt_n ?? "?"} tok procesados + ${t.cache_n ?? 0} de caché · lectura ${Math.round(t.prompt_per_second ?? 0)} t/s · generación ${Math.round((t.predicted_per_second ?? 0) * 10) / 10} t/s\n`
          : "(todavía no hay una petición medida)\n",
      );
      continue;
    }
    if (cmd.startsWith("/tope")) {
      const n = Number(text.trim().split(/\s+/)[1]);
      if (!Number.isInteger(n) || n < 512) {
        status("usa /tope 2048 (entero >= 512)");
        continue;
      }
      chat.configuredCap = n;
      chat.tighten = 0;
      status(`[tope de historial: ${chat.historyCap()} tok]`);
      continue;
    }
    if (cmd.startsWith("/")) {
      status("comando desconocido; /ayuda");
      continue;
    }
    const controller = new AbortController();
    chat.active = controller;
    try {
      await chat.runTurn(text, controller.signal);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`\x1b[31m${message}\x1b[0m\n`);
    } finally {
      chat.active = null;
    }
  }
  rl.close();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    const failures = selfTest();
    if (failures.length) {
      process.stderr.write(`${failures.join("\n")}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write("self-test ok\n");
    return;
  }

  const chat = new BonsaiChat(args);
  chat.loadSession();
  await chat.connect();
  const thinkNote = chat.thinkBudget ? `razonamiento ${chat.thinkBudget} tok` : "sin razonamiento";
  process.stdout.write(
    `Bonsai local · ${chat.base}\nventana ${chat.nCtx} tok · tope de historial ${chat.historyCap()} tok · muestreo ${chat.perfil} · ${thinkNote} · sin Cursor\n`,
  );
  if (args.once !== null) {
    await chat.runTurn(args.once, AbortSignal.timeout(600000));
    return;
  }
  process.on("SIGINT", () => {
    if (chat.active) {
      chat.active.abort();
      return;
    }
    process.exit(0);
  });
  await repl(chat);
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (entry === import.meta.url) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\x1b[31m${message}\x1b[0m\n`);
    process.exitCode = 1;
  });
}
