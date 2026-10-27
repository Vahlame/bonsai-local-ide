/**
 * Chat local contra llama-server. No es Cursor: no hay herramientas ni reglas de IDE.
 * El historial que se envía tiene tope. Si la respuesta llena la ventana, el mismo
 * turno sigue: la cabeza pasa a notas y la cola se continúa con continue_final_message.
 */

import fs from "node:fs";
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
  sampleText,
  selectContext,
  selfTest,
  takeHeadByTokens,
  turnoInterno,
} from "./context.mjs";
import { PC_TOOLS, stripFakeToolText } from "./actions.mjs";
import { MODELO, muestreo } from "./modelo.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = path.join(ROOT, "session.json");
const TIMINGS_PATH = path.join(ROOT, "timings.jsonl");
/** Hueco por tanda cuando el modelo puede escribir archivos con una tool call. */
export const AGENT_SLICE_TOKENS = 16384;

// El resumidor es el MISMO modelo que hace la tarea y, con la transcripción delante, tendía a
// seguir con ella («Creo test_api.py: ```python…»). De ahí que se le diga qué NO hacer y que
// la transcripción vaya entre marcas: es material para archivar, no un pedido.
const SUMMARY_RULES =
  "Eres el archivador de una sesión de programación. Escribe SOLO notas en viñetas sobre lo que YA pasó: lo que pidió el usuario, archivos creados o cambiados (ruta y para qué), nombres reales de funciones y clases, comandos ejecutados con su resultado y los errores que siguen pendientes. NO escribas código, NO sigas la tarea, NO digas lo que vas a hacer y NO des el pedido por cumplido. Lo importante primero. Máximo 700 palabras.";

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
  if (!Number.isInteger(out.historyCap) || out.historyCap < 512) {
    throw new Error("El tope de historial tiene que ser un entero >= 512");
  }
  if (!Number.isInteger(out.think) || out.think < 0) throw new Error("--think es un presupuesto en tokens (0 = apagado)");
  muestreo(out.perfil);
  return out;
}

/**
 * @param {unknown} data
 * @returns {number | null}
 */
function readTokenCount(data) {
  if (typeof data === "number") return data;
  if (!data || typeof data !== "object") return null;
  const row = /** @type {Record<string, unknown>} */ (data);
  if (typeof row.input_tokens === "number") return row.input_tokens;
  if (typeof row.prompt_tokens === "number") return row.prompt_tokens;
  if (typeof row.n_tokens === "number") return row.n_tokens;
  const usage = row.usage;
  if (usage && typeof usage === "object" && typeof /** @type {{prompt_tokens?: unknown}} */ (usage).prompt_tokens === "number") {
    return /** @type {{prompt_tokens: number}} */ (usage).prompt_tokens;
  }
  if (Array.isArray(row.tokens)) return row.tokens.length;
  return null;
}

/**
 * @param {unknown} props
 * @returns {number | null}
 */
function readContextSize(props) {
  if (!props || typeof props !== "object") return null;
  const row = /** @type {Record<string, unknown>} */ (props);
  if (typeof row.n_ctx === "number") return row.n_ctx;
  const settings = row.default_generation_settings;
  if (settings && typeof settings === "object" && typeof /** @type {{n_ctx?: unknown}} */ (settings).n_ctx === "number") {
    return /** @type {{n_ctx: number}} */ (settings).n_ctx;
  }
  return null;
}

class ApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {string} code
   */
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isContextError(err) {
  if (!(err instanceof Error)) return false;
  const code = err instanceof ApiError ? err.code : "";
  return code === "exceed_context_size_error" || /exceeds the available context size|context size/i.test(err.message);
}

/**
 * @param {string} msg
 */
function status(msg) {
  process.stderr.write(`\x1b[90m${msg}\x1b[0m\n`);
}

