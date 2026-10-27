/**
 * Mide el FORMATO CRUDO de un modelo.
 *
 * Manda N tareas distintas (código, criptografía, investigación, datos, multi-paso…) SIN
 * decirle cómo llamar a las herramientas: viajan los esquemas en `tools` (como en
 * producción) y nada más. Ni una instrucción de formato en el mensaje de sistema. Lo que
 * devuelva el modelo se guarda VERBATIM para ver con qué dialecto emite cada uno.
 *
 *   node chat\medir-formato.mjs --puerto 8080 --modelo override6
 *   node chat\medir-formato.mjs --puerto 8080 --modelo bolding_v1 --desde 10 --hasta 14
 *
 * Artefactos:
 *   salida\formato\crudo-<modelo>-<sello>.jsonl   frames SSE tal cual, uno por tarea
 *   salida\formato\informe-<modelo>-<sello>.md    clasificación + ejemplos
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PC_TOOLS } from "./actions.mjs";
import { SYSTEM_RULES } from "./context.mjs";
import { MODELO, muestreo } from "./modelo.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const SALIDA = process.env.BONSAI_SALIDA ? path.resolve(process.env.BONSAI_SALIDA) : path.join(PROJECT, "salida");
const DESTINO = path.join(SALIDA, "formato");

/** Las 20 tareas. Ninguna le dice al modelo CÓMO llamar a las funciones. */
export const TAREAS = [
  "Crea un archivo saludo.py que defina saludar(nombre) y lo pruebe al ejecutarse.",
  "Crea un archivo cifrado.py con el cifrado César (rot13 y rot_n) y un test con unittest.",
  "Crea un archivo hashes.py que calcule sha256 de un texto y compare dos hashes.",
  "Crea un archivo primos.py que cuente los primos menores que 1000 y muestre el total.",
  "Crea un archivo media.py que lea notas.csv y saque la media por alumno.",
  "Escribe tests/test_suma.py con unittest para una función suma(a, b) y ejecútalo.",
  "Crea un archivo index.html con un contador que sume 1 al pulsar un botón.",
  "Crea un archivo estilo.css con la clase .tarjeta centrada y sombra suave.",
  "Crea un archivo consultas.sql con una tabla alumnos y una consulta de aprobados.",
  "Corrige el bug del archivo fechas.py: no cuenta bien los días entre dos fechas.",
  "Renombra la función calc_total a calcular_total en el archivo facturas.py.",
  "Explícame en dos frases qué es una función hash criptográfica. No crees archivos.",
  "Compara brevemente SHA-256 y BLAKE3 en una tabla. No crees archivos.",
  "Busca en internet el precio actual de la plata por onza y dime la fuente.",
  "Mira qué archivos hay en la carpeta del proyecto y dime cuántos son.",
  "Lee el archivo README.md y dime de qué va el proyecto en una frase.",
  "Genera un PDF llamado informe.pdf con el texto «Hola Bonsai» y ábrelo para comprobarlo.",
  "Crea un archivo datos.json con tres alumnos y sus notas, y luego otro resumen.json con la media.",
  "Crea un script que descargue un CSV de ejemplo, lo guarde y cuente sus líneas.",
  "Explícame cómo se escribe una llamada a función en tu plantilla, con un ejemplo literal del formato.",
];

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const out = { puerto: 8080, modelo: "", desde: 1, hasta: TAREAS.length, pausa: 0, maxTokens: 900, timeout: 120000 };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === "--puerto") out.puerto = Number(argv[++i]) || 8080;
    else if (k === "--modelo") out.modelo = argv[++i] || "";
    else if (k === "--desde") out.desde = Number(argv[++i]) || 1;
    else if (k === "--hasta") out.hasta = Number(argv[++i]) || TAREAS.length;
    else if (k === "--pausa") out.pausa = Number(argv[++i]) || 0;
    else if (k === "--max-tokens") out.maxTokens = Number(argv[++i]) || 900;
    else if (k === "--timeout") out.timeout = Number(argv[++i]) || 120000;
    else throw new Error(`argumento desconocido: ${k}`);
  }
  return out;
}

/** @param {string} s */
const sello = (s) => String(s).replace(/[^a-z0-9-]/gi, "").slice(0, 40);

/**
 * Clasifica lo que emitió el modelo SIN interpretarlo.
 * @param {string} texto
 * @param {Array<{name: string, arguments: string}>} nativas
 * @returns {string}
 */
