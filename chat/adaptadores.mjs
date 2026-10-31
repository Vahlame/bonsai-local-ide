/**
 * Adaptadores de tool calls: cómo ESCRIBE cada modelo sus llamadas.
 *
 * El servidor OpenAI-compatible parsea la plantilla del modelo y, cuando puede, manda
 * la llamada ya hecha en `delta.tool_calls` (eso es el camino NATIVO y no necesita
 * adaptador). Cuando no la parsea —`tool_choice: "none"`, plantillas que su parser no
 * reconoce— el modelo la escribe IGUALMENTE en su texto, con el dialecto con el que fue
 * entrenado. Ese dialecto es del MODELO, no de bonsai.
 *
 * Aquí se declara uno por modelo en chat\modelo.json (`catalogo.<clave>.toolcalls`) y se
 * traduce a la MISMA forma que produce el camino nativo: `[{name, arguments}]`, que es lo
 * que come `nativeToolEffects` de chat/actions.mjs. Así el agente tiene un solo camino y
 * añadir un modelo nuevo es declarar su dialecto, no tocar el bucle del agente.
 *
 * Evidencia del dialecto de la familia Ternary-Bonsai-2-27B (plantilla Qwen), salida
 * CRUDA capturada en este repo:
 *   salida/eval-4/tarea-lru-cache.json:669
 *   chat/evaluar/resultados/2026-10-04-eval-3-modelo-override6-prompt-arreglado.json:400
 *   <tool_call>\n<function=ejecutar>\n<parameter=comando>\npython -m unittest test_lru -v\n</parameter>\n</function>\n</tool_call>
 */

/**
 * Una llamada dentro de un bloque `<tool_call>` que en realidad es JSON.
 * @param {string} cuerpo
 * @returns {{name: string, arguments: Record<string, unknown>} | null}
 */
function llamadaJson(cuerpo) {
  let json;
  try {
    json = JSON.parse(cuerpo);
  } catch {
    return null;
  }
  if (!json || typeof json !== "object") return null;
  const fn = json.function && typeof json.function === "object" ? json.function : json;
  const name = typeof fn.name === "string" ? fn.name.trim() : "";
  if (!name) return null;
  let args = fn.arguments !== undefined ? fn.arguments : json.arguments;
  if (typeof args === "string") {
    try {
      args = JSON.parse(args);
    } catch {
      return null;
    }
  }
  return { name, arguments: args && typeof args === "object" ? /** @type {Record<string, unknown>} */ (args) : {} };
}

/**
 * Dialecto `xml-funcion` (plantilla Qwen, el que emiten los dos modelos del catálogo):
 *   <tool_call>
 *   <function=ejecutar>
 *   <parameter=comando>
 *   python -m unittest test_lru -v
 *   </parameter>
 *   </function>
 *   </tool_call>
 * También acepta un `<tool_call>` con JSON dentro, que es la otra forma de la misma
 * plantilla. Los valores van como texto: son los argumentos tal cual los escribió el
 * modelo, sin reinterpretarlos.
 * @param {string} texto
 * @returns {Array<{name: string, arguments: Record<string, unknown>}>}
 */
function llamadasXml(texto) {
  /** @type {Array<{name: string, arguments: Record<string, unknown>}>} */
  const out = [];
  const re = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
  for (const bloque of String(texto || "").matchAll(re)) {
    const cuerpo = (bloque[1] || "").trim();
    const json = llamadaJson(cuerpo);
    if (json) {
      out.push(json);
      continue;
    }
    const fn = cuerpo.match(/<function\s*=\s*([^\s>]+)\s*>/i);
    if (!fn) continue;
    /** @type {Record<string, unknown>} */
    const args = {};
    for (const param of cuerpo.matchAll(/<parameter\s*=\s*([^\s>]+)\s*>([\s\S]*?)<\/parameter>/gi)) {
      args[param[1].trim()] = (param[2] || "").replace(/^\r?\n/, "").replace(/\s+$/, "");
    }
    out.push({ name: fn[1].trim(), arguments: args });
  }
  return out;
}

