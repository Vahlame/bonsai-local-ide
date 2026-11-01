// Independent acceptance checks of the unedited GPT-OSS output. No model inference.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { chromium } from "../chat/node_modules/playwright-core/index.mjs";
const directory = path.resolve(process.argv[2] || "reports/agent-ui-2026-11-01/gpt-oss-first");
const project = path.join(directory, "generated-project");
const result = { time: new Date().toISOString(), checks: [] };
let server, browser, cli;
const check = (name, detail) => { result.checks.push({ name, ok: true, detail }); };
try {
  const app = await import(pathToFileURL(path.join(project, "server.mjs")));
  server = await app.startServer(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(base + "/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Validación independiente" }) });
  assert.equal(response.status, 201); const task = await response.json(); check("API crear", task.id);
  response = await fetch(base + `/api/tasks/${task.id}`, { method: "PATCH" });
  assert.equal(response.status, 200); assert.equal((await response.json()).completed, true); check("API completar");
  assert.ok((await (await fetch(base + "/api/tasks")).json()).some(t => t.id === task.id)); check("API listar");
  const store = JSON.parse(fs.readFileSync(path.join(project, "data.json"), "utf8"));
  assert.ok(store.some(t => t.id === task.id && t.completed)); check("Persistencia JSON");
  response = await fetch(base + `/api/tasks/${task.id}`, { method: "DELETE" }); assert.equal(response.status, 204); check("API borrar");
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(fs.existsSync);
  browser = await chromium.launch({ executablePath, headless: true, args: ["--disable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator("#title").fill("Comprar café");
  await page.locator('#taskForm button[type="submit"]').click();
  await page.locator("#tasks li", { hasText: "Comprar café" }).waitFor(); check("UI añadir");
  await page.reload({ waitUntil: "networkidle" });
  const row = page.locator("#tasks li", { hasText: "Comprar café" }); await row.waitFor(); check("UI recarga persistente");
  await row.locator("button").first().click();
  await page.locator("#tasks li.completed", { hasText: "Comprar café" }).waitFor(); check("UI completar");
  await page.screenshot({ path: path.join(directory, "todo-app.png") });
  await page.locator("#tasks li", { hasText: "Comprar café" }).locator("button").last().click();
  await page.locator("#tasks li", { hasText: "Comprar café" }).waitFor({ state: "detached" }); check("UI borrar");
  assert.deepEqual(errors, []); check("Navegador sin errores");
  const occupied = await new Promise(resolve => {
    const socket = net.connect({ host: "127.0.0.1", port: 3000 });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
  });
  if (occupied) result.checks.push({ name: "CLI node server.mjs", skipped: true, detail: "3000 ya ocupado; no se intervino ese proceso." });
  else {
    let output = "";
    cli = spawn(process.execPath, ["server.mjs"], { cwd: project, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    cli.stdout.on("data", data => { output += data; }); cli.stderr.on("data", data => { output += data; });
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      assert.equal(cli.exitCode, null, output);
      try { const res = await fetch("http://127.0.0.1:3000", { signal: AbortSignal.timeout(500) }); if (res.status === 200 && /taskForm/.test(await res.text())) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, "node server.mjs no sirvió la app: " + output);
    check("CLI node server.mjs", { pid: cli.pid, port: 3000 });
  }
  result.ok = true;
} catch (err) { result.ok = false; result.error = err.stack; process.exitCode = 1; }
finally {
  if (cli?.exitCode === null) { const exited = once(cli, "exit"); cli.kill(); await exited; }
  if (browser) await browser.close();
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  fs.writeFileSync(path.join(directory, "acceptance.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
