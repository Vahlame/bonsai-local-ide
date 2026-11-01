/**
 * Parser del formato Harmony crudo de GPT-OSS.
 *
 * Cuando llama-server arranca con `--skip-chat-parsing`, el parser PEG nativo
 * no puede tumbar el turno: la respuesta llega entera en `content` con los
 * canales de Harmony. Este módulo separa análisis, respuesta final y tool calls
 * nativas (`assistant to=functions.NOMBRE ... <|message|>{json}`).
 *
 * No es un parser de prosa: solo reconoce los marcadores Harmony reales. Si no
 * hay marcadores, devuelve el texto tal cual para que el fallback `gpt-oss-json`
 * siga funcionando.
 */

/**
 * @param {string} raw
 * @returns {{reasoning: string, final: string, commentary?: string, calls: Array<{name: string, arguments: Record<string, unknown> | string}>}}
 */
export function parseHarmony(raw) {
  const texto = String(raw ?? "");
  if (!texto.includes("<|channel|>")) {
    return { reasoning: "", final: texto, calls: [] };
  }
  let reasoning = "";
  let final = "";
  let commentary = "";
  /** @type {Array<{name: string, arguments: Record<string, unknown> | string}>} */
  const calls = [];
  for (const message of texto.split(/<\|(?:start|end|call|return)\|>/)) {
    const separator = message.indexOf("<|message|>");
    if (separator < 0) continue;
    const meta = message.slice(0, separator);
    const nombreCanal = meta.match(/<\|channel\|>(analysis|final|commentary)\b/)?.[1];
    const cuerpo = message.slice(separator + "<|message|>".length);
    // Harmony permits the recipient before OR after the channel, including analysis tools.
    const recipient = meta.match(/\bto=([A-Za-z0-9_.-]+)/)?.[1];
    if (recipient && recipient !== "all") {
      const nombre = recipient.replace(/^functions\./, "");
      const limpio = cuerpo.trim();
      let args;
      try { args = JSON.parse(limpio); } catch { args = limpio; }
      calls.push({ name: nombre, arguments: args });
      continue;
    }
    if (nombreCanal === "analysis") {
      reasoning += cuerpo;
      continue;
    }
    if (nombreCanal === "final") {
      final += cuerpo;
      continue;
    }
    if (nombreCanal === "commentary") commentary += cuerpo;
  }
  return { reasoning, final, commentary, calls };
}

/** Progress only: partial arguments are never executable calls. Invoke at a bounded rate. */
export function createHarmonyProgress({ reasoning = () => {}, final = () => {}, tool = () => {}, commentary = () => {} } = {}) {
  let seenReasoning = "", seenFinal = "", seenCommentary = "";
  const markers = ["<|start|>", "<|end|>", "<|call|>", "<|return|>", "<|channel|>", "<|message|>", "<|constrain|>"];
  return (raw) => {
    if (!raw.includes("<|channel|>")) return;
    const last = raw.lastIndexOf("<");
    const text = last >= 0 && markers.some((marker) => marker.startsWith(raw.slice(last))) ? raw.slice(0, last) : raw;
    const parsed = parseHarmony(text);
    for (const [value, seen, emit] of [[parsed.reasoning, seenReasoning, reasoning], [parsed.final, seenFinal, final], [parsed.commentary || "", seenCommentary, commentary]]) {
      if (value.startsWith(seen) && value.length > seen.length) emit(value.slice(seen.length));
    }
    seenReasoning = parsed.reasoning; seenFinal = parsed.final; seenCommentary = parsed.commentary || "";
    for (const call of parsed.calls.slice(-1)) {
      const args = typeof call.arguments === "string" ? call.arguments : JSON.stringify(call.arguments);
      tool({ name: call.name, chars: args.length, ruta: args.match(/"(?:ruta|path)"\s*:\s*"([^"\r\n]{1,200})"/)?.[1] || "" });
    }
  };
}

/**
 * @returns {string[]} nombres de las comprobaciones que fallaron
 */
export function selfTest() {
  const fallos = [];
  const check = (nombre, cond) => {
    if (!cond) fallos.push(nombre);
  };

  const crudo = '<|channel|>analysis<|message|>We need to create a file.<|end|><|start|>assistant<|channel|>commentary to=functions.archivo <|constrain|>json<|message|>{"ruta":"skip.txt","contenido":"skip"}';
  const uno = parseHarmony(crudo);
  check("separa análisis", uno.reasoning.includes("We need"));
  check("lee la tool call nativa", uno.calls.length === 1 && uno.calls[0].name === "archivo");
  check("parsea los argumentos", uno.calls[0]?.arguments?.ruta === "skip.txt");
  check("no deja el análisis como respuesta", uno.final === "");

  const final = '<|start|>assistant<|channel|>final<|message|>Listo.<|return|>';
  const dos = parseHarmony(final);
  check("lee el canal final", dos.final === "Listo.");

  const multiple = `${crudo}<|call|><|start|>assistant<|channel|>commentary to=functions.archivo <|constrain|>json<|message|>{"ruta":"dos.txt","contenido":"dos"}`;
  const tres = parseHarmony(multiple);
  check("lee varias tool calls", tres.calls.length === 2 && tres.calls[1].arguments.ruta === "dos.txt");

  const texto = parseHarmony("Hola, sin canales.");
  check("texto normal no se toca", texto.final === "Hola, sin canales." && texto.calls.length === 0);
  const jsonSuelto = parseHarmony('{"name":"leer","arguments":{"ruta":"a"}}');
  check("JSON suelto sigue disponible para el fallback", jsonSuelto.final.includes('"name"') && jsonSuelto.calls.length === 0);

  return fallos;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("chat/harmony.mjs")) {
  const fallos = selfTest();
  if (fallos.length) {
    process.stderr.write(`FALLO:\n- ${fallos.join("\n- ")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("harmony ok\n");
  }
}
