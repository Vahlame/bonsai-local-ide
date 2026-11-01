// Real UI + real Windows process inspection; an unrelated HTTP listener must survive.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright-core";

const root = path.resolve(import.meta.dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-lifecycle-browser-"));
const state = path.join(temp, "state"), project = path.join(temp, "project");
fs.mkdirSync(state); fs.mkdirSync(project);
fs.writeFileSync(path.join(project, "dirty.txt"), "original\n");
fs.writeFileSync(path.join(state, "ui-workspace.json"), JSON.stringify({ path: project }));
fs.writeFileSync(path.join(state, "ui-settings.json"), JSON.stringify({ editorModerno: true, preguntarModeloInicio: false }));
const foreign = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(req.url === "/props" ? { default_generation_settings: { n_ctx: 8192 } } : req.url === "/v1/models" ? { data: [{ id: "foreign" }] } : { status: "ok" }));
});
await new Promise((r) => foreign.listen(0, "127.0.0.1", r));
const modelPort = foreign.address().port;
const probe = http.createServer();
await new Promise((r) => probe.listen(0, "127.0.0.1", r));
const uiPort = probe.address().port;
await new Promise((r) => probe.close(r));
const base = `http://127.0.0.1:${uiPort}`;
let ui, browser, output = "";
try {
  ui = spawn(process.execPath, ["chat/ui-server.mjs", "--port", String(uiPort), "--llama-port", String(modelPort)], {
    cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BONSAI_STATE: state, BONSAI_SALIDA: path.join(temp, "out"), BONSAI_PTY: "0" },
  });
  ui.stdout.on("data", (d) => { output += d; }); ui.stderr.on("data", (d) => { output += d; });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${base}/api/state`)).ok) { ready = true; break; } } catch { }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, output);
  assert.equal((await (await fetch(`${base}/api/server/state`)).json()).state, "foreign");
  const failedStop = await fetch(`${base}/api/server/stop`, { method: "POST" });
  assert.equal(failedStop.status, 409);
  assert.equal((await failedStop.json()).state, "foreign");
  assert.equal((await fetch(`http://127.0.0.1:${modelPort}/health`)).ok, true);

  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(fs.existsSync);
  assert.ok(executablePath, "Falta Edge/Chrome");
  browser = await chromium.launch({ executablePath, headless: true, args: ["--disable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator("#tree .row .name", { hasText: "dirty.txt" }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("sin guardar");
  await page.locator("#cerrar-bonsai").click();
  await page.locator(".dialogo").waitFor();
  assert.match(await page.locator(".dialogo").textContent(), /cambios sin guardar/);
  await page.locator(".dialogo button.primary").click();
  await page.waitForFunction(() => document.querySelector("#avisos")?.textContent.includes("no administra"));
  assert.equal(await page.locator("#cerrar-bonsai").isEnabled(), true, "debe permitir reintentar");
  assert.equal((await fetch(`${base}/api/state`)).ok, true, "el cierre fallido dejó la UI viva");
  assert.equal((await fetch(`http://127.0.0.1:${modelPort}/health`)).ok, true, "el proceso ajeno sigue vivo");
  assert.equal(fs.readFileSync(path.join(project, "dirty.txt"), "utf8"), "original\n");

  foreign.closeAllConnections();
  await new Promise((r) => foreign.close(r));
  const stops = await Promise.all([1, 2].map(() => fetch(`${base}/api/server/stop`, { method: "POST" })));
  assert.deepEqual(stops.map((r) => r.status), [200, 200]);
  for (const r of stops) assert.equal((await r.json()).portClosed, true);
  // Exercise the actual controller request with saved CUSTOM settings, without loading a model.
  await fetch(`${base}/api/settings`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coderContextTokens: 65536, engineKv: "q8_0", engineVision: false }) });
  let startBody;
  await page.route("**/api/server/start", async (route) => {
    startBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, state: "empty" }) });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#server-preset").selectOption("CUSTOM");
  await page.locator("#server-start").click();
  await page.waitForResponse((r) => r.url().endsWith("/api/server/state") && r.request().method() === "GET");
  assert.equal(startBody.contexto, 65536);
  assert.equal(startBody.kv, "q8_0");
  assert.equal(startBody.vision, false);
  await page.unroute("**/api/server/start");
  // Reload discarded the unsaved buffer; make it dirty again for the real close retry.
  await page.locator("#tree .row .name", { hasText: "dirty.txt" }).click();
  await page.locator(".cm-content").click();
  await page.keyboard.type("sin guardar");
  const alias = await fetch(`${base}/api/servidor`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accion: "apagar" }) });
  assert.equal((await alias.json()).state, "empty");
  // State polling must settle before the retry button becomes available.
  await page.locator("#cerrar-bonsai").click();
  await page.locator(".dialogo button.primary").click();
  await page.waitForFunction(() => document.body.textContent.includes("IDE e IA cerrados"));
  const exited = ui.exitCode === null ? once(ui, "exit") : Promise.resolve();
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error("La UI quedó viva")), 5000))]);
  assert.equal(ui.exitCode, 0);
  assert.deepEqual(errors, []);
  console.log("Lifecycle navegador: foreign preservado, error visible, cambios sin guardar confirmados, dos stop 200, CUSTOM guardado, alias y cierre real de Node correctos.");
} finally {
  if (browser) await browser.close();
  if (ui?.exitCode === null) { const done = once(ui, "exit"); ui.kill(); await done; }
  if (foreign.listening) { foreign.closeAllConnections(); await new Promise((r) => foreign.close(r)); }
  assert.equal(path.dirname(temp), os.tmpdir());
  assert.ok(path.basename(temp).startsWith("bonsai-lifecycle-browser-"));
  fs.rmSync(temp, { recursive: true, force: true });
}
