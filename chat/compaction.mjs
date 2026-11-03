/**
 * Compactación del historial: resumen con el modelo, notas de respaldo y empaquetado
 * para el perfil legacy y para el CoderTask. Recibe el chat por contexto.
 */
import {
  agentText,
  describirLlamadas,
  estimateTokens,
  fitDraft,
  isRepetition,
  limpiarNotas,
  notaDeResultado,
  sampleText,
  selectContext,
  takeHeadByTokens,
  takeTailByTokens,
  turnoInterno,
} from "./context.mjs";
import { stripFakeToolText } from "./actions.mjs";
import { CODER_SYSTEM } from "./coder-harness.mjs";
import { contextoEntorno } from "./entorno.mjs";

const SUMMARY_RULES =
  "Eres el compactador de contexto de una sesion de programacion (estilo Claude/DeepSeek). " +
  "Devuelve SOLO vinetas, agrupadas con estos encabezados cuando tengan contenido: " +
  "OBJETIVO, DECISIONES, ARCHIVOS (ruta + para que), COMANDOS Y PRUEBAS (resultado), " +
  "ERRORES ABIERTOS, PENDIENTE, HECHOS CLAVE. " +
  "Conserva literales los nombres de archivos, funciones, clases, rutas, comandos y numeros. " +
  "No inventes, no escribas codigo, no repitas lo obvio, no sigas la tarea y no des nada por cumplido. " +
  "Fusiona con las notas anteriores sin duplicar. Lo importante primero. Maximo 700 palabras.";

const HUELLA_FALLO = /\b(?:error(?:es)?|fall(?:a|ó|o|an|as|ando|id[oa])|fail(?:ed|s|ing)?|traceback|exception|pendiente|roto|rota|no (?:pasa|funciona|compila|termina)|no se pudo)/i;

export class Compactor {
  /** @param {Record<string, any>} chat */
  constructor(chat) {
    this.chat = chat;
  }

