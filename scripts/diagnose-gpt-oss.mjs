// Diagnosis of the existing agent protocol. Model writes only in its report workspace.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";

const root = path.resolve(import.meta.dirname, "..");
const directory = path.resolve(process.env.BONSAI_EVIDENCE_DIR || path.join(root, "reports/lifecycle-2026-11-01/gpt-oss-diagnostic"));
const state = path.join(directory, "state"), project = path.join(directory, "project");
assert.equal(fs.existsSync(directory), false, "usa una carpeta nueva para conservar las evidencias anteriores");
fs.mkdirSync(state, { recursive: true }); fs.mkdirSync(project);
fs.writeFileSync(path.join(directory, ".gitignore"), "project/\n");
// Keep git_diff and any model-issued Git commands inside the disposable workspace.
execFileSync("git", ["-C", project, "init", "--quiet"], { windowsHide: true });
// Preserve the user's effective profile, context and thinking settings in an isolated state.
const settings = JSON.parse(fs.readFileSync(path.join(root, "chat/ui-settings.json"), "utf8"));
fs.writeFileSync(path.join(state, "ui-settings.json"), JSON.stringify(settings, null, 2));
fs.writeFileSync(path.join(state, "ui-workspace.json"), JSON.stringify({ path: project }));
fs.writeFileSync(path.join(state, "ui-permit.json"), JSON.stringify({ mode: "all" }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", (e) => { socket.destroy(); if (e.code === "ECONNREFUSED") resolve(false); else reject(e); });
    socket.setTimeout(1000, () => { socket.destroy(); reject(new Error(`timeout TCP ${port}`)); });
  });
}
assert.equal(await open(8080), false, "8080 debe estar libre");
assert.equal(await open(8787), false, "8787 debe estar libre");
const base = "http://127.0.0.1:8787", events = [];
const evidence = { started: new Date().toISOString(), settings, prompt: "Crea y termina una aplicación de tareas en esta carpeta vacía. Usa Node.js con módulos ESM y HTTP nativo, sin dependencias nuevas, y una interfaz HTML/CSS/JS. Debe permitir añadir, listar, completar y borrar tareas mediante GET/POST/PATCH/DELETE /api/tasks, guardar los datos en un JSON local y funcionar al ejecutar node server.mjs. Incluye pruebas con node --test para crear, completar y borrar, ejecútalas y corrige los fallos. No inicies servidores persistentes ni uses procesos en segundo plano. Al terminar responde en español con los archivos creados y el resultado real de las pruebas." };
let ui, started = false, output = "";
async function api(route, body, timeoutMs = 300000) {
  const res = await fetch(base + route, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${route}: HTTP ${res.status} ${await res.text()}`);
  return res;
}
try {
  ui = spawn(process.execPath, ["chat/ui-server.mjs", "--port", "8787", "--llama-port", "8080"], {
    cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BONSAI_STATE: state, BONSAI_SALIDA: path.join(directory, "out"), BONSAI_PTY: "0", BONSAI_RAW_STREAM: path.join(directory, "raw-stream.jsonl") },
  });
  ui.stdout.on("data", (d) => { output += d; }); ui.stderr.on("data", (d) => { output += d; });
  for (let i = 0; i < 100 && !await open(8787); i++) { assert.equal(ui.exitCode, null, output); await wait(100); }
  evidence.launch = await (await api("/api/server/start", { model: "gpt-oss-20b", preset: "CUSTOM", contexto: settings.coderContextTokens, kv: settings.engineKv, vision: false, pensar: settings.pensar })).json();
  started = true;
  evidence.before = await (await api("/api/state")).json();
  fs.writeFileSync(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2));
  const res = await api("/api/chat", { text: evidence.prompt, modo: "agente" }, 900000);
  const decoder = new TextDecoder(); let buffer = "";
  for await (const data of res.body) {
    fs.appendFileSync(path.join(directory, "ui-stream.sse"), data);
    buffer += decoder.decode(data, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      for (const line of frame.split("\n")) if (line.startsWith("data: ")) {
        const event = JSON.parse(line.slice(6)); events.push(event);
        if (["action", "status", "error", "done", "task_state"].includes(event.type)) console.log(JSON.stringify(event));
      }
    }
  }
  evidence.done = events.filter((e) => e.type === "done").at(-1) || null;
  evidence.errors = events.filter((e) => e.type === "error");
  evidence.after = await (await api("/api/state")).json();
  evidence.streamEnded = true;
} catch (err) {
  evidence.error = err.stack;
  console.error(err.stack);
  process.exitCode = 1;
} finally {
  try {
    if (ui?.exitCode === null) {
      await api("/api/stop", {}, 10000);
      for (let i = 0; i < 100; i++) {
        if (!(await (await api("/api/state", undefined, 10000)).json()).busy) break;
        await wait(100);
      }
      evidence.cleanup = await (await api("/api/server/close", {}, 60000)).json();
      if (ui.exitCode === null) await Promise.race([once(ui, "exit"), new Promise((_, reject) => setTimeout(() => reject(new Error("Node no cerró")), 5000))]);
    }
  } catch (err) { evidence.cleanupError = err.message; process.exitCode = 1; }
  if (!started) evidence.modelNeverReady = true;
  evidence.finished = new Date().toISOString();
  evidence.finalPorts = { model: await open(8080), ide: await open(8787) };
  fs.writeFileSync(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2));
  fs.writeFileSync(path.join(directory, "ui.log"), output);
  // Retain the disposable Git repository; export only reviewable generated files.
  fs.cpSync(project, path.join(directory, "generated-project"), { recursive: true, filter: (source) => path.basename(source) !== ".git" });
  console.log(JSON.stringify({ done: evidence.done, error: evidence.error, cleanupError: evidence.cleanupError, finalPorts: evidence.finalPorts }));
}
