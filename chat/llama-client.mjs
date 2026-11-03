/**
 * Cliente HTTP de llama-server. Contiene el transporte, los errores de API y las
 * operaciones de conexión/conteo de tokens. `BonsaiChat` hereda de esta clase y
 * aporta el prompt, el muestreo y las herramientas.
 */
import { estimateTokens } from "./context.mjs";

/** Error de la API con el estado HTTP y el código del servidor. */
export class ApiError extends Error {
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

/** @param {unknown} err @returns {boolean} */
export function isContextError(err) {
  if (!(err instanceof Error)) return false;
  const code = err instanceof ApiError ? err.code : "";
  return code === "exceed_context_size_error" || /exceeds the available context size|context size/i.test(err.message);
}

/**
 * @param {unknown} data
 * @returns {number | null}
 */
export function readTokenCount(data) {
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
export function readContextSize(props) {
  if (!props || typeof props !== "object") return null;
  const row = /** @type {Record<string, unknown>} */ (props);
  if (typeof row.n_ctx === "number") return row.n_ctx;
  const settings = row.default_generation_settings;
  if (settings && typeof settings === "object" && typeof /** @type {{n_ctx?: unknown}} */ (settings).n_ctx === "number") {
    return /** @type {{n_ctx: number}} */ (settings).n_ctx;
  }
  return null;
}

export class LlamaClient {
  /**
   * @param {{host: string, port: number}} opts
   */
  constructor(opts) {
    this.base = `http://${opts.host}:${opts.port}`;
    /** @type {AbortController | null} */
    this.active = null;
    this.model = "local";
    /** Respuesta de /props del servidor (n_ctx, modalities…). */
    this.props = null;
    this.nCtx = 0;
    this.allowThinkingKw = true;
    /** ¿El servidor tiene proyector de visión (mmproj)? */
    this.vision = false;
    /** Caché acotada del conteo exacto de prompt. */
    this.promptCountCache = new Map();
  }

  /**
   * @param {string} pathName
   * @param {RequestInit} [init]
   * @returns {Promise<Response>}
   */
  async request(pathName, init) {
    const signals = [init?.signal, this.active?.signal].filter(Boolean);
    const signal = signals.length ? AbortSignal.any(signals) : AbortSignal.timeout(15000);
    let res;
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
   * @param {Record<string, unknown>} body
   * @param {AbortSignal} [signal]
   * @returns {Promise<unknown>}
   */
  async postChat(body, signal) {
    try {
      const fields = this.templateFields(this.thinkBudget > 0);
      if (typeof fields.thinking_budget_tokens === "number" && Number.isFinite(Number(body.max_tokens))) {
        fields.thinking_budget_tokens = Math.min(fields.thinking_budget_tokens, Math.max(1, Math.floor(Number(body.max_tokens) / 3)));
      }
      return await this.postJson("/v1/chat/completions", { ...body, ...fields }, signal);
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
    const body = { model: this.model, messages, ...this.templateFields(this.thinkBudget > 0), ...this.toolFields() };
    const fallbackCount = () => {
      this.lastCountMethod = "estimación: conteo del servidor no disponible";
      this.note("No se pudo contar con el tokenizer del servidor; se usa una estimación con margen.");
      return Math.ceil((this.estimateMessages(messages) + estimateTokens(JSON.stringify(this.toolFields()))) * 1.15);
    };
    if (continueFinal) {
      body.continue_final_message = true;
      body.add_generation_prompt = false;
    }
    // Caché acotada: incluye modelo, plantilla y herramientas, así que un cambio la invalida.
    const countKey = this.agentProfile === "small-local-coder" ? JSON.stringify(body) : "";
    if (countKey && this.promptCountCache.has(countKey)) {
      this.lastCountMethod = "conteo exacto cacheado";
      return this.promptCountCache.get(countKey);
    }
    const remember = (n) => {
      if (countKey) {
        this.promptCountCache.set(countKey, n);
        while (this.promptCountCache.size > 8) this.promptCountCache.delete(this.promptCountCache.keys().next().value);
      }
      return n;
    };
    try {
      const data = await this.postJson("/v1/chat/completions/input_tokens", body);
      const n = readTokenCount(data);
      if (n !== null) {
        this.lastCountMethod = "llama-server input_tokens";
        return remember(n);
      }
    } catch (err) {
      if (this.active?.signal.aborted || (err instanceof Error && err.name === "AbortError")) throw err;
      if (isContextError(err)) {
        // Un valor un poco por encima del tope fuerza el repliegue sin envenenar el estado.
        this.lastCountMethod = "límite inferior: el servidor rechazó el tamaño del contexto";
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
      if (typeof prompt !== "string") return fallbackCount();
      const tokens = await this.postJson("/tokenize", { content: prompt, add_special: false });
      const n = readTokenCount(tokens);
      if (n !== null) {
        this.lastCountMethod = "llama-server apply-template/tokenize";
        return remember(n);
      }
      return fallbackCount();
    } catch (err) {
      if (this.active?.signal.aborted || (err instanceof Error && err.name === "AbortError")) throw err;
      if (isContextError(err)) {
        this.lastCountMethod = "límite inferior: el servidor rechazó el tamaño del contexto";
        return this.historyCap() + 64;
      }
      return fallbackCount();
    }
  }
}
