// La primera respuesta se queda abierta hasta la cancelación; la segunda debe
// llegar a un turno nuevo, sin un 409 ni conexiones del proxy que impidan salir.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-medir-test-"));
let chats = 0;
let cerrado = false;
let segundoSinAnterior = false;
let segundoTrasCancelacion = false;
const server = http.createServer((req, res) => {
  const json = (data) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(data));
  if (req.url === "/health") return json({ status: "ok" });
  if (req.url === "/props") return json({ default_generation_settings: { n_ctx: 32768 }, modalities: { vision: false } });
  if (req.url === "/v1/models") return json({ data: [{ id: "falso" }] });
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === "/v1/chat/completions/input_tokens") return json({ input_tokens: 500 });
    if (req.url !== "/v1/chat/completions") return res.writeHead(404).end();
    chats += 1;
    if (chats === 1) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "pensando" }, finish_reason: null }] })}\n\n`);
      res.on("close", () => { cerrado = true; });
      return;
    }
    segundoSinAnterior = !JSON.stringify(body.messages).includes("Crea expr.py con un analizador");
    segundoTrasCancelacion = cerrado;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Terminé." }, finish_reason: null }] })}\n\n`);
    res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const child = spawn(process.execPath, [path.join(here, "medir-agente.mjs"), "--puerto", String(port), "--modelo", "falso", "--tareas", "arreglar-bugs,parser", "--timeout", "1200"], {
  env: { ...process.env, BONSAI_SALIDA: temp }, windowsHide: true,
});
let output = "";
child.stdout.on("data", (b) => { output += b; });
child.stderr.on("data", (b) => { output += b; });
try {
  const result = await Promise.race([
    new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); }),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`el evaluador no terminó: chats=${chats}, cerrado=${cerrado}, salida=${output}`)), 15000).unref()),
  ]);
  assert.equal(result, 0, output);
  assert.equal(chats, 2, output);
  assert.equal(cerrado, true, "el proxy no canceló la conexión al modelo");
  assert.equal(segundoTrasCancelacion, true, "el siguiente turno empezó antes de cerrar la petición anterior");
  assert.equal(segundoSinAnterior, true, "el segundo turno heredó el primero");
  assert.match(output, /parser\s+INCOMPLETA/);
  assert.match(output, /arreglar-bugs\s+FALLA/); // modelo simulado: no corrigió las fechas
  assert.doesNotMatch(output, /HTTP 409/);
  const archivo = fs.readdirSync(path.join(temp, "formato")).find((n) => n.endsWith(".jsonl"));
  const datos = fs.readFileSync(path.join(temp, "formato", archivo), "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(datos[0].veredicto.incompleta, true);
  assert.equal(datos[1].veredicto.incompleta, undefined);
  console.log("OK: cancelación, proyecto y chat limpios, segundo turno y salida del proxy");
} finally {
  if (child.exitCode === null) child.kill();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  if (path.dirname(path.resolve(temp)) === path.resolve(os.tmpdir()) && path.basename(temp).startsWith("bonsai-medir-test-")) {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