export class BonsaiChat {
  /**
   * @param {{ host: string, port: number, historyCap: number, sessionPath?: string, think?: number, perfil?: string, parallelTools?: boolean, timingsPath?: string | null }} opts
   */
  constructor(opts) {
    this.base = `http://${opts.host}:${opts.port}`;
    this.configuredCap = opts.historyCap;
    this.sessionPath = opts.sessionPath || SESSION_PATH;
    /** Razonamiento APAGADO por defecto: solo se enciende con un presupuesto explícito (tokens). */
    this.thinkBudget = Number.isInteger(opts.think) && /** @type {number} */ (opts.think) > 0 ? /** @type {number} */ (opts.think) : 0;
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
    /** @type {{cache_n?: number, prompt_n?: number, prompt_per_second?: number, predicted_n?: number, predicted_per_second?: number} | null} */
    this.lastTimings = null;
    this.nCtx = 0;
    this.model = "local";
    this.allowThinkingKw = true;
    this.tighten = 0;
    this.silent = false;
    this.actOnPc = false;
    /** @type {((event: {type: string, text?: string}) => void) | null} */
    this.push = null;
    /** @type {{ memory: string, folded: number, turns: Array<{role: "user"|"assistant"|"tool", content: string, toolCallId?: string}>, draft: string, files: Array<{rel: string, bytes: number}> }} */
    this.session = { memory: "", folded: 0, turns: [], draft: "", files: [] };
    /** @type {AbortController | null} */
    this.active = null;
    this.livePrompt = 0;
    this.liveGenerated = 0;
    this.usageTick = 0;
    /** @type {{prompt: number, generated: number, cap: number, nCtx: number, folded: number, turns: number, memory: number} | null} */
    this.usage = null;
    /** @type {string} */
    this.projectMap = "";
    /** Reglas del proyecto (BONSAI.md, AGENTS.md, .cursor/rules) que van al mensaje de sistema. */
    this.rules = "";
    /** Respuesta de /props del servidor (n_ctx, modalities…). */
    this.props = null;
    /** ¿El servidor tiene proyector de visión (mmproj)? Sin él no puede ver imágenes. */
    this.vision = false;
    /** Tope de tokens por imagen (--image-max-tokens); se reserva en la ventana al mandar imágenes. */
    this.imageMaxTokens = 1024;
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
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i];
      if (typeof msg.content !== "string") continue;
      if (toolCallId ? msg.role !== "tool" || msg.tool_call_id !== toolCallId : msg.role !== "user") continue;
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
    this.usage = {
      prompt,
      generated,
      cap: this.historyCap(),
      nCtx: this.nCtx,
      folded: this.session.folded,
      turns: this.session.turns.length,
      memory: estimateTokens(this.session.memory),
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

  historyCap() {
    // Reserva espacio para producir codigo. Con una ventana de 32K y un tope
    // de historial de 32K antes solo quedaban ~384 tokens para escribir el archivo.
    const respuesta = this.actOnPc && this.toolChoice !== "none"
      ? Math.min(AGENT_SLICE_TOKENS, Math.floor(this.nCtx / 2))
      : SLICE_TOKENS;
    const ceiling = this.nCtx > 0 ? Math.max(512, this.nCtx - Math.max(MIN_ROOM, respuesta) - 128) : this.configuredCap;
    return Math.max(512, Math.min(this.configuredCap, ceiling) - this.tighten);
  }

  loadSession() {
    if (!fs.existsSync(this.sessionPath)) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.sessionPath, "utf8"));
      const turns = Array.isArray(raw.turns) ? raw.turns : [];
      /** @type {Array<{role: "user"|"assistant"|"tool", content: string, toolCallId?: string, shown?: string, actions?: Array<{id: string, kind: string, title: string, state: string, detail?: string, code?: number}>}>} */
      const clean = [];
      for (const turn of turns) {
        if (!turn || (turn.role !== "user" && turn.role !== "assistant" && turn.role !== "tool")) continue;
        if (typeof turn.content !== "string") continue;
        const storedCalls = Array.isArray(turn.toolCalls) ? turn.toolCalls.filter((call) => call && typeof call.name === "string") : [];
        const storedActions = Array.isArray(turn.actions) ? turn.actions.filter((action) => action && typeof action.title === "string" && typeof action.kind === "string") : [];
        if (!turn.content && !storedCalls.length && !storedActions.length) continue;
        /** @type {{role: "user"|"assistant"|"tool", content: string, toolCallId?: string, shown?: string, actions?: Array<{id: string, kind: string, title: string, state: string, detail?: string, code?: number}>, toolCalls?: Array<{id: string, name: string, arguments: unknown}>}} */
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
      this.session = { memory, folded, turns: clean, draft: "", files };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Se APARTA el fichero ilegible antes de seguir con la sesión vacía: si no, el primer
      // saveSession lo pisa y la conversación del usuario desaparece del disco.
      try {
        fs.renameSync(this.sessionPath, `${this.sessionPath}.corrupto`);
      } catch {
        /* sin copia: al menos queda el aviso */
      }
      this.note(`sesión ilegible (${message}); la aparto como .corrupto y empiezo vacía`);
      this.session = { memory: "", folded: 0, turns: [], draft: "", files: [] };
    }
  }

  saveSession() {
    const payload = JSON.stringify(this.session);
    const tmp = `${this.sessionPath}.tmp`;
    fs.writeFileSync(tmp, payload);
    fs.renameSync(tmp, this.sessionPath);
  }

  /**
   * @param {string} pathName
   * @param {RequestInit} [init]
   * @returns {Promise<Response>}
   */
  async request(pathName, init) {
    let res;
    // Cancelar tambien debe interrumpir el conteo y los resumenes, no solo los
    // tokens. Antes podian dejar el turno ocupado durante minutos tras Detener.
    const signals = [init?.signal, this.active?.signal].filter(Boolean);
    const signal = signals.length ? AbortSignal.any(signals) : AbortSignal.timeout(15000);
    try {
      res = await fetch(`${this.base}${pathName}`, { ...init, signal });
    } catch (err) {
      if (signal.aborted) throw signal.reason;
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`No hay servidor en ${this.base}. Arranca con .\\scripts\\start-chat.ps1 (${message})`);
    }
    return res;
  }

  /**
   * @param {string} pathName
   * @param {Record<string, unknown>} body
   * @param {AbortSignal} [signal]
   * @returns {Promise<unknown>}
   */
  async postJson(pathName, body, signal) {
    const res = await this.request(pathName, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const text = await res.text();
    /** @type {unknown} */
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const row = data && typeof data === "object" ? /** @type {{error?: {message?: string, type?: string}}} */ (data) : {};
      const message = row.error?.message || text || res.statusText;
      const code = row.error?.type || "";
      throw new ApiError(message, res.status, code);
    }
    return data;
  }

  /**
   * Sin razonamiento salvo que se pida (`think`) y haya presupuesto. El presupuesto va en la raíz
   * de la petición: dentro de chat_template_kwargs el servidor lo ignora (KNOWN_ISSUES de prism-ml).
   * @param {boolean} [think]
   * @returns {Record<string, unknown>}
   */
  templateFields(think = false) {
    if (!this.allowThinkingKw) return {};
    if (think && this.thinkBudget > 0) {
      return {
        chat_template_kwargs: { enable_thinking: true, reasoning_effort: MODELO.razonamiento.esfuerzo },
        thinking_budget_tokens: this.thinkBudget,
      };
    }
    return { chat_template_kwargs: { enable_thinking: false } };
  }

  /**
   * Muestreo recomendado por el fabricante (modelo.json), en cada petición. El GGUF declara como
   * muestreo por defecto el del modo thinking (temp 1.0), que no es el de las respuestas sin razonar.
   * @param {boolean} [think]
   * @returns {Record<string, number>}
   */
  samplingFields(think = false) {
    const archivo = path.basename(String(this.props?.model_path || this.model || ""));
    const clave = Object.keys(MODELO.catalogo || {}).find((key) => MODELO.catalogo[key]?.archivo === archivo) || "";
    return muestreo(think && this.thinkBudget > 0 ? "razonar" : this.perfil, clave);
  }

  toolFields() {
    if (!this.actOnPc) return {};
    return { tools: PC_TOOLS, tool_choice: this.toolChoice, parallel_tool_calls: this.parallelTools };
  }

  /**
   * @param {Record<string, unknown>} body
   * @param {AbortSignal} [signal]
   * @returns {Promise<unknown>}
   */
  async postChat(body, signal) {
    try {
      return await this.postJson("/v1/chat/completions", { ...body, ...this.templateFields() }, signal);
    } catch (err) {
      if (this.allowThinkingKw && err instanceof Error && /enable_thinking/i.test(err.message)) {
        this.allowThinkingKw = false;
        return this.postJson("/v1/chat/completions", body, signal);
      }
      throw err;
    }
  }

  async connect() {
    const health = await this.request("/health");
    if (!health.ok) {
      throw new Error(`El servidor aún no está listo (${health.status}). Espera a que cargue el modelo.`);
    }
    const props = await (await this.request("/props")).json();
    /** Respuesta cruda de /props: de ahí salen n_ctx y si hay visión (mmproj). */
    this.props = props;
    let nCtx = readContextSize(props);
    if (!nCtx) {
      const slots = await (await this.request("/slots")).json();
      if (Array.isArray(slots) && typeof slots[0]?.n_ctx === "number") nCtx = slots[0].n_ctx;
    }
    if (!nCtx || nCtx < 512) throw new Error("No pude leer n_ctx del servidor");
    this.nCtx = nCtx;
    try {
      const models = await (await this.request("/v1/models")).json();
      const id = models?.data?.[0]?.id;
      if (typeof id === "string" && id) this.model = id;
    } catch {
      this.model = "local";
    }
  }

  /**
   * @param {Array<{role: string, content: string}>} messages
   * @param {boolean} continueFinal
   * @returns {Promise<number>}
   */
  async countPrompt(messages, continueFinal) {
    /** @type {Record<string, unknown>} */
    const body = { model: this.model, messages, ...this.templateFields(), ...this.toolFields() };
    if (continueFinal) {
      body.continue_final_message = true;
      body.add_generation_prompt = false;
    }
    try {
      const data = await this.postJson("/v1/chat/completions/input_tokens", body);
      const n = readTokenCount(data);
      if (n !== null) return n;
    } catch (err) {
      if (this.active?.signal.aborted || (err instanceof Error && err.name === "AbortError")) throw err;
      if (isContextError(err)) {
      // NO se devuelve un centinela gigante: ese valor acababa en `tighten` (línea 642) y
      // dejaba el tope de historial clavado en 512 tokens el resto del proceso. Un valor
      // un poco por encima del tope actual fuerza el mismo repliegue sin envenenar el estado.
      return this.historyCap() + 64;
    }
      if (!(err instanceof ApiError) || (err.status !== 404 && err.status !== 405)) {
        /* el conteo exacto es opcional; abajo hay respaldo */
      }
    }
    try {
      const rendered = await this.postJson("/apply-template", body);
      const prompt = rendered && typeof rendered === "object"
        ? /** @type {{prompt?: unknown}} */ (rendered).prompt
        : null;
      if (typeof prompt !== "string") return this.estimateMessages(messages);
      const tokens = await this.postJson("/tokenize", { content: prompt, add_special: false });
      const n = readTokenCount(tokens);
      return n ?? this.estimateMessages(messages);
    } catch (err) {
      if (this.active?.signal.aborted || (err instanceof Error && err.name === "AbortError")) throw err;
      if (isContextError(err)) {
      // NO se devuelve un centinela gigante: ese valor acababa en `tighten` (línea 642) y
      // dejaba el tope de historial clavado en 512 tokens el resto del proceso. Un valor
      // un poco por encima del tope actual fuerza el mismo repliegue sin envenenar el estado.
      return this.historyCap() + 64;
    }
      return this.estimateMessages(messages);
    }
  }

  /**
   * @param {Array<{role: string, content: string}>} messages
   * @returns {number}
   */
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

  /**
   * @param {string} prev
   * @param {Array<{role: string, content: string}>} turns
   * @param {string} extra
   * @param {number} maxWords
   * @returns {Promise<string>}
   */
  async summarize(prev, turns, extra, maxWords = 700) {
    const parts = [];
    for (const turn of turns) {
      // R = resultado de una herramienta: no lo dijo el usuario. Las llamadas del asistente
      // van descritas (sin el código): antes un turno de solo llamadas llegaba vacío.
      const label = turn.role === "tool" ? "R" : turn.role === "user" ? "U" : "A";
      const llamadas = turn.role === "assistant" ? describirLlamadas(/** @type {{toolCalls?: Array<{name?: string, arguments?: unknown}>}} */ (turn).toolCalls) : "";
      const texto = sampleText(turn.content, estimateTokens, 1600);
      parts.push(`${label}: ${[texto, llamadas].filter(Boolean).join(" ")}`);
    }
    if (extra) parts.push(`A ya escrito, no repetir: ${sampleText(extra, estimateTokens, 1600)}`);
    let blob = parts.join("\n");
    if (estimateTokens(blob) > 2400) blob = sampleText(blob, estimateTokens, 2400);
    const notes = takeHeadByTokens(prev, MEMORY_CAP_TOKENS, estimateTokens);
    if (!blob.trim()) {
      // Sin nada nuevo no hay nada que resumir… salvo que lo que se pida sea ACORTAR las
      // notas (maxWords pequeño, la ruta de `overflow === "memory"`): ahí sí hay que llamar
      // al modelo, y antes se devolvía `notes` sin llamarlo y el tope acababa recortando la
      // memoria a ~80 tokens en silencio.
      if (maxWords >= 700) return notes;
      blob = "(nada nuevo: acorta solo las notas)";
    }

    /** @type {Array<{role: string, content: string}>} */
    const messages = [
      {
        role: "system",
        content: maxWords === 700
          ? SUMMARY_RULES
          : `Acorta a notas densas. Lo importante primero. Omite apartados vacíos. Máximo ${maxWords} palabras.`,
      },
      {
        role: "user",
        content: `NOTAS ANTERIORES:\n${notes || "(ninguna)"}\n\nTRANSCRIPCIÓN (U = usuario, A = asistente, R = resultado de una herramienta):\n<<<\n${blob}\n>>>\n\nDevuelve solo las notas actualizadas, en viñetas. Sin código.`,
      },
    ];
    try {
      const data = await this.postChat({
        model: this.model,
        messages,
        temperature: 0.1,
        max_tokens: maxWords >= 600 ? 1600 : 400,
        stream: false,
      }, AbortSignal.timeout(180000));
      const content = data && typeof data === "object"
        ? /** @type {{choices?: Array<{message?: {content?: string}}>}} */ (data).choices?.[0]?.message?.content
        : "";
      const merged = typeof content === "string" ? limpiarNotas(content) : "";
      if (!merged) return this.fallbackNotes(notes, turns, extra);
      return takeHeadByTokens(merged, MEMORY_CAP_TOKENS, estimateTokens);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
      this.note("no pude resumir con el modelo; guardo un recorte");
      return this.fallbackNotes(notes, turns, extra);
    }
  }

  /**
   * @param {string} notes
   * @param {Array<{role: string, content: string}>} turns
   * @param {string} extra
   * @returns {string}
   */
  fallbackNotes(notes, turns, extra) {
    const bits = [];
    if (notes) bits.push(notes);
    for (const turn of turns) {
      // R = resultado de una herramienta: no lo dijo el usuario.
      const label = turn.role === "tool" ? "R" : turn.role === "user" ? "U" : "A";
      const llamadas = turn.role === "assistant" ? describirLlamadas(/** @type {{toolCalls?: Array<{name?: string, arguments?: unknown}>}} */ (turn).toolCalls) : "";
      bits.push(`${label}: ${[limpiarNotas(turn.content).replace(/\s+/g, " ").slice(0, 180), llamadas].filter(Boolean).join(" ")}`);
    }
    if (extra) {
      const flat = extra.replace(/\s+/g, " ");
      bits.push(`Ya dicho: ${flat.slice(0, 220)} … ${flat.slice(-160)}`);
    }
    return takeHeadByTokens(bits.join("\n"), MEMORY_CAP_TOKENS, estimateTokens);
  }

  /**
   * @returns {Promise<{ messages: Array<{role: string, content: string}>, promptTokens: number, changed: boolean, anchorClipped: boolean }>}
   */
  /**
   * @param {{role: string, content: string, actions?: Array<{id?: string, kind: string, title: string, state?: string}>, toolCalls?: Array<{id?: string, name: string, arguments?: unknown}>, toolCallId?: string}} turn
   * @returns {{role: string, content: string, toolCalls?: Array<{id?: string, name: string, arguments?: unknown}>, toolCallId?: string}}
   */
  modelTurn(turn) {
    let content = typeof turn.content === "string" ? turn.content : "";
    let role = turn.role;
    if (role === "tool") return { role, content, toolCallId: typeof turn.toolCallId === "string" ? turn.toolCallId : "" };
    if (role === "assistant") content = stripFakeToolText(content);
    if (/^sin respuesta\.?$/i.test(content.trim())) content = "";
    /** @type {Array<{id?: string, name: string, arguments?: unknown}>} */
    let toolCalls = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
    if (role === "assistant" && !toolCalls.length && !content && Array.isArray(turn.actions)) {
      toolCalls = [];
      const notes = [];
      for (const action of turn.actions) {
        if (!action || action.state === "denied") continue;
        if (action.kind === "cmd") toolCalls.push({ id: action.id, name: "ejecutar", arguments: { comando: action.title } });
        else if (action.kind === "search") toolCalls.push({ id: action.id, name: "buscar", arguments: { consulta: action.title } });
        else if (action.kind === "read") toolCalls.push({ id: action.id, name: "leer", arguments: { ruta: action.title } });
        else if (action.kind === "index") toolCalls.push({ id: action.id, name: "indice", arguments: { carpeta: action.title === "carpeta" ? "" : action.title } });
        else if (action.kind === "write") notes.push(`archivo ${action.title}`);
      }
      if (!toolCalls.length && notes.length) content = notes.join("\n");
    }
    return toolCalls.length ? { role, content, toolCalls } : { role, content };
  }

  /**
   * Instrucciones de agente para el mensaje de sistema: solo cuando hay herramientas.
   * @returns {string}
   */
  agentRules() {
    return this.actOnPc ? agentText({ python: this.pythonCmd }) : "";
  }

  /**
   * El pedido vigente del usuario (el último mensaje suyo que no es un resultado ni un
   * empujón interno), listo para fijarlo tras el sistema si el pliegue lo deja fuera.
   * `index` es relativo a los turnos sin plegar (negativo si ya está en las notas).
   * @returns {{index: number, content: string} | null}
   */
  pinnedRequest() {
    const turns = this.session.turns;
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const turn = turns[i];
      if (turn.role !== "user" || turnoInterno(turn)) continue;
      const texto = clipMiddle(String(turn.content || ""), 1500, estimateTokens);
      return { index: i - this.session.folded, content: `Pedido original (lo hecho hasta ahora está resumido en las notas):\n${texto}` };
    }
    return null;
  }

  async packHistory() {
    let clipAnchor = false;
    let changed = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const active = this.session.turns.slice(this.session.folded).map((turn) => this.modelTurn(turn));
      if (active.length === 0) throw new Error("No hay pregunta para enviar");
      const plan = selectContext({
        turns: active,
        memory: this.session.memory,
        historyCap: this.historyCap(),
        countText: estimateTokens,
        rules: this.rules,
        agent: this.agentRules(),
        pinned: this.pinnedRequest(),
        clipAnchor,
      });
      if (plan.dropCount > 0) {
        const folding = active.slice(0, plan.dropCount);
        this.session.memory = await this.summarize(this.session.memory, folding, "");
        this.session.folded += plan.dropCount;
        changed = true;
        clipAnchor = false;
        continue;
      }
      if (plan.overflow === "memory") {
        const before = this.session.memory;
        const shrunk = await this.summarize(before, [], "", 80);
        this.session.memory = shrunk.length < before.length
          ? shrunk
          : takeHeadByTokens(before, 80, estimateTokens);
        changed = true;
        continue;
      }
      if (plan.overflow === "anchor") {
        clipAnchor = true;
        continue;
      }
      if (!plan.messages) throw new Error("No pude armar el historial");
      const real = await this.countPrompt(plan.messages, false);
      if (real <= this.historyCap() || (plan.anchorClipped && real < this.nCtx - MIN_ROOM)) {
        return { messages: plan.messages, promptTokens: real, changed, anchorClipped: plan.anchorClipped };
      }
      this.tighten += real - this.historyCap() + 64;
      changed = true;
    }
    this.session.folded = Math.max(0, this.session.turns.length - 1);
    this.session.memory = takeHeadByTokens(this.session.memory, 80, estimateTokens);
    this.tighten = 0;
    const last = this.modelTurn(this.session.turns[this.session.turns.length - 1]);
    const solo = selectContext({
      turns: [{ ...last, content: takeHeadByTokens(last.content, Math.max(256, this.historyCap() - 400), estimateTokens) }],
      memory: this.session.memory,
      historyCap: this.historyCap(),
      countText: estimateTokens,
      rules: this.rules,
      agent: this.agentRules(),
      pinned: last.role === "user" && !turnoInterno(last) ? null : { ...(this.pinnedRequest() || { content: "" }), index: -1 },
      clipAnchor: true,
    });
    if (!solo.messages) throw new Error("No pude meter el historial en el tope de contexto");
    return { messages: solo.messages, promptTokens: estimateTokens(solo.messages.map((msg) => msg.content).join("\n")), changed: true, anchorClipped: true };
  }

  /**
   * @param {Array<{role: string, content: string}>} messages
   * @param {number} maxTokens
   * @param {boolean} continueFinal
   * @param {AbortSignal} signal
   * @returns {Promise<{ chunk: string, reason: string, toolCalls: Array<{id: string, name: string, arguments: string}>, timings: Record<string, number> | null, usage: Record<string, number> | null }>}
   */
  async streamSlice(messages, maxTokens, continueFinal, signal) {
    // El razonamiento (si está encendido) solo acompaña a una generación nueva: una
    // continuación ya viene con el bloque de pensamiento cerrado en la plantilla.
    const think = !continueFinal && this.pensarEsteSalto !== false;
    /** @type {Record<string, unknown>} */
    const body = {
      model: this.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      cache_prompt: true,
      max_tokens: maxTokens,
      ...this.samplingFields(think),
      ...this.templateFields(think),
      ...this.toolFields(),
    };
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
      throw new ApiError(message, res.status, data.error?.type || "");
    }
    if (!res.body) throw new Error("El servidor no devolvió un stream");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let chunk = "";
    let reason = "stop";
    let thinking = false;
    /** @type {Record<string, number> | null} */
    let timings = null;
    /** @type {Record<string, number> | null} */
    let usage = null;
    /** @type {Map<number, {id: string, name: string, arguments: string}>} */
    const calls = new Map();
    let ultimoProgreso = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl = buf.indexOf("\n");
        while (nl !== -1) {
          const line = buf.slice(0, nl).replace(/\r$/, "").trim();
          buf = buf.slice(nl + 1);
          nl = buf.indexOf("\n");
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          /** @type {{choices?: Array<{delta?: {content?: string, reasoning_content?: string}, finish_reason?: string | null}>, error?: {message?: string, type?: string}, timings?: Record<string, number>, usage?: Record<string, number>}} */
          let json;
          try {
            json = JSON.parse(payload);
          } catch {
            continue;
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
          const token = delta.content ?? "";
          if (token) {
            chunk += token;
            this.emitToken(token);
          }
          if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
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
        }
      }
    } catch (err) {
      if (err instanceof Error && !("partial" in err)) {
        Object.defineProperty(err, "partial", { value: chunk });
      }
      throw err;
    }
    // Un trozo de continuación puede venir SIN `name` (solo `arguments`): si se tirara aquí,
    // la llamada se quedaría cortada para siempre. Vale con que traiga nombre o argumentos.
    return { chunk, reason, toolCalls: [...calls.values()].filter((call) => call.name || call.arguments), timings, usage };
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
    const round = (n) => (typeof n === "number" ? Math.round(n * 10) / 10 : undefined);
    const row = {
      t: new Date().toISOString(),
      cache_n: timings.cache_n,
      prompt_n: timings.prompt_n,
      prompt_ps: round(timings.prompt_per_second),
      predicted_n: timings.predicted_n,
      predicted_ps: round(timings.predicted_per_second),
      prompt_tokens: usage?.prompt_tokens,
      n_ctx: this.nCtx,
      continued,
    };
    this.emit({ type: "speed", ...row });
    if (!this.timingsPath) return;
    try {
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
    const text = String(userText || "").trim();
    const resultados = Array.isArray(opts.resultados) ? opts.resultados.filter((r) => r && typeof r.toolCallId === "string") : [];
    // Las imágenes de herramientas se adjuntan solo a SU resultado y solo en este salto.
    // No se guardan data URLs en el historial ni se atribuyen al pedido del usuario.
    const adjuntar = (messages) => {
      let total = imagenes.length;
      this.aplicarImagenes(messages, imagenes);
      for (const r of resultados) {
        if (this.vision && Array.isArray(r.imagenes) && r.imagenes.length) {
          this.aplicarImagenes(messages, r.imagenes, r.toolCallId);
          total += r.imagenes.length;
        }
      }
      return this.vision ? total * this.imageMaxTokens : 0;
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
    let sliceCap = this.actOnPc && this.toolChoice !== "none" ? AGENT_SLICE_TOKENS : SLICE_TOKENS;
    let escalados = 0;
    /**
     * ¿Los `arguments` de esta llamada llegaron cortados? (JSON que no cierra)
     * @param {{arguments?: string}} call
     * @returns {boolean}
     */
    const callIncompleta = (call) => {
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
        // Con razonamiento (opt-in), la primera tanda lleva además el presupuesto para pensar.
        const thinkRoom = slice === 0 && this.thinkBudget > 0 && this.pensarEsteSalto !== false ? this.thinkBudget : 0;
        const maxTokens = Math.min(sliceCap + thinkRoom, room);
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
    if (spoken.trim() || toolCalls.length) {
      /** @type {{role: "assistant", content: string, toolCalls?: Array<{id: string, name: string, arguments: string}>, cortadas?: string[]}} */
      const turn = { role: "assistant", content: spoken };
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
