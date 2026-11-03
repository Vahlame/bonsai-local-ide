/**
 * Política de prompt: razonamiento, muestreo y campos de herramientas. Recibe el
 * chat para leer su estado; no conoce HTTP ni el transporte.
 */
import path from "node:path";
import { MODELO, muestreo } from "./modelo.mjs";
import { CODER_CONFIG, CODER_TOOLS } from "./coder-harness.mjs";
import { PC_TOOLS } from "./tool-registry.mjs";

export class PromptPolicy {
  /** @param {Record<string, any>} chat */
  constructor(chat) {
    this.chat = chat;
  }

  /**
   * Sin razonamiento salvo que se pida (`think`) y haya presupuesto. El presupuesto va en la raíz
   * de la petición: dentro de chat_template_kwargs el servidor lo ignora (KNOWN_ISSUES de prism-ml).
   * @param {boolean} [think]
   * @returns {Record<string, unknown>}
   */
  templateFields(think = false) {
    if (!this.chat.allowThinkingKw) return {};
    const caps = this.chat.props?.chat_template_caps || {};
    // GPT-OSS/Harmony no usa enable_thinking: su plantilla recibe reasoning_effort.
    // Enviar enable_thinking a esta plantilla es ruido (y el servidor lo ignora).
    // Se limita al modelo GPT-OSS para no cambiar la plantilla de otros modelos.
    const esGptOss = /gpt-oss/i.test(`${this.chat.model || ""} ${this.chat.props?.model_path || ""}`);
    const harmony = esGptOss && caps.supports_reasoning_effort === true && Array.isArray(caps.reasoning_effort_levels);
    if (think && this.chat.thinkBudget !== 0) {
      const esfuerzo = this.chat.razonamientoEsfuerzo || MODELO.razonamiento.esfuerzo;
      return {
        chat_template_kwargs: harmony
          ? { reasoning_effort: esfuerzo }
          : { enable_thinking: true, reasoning_effort: esfuerzo },
        thinking_budget_tokens: this.chat.effectiveThinkingBudget(),
      };
    }
    return harmony
      ? { chat_template_kwargs: { reasoning_effort: "minimal" }, thinking_budget_tokens: 0 }
      : { chat_template_kwargs: { enable_thinking: false } };
  }

  thinkingLimit() {
    const config = this.chat.coderTask?.config || this.chat.coderConfig || CODER_CONFIG;
    const output = this.chat.reservaSalida();
    // Keep two thirds for small profiles, up to 2k for an edit/answer on larger ones.
    return Math.min(config.thinkingTokens ?? 512, Math.max(0, output - Math.min(2048, Math.ceil(output * 2 / 3))));
  }

  effectiveThinkingBudget() {
    if (this.chat.thinkBudget < 0) return -1;
    const taskCap = this.chat.consultation || this.chat.faseSalto === "charla" ? 256
      : this.chat.coderTask?.state.phase === "REPAIR" ? 4096 : 1024;
    const editLimit = this.chat.agentProfile === "small-local-coder" ? this.chat.thinkingLimit() : Math.max(0, this.chat.reservaSalida() - 256);
    return Math.max(0, Math.min(this.chat.thinkBudget, taskCap, editLimit));
  }

  /**
   * Muestreo recomendado por el fabricante (modelo.json), en cada petición. El GGUF declara como
   * muestreo por defecto el del modo thinking (temp 1.0), que no es el de las respuestas sin razonar.
   * @param {boolean} [think]
   * @returns {Record<string, number>}
   */
  samplingFields(think = false) {
    const archivo = path.basename(String(this.chat.props?.model_path || this.chat.model || ""));
    const clave = Object.keys(MODELO.catalogo || {}).find((key) => MODELO.catalogo[key]?.archivo === archivo) || "";
    return muestreo(think && this.chat.thinkBudget !== 0 ? "razonar" : this.chat.perfil, clave);
  }

  toolFields(choiceOverride, incluirTools = true) {
    if (this.chat.consultation || (this.chat.faseSalto === "final" && this.chat.toolChoice === "none")) return { tool_choice: "none" };
    if (!this.chat.actOnPc) return {};
    const tools = this.chat.agentProfile === "small-local-coder" ? CODER_TOOLS : PC_TOOLS;
    const choice = choiceOverride !== undefined
      ? choiceOverride
      : (this.chat.toolChoice === "auto" && this.chat.coderTask?.state.phase === "PLAN"
        ? { type: "function", function: { name: "plan" } }
        : this.chat.toolChoice);
    return {
      ...(incluirTools ? { tools } : {}),
      tool_choice: choice,
      parallel_tool_calls: this.chat.parallelTools,
    };
  }

