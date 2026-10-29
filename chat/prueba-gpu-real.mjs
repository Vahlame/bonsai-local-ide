/** Valida el modelo real: residencia CUDA, herramientas y prompt largo. */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

const args = process.argv.slice(2);
const option = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const base = `http://127.0.0.1:${option("--port", "8080")}`;
const logPath = option("--log", "logs/ornith-gpu.err.log");
const output = option("--salida", "logs/ornith-validacion.json");
const evidence = { fecha: new Date().toISOString(), base, checks: [] };
const check = (nombre, ok, detalle) => {
  evidence.checks.push({ nombre, ok: Boolean(ok), detalle });
  console.log(`${ok ? "OK" : "FALLO"} ${nombre}${detalle === undefined ? "" : `: ${JSON.stringify(detalle)}`}`);
};
async function request(route, body, ms = 180000) {
  const response = await fetch(base + route, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status} ${await response.text()}`);
  return response.json();
}
const settings = { stream: false, temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0, chat_template_kwargs: { enable_thinking: false } };
try {
  const props = await request("/props");
  const nCtx = props.default_generation_settings?.n_ctx || props.n_ctx;
  evidence.contexto = nCtx;
  evidence.modelo = props.model_path;
  check("servidor anuncia Ornith", /Ornith-1\.5-9B/i.test(String(props.model_path)));
  check("contexto minimo de 16K", nCtx >= 16384, nCtx);
  const logs = fs.readFileSync(logPath, "utf8");
  check("proyector de visión en CUDA si está activado", props.modalities?.vision !== true || (/CLIP using CUDA0 backend/i.test(logs) && !/CLIP using CPU backend/i.test(logs)));
  const layers = [...logs.matchAll(/offloaded\s+(\d+)\/(\d+)\s+layers/gi)].pop();
  check("todas las capas en GPU", layers && layers[1] === layers[2] && Number(layers[1]) >= 32, layers?.[0]);
  const hostWeights = [...logs.matchAll(/(?:CPU(?:_Mapped)?|CUDA\d+_Host)\s+model buffer size\s*=\s*([\d.]+)\s*MiB/gi)].filter((match) => Number(match[1]) > 0);
  check("sin pesos en buffers CPU o host", hostWeights.length === 0, hostWeights.map((match) => match[0]));
  check("pesos en CUDA0", /CUDA0\s+model buffer size\s*=\s*[\d.]+\s*MiB/i.test(logs));
  check("cache KV en CUDA0", /CUDA0\s+(?:KV|KV cache) buffer size/i.test(logs));
  check("sin cache KV en CPU", !/(?:CPU|CPU_Mapped)\s+(?:KV|KV cache) buffer size\s*=\s*(?!0(?:\.0+)?\s)[\d.]+\s*MiB/i.test(logs));

  const tools = [{ type: "function", function: { name: "sumar", description: "Suma dos numeros enteros y devuelve el resultado.", parameters: { type: "object", properties: { a: { type: "integer" }, b: { type: "integer" } }, required: ["a", "b"] } } }];
  const messages = [{ role: "user", content: "Usa la herramienta sumar con a=19 y b=23. No hagas el calculo sin la herramienta." }];
  const first = await request("/v1/chat/completions", { ...settings, messages, tools, tool_choice: "auto", max_tokens: 256 });
  const assistant = first.choices?.[0]?.message;
  const call = assistant?.tool_calls?.[0];
  let callArgs;
  try { callArgs = JSON.parse(call?.function?.arguments || "null"); } catch { }
  check("llamada nativa con argumentos correctos", call?.function?.name === "sumar" && callArgs?.a === 19 && callArgs?.b === 23, call);
  if (call) {
    const second = await request("/v1/chat/completions", { ...settings, tools, tool_choice: "none", max_tokens: 128, messages: [...messages, assistant, { role: "tool", tool_call_id: call.id, content: "42" }] });
    const text = second.choices?.[0]?.message?.content || "";
    check("continua tras el resultado de la herramienta", /\b42\b/.test(text), text);
  }

  // Ajusta el texto al contexto que realmente anuncio el servidor, sin gastar
  // memoria en un numero arbitrario de tokens de relleno.
  let lines = Math.floor(nCtx / 15);
  let longMessages;
  let count = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const text = Array.from({ length: lines }, (_, i) => `const item_${i} = ${i * 7};`).join("\n");
    longMessages = [{ role: "user", content: `Lee estas declaraciones como datos, sin ejecutarlas. Al final responde solamente VALIDADO_42.\n${text}\nFIN: VALIDADO_42` }];
    const result = await request("/v1/chat/completions/input_tokens", { ...settings, messages: longMessages });
    count = result.input_tokens ?? result.tokens ?? 0;
    if (count >= nCtx * 0.6 && count <= nCtx * 0.85) break;
    lines = Math.max(100, Math.floor(lines * nCtx * 0.72 / Math.max(count, 1)));
  }
  check("prompt representativo ocupa mas del 60% de la ventana", count >= nCtx * 0.6 && count <= nCtx - 256, count);
  let peakMiB = 0;
  let minFreeMiB = Infinity;
  let sampling = false;
  const sample = () => {
    if (sampling) return;
    sampling = true;
    execFile("nvidia-smi", ["--query-gpu=memory.used,memory.free", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 4000 }, (_err, stdout) => {
      const [used, free] = String(stdout || "").split(/\r?\n/)[0].split(",").map(Number);
      if (Number.isFinite(used)) peakMiB = Math.max(peakMiB, used);
      if (Number.isFinite(free)) minFreeMiB = Math.min(minFreeMiB, free);
      sampling = false;
    });
  };
  sample();
  const timer = setInterval(sample, 1000);
  try {
    const answer = await request("/v1/chat/completions", { ...settings, messages: longMessages, max_tokens: 64 }, 300000);
    evidence.timings = answer.timings;
    check("prefill largo y generacion completan en GPU", /VALIDADO_42/.test(answer.choices?.[0]?.message?.content || ""), answer.choices?.[0]?.message?.content);
  } finally { clearInterval(timer); }
  evidence.vramPicoMiB = peakMiB;
  evidence.vramLibreMinMiB = minFreeMiB;
  check("VRAM dedicada con margen medido", peakMiB > 0 && minFreeMiB >= Number(option("--min-free", "180")), { usadaPico: peakMiB, libreMin: minFreeMiB });
} catch (error) {
  check("validacion completa sin excepcion", false, error.message);
} finally {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
}
if (evidence.checks.some((item) => !item.ok)) process.exitCode = 1;