export function clasificar(texto, nativas) {
  if (nativas.length) return "nativo-tool_calls";
  if (/<tool_call>[\s\S]*?<function\s*=/i.test(texto)) return "xml-funcion";
  if (/<tool_call>[\s\S]*?\{[\s\S]*?"(?:name|tool)"\s*:/i.test(texto)) return "xml-json";
  if (/```\s*(?:ejecutar|leer|indice|índice|buscar|archivo)\b/i.test(texto)) return "cercas";
  if (/"(?:name|tool)"\s*:\s*"[a-z_]+"[\s\S]{0,80}"arguments?"\s*:/i.test(texto)) return "json-suelto";
  return "solo-texto";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.modelo) throw new Error("falta --modelo <clave> (para el nombre de los ficheros)");
  const base = `http://127.0.0.1:${args.puerto}`;
  const salud = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!salud || !salud.ok) throw new Error(`no hay llama-server en ${base}: arranca con .\\scripts\\start-server.ps1 -Modelo <clave>`);
  const props = await (await fetch(`${base}/props`, { signal: AbortSignal.timeout(5000) })).json();
  const cargado = path.basename(String(props?.model_path || "")) || "(desconocido)";

  fs.mkdirSync(DESTINO, { recursive: true });
  const selloTiempo = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ficheroCrudo = path.join(DESTINO, `crudo-${sello(args.modelo)}-${selloTiempo}.jsonl`);
  const ficheroInforme = path.join(DESTINO, `informe-${sello(args.modelo)}-${selloTiempo}.md`);
  const volcado = fs.createWriteStream(ficheroCrudo, { flags: "a" });

  /** @type {Array<{n: number, tarea: string, dialecto: string, nativas: number, texto: number, finish: string, segundos: number}>} */
  const filas = [];
  process.stdout.write(`modelo cargado en el servidor: ${cargado}\n`);
  process.stdout.write(`crudo: ${ficheroCrudo}\n`);

  for (let n = args.desde; n <= args.hasta; n += 1) {
    const tarea = TAREAS[n - 1];
    if (!tarea) continue;
    const cuerpo = {
      model: "local",
      messages: [
        { role: "system", content: SYSTEM_RULES },
        { role: "user", content: tarea },
      ],
      stream: true,
      stream_options: { include_usage: true },
      cache_prompt: true,
      max_tokens: args.maxTokens,
      ...muestreo("codigo"),
      chat_template_kwargs: { enable_thinking: false },
      tools: PC_TOOLS,
      tool_choice: "auto",
      parallel_tool_calls: true,
    };
    const t0 = Date.now();
    /** @type {string[]} */
    const frames = [];
    let texto = "";
    /** @type {Map<number, {id: string, name: string, arguments: string}>} */
    const nativas = new Map();
    let finish = "";
    let razonamiento = false;
    let idEnPrimerDelta = false;
    let indexVisto = false;
    try {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(args.timeout),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const lector = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await lector.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl = buf.indexOf("\n");
        while (nl !== -1) {
          const linea = buf.slice(0, nl).replace(/\r$/, "");
          buf = buf.slice(nl + 1);
          nl = buf.indexOf("\n");
          if (!linea.startsWith("data:")) continue;
          frames.push(linea);
          const payload = linea.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let json;
          try {
            json = JSON.parse(payload);
          } catch {
            continue;
          }
          const choice = json.choices?.[0];
          const delta = choice?.delta || {};
          if (typeof delta.content === "string") texto += delta.content;
          if (typeof delta.reasoning_content === "string" && delta.reasoning_content) razonamiento = true;
          if (Array.isArray(delta.tool_calls)) {
            for (const call of delta.tool_calls) {
              if (Number.isInteger(call?.index)) indexVisto = true;
              const idx = Number.isInteger(call?.index) ? call.index : 0;
              const fila = nativas.get(idx) || { id: "", name: "", arguments: "" };
              if (typeof call?.id === "string" && call.id) {
                fila.id = call.id;
                if (texto === "" && nativas.size === 0) idEnPrimerDelta = true;
              }
              if (typeof call?.function?.name === "string") fila.name += call.function.name;
              if (typeof call?.function?.arguments === "string") fila.arguments += call.function.arguments;
              nativas.set(idx, fila);
            }
          }
          if (choice?.finish_reason) finish = choice.finish_reason;
        }
      }
    } catch (err) {
      finish = `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
    const lista = [...nativas.values()].filter((c) => c.name);
    const dialecto = clasificar(texto, lista);
    const segundos = Math.round((Date.now() - t0) / 100) / 10;
    volcado.write(`${JSON.stringify({
      modelo: args.modelo,
      cargado,
      n,
      tarea,
      dialecto,
      finish,
      razonamiento,
      indexVisto,
      idEnPrimerDelta,
      nativas: lista,
      texto,
      frames,
    })}\n`);
    filas.push({ n, tarea, dialecto, nativas: lista.length, texto: texto.length, finish, segundos });
    process.stdout.write(`${String(n).padStart(2)} ${dialecto.padEnd(18)} ${String(lista.length)} llamadas  ${String(texto.length).padStart(6)} chars  ${String(segundos).padStart(6)} s  ${tarea.slice(0, 44)}\n`);
    if (args.pausa) await new Promise((r) => setTimeout(r, args.pausa));
  }
  volcado.end();

  const cuenta = /** @type {Record<string, number>} */ ({});
  for (const fila of filas) cuenta[fila.dialecto] = (cuenta[fila.dialecto] || 0) + 1;
  const lineas = [
    `# Formato crudo de ${args.modelo}`,
    "",
    `- Servidor: ${base} · modelo cargado según /props: \`${cargado}\``,
    `- Fecha: ${new Date().toISOString()}`,
    `- Tareas: ${filas.length} (sin ninguna instrucción de formato en el mensaje de sistema)`,
    `- Crudo frame a frame: \`${path.relative(PROJECT, ficheroCrudo)}\``,
    "",
    "## Recuento por dialecto",
    "",
    "| dialecto | tareas |",
    "| --- | --- |",
    ...Object.entries(cuenta).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## Tarea a tarea",
    "",
    "| # | dialecto | llamadas | chars | finish | s | tarea |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...filas.map((f) => `| ${f.n} | ${f.dialecto} | ${f.nativas} | ${f.texto} | ${f.finish} | ${f.segundos} | ${f.tarea.slice(0, 60).replace(/\|/g, "/")} |`),
    "",
  ];
  fs.writeFileSync(ficheroInforme, lineas.join("\n"), "utf8");
  process.stdout.write(`\ninforme: ${ficheroInforme}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
