/**
 * Matriz de STACKS: 12 tareas de tecnologías distintas PARA CADA MODELO (conjuntos A y B, sin
 * repetir ninguna), con la salida cruda del modelo guardada verbatim. Sirve para ver si el
 * dialecto de las tool calls cambia según la tecnología o según el modelo.
 *
 * Sin instrucciones de formato: solo viajan los esquemas en `tools`, como en producción.
 *
 *   node chat\medir-stacks.mjs --puerto 8080 --modelo override6 --conjunto A
 *   node chat\medir-stacks.mjs --puerto 8080 --modelo bolding_v1 --conjunto B
 *
 * Artefactos: salida\formato\stacks-<modelo>-<conjunto>-<sello>.jsonl + .md
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PC_TOOLS } from "./actions.mjs";
import { SYSTEM_RULES } from "./context.mjs";
import { muestreo } from "./modelo.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const SALIDA = process.env.BONSAI_SALIDA ? path.resolve(process.env.BONSAI_SALIDA) : path.join(PROJECT, "salida");
const DESTINO = path.join(SALIDA, "formato");

/** Conjunto A (para un modelo): 12 stacks, la última sin herramientas a propósito. */
export const CONJUNTO_A = [
  "Escribe en Python un script cli.py con argparse que lea config.json, filtre las entradas activas y las imprima en una tabla.",
  "Escribe un script de Node (ESM) que lea ventas.csv, agrupe por mes y escriba totales.json con los totales.",
  "Escribe una página web (index.html + estilo.css + app.js) con un formulario que valide un email y muestre el resultado.",
  "Escribe consultas.sql para SQLite: dos tablas (clientes, pedidos), un JOIN con el total por cliente y una consulta de los que superan 100.",
  "Escribe un script PowerShell que liste los 10 procesos que más RAM usan y los guarde en procesos.csv.",
  "Escribe un script que extraiga todos los correos y teléfonos de un log de texto con expresiones regulares.",
  "Escribe un módulo Python que calcule un HMAC-SHA256 de un mensaje con una clave y verifique una firma.",
  "Escribe un script que convierta un XML de facturas a JSON y valide que cada factura tenga id e importe.",
  "Escribe un módulo Python con media, mediana y desviación típica, y un test con unittest de los tres.",
  "Escribe un cliente HTTP en Python que descargue una URL, guarde el cuerpo en un archivo y diga el código de estado.",
  "Escribe un script Python con hilos que procese una lista de tareas en paralelo y agregue los resultados.",
  "Explícame en tres frases qué diferencia hay entre un proceso y un hilo. No crees archivos.",
];

/** Conjunto B (para el otro modelo): otras 12 tecnologías, ninguna repetida con A. */
export const CONJUNTO_B = [
  "Escribe una clase Python con propiedades y validación de rangos, y un test que compruebe que un valor inválido lanza excepción.",
  "Escribe en JavaScript una función pura que normalice y ordene una lista de objetos, con tests usando assert de Node.",
  "Escribe un canvas HTML que dibuje un círculo que rebote y responda a las flechas del teclado.",
  "Escribe una consulta SQL con una CTE y una función de ventana que numere los pedidos por cliente y fecha.",
  "Escribe un script de shell (bash o cmd) que haga una copia de seguridad comprimida de una carpeta con fecha en el nombre.",
  "Escribe un script que normalice texto Unicode, quite acentos y cuente las palabras más repetidas.",
  "Escribe un módulo Python de cifrado simétrico con clave (XOR con derivación y verificación de integridad) y su test.",
  "Escribe un script que lea dos archivos de configuración (YAML y TOML) y los fusione en un JSON, avisando de claves duplicadas.",
  "Escribe un módulo Python que factorice un número y liste sus divisores primos, con un test de casos límite.",
  "Escribe un mini servidor HTTP en Python que devuelva JSON en /estado y un cliente que lo consuma e imprima la respuesta.",
  "Escribe un productor/consumidor con threading y una cola, que termine solo cuando el productor acabe.",
  "Explícame en tres frases qué es una función de ventana en SQL. No crees archivos.",
];

/**
 * @param {string} texto
 * @param {Array<{name: string, arguments: string}>} nativas
 * @returns {string}
 */
