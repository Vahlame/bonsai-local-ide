/**
 * Pruebas del camino GPT-OSS/Harmony: tool calls nativas, JSON suelto en content,
 * plantilla de razonamiento y captura de la salida cruda.
 *
 * No necesita GPU ni llama-server real: simula el streaming SSE exacto del servidor.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { BonsaiChat } from "./bonsai-chat.mjs";
import { llamadasCrudas } from "./adaptadores.mjs";
import { nativeToolEffects } from "./actions.mjs";
import { parseHarmony, createHarmonyProgress } from "./harmony.mjs";
import { nodeRuntimeGuide, runtimeFailureFacts, replacementFailureFacts, webAppFailureFacts } from "./runtime-facts.mjs";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-gpt-oss-"));
let requests = 0;
let lastBody = null;
const server = http.createServer(async (req, res) => {
  let rawBody = "";
  for await (const chunk of req) rawBody += chunk;
  const json = (data, status = 200) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (req.url === "/health") return json({ status: "ok" });
  if (req.url === "/props") {
    return json({
      default_generation_settings: { n_ctx: 65536 },
      chat_template_caps: {
        supports_tools: true,
        supports_tool_calls: true,
        supports_reasoning_effort: true,
        reasoning_effort_levels: ["minimal", "low", "medium", "high", "xhigh", "max"],
      },
    });
  }
  if (req.url === "/v1/models") return json({ data: [{ id: "gpt-oss-20b" }] });
  if (req.url === "/v1/chat/completions/input_tokens") return json({ input_tokens: 42 });
  if (req.url === "/v1/chat/completions") {
    const mode = process.env.MOCK_MODE || "native";
    requests += 1;
    lastBody = rawBody ? JSON.parse(rawBody) : null;
    if (mode === "peg-then-json" && requests <= 2) {
      return json({ error: { code: 500, message: "The model produced output that does not match the expected peg-native format", type: "server_error" } }, 500);
    }
    if (mode === "peg-error") {
      return json({ error: { code: 500, message: "The model produced output that does not match the expected peg-native format", type: "server_error" } }, 500);
    }
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (mode === "raw-slow") {
      send({ choices: [{ delta: { content: '<|channel|>analysis<|message|>Revisando el proyecto.<|end|><|start|>assistant to=functions.archivo<|channel|>commentary<|message|>{"ruta":"progreso.txt","contenido":"' } }] });
      await new Promise(r => setTimeout(r, 450));
      send({ choices: [{ delta: { content: 'completo"}<|call|>' }, finish_reason: "stop" }] });
    } else if (mode === "native") {
      send({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "archivo", arguments: "{\"ruta\":\"a.txt\",\"contenido\":\"uno\"}" },
            }],
          },
        }],
      });
      send({ choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else {
      send({ choices: [{ delta: { content: "{\"name\":\"functions.archivo\",\"arguments\":{\"ruta\":\"a.txt\",\"contenido\":\"uno\"}};" } }] });
      send({ choices: [{ delta: { content: "{\"name\":\"functions.archivo\",\"arguments\":{\"ruta\":\"b.txt\",\"contenido\":\"dos\"}}" } }] });
      send({ choices: [{ delta: {}, finish_reason: "stop" }] });
    }
    res.write("data: [DONE]\n\n");
    res.end();
    return;
  }
  json({ error: "no encontrado" }, 404);
});

try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const chat = new BonsaiChat({
    host: "127.0.0.1",
    port,
    historyCap: 4096,
    sessionPath: path.join(temp, "session.json"),
    timingsPath: path.join(temp, "timings.jsonl"),
    think: 512,
    perfil: "codigo",
  });
  await chat.connect();
  chat.silent = true;

  for (const header of ["assistant to=functions.leer<|channel|>analysis", "assistant<|channel|>commentary to=functions.leer"]) {
    const parsed = parseHarmony(`<|start|>${header}<|message|>{"ruta":"a.txt"}<|call|>`);
    assert.equal(parsed.calls[0]?.name, "leer");
    assert.equal(parsed.calls[0]?.arguments.ruta, "a.txt");
    assert.equal(parsed.reasoning, "");
  }
  const seen = { reasoning: "", final: "", tools: [] };
  const progress = createHarmonyProgress({ reasoning: t => { seen.reasoning += t; }, final: t => { seen.final += t; }, tool: t => seen.tools.push(t) });
  const text = '<|channel|>analysis<|message|>Pensando.<|end|><|start|>assistant<|channel|>final<|message|>Listo.<|return|>';
  for (let i = 1; i <= text.length; i++) progress(text.slice(0, i));
  assert.equal(seen.reasoning, "Pensando.");
  assert.equal(seen.final, "Listo.");
  assert.ok(nodeRuntimeGuide().includes("fileURLToPath"));
  const indented = "\tif (ready) {\r\n\t  run();\r\n\t}";
  const recovery = replacementFailureFacts(indented, "  if (ready) {\n    run();\n  }");
  assert.ok(recovery.includes(JSON.stringify(indented)), "la recuperación conserva tabs y CRLF exactos");
  assert.equal(replacementFailureFacts(indented + "\r\n" + indented, "if (ready) {\nrun();\n}"), "", "no se sugiere un bloque ambiguo");
  assert.equal(replacementFailureFacts(indented, "if (different) {\nrun();\n}"), "", "no se reinterpretan cambios de código");
  assert.match(await runtimeFailureFacts("The requested module 'node:test' does not provide an export named 'afterAll'"), /Exportaciones reales:.*after/);
  const webSignal = webAppFailureFacts("const publicDir = new URL('./public', import.meta.url);\nconst fileUrl = new URL(pathname, publicDir);\n");
  assert.match(webSignal, /barra final/);
  assert.match(webSignal, /barra inicial/);
  assert.equal(webAppFailureFacts("const files = new URL('./public/', import.meta.url);"), "");

  const events = [];
  chat.push = e => events.push(e);
  process.env.MOCK_MODE = "raw-slow";
  const streaming = chat.streamSlice([{ role: "user", content: "crea progreso.txt" }], 512, false, new AbortController().signal);
  await new Promise(r => setTimeout(r, 150));
  assert.ok(events.some(e => e.type === "reasoning" && e.text.includes("Revisando")), "razonamiento antes de terminar SSE");
  assert.ok(events.some(e => e.type === "tool_progress" && e.name === "archivo"), "progreso de JSON parcial antes de ejecutar");
  const completed = await streaming;
  assert.deepEqual(JSON.parse(completed.toolCalls[0].arguments), { ruta: "progreso.txt", contenido: "completo" });
  assert.equal(events.filter(e => e.type === "reasoning").map(e => e.text).join(""), "Revisando el proyecto.");
  chat.faseSalto = "final"; chat.toolChoice = "none"; chat.actOnPc = true;
  assert.equal(chat.toolFields().tools, undefined, "el cierre retira herramientas");
  chat.faseSalto = "plan"; chat.toolChoice = "auto";

  // La plantilla GPT-OSS recibe reasoning_effort, no enable_thinking.
  const fields = chat.templateFields(true);
  assert.equal(fields.chat_template_kwargs.enable_thinking, undefined);
  assert.equal(fields.chat_template_kwargs.reasoning_effort, "medium");
  assert.ok(fields.thinking_budget_tokens > 0);

  // Tool call nativa: el servidor manda delta.tool_calls.
  process.env.MOCK_MODE = "native";
  const native = await chat.streamSlice([{ role: "user", content: "crea a.txt" }], 512, false, new AbortController().signal);
  assert.equal(native.toolCalls.length, 1);
  assert.equal(native.toolCalls[0].name, "archivo");
  const nativeArgs = JSON.parse(native.toolCalls[0].arguments);
  assert.equal(nativeArgs.ruta, "a.txt");

  // GPT-OSS puede dejar el JSON en content: el dialecto lo recupera y los efectos lo aplican.
  process.env.MOCK_MODE = "content";
  const raw = await chat.streamSlice([{ role: "user", content: "crea a.txt y b.txt" }], 512, false, new AbortController().signal);
  assert.equal(raw.toolCalls.length, 0);
  const calls = llamadasCrudas(raw.chunk, "nativo gpt-oss-json");
  assert.equal(calls.length, 2);
  const effects = nativeToolEffects(calls);
  assert.deepEqual(effects.writes.map((w) => w.rel), ["a.txt", "b.txt"]);
  assert.equal(effects.writes[1].content, "dos");

  // La salida cruda queda en el archivo de diagnóstico, con tool_calls y content.
  const rawPath = path.join(temp, "raw.jsonl");
  chat.rawStreamPath = rawPath;
  process.env.MOCK_MODE = "native";
  await chat.streamSlice([{ role: "user", content: "otra" }], 256, false, new AbortController().signal);
  const rawLines = fs.readFileSync(rawPath, "utf8").trim().split("\n");
  assert.ok(rawLines.length >= 2, "debe guardar cada evento SSE");
  assert.ok(rawLines.some((line) => line.includes("tool_calls")));

  // peg-native: reintento sin tools nativas, catálogo como texto y JSON parseable.
  requests = 0;
  chat.actOnPc = true;
  process.env.MOCK_MODE = "peg-then-json";
  const retry = await chat.streamSlice([{ role: "user", content: "dos llamadas" }], 512, false, new AbortController().signal);
  assert.equal(retry.toolCalls.length, 0);
  const retryCalls = llamadasCrudas(retry.chunk, "nativo gpt-oss-json");
  assert.equal(requests, 3, "primer intento + reintento nativo + reintento JSON");
  assert.equal(retryCalls.length, 2);
  assert.equal(lastBody.tools, undefined, "el reintento no debe enviar tools nativas");
  assert.match(String(lastBody.messages[0].content), /REINTENTO SIN PARSER NATIVO/);
  assert.match(String(lastBody.messages[0].content), /"archivo"/);

  // El error peg-native se propaga como ApiError, no como respuesta vacía.
  process.env.MOCK_MODE = "peg-error";
  await assert.rejects(
    () => chat.streamSlice([{ role: "user", content: "dos llamadas" }], 512, false, new AbortController().signal),
    /peg-native/,
  );

  console.log("GPT-OSS tools: nativas, fallback JSON, plantilla Harmony, raw stream, reintento peg-native y error final OK.");
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
}
