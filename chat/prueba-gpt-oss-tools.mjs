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

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-gpt-oss-"));
const server = http.createServer((req, res) => {
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
    if (mode === "peg-error") {
      return json({ error: { code: 500, message: "The model produced output that does not match the expected peg-native format", type: "server_error" } }, 500);
    }
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8" });
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    if (mode === "native") {
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

  // El error peg-native se propaga como ApiError, no como respuesta vacía.
  process.env.MOCK_MODE = "peg-error";
  await assert.rejects(
    () => chat.streamSlice([{ role: "user", content: "dos llamadas" }], 512, false, new AbortController().signal),
    /peg-native/,
  );

  console.log("GPT-OSS tools: nativas, fallback JSON, plantilla Harmony, raw stream y error peg-native OK.");
} finally {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
}