/** Dialectos de texto conocidos. La clave es lo que se declara en modelo.json. */
const PARSERS = {
  "xml-funcion": llamadasXml,
  /**
   * Qwen2.5 Coder emite:
   *   <function-call>
   *   {"name": "sumar", "arguments": {"a": 17, "b": 25}}
   *   </function-call>
   * Es JSON, no XML de parámetros; se acepta también dentro de <tool_call>.
   */
  "function-call": (texto) => {
    /** @type {Array<{name: string, arguments: Record<string, unknown>}>} */
    const out = [];
    for (const bloque of String(texto || "").matchAll(/<function-call>([\s\S]*?)<\/function-call>/gi)) {
      const json = llamadaJson((bloque[1] || "").trim());
      if (json) out.push(json);
    }
    return out;
  },
  /**
   * Qwen2.5 Coder, cuando la plantilla no declara tools, envuelve el JSON en
   * `<xml>…</xml>` en vez de `<function-call>`. Misma estructura {name, arguments}.
   */
  "xml-json": (texto) => {
    /** @type {Array<{name: string, arguments: Record<string, unknown>}>} */
    const out = [];
    for (const bloque of String(texto || "").matchAll(/<xml>([\s\S]*?)<\/xml>/gi)) {
      const json = llamadaJson((bloque[1] || "").trim());
      if (json) out.push(json);
    }
    return out;
  },
  /** Qwen2.5 Coder también usa `<tools>{name,arguments}</tools>` según el prompt. */
  "tools-json": (texto) => {
    /** @type {Array<{name: string, arguments: Record<string, unknown>}>} */
    const out = [];
    for (const bloque of String(texto || "").matchAll(/<tools>([\s\S]*?)<\/tools>/gi)) {
      const json = llamadaJson((bloque[1] || "").trim());
      if (json) out.push(json);
    }
    return out;
  },
};

export const DIALECTOS = Object.keys(PARSERS);

/**
 * Dialecto declarado para un modelo del catálogo. "" = no declarado: se sigue el camino
 * de siempre (nativo y, si no, las heurísticas de texto del agente).
 * "auto" = probar todos los dialectos conocidos.
 * @param {string} clave
 * @param {Record<string, any>} [catalogo]
 * @returns {string}
 */
export function dialectoDe(clave, catalogo = {}) {
  const fila = clave && catalogo ? catalogo[clave] : null;
  const dialecto = fila && typeof fila.toolcalls === "string" ? fila.toolcalls.trim() : "";
  return dialecto === "auto" ? DIALECTOS.join(" ") : dialecto;
}

/**
 * Tool calls escritas en el TEXTO del modelo, traducidas a `{name, arguments}`, la misma
 * forma que las nativas. Sin dialecto declarado devuelve [] y no toca nada.
 * @param {string} texto
 * @param {string} dialecto
 * @returns {Array<{id: string, name: string, arguments: Record<string, unknown>}>}
 */
export function llamadasCrudas(texto, dialecto) {
  if (!texto || !dialecto) return [];
  // Un `<tool_call>` CITADO dentro de una cerca de código es un ejemplo, no una llamada: si
  // no se quita, el modelo que explica su propia plantilla —o que repite lo que leyó de un
  // archivo o de una búsqueda— haría ejecutar algo que nadie pidió.
  const limpio = String(texto).replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
  /** @type {Array<{name: string, arguments: Record<string, unknown>}>} */
  const todas = [];
  for (const nombre of String(dialecto).split(/[\s,|]+/).filter(Boolean)) {
    if (!Object.hasOwn(PARSERS, nombre)) continue;
    todas.push(...PARSERS[nombre](limpio));
  }
  /** @type {Map<string, {id: string, name: string, arguments: Record<string, unknown>}>} */
  const unicas = new Map();
  for (const llamada of todas) {
    const clave = `${llamada.name}:${JSON.stringify(llamada.arguments)}`;
    if (!unicas.has(clave)) unicas.set(clave, { id: `crudo_${unicas.size + 1}`, name: llamada.name, arguments: llamada.arguments });
  }
  return [...unicas.values()];
}

/**
 * @returns {string[]} nombres de las comprobaciones que fallaron
 */
