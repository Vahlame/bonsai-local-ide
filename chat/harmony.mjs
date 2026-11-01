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
 * @returns {{reasoning: string, final: string, calls: Array<{name: string, arguments: Record<string, unknown> | string}>}}
 */
export function parseHarmony(raw) {
  const texto = String(raw ?? "");
  if (!texto.includes("<|channel|>")) {
    return { reasoning: "", final: texto, calls: [] };
  }
  const canal = /<\|channel\|>(analysis|final|commentary)([\s\S]*?)<\|message\|>([\s\S]*?)(?=<\|call\|>|<\|end\|>|<\|start\|>|<\|return\|>|$)/g;
  let reasoning = "";
  let final = "";
  /** @type {Array<{name: string, arguments: Record<string, unknown> | string}>} */
  const calls = [];
  for (const match of texto.matchAll(canal)) {
    const nombreCanal = match[1];
    const meta = match[2] || "";
    const cuerpo = match[3] || "";
    if (nombreCanal === "analysis") {
      reasoning += cuerpo;
      continue;
    }
    if (nombreCanal === "final") {
      final += cuerpo;
      continue;
    }
    const nombre = meta.match(/to=functions\.([A-Za-z0-9_.-]+)/)?.[1]
      || meta.match(/\bto=([A-Za-z0-9_.-]+)/)?.[1]
      || "";
    if (!nombre) continue;
    const limpio = cuerpo.replace(/<\|constrain\|>\w+/g, "").trim();
    let args;
    try {
      args = JSON.parse(limpio);
    } catch {
      args = limpio;
    }
    calls.push({ name: nombre, arguments: args });
  }
  return { reasoning, final, calls };
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
