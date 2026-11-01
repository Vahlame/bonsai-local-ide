// Real orchestrator, fake raw Harmony model: protocol recovery, never GPU evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
const root = path.resolve(import.meta.dirname, "..");
const rawCall = (name, args) => `<|channel|>analysis<|message|>Reviso la acción.<|end|><|start|>assistant to=functions.${name}<|channel|>commentary<|message|>${args}<|call|>`;
const webServer = status => `import http from 'node:http';
export async function startServer(port=0) {
 const server=http.createServer((req,res)=>{res.statusCode=${status};res.setHeader('Content-Type','text/html');res.end('<html><body><form>App</form></body></html>');});
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));return server;
}\n`;
for (const mode of ["truncated", "unknown", "indent", "verified_guard", "step_limit", "closing"]) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-harmony-agent-"));
  const state = path.join(temp, "state"), project = path.join(temp, "project");
  fs.mkdirSync(state); fs.mkdirSync(project);
  if (mode === "indent") fs.writeFileSync(path.join(project, "ready.txt"), "  first\n    second");
  if (mode === "verified_guard") {
    fs.writeFileSync(path.join(project, "server.mjs"), webServer(404));
    for (let i = 3; i <= 6; i++) fs.writeFileSync(path.join(project, `read-${i}.txt`), `evidencia ${i}`);
  }
  fs.writeFileSync(path.join(state, "ui-workspace.json"), JSON.stringify({ path: project }));
  fs.writeFileSync(path.join(state, "ui-permit.json"), JSON.stringify({ mode: "all" }));
  fs.writeFileSync(path.join(state, "ui-settings.json"), JSON.stringify({ agentePerfil: "small-local-coder", coderContextTokens: 65536, pensar: 512, memoriaGlobal: false }));
  let calls = 0, finalRequest, ui, log = "", modelError;
  const model = http.createServer(async (req, res) => {
    let body = ""; for await (const data of req) body += data;
    const json = obj => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
    if (req.url === "/props") return json({ default_generation_settings: { n_ctx: 65536 }, model_path: path.join(root, "models/gpt-oss-20b-gpt-oss-20b-MXFP4.gguf") });
    if (req.url === "/v1/models") return json({ data: [{ id: "gpt-oss-20b" }] });
    if (req.url === "/v1/chat/completions/input_tokens") return json({ input_tokens: 1000 });
    if (req.url !== "/v1/chat/completions") return json({ status: "ok" });
    const request = JSON.parse(body); calls++;
    let content;
    if (request.tool_choice === "none") {
      finalRequest = request;
      // Misbehaving model still asks for a tool at finalization. It must never run.
      content = rawCall("archivo", '{"ruta":"must-not-exist.txt","contenido":"unsafe"}');
    } else if (mode === "verified_guard") {
      try {
        if (calls === 1) content = rawCall("leer", '{"ruta":"server.mjs"}');
        else if (calls === 2) content = rawCall("archivo", '{"ruta":"ready.txt","contenido":"completo"}');
        else if (calls <= 6) content = rawCall("leer", JSON.stringify({ ruta: `read-${calls}.txt` }));
        else if (calls === 7) {
          assert.ok(request.messages.some(message => message.content?.includes("GET / devolvió 404")), "el atajo VERIFY debe devolver el fallo HTTP al modelo");
          content = rawCall("archivo", JSON.stringify({ ruta: "server.mjs", contenido: webServer(200) }));
        } else content = "<|channel|>final<|message|>Interfaz HTTP corregida y comprobada.<|return|>";
      } catch (error) { modelError = error; content = "<|channel|>final<|message|>Fallo en la regresión del cierre.<|return|>"; }
    } else if (mode === "indent") {
      try {
        if (calls === 1) content = rawCall("leer", '{"ruta":"ready.txt"}');
        else if (calls === 2) content = rawCall("reemplazar", JSON.stringify({ ruta: "ready.txt", buscar: "first\nsecond", poner: "completo" }));
        else if (calls === 3) {
          assert.equal(fs.readFileSync(path.join(project, "ready.txt"), "utf8"), "  first\n    second", "no hay edición difusa");
          const result = request.messages.find(message => message.role === "tool" && message.content.includes("DATO COMPROBADO: el bloque"));
          assert.ok(result, "el dato exacto debe llegar al modelo");
          const buscar = JSON.parse(result.content.split("espacios): ")[1].split("\n")[0]);
          content = rawCall("reemplazar", JSON.stringify({ ruta: "ready.txt", buscar, poner: "completo" }));
        } else content = "<|channel|>final<|message|>Archivo creado y comprobado.<|return|>";
      } catch (error) {
        modelError = error;
        console.error("Recuperación recibida:", JSON.stringify(request.messages.filter(message => message.role === "tool")));
        content = "<|channel|>final<|message|>La prueba no recibió recuperación.<|return|>";
      }
    } else if (mode === "closing") content = rawCall("made_up_tool", "{}");
    else if (mode === "step_limit") content = rawCall("archivo", '{"ruta":"ready.txt","contenido":"completo"}');
    else if (calls === 1) content = mode === "truncated"
      ? rawCall("archivo", '{"ruta":"ready.txt","contenido":"half')
      : rawCall("made_up_tool", "{}");
    else if (calls === 2) content = rawCall("archivo", '{"ruta":"ready.txt","contenido":"completo"}');
    else content = "<|channel|>final<|message|>Archivo creado y comprobado.<|return|>";
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(r => model.listen(0, "127.0.0.1", r));
  const probe = http.createServer(); await new Promise(r => probe.listen(0, "127.0.0.1", r));
  const port = probe.address().port; await new Promise(r => probe.close(r));
  const base = `http://127.0.0.1:${port}`;
  try {
    ui = spawn(process.execPath, ["chat/ui-server.mjs", "--port", String(port), "--llama-port", String(model.address().port)], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, BONSAI_STATE: state, BONSAI_SALIDA: path.join(temp, "out"), BONSAI_PTY: "0", BONSAI_CODER_OPTIONS: mode === "step_limit" ? JSON.stringify({ maxSteps: 1 }) : "" } });
    ui.stdout.on("data", d => { log += d; }); ui.stderr.on("data", d => { log += d; });
    let ready = false;
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + "/api/state")).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 50)); }
    assert.ok(ready, log);
    const text = mode === "verified_guard" ? "Termina la interfaz HTML de la app Node.js HTTP y crea ready.txt con el texto completo." : "Crea ready.txt con el texto completo y termina el turno.";
    const response = await fetch(base + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, modo: "agente" }), signal: AbortSignal.timeout(30000) });
    const events = (await response.text()).split("\n").filter(l => l.startsWith("data: ")).map(l => JSON.parse(l.slice(6)));
    const done = events.findLast(e => e.type === "done"); assert.ok(done, log);
    if (modelError) throw modelError;
    assert.equal(fs.existsSync(path.join(project, "must-not-exist.txt")), false);
    if (!["closing", "step_limit"].includes(mode)) {
      assert.equal(fs.readFileSync(path.join(project, "ready.txt"), "utf8"), "completo");
      assert.equal(done.incompleto, false, JSON.stringify(events.slice(-4)));
      if (mode === "verified_guard") {
        assert.equal(fs.readFileSync(path.join(project, "server.mjs"), "utf8"), webServer(200));
        assert.ok(calls >= 8 && calls < 12, `recuperación HTTP acotada: ${calls}`);
      } else assert.ok(calls >= 3 && calls < 7, `recuperación acotada: ${calls}`);
    } else {
      assert.equal(done.incompleto, true);
      assert.equal(finalRequest.tools, undefined);
      assert.match(finalRequest.messages[0].content, /resumen final/i);
      assert.ok(events.some(e => e.type === "replace" && e.text.trim()));
      assert.ok(calls < 12, `límite de tools inválidas: ${calls}`);
      if (mode === "step_limit") {
        assert.equal(done.motivo, "step_limit");
        assert.equal(calls, 2, "un paso y un único resumen sin herramientas");
      }
    }
    console.log(`GPT-OSS agente ${mode}: recuperación/cierre y efectos en disco verificados (${calls} peticiones).`);
  } finally {
    if (ui?.exitCode === null) { const exited = once(ui, "exit"); ui.kill(); await exited; }
    model.closeAllConnections(); await new Promise(r => model.close(r));
    assert.equal(path.dirname(temp), os.tmpdir()); assert.ok(path.basename(temp).startsWith("bonsai-harmony-agent-")); fs.rmSync(temp, { recursive: true, force: true });
  }
}