  /** ¿Este modelo puede devolver tool calls como JSON de texto si se las pide así? */
  puedeFallbackTexto() {
    return /gpt-oss/i.test(`${this.chat.model || ""} ${this.chat.props?.model_path || ""}`);
  }

  /**
   * Si llama.cpp rechaza la salida nativa con `peg-native`, se reintenta SIN tools
   * nativas: el modelo recibe el catálogo como texto y devuelve JSON puro, que
   * `llamadasCrudas` convierte en las mismas llamadas. Evita que un parser roto
   * tumbe el turno entero.
   * @param {Array<Record<string, any>>} messages
   * @returns {Array<Record<string, any>>}
   */
  mensajesSinParser(messages) {
    const tools = this.chat.toolFields().tools || [];
    const catalogo = tools.map((t) => ({
      name: t.function?.name,
      description: t.function?.description,
      parameters: t.function?.parameters,
    }));
    const instruccion = `\n\nREINTENTO SIN PARSER NATIVO (llama.cpp peg-native).\nNo hay herramientas nativas en esta petición. Si necesitas una herramienta, responde SOLO con un objeto JSON con esta forma: {"name":"<herramienta>","arguments":{...}}. El objeto debe tener SIEMPRE las claves "name" y "arguments"; nunca devuelvas solo los argumentos. No uses markdown, no expliques y no escribas texto antes ni después. Para varias acciones, haz una sola llamada y espera el resultado. Ejemplo exacto: {"name":"archivo","arguments":{"ruta":"a.txt","contenido":"uno"}}\nHerramientas disponibles:\n${JSON.stringify(catalogo)}`;
    const copia = messages.map((m) => ({ ...m }));
    if (!copia.length || !["system", "developer"].includes(copia[0].role)) {
      copia.unshift({ role: "system", content: instruccion.trim() });
      return copia;
    }
    copia[0] = { ...copia[0], content: `${copia[0].content || ""}${instruccion}` };
    return copia;
  }

  /** @returns {string} guía compacta con ejemplos para GPT-OSS. */
  guiaHerramientas() {
    const tools = this.chat.agentProfile === "small-local-coder" ? CODER_TOOLS : PC_TOOLS;
    const ejemplos = {
      archivo: '{"ruta":"src/app.js","contenido":"..."}',
      leer: '{"ruta":"src/app.js","desde":1,"hasta":80}',
      reemplazar: '{"ruta":"src/app.js","buscar":"texto viejo","poner":"texto nuevo"}',
      buscar_codigo: '{"consulta":"TODO","ruta":"src"}',
      buscar_estructural: '{"patron":"console.log($$$ARGS)","lenguaje":"js"}',
      ejecutar: '{"comando":"npm test"}',
      escribir_partes: '{"ruta":"src/app.js","accion":"iniciar","contenido":"..."}',
      indice: '{"carpeta":"src"}',
      simbolo: '{"nombre":"createApp"}',
      plan: '{"pasos":["inspeccionar","editar","probar"]}',
      borrar: '{"ruta":"archivo.txt"}',
      mover: '{"origen":"a.txt","destino":"b.txt"}',
      git_diff: '{"ruta":"src/app.js"}',
    };
    const lineas = tools.map((t) => {
      const f = t.function || {};
      const req = (f.parameters?.required || []).join(", ") || "sin argumentos obligatorios";
      return `- ${f.name}: ${f.description} Argumentos: ${req}. Ejemplo: ${ejemplos[f.name] || "{}"}`;
    });
    return `GUÍA DE HERRAMIENTAS PARA GPT-OSS:\nCada llamada va en el canal nativo; no escribas la llamada como texto. Puedes hacer varias llamadas independientes en un turno y esperar sus resultados.\n${lineas.join("\n")}`;
  }

  /**
   * @param {Array<Record<string, any>>} messages
   * @returns {Array<Record<string, any>>}
   */
  mensajesReintentoNativo(messages) {
    const instruccion = "\n\nREINTENTO OBLIGATORIO: la petición anterior fue rechazada por el parser nativo de llama.cpp. Haz EXACTAMENTE UNA tool call y nada más. No escribas texto antes ni después y no emitas varias tool calls en el mismo mensaje.";
    const copia = messages.map((m) => ({ ...m }));
    if (!copia.length || !["system", "developer"].includes(copia[0].role)) {
      copia.unshift({ role: "system", content: instruccion.trim() });
      return copia;
    }
    copia[0] = { ...copia[0], content: `${copia[0].content || ""}${instruccion}` };
    return copia;
  }

  /**
   * @param {Array<{role: string, content: string}>} messages
   * @returns {number}
   */
}