export function selfTest() {
  /** @type {string[]} */
  const fallos = [];
  /**
   * @param {string} nombre
   * @param {boolean} cond
   */
  const check = (nombre, cond) => {
    if (!cond) fallos.push(nombre);
  };

  // Salida CRUDA verbatim de salida/eval-4/tarea-lru-cache.json:669 (sin retocar).
  const crudoReal = "<tool_call>\n<function=ejecutar>\n<parameter=comando>\npython -m unittest test_lru -v\n</parameter>\n</function>\n</tool_call>";
  const real = llamadasCrudas(crudoReal, "xml-funcion");
  check("lee la tool call cruda del modelo", real.length === 1 && real[0].name === "ejecutar" && real[0].arguments.comando === "python -m unittest test_lru -v");

  const dos = llamadasCrudas("Voy.\n<tool_call>\n<function=archivo>\n<parameter=ruta>\na.txt\n</parameter>\n<parameter=contenido>\nuno\n</parameter>\n</function>\n</tool_call>", "xml-funcion");
  check("lee varios parámetros", dos.length === 1 && dos[0].name === "archivo" && dos[0].arguments.ruta === "a.txt" && dos[0].arguments.contenido === "uno");

  const enJson = llamadasCrudas('<tool_call>{"name":"leer","arguments":{"ruta":"x.py"}}</tool_call>', "xml-funcion");
  check("acepta la misma plantilla con JSON dentro", enJson.length === 1 && enJson[0].name === "leer" && enJson[0].arguments.ruta === "x.py");

  const conFunction = llamadasCrudas('<tool_call>{"function":{"name":"buscar","arguments":"{\\"consulta\\":\\"hora\\"}"}}</tool_call>', "xml-funcion");
  check("acepta el sobre de OpenAI con arguments en texto", conFunction.length === 1 && conFunction[0].arguments.consulta === "hora");

  const dosLlamadas = llamadasCrudas(`${crudoReal}\n${crudoReal}`, "xml-funcion");
  check("no repite la misma llamada dos veces", dosLlamadas.length === 1);

  const qwenCoder = '<function-call>\n{"name": "sumar", "arguments": {"a": 17, "b": 25}}\n</function-call>';
  const fc = llamadasCrudas(qwenCoder, "function-call");
  check("lee el formato <function-call> de Qwen2.5 Coder", fc.length === 1 && fc[0].name === "sumar" && fc[0].arguments.a === 17 && fc[0].arguments.b === 25);
  check("function-call no confunde texto normal", llamadasCrudas("hola", "function-call").length === 0);
  const xmlJson = llamadasCrudas('<xml>\n{"name": "convertir_moneda", "arguments": {"monto": 250, "de": "USD", "a": "EUR"}}\n</xml>', "xml-json");
  check("lee el JSON envuelto en <xml> de Qwen2.5 Coder", xmlJson.length === 1 && xmlJson[0].name === "convertir_moneda" && xmlJson[0].arguments.monto === 250);
  const toolsJson = llamadasCrudas('<tools>\n{"name": "convertir_moneda", "arguments": {"monto": 250}}\n</tools>', "tools-json");
  check("lee el JSON envuelto en <tools> de Qwen2.5 Coder", toolsJson.length === 1 && toolsJson[0].name === "convertir_moneda");

  check("sin dialecto no toca el texto", llamadasCrudas(crudoReal, "").length === 0);
  check("un dialecto desconocido no rompe", llamadasCrudas(crudoReal, "inventado").length === 0);
  check("texto sin tool calls no produce nada", llamadasCrudas("hola, ¿qué tal?", "xml-funcion").length === 0);
  check("un bloque cortado a medias no produce nada", llamadasCrudas("<tool_call>\n<function=ejecutar>", "xml-funcion").length === 0);

  const catalogo = { override6: { toolcalls: "xml-funcion" }, bolding_v1: {}, _nota: "x" };
  check("el dialecto sale de la configuración del modelo", dialectoDe("override6", catalogo) === "xml-funcion");
  check("un modelo sin declararlo se queda sin dialecto", dialectoDe("bolding_v1", catalogo) === "");
  check("una clave que no está en el catálogo tampoco tiene dialecto", dialectoDe("otro", catalogo) === "");
  check("la nota del catálogo no se confunde con un modelo", dialectoDe("_nota", catalogo) === "");
  check("auto prueba todos los dialectos", dialectoDe("x", { x: { toolcalls: "auto" } }) === DIALECTOS.join(" "));

  return fallos;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("chat/adaptadores.mjs")) {
  const fallos = selfTest();
  if (fallos.length) {
    process.stderr.write(`FALLÓ:\n- ${fallos.join("\n- ")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("adaptadores ok\n");
  }
}
