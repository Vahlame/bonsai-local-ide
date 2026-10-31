/**
 * Humo del editor CodeMirror opt-in: carga, documento, Ctrl+K y guardado.
 * Sin GPU y con un llama-server simulado.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.dirname(HERE);
const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find((ruta) => fs.existsSync(ruta));
if (!EDGE) {
  console.error("prueba editor moderno: no encontré Edge ni Chrome.");
  process.exit(1);
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-editor-cm-"));
const estado = path.join(tmp, "estado");
const proyecto = path.join(tmp, "proyecto");
const salida = path.join(tmp, "salida");
fs.mkdirSync(estado, { recursive: true });
fs.mkdirSync(proyecto, { recursive: true });
fs.writeFileSync(path.join(estado, "ui-workspace.json"), JSON.stringify({ path: proyecto }));
fs.writeFileSync(path.join(estado, "ui-settings.json"), JSON.stringify({ editorModerno: true, historial: 8192, pensar: 0, reglas: false }));
fs.writeFileSync(path.join(estado, "ui-permit.json"), JSON.stringify({ mode: "ask" }));
fs.writeFileSync(path.join(proyecto, "x.txt"), "uno\ndos\ntres\n", "utf8");

let ui = null;
let navegador = null;
let falso = null;
try {
  falso = http.createServer((req, res) => {
    const url = req.url || "";
    const json = (body) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(body));
    };
    if (url === "/health") return json({ status: "ok" });
    if (url === "/props") {
      return json({
        default_generation_settings: { n_ctx: 32768 },
        modalities: { vision: false },
        chat_template_caps: { supports_tools: true },
      });
    }
    if (url === "/v1/models") return json({ data: [{ id: "ficticio" }] });
    let bruto = "";
    req.on("data", (trozo) => (bruto += trozo));
    req.on("end", () => {
      let cuerpo = {};
      try { cuerpo = bruto ? JSON.parse(bruto) : {}; } catch { cuerpo = {}; }
      if (url === "/v1/chat/completions/input_tokens") return json({ input_tokens: 100 });
      if (url !== "/v1/chat/completions") {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end("{}");
      }
      if (!cuerpo.stream) return json({ choices: [{ message: { content: "UNO" } }] });
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const mandar = (delta, finish = null) => res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`);
      mandar({ content: "UNO" });
      mandar({}, "stop");
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  await new Promise((r) => falso.listen(0, "127.0.0.1", r));
  const sonda = http.createServer();
  await new Promise((r) => sonda.listen(0, "127.0.0.1", r));
  const puerto = sonda.address().port;
  await new Promise((r) => sonda.close(r));

  ui = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(puerto), "--llama-port", String(falso.address().port)], {
    cwd: RAIZ,
    env: { ...process.env, BONSAI_STATE: estado, BONSAI_SALIDA: salida, BONSAI_PTY: "0" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let log = "";
  ui.stdout.on("data", (d) => (log += d));
  ui.stderr.on("data", (d) => (log += d));
  let listo = false;
  for (let i = 0; i < 100 && ui.exitCode === null; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${puerto}/api/state`);
      if (r.ok) { listo = true; break; }
    } catch { /* arrancando */ }
    await esperar(100);
  }
  assert.ok(listo, `ui-server no arrancó: ${log}`);

  navegador = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--disable-gpu"] });
  const pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 } });
  const errores = [];
  pagina.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/i.test(m.text())) errores.push(m.text());
  });
  await pagina.goto(`http://127.0.0.1:${puerto}/`, { waitUntil: "domcontentloaded" });
  await pagina.waitForSelector("#tree .row", { timeout: 15000 });
  await pagina.locator("#tree .row .name", { hasText: "x.txt" }).click();
  await pagina.waitForSelector(".editor-cm:not([hidden]) .cm-content", { timeout: 15000 });
  const texto = await pagina.locator(".cm-content").innerText();
  assert.match(texto, /uno/);
  const estadoEditor = await pagina.evaluate(() => window.bonsaiEditor?.());
  assert.equal(estadoEditor?.rel, "x.txt");
  assert.equal(estadoEditor?.linea, 1);

  // Ctrl+K sobre la primera línea: selecciona con teclado y verifica el diff.
  await pagina.locator(".cm-content").click();
  await pagina.keyboard.press("Control+a");
  assert.ok(await pagina.evaluate(() => Boolean(window.selectionInsideEditor?.())), "Ctrl+A debe producir una selección");
  await pagina.keyboard.press("Control+k");
  const dialogo = pagina.locator(".dialogo").last();
  await dialogo.locator("input").waitFor({ timeout: 10000 });
  await dialogo.locator("input").fill("ponlo en mayúsculas");
  await dialogo.getByRole("button", { name: "Editar" }).click();
  await pagina.waitForSelector("pre.diff-preview", { timeout: 20000 });
  assert.match(await pagina.locator("pre.diff-preview").textContent(), /UNO/);
  await pagina.getByRole("button", { name: "Aceptar y guardar" }).click();
  await pagina.waitForFunction(() => (document.querySelector(".avisos")?.textContent || "").includes("Editado x.txt"), null, { timeout: 20000 });
  const guardado = fs.readFileSync(path.join(proyecto, "x.txt"), "utf8");
  assert.equal(guardado, "UNO");

  // xterm se monta en el panel inferior aunque el PTY esté desactivado.
  await pagina.keyboard.press("Control+`");
  await pagina.waitForSelector("#term-out .xterm", { timeout: 15000 });
  assert.ok((await pagina.locator("#term-out .xterm").count()) >= 1);

  assert.deepEqual(errores, [], errores.join("\n"));
  console.log("Editor moderno: CodeMirror carga, expone bonsaiEditor, guarda Ctrl+K y monta xterm.");
} finally {
  if (navegador) await navegador.close().catch(() => {});
  if (ui && ui.exitCode === null) {
    ui.kill();
    await Promise.race([new Promise((r) => ui.once("exit", r)), esperar(3000)]);
  }
  if (falso) await new Promise((r) => falso.close(r));
  if (path.dirname(tmp) === os.tmpdir() && path.basename(tmp).startsWith("bonsai-editor-cm-")) fs.rmSync(tmp, { recursive: true, force: true });
}