export function clasificar(texto, nativas) {
  if (nativas.length) return "nativo-tool_calls";
  if (/<tool_call>[\s\S]*?<function\s*=/i.test(texto)) return "xml-funcion";
  if (/```\s*(?:ejecutar|leer|indice|índice|buscar|archivo)\b/i.test(texto)) return "cercas";
  if (/"(?:name|tool)"\s*:\s*"[a-z_]+"[\s\S]{0,80}"arguments?"\s*:/i.test(texto)) return "json-suelto";
  return "solo-texto";
}

async function main() {
  const argv = process.argv.slice(2);
  let puerto = 8080;
  let modelo = "";
  let conjunto = "A";
  let maxTokens = 400;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--puerto") puerto = Number(argv[++i]) || 8080;
    else if (argv[i] === "--modelo") modelo = argv[++i] || "";
    else if (argv[i] === "--conjunto") conjunto = String(argv[++i] || "A").toUpperCase();
    else if (argv[i] === "--max-tokens") maxTokens = Number(argv[++i]) || 400;
    else throw new Error(`argumento desconocido: ${argv[i]}`);
  }
  if (!modelo) throw new Error("falta --modelo");
  const tareas = conjunto === "B" ? CONJUNTO_B : CONJUNTO_A;
  const base = `http://127.0.0.1:${puerto}`;
  const salud = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!salud || !salud.ok) throw new Error(`no hay llama-server en ${base}`);
  const props = await (await fetch(`${base}/props`, { signal: AbortSignal.timeout(5000) })).json();
  const cargado = path.basename(String(props?.model_path || ""));

  fs.mkdirSync(DESTINO, { recursive: true });
  const sello = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ficheroCrudo = path.join(DESTINO, `stacks-${modelo}-${conjunto}-${sello}.jsonl`);
  const volcado = fs.createWriteStream(ficheroCrudo, { flags: "a" });
  /** @type {Array<{n: number, stack: string, dialecto: string, nativas: number, chars: number, s: number}>} */
  const filas = [];
  process.stdout.write(`modelo cargado: ${cargado} · conjunto ${conjunto} (${tareas.length} tareas)\n`);

  for (let n = 0; n < tareas.length; n += 1) {
    const tarea = tareas[n];
    const t0 = Date.now();
    /** @type {string[]} */
    const frames = [];
    let texto = "";
    /** @type {Map<number, {id: string, name: string, arguments: string}>} */
    const nativas = new Map();
    let finish = "";
    try {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "local",
          messages: [{ role: "system", content: SYSTEM_RULES }, { role: "user", content: tarea }],
          stream: true,
          stream_options: { include_usage: true },
          cache_prompt: true,
          max_tokens: maxTokens,
          ...muestreo("codigo"),
          chat_template_kwargs: { enable_thinking: false },
          tools: PC_TOOLS,
          tool_choice: "auto",
          parallel_tool_calls: true,
        }),
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
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
          if (Array.isArray(delta.tool_calls)) {
            for (const call of delta.tool_calls) {
              const idx = Number.isInteger(call?.index) ? call.index : 0;
              const fila = nativas.get(idx) || { id: "", name: "", arguments: "" };
              if (typeof call?.id === "string" && call.id) fila.id = call.id;
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
    const stack = tarea.split(/[ ,.]/)[0].slice(0, 18);
    volcado.write(`${JSON.stringify({ modelo, conjunto, n: n + 1, stack, tarea, dialecto, finish, nativas: lista, texto, frames })}\n`);
    filas.push({ n: n + 1, stack, dialecto, nativas: lista.length, chars: texto.length, s: segundos });
    process.stdout.write(`${String(n + 1).padStart(2)} ${dialecto.padEnd(18)} ${String(lista.length)} llamadas ${String(texto.length).padStart(5)} chars ${String(segundos).padStart(6)} s  ${tarea.slice(0, 46)}\n`);
  }
  volcado.end();
  const cuenta = /** @type {Record<string, number>} */ ({});
  for (const f of filas) cuenta[f.dialecto] = (cuenta[f.dialecto] || 0) + 1;
  fs.writeFileSync(
    path.join(DESTINO, `stacks-${modelo}-${conjunto}-${sello}.md`),
    [
      `# Stacks · ${modelo} · conjunto ${conjunto}`,
      "",
      `- Modelo cargado: \`${cargado}\``,
      `- Fecha: ${new Date().toISOString()}`,
      `- Crudo: \`${path.relative(PROJECT, ficheroCrudo)}\``,
      "",
      "| dialecto | tareas |",
      "| --- | --- |",
      ...Object.entries(cuenta).map(([k, v]) => `| ${k} | ${v} |`),
      "",
      "| # | dialecto | llamadas | chars | s | tarea |",
      "| --- | --- | --- | --- | --- | --- |",
      ...filas.map((f) => `| ${f.n} | ${f.dialecto} | ${f.nativas} | ${f.chars} | ${f.s} | ${f.stack} |`),
      "",
    ].join("\n"),
    "utf8",
  );
  process.stdout.write(`\ncrudo: ${ficheroCrudo}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