  /**
   * @param {string} prev
   * @param {Array<{role: string, content: string}>} turns
   * @param {string} extra
   * @param {number} maxWords
   * @returns {Promise<string>}
   */
  async summarize(prev, turns, extra, maxWords = 700) {
    const cap = this.chat.memoryCapTokens();
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
    if (estimateTokens(prev) > cap) throw new Error("La memoria anterior supera el límite de resumen; se conserva íntegra en la sesión.");
    const notes = prev;
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
    const summaryStart = Date.now();
    try {
      const data = await this.chat.postChat({
        model: this.chat.model,
        messages,
        temperature: 0.1,
        max_tokens: maxWords >= 600 ? 1600 : 400,
        stream: false,
      }, AbortSignal.timeout(180000));
      if (this.chat.summaryMetrics) {
        this.chat.summaryMetrics.calls++;
        const usage = data?.usage;
        if (Number.isFinite(usage?.prompt_tokens)) this.chat.summaryMetrics.inputTokens += usage.prompt_tokens; else this.chat.summaryMetrics.usageUnavailable = true;
        if (Number.isFinite(usage?.completion_tokens)) this.chat.summaryMetrics.outputTokens += usage.completion_tokens; else this.chat.summaryMetrics.usageUnavailable = true;
      }
      const content = data && typeof data === "object"
        ? /** @type {{choices?: Array<{message?: {content?: string}}>}} */ (data).choices?.[0]?.message?.content
        : "";
      const merged = typeof content === "string" ? limpiarNotas(content) : "";
      if (!merged) throw new Error("El modelo devolvió un resumen vacío o inválido");
      if (estimateTokens(merged) > cap && this.chat.summaryMetrics) this.chat.summaryMetrics.truncated = true;
      return takeHeadByTokens(merged, cap, estimateTokens);
    } catch (err) {
      if (this.chat.active?.signal.aborted || (err instanceof Error && err.name === "AbortError")) throw err;
      throw new Error(`No se pudo compactar la conversación; se conserva el historial: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (this.chat.summaryMetrics) this.chat.summaryMetrics.durationMs += Date.now() - summaryStart;
    }
  }

  /**
   * @param {string} notes
   * @param {Array<{role: string, content: string}>} turns
   * @param {string} extra
   * @returns {string}
   */
  fallbackNotes(notes, turns, extra) {
    // Hallazgo 21: la memoria de respaldo no puede quedarse con lo viejo y perder lo nuevo.
    // Primero se aparta espacio para los hechos recientes (fallos abiertos y verificaciones
    // pendientes primero) y solo con lo que sobra se recortan las notas antiguas.
    const cap = this.chat.memoryCapTokens();
    /** @type {string[]} */
    const recientes = [];
    for (const turn of turns) {
      // R = resultado de una herramienta: no lo dijo el usuario.
      const label = turn.role === "tool" ? "R" : turn.role === "user" ? "U" : "A";
      const llamadas = turn.role === "assistant" ? describirLlamadas(/** @type {{toolCalls?: Array<{name?: string, arguments?: unknown}>}} */ (turn).toolCalls) : "";
      const texto = limpiarNotas(turn.content).replace(/\s+/g, " ").slice(0, 180);
      const linea = `${label}: ${[texto, llamadas].filter(Boolean).join(" ")}`.trim();
      if (linea.length > 3) recientes.push(linea);
    }
    if (extra) {
      const flat = extra.replace(/\s+/g, " ");
      recientes.push(`Ya dicho: ${flat.slice(0, 220)} … ${flat.slice(-160)}`);
    }
    const fallos = recientes.filter((linea) => HUELLA_FALLO.test(linea));
    const normales = recientes.filter((linea) => !HUELLA_FALLO.test(linea));
    // Reserva para lo nuevo: ~45 % del tope. Los fallos van delante y completos; de los
    // turnos normales se conservan los más recientes (el final del bloque plegado).
    const reservaNueva = Math.max(320, Math.floor(cap * 0.45));
    const parteFallos = takeHeadByTokens(fallos.join("\n"), Math.max(96, Math.floor(reservaNueva * 0.7)), estimateTokens);
    const parteNormal = takeTailByTokens(normales.join("\n"), Math.max(64, reservaNueva - estimateTokens(parteFallos)), estimateTokens);
    const nuevas = [parteFallos, parteNormal].filter(Boolean).join("\n");
    if (!nuevas && !notes) return "";
    const tokensNuevas = estimateTokens(nuevas);
    const presupuestoViejas = Math.max(0, cap - tokensNuevas - 2);
    const viejas = presupuestoViejas > 0 && notes ? takeHeadByTokens(notes, presupuestoViejas, estimateTokens) : "";
    let texto = [viejas, nuevas].filter(Boolean).join("\n");
    // Red de seguridad: si aun así no cabe, se recorta MÁS lo viejo, nunca lo nuevo.
    if (estimateTokens(texto) > cap && viejas) {
      const sobra = Math.max(0, cap - tokensNuevas - 1);
      texto = [takeHeadByTokens(viejas, sobra, estimateTokens), nuevas].filter(Boolean).join("\n");
    }
    return texto;
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
    if (this.chat.consultation) return "Responde a la consulta usando el texto y las imágenes adjuntas. No llames herramientas ni modifiques archivos. Sigue el formato solicitado por el usuario.";
    return this.chat.actOnPc ? agentText({ python: this.chat.pythonCmd, ...this.chat.entornoAgente }) : "";
  }

  /**
   * El pedido vigente del usuario (el último mensaje suyo que no es un resultado ni un
   * empujón interno), listo para fijarlo tras el sistema si el pliegue lo deja fuera.
   * `index` es relativo a los turnos sin plegar (negativo si ya está en las notas).
   * @returns {{index: number, content: string} | null}
   */
  pinnedRequest() {
    const turns = this.chat.session.turns;
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const turn = turns[i];
      if (turn.role !== "user" || turnoInterno(turn)) continue;
      const texto = String(turn.content || "");
      return { index: i - this.chat.session.folded, content: `Pedido original (lo hecho hasta ahora está resumido en las notas):\n${texto}` };
    }
    return null;
  }

  async packHistory() {
    if (this.chat.agentProfile === "small-local-coder" && this.chat.coderTask) return this.chat.packCoderHistory();
    const previousMemory = this.chat.session.memory, previousFolded = this.chat.session.folded;
    const inicioCompactacion = Date.now();
    this.chat.summaryMetrics = { calls:0, inputTokens:0, outputTokens:0, durationMs:0, usageUnavailable:false };
    let tokensAntes = null, gruposPlegados = 0;
    try {
    // Primero probar el historial completo con el tokenizer real. La estimación por
    // caracteres puede sobrestimar código y plegar una solicitud que sí cabe.
    const all = this.chat.session.turns.slice(this.chat.session.folded).map(turn => this.chat.modelTurn(turn));
    if (all.length) {
      const candidate = selectContext({ turns:all, memory:this.chat.session.memory, historyCap:Number.MAX_SAFE_INTEGER, countText:estimateTokens, rules:this.chat.rules, agent:this.chat.agentRules(), globalMemory:this.chat.globalMemory, pinned:this.chat.pinnedRequest() });
      if (candidate.messages) {
        const actual = await this.chat.countPrompt(candidate.messages, false);
        tokensAntes = actual;
        if (actual <= this.chat.historyCap()) return { messages:candidate.messages, promptTokens:actual, changed:false, anchorClipped:false };
      }
    }
    let clipAnchor = false;
    let changed = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const active = this.chat.session.turns.slice(this.chat.session.folded).map((turn) => this.chat.modelTurn(turn));
      if (active.length === 0) throw new Error("No hay pregunta para enviar");
      const plan = selectContext({
        turns: active,
        memory: this.chat.session.memory,
        historyCap: this.chat.historyCap(),
        countText: estimateTokens,
        rules: this.chat.rules,
        agent: this.chat.agentRules(),
        globalMemory: this.chat.globalMemory,
        pinned: this.chat.pinnedRequest(),
        clipAnchor,
        foldTo: 0.9,
      });
      if (plan.dropCount > 0) {
        const folding = active.slice(0, plan.dropCount);
        this.chat.session.memory = await this.chat.summarize(this.chat.session.memory, folding, "");
        this.chat.session.folded += plan.dropCount;
        gruposPlegados += plan.dropCount;
        changed = true;
        clipAnchor = false;
        continue;
      }
      if (plan.overflow === "memory") {
        const before = this.chat.session.memory;
        const target = Math.max(256, Math.floor(estimateTokens(before) / 2));
        const shrunk = await this.chat.summarize(before, [], "", target);
        if (shrunk.length >= before.length) throw new Error("El resumen no redujo la memoria; se conserva el estado anterior.");
        this.chat.session.memory = shrunk;
        this.chat.note(`Memoria compactada por falta de espacio: objetivo ${target} tokens.`);
        changed = true;
        continue;
      }
      if (plan.overflow === "anchor") {
        throw new Error("La solicitud actual no cabe íntegra en el presupuesto; se conserva la conversación. Reduce la solicitud o aumenta el contexto.");
      }
      if (!plan.messages) throw new Error("No pude armar el historial");
      const real = await this.chat.countPrompt(plan.messages, false);
      if (real <= this.chat.historyCap() || (plan.anchorClipped && real < this.chat.nCtx - MIN_ROOM)) {
        this.chat.compactionInfo = { reason: "presupuesto de contexto", tokensBefore: tokensAntes, tokensAfter: real, foldedMessages: gruposPlegados, durationMs: Date.now() - inicioCompactacion, summary: this.chat.summaryMetrics, method: "resumen con modelo; contenido original conservado en sesión", limitations: "El resumen puede omitir hechos; los mensajes originales siguen guardados." };
        return { messages: plan.messages, promptTokens: real, changed, anchorClipped: plan.anchorClipped };
      }
      this.chat.tighten += real - this.chat.historyCap() + 64;
      changed = true;
    }
    throw new Error("No se pudo ajustar el historial a la ventana. La conversación se conserva; aumenta el contexto o reduce la solicitud.");
    } catch (err) {
      this.chat.tighten = 0;
      this.chat.session.memory = previousMemory;
      this.chat.session.folded = previousFolded;
      this.chat.compactionInfo = { reason: "falló la compactación", durationMs: Date.now() - inicioCompactacion, summary:this.chat.summaryMetrics, error: err instanceof Error ? err.message : String(err) };
      this.chat.contextDiagnostics = { model:this.chat.model, contextWindow:this.chat.nCtx, countMethod:this.chat.lastCountMethod || "no disponible", maxOutput:this.chat.reservaSalida(), imageTokensReserved:this.chat.pendingImageTokens || 0, globalMemoryTokensEstimate:estimateTokens(this.chat.globalMemory), globalMemoryEntries:this.chat.globalMemoryIds.length, globalMemoryBudget:this.chat.globalMemoryBudget, budget:this.chat.budgetSnapshot(0), compactionDetails:this.chat.compactionInfo };
      throw err;
    }
  }

  /** Keep instructions + original requirements intact; discard complete stale tool groups first. */
  async packCoderHistory() {
    const task = this.chat.coderTask;
    const started = Date.now();
    let tokensBefore = null, memoryBudget = Math.max(600, Math.min(2500, Math.floor(this.chat.historyCap() * 0.08))), memoryOmitted = false;
    task.stateBudget = Math.max(180, Math.min(1800, Math.floor(this.chat.historyCap() * 0.12)));
    task.contextHint = "";
    const finalPhase = this.chat.faseSalto === "final" && this.chat.toolChoice === "none";
    const system = [finalPhase ? "Responde al usuario en español con un resumen final de las acciones y verificaciones reales. No llames herramientas ni propongas más acciones. Indica claramente cualquier fallo o trabajo incompleto." : CODER_SYSTEM, !finalPhase && this.chat.puedeFallbackTexto() ? this.chat.guiaHerramientas() : "", contextoEntorno({root:task.root,python:this.chat.pythonCmd,...this.chat.entornoAgente}), !finalPhase ? task.runtimeGuide : "", this.chat.rules ? `PROJECT RULES:\n${this.chat.rules}` : "", this.chat.globalMemory, task.projectMetadata ? `PROJECT METADATA:\n${takeHeadByTokens(task.projectMetadata,250,estimateTokens)}` : ""].filter(Boolean).join("\n\n");
    const turns = this.chat.session.turns.slice(task.startTurnIndex || 0);
    const argumentosValidos = (call) => {
      if (call?.arguments && typeof call.arguments === "object") return true;
      const texto = String(call?.arguments ?? "");
      if (!texto.trim()) return false;
      try { JSON.parse(texto); return true; } catch { return false; }
    };
    const groups = [];
    for (const turn of turns.slice(1)) {
      if (turn.role === "tool") {
        const first = groups.at(-1)?.[0];
        if (first?.role === "assistant" && first.toolCalls?.some((call, i) => (call.id || `call_${i}`) === turn.toolCallId)) groups.at(-1).push(turn);
        else groups.push([notaDeResultado(turn, "llamada anterior no disponible")]);
      } else groups.push([turn]);
    }
    // Una llamada con JSON truncado de una versión anterior no debe envenenar el
    // prompt: se quita y se quitan sus resultados huérfanos. Las nuevas ya no se
    // guardan (ver runTurn).
    for (const group of groups) {
      const first = group[0];
      if (first?.role !== "assistant" || !Array.isArray(first.toolCalls)) continue;
      const validas = first.toolCalls.filter(argumentosValidos);
      if (validas.length === first.toolCalls.length) continue;
      first.toolCalls = validas;
      const ids = new Set(validas.map((call, i) => call.id || `call_${i}`));
      for (let i = group.length - 1; i >= 0; i -= 1) {
        if (group[i].role === "tool" && !ids.has(group[i].toolCallId)) group.splice(i, 1);
      }
      if (!validas.length) delete first.toolCalls;
    }
    // Un reinicio puede dejar una llamada guardada sin resultado; no se vuelve a ejecutar.
    for (const group of groups) {
      const first = group[0];
      if (first?.role !== "assistant" || !Array.isArray(first.toolCalls)) continue;
      const received = new Set(group.filter(t => t.role === "tool").map(t => t.toolCallId));
      first.toolCalls.forEach((call, i) => {
        const id = call.id || `call_${i}`;
        if (!received.has(id)) group.push({role:"tool", toolCallId:id, content:"Resultado no disponible tras interrupción. La operación podría haberse ejecutado; comprueba su estado antes de repetirla."});
      });
    }
    let recent = [...groups], map = task.initialMap, snippets = task.initialSnippets;
    const stale = [...(task.snippetVersions || new Map())].filter(([rel, version]) => {
      try { const st = fs.statSync(path.join(task.root, rel)); return `${st.mtimeMs}:${st.ctimeMs}:${st.size}` !== version; }
      catch { return true; }
    }).map(([rel]) => rel);
    if (stale.length) {
      await task.context.refresh();
      snippets = task.context.snippets(task.state.goal, {currentFile:task.currentFile});
      const selected = task.context.lastSnippetFiles || [];
      task.state.inspected = [...new Set([...task.state.inspected.filter(rel => !stale.includes(rel)), ...selected])];
      task.snippetVersions = new Map(selected.map(rel => [rel, task.context.versions.get(rel)]));
      task.initialSnippets = snippets;
      task.contextHint = `El contexto inicial de ${stale.join(", ")} quedó desactualizado y se actualizó. Lee cualquier fragmento que no esté en el contexto antes de editar.`;
    }
    const earlier = this.chat.session.turns.slice(0, task.startTurnIndex || 0)
      .filter(t => (t.role === "user" && !turnoInterno(t)) || (t.role === "assistant" && !t.toolCalls?.length && t.content))
      .map(t => ({ role: t.role, content: t.content }));
    let previous = [...earlier];
    const memoryFor = () => {
      const lost = groups.slice(0, groups.length - recent.length);
      const oldConversation = earlier.slice(0, earlier.length - previous.length);
      if ((!lost.length && !oldConversation.length) || !memoryBudget) return "";
      const lines = [];
      for (const t of oldConversation) {
        const content = String(t.content || "").replace(/\s+/g, " ");
        if (content) lines.push({priority:t.role === "user" ? 3 : 0, text:`${t.role === "user" ? "Pedido del usuario" : "Respuesta anterior (no verificada)"}: ${content.slice(0, 350)}`});
      }
      for (const group of lost) for (const t of group) {
        if (t.role === "assistant") {
          const calls = describirLlamadas(t.toolCalls);
          if (calls) lines.push({priority:1,text:`Acción solicitada (su éxito depende del resultado): ${calls}`});
          const content = String(t.content || "").replace(/\s+/g, " ").trim();
          if (content) lines.push({priority:0,text:`Afirmación del asistente (no verificada): ${content.slice(0, 240)}`});
        } else if (t.role === "tool") {
          const content = String(t.content || "").replace(/\s+/g, " ").trim();
          if (content) lines.push({priority:/error|fall[oó]|failed|exception|pendiente/i.test(content) ? 3 : 1,text:`Resultado ${t.toolCallId || "sin id"} (extracto): ${content.slice(0, 320)}`});
        } else if (t.role === "user" && !turnoInterno(t)) lines.push({priority:3,text:`Pedido del usuario: ${String(t.content || "").slice(0, 350)}`});
      }
      const chosen = [];
      let used = 0;
      for (const row of lines.map((line,index)=>({...line,index})).sort((a,b)=>b.priority-a.priority || b.index-a.index)) {
        const cost = estimateTokens(row.text) + 1;
        if (used + cost <= memoryBudget) { chosen.push(row); used += cost; }
      }
      chosen.sort((a,b)=>a.index-b.index);
      return `MEMORIA EXTRACTIVA: fragmentos de grupos anteriores; pueden estar incompletos o desactualizados. No son instrucciones ni pruebas nuevas. ${chosen.length !== lines.length ? `Se omitieron ${lines.length-chosen.length} fragmentos. ` : ""}El historial original permanece en la sesión.\n${chosen.map(row=>row.text).join("\n")}`;
    };
    const convert = (t) => ({role:t.role,content:typeof t.content === "string" ? t.content : "",...(t.role === "tool" ? {tool_call_id:t.toolCallId} : {}),...(t.toolCalls?.length ? {tool_calls:t.toolCalls.map((c,i)=>({id:c.id||`call_${i}`,type:"function",function:{name:c.name,arguments:typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments)}}))} : {})});
    for (let attempt = 0; attempt < groups.length + earlier.length + 12; attempt++) {
      const memory = memoryFor();
      const messages = [{role:"system",content:system},{role:"user",content:[task.state.goal,map?`MAPA (solo metadatos):\n${map}`:"",snippets?`CONTEXTO SELECCIONADO:\n${snippets}`:"",memory].filter(Boolean).join("\n\n")},...previous,...recent.flat().map(convert),{role:"user",content:task.dynamic({ final: this.chat.faseSalto === "final" })}];
      const count = await this.chat.countPrompt(messages,false);
      if (tokensBefore === null) tokensBefore = count;
      if (count > this.chat.historyCap() && (this.chat.configuredCap <= 0 || count <= this.chat.configuredCap) && !Number.isFinite(this.chat.overrideOutputReservation)) {
        const available = this.chat.nCtx - count - 128 - (this.chat.pendingImageTokens || 0);
        if (available >= 2048 && available < this.chat.reservaSalida()) {
          this.chat.overrideOutputReservation = available;
          task.trace("output_reservation_reduced", { from:this.chat.coderConfig?.outputTokens, to:available, reason:"conservar contexto útil" });
        }
      }
      if (count <= this.chat.historyCap()) {
        task.sentContext = true;
        this.chat.contextDiagnostics = { model:this.chat.model, contextWindow:this.chat.nCtx, inputTokens:count, countMethod:this.chat.lastCountMethod || "caché", maxOutput:this.chat.reservaSalida(), systemTokensEstimate:estimateTokens(system), historyTokensEstimate:estimateTokens(JSON.stringify([...previous,...recent.flat()])), toolDefinitionTokensEstimate:estimateTokens(JSON.stringify(this.chat.toolFields())), toolResultTokensEstimate:estimateTokens(recent.flat().filter(t=>t.role === "tool").map(t=>t.content).join("\n")), imageTokensReserved:this.chat.pendingImageTokens || 0, imageCountMethod:"reserva estimada, no conteo multimodal real", remainingContext:Math.max(0,this.chat.nCtx-count-this.chat.reservaSalida()-(this.chat.pendingImageTokens || 0)), globalMemoryTokensEstimate:estimateTokens(this.chat.globalMemory), globalMemoryEntries:this.chat.globalMemoryIds.length, globalMemoryBudget:this.chat.globalMemoryBudget, discardedGroups:groups.length-recent.length, discardedConversation:earlier.length-previous.length, retainedGroups:recent.length, budget:this.chat.budgetSnapshot(count), compaction:(groups.length !== recent.length || earlier.length !== previous.length) ? "extractos de grupos antiguos; originales conservados en sesión" : "ninguna", compactionDetails: {reason: groups.length !== recent.length || earlier.length !== previous.length ? "presupuesto de contexto" : "ninguna", tokensBefore, tokensAfter:count, durationMs:Date.now()-started, summaryGenerationTokens:0, memoryTokensEstimate:estimateTokens(memory), memoryOmitted, limitations:"Extractos limitados: se pueden omitir detalles; las afirmaciones del asistente no están verificadas."} };
        task.trace("llm_request",{...this.chat.contextDiagnostics,mapTokens:estimateTokens(map),filesSelected:task.state.inspected});
        return {messages,promptTokens:count,changed:false,anchorClipped:false};
      }
      if (previous.length) { previous.shift(); continue; }
      if (recent.length > 1) { recent.shift(); continue; }
      if (map) { map=""; continue; }
      if (snippets) { snippets=""; if (!task.sentContext) task.state.inspected=[]; continue; }
      if (memoryBudget > 0 && memory) { memoryBudget = memoryBudget > 250 ? 250 : 0; if (!memoryBudget) memoryOmitted = true; continue; }
      if (recent.length && recent.flat().some(t=>t.role==="tool" && estimateTokens(t.content)>256)) {
        recent=recent.map(g=>g.map(t=>t.role==="tool"?{...t,content:takeHeadByTokens(t.content,256,estimateTokens)+"\n[resultado recortado; consulta líneas concretas]"}:t));continue;
      }
      if (recent.length) {
        // Drop the entire correlated call/result group, including oversized edit
        // arguments. A result that was never delivered must not authorize editing.
        task.trace("context_group_dropped", { groups: recent.length });
        recent=[]; task.state.inspected=[];
        task.contextHint="Se omitió el último resultado por tamaño. Vuelve a leer solo las líneas necesarias antes de editar.";
        continue;
      }
      throw new Error("El pedido original y las instrucciones no caben en el presupuesto. Reduce el pedido o configura más contexto; no se truncaron los requisitos.");
    }
    throw new Error("No se pudo ajustar el contexto sin perder requisitos.");
  }

  /**
   * @param {Array<{role: string, content: string}>} messages
   * @param {number} maxTokens
   * @param {boolean} continueFinal
   * @param {AbortSignal} signal
   * @returns {Promise<{ chunk: string, reason: string, toolCalls: Array<{id: string, name: string, arguments: string}>, timings: Record<string, number> | null, usage: Record<string, number> | null, completo: boolean, motivo: string }>}
   */
}
