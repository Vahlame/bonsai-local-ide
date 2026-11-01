// Real Edge UI, isolated filesystem and simulated model. No GPU claims.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright-core";
const root = path.resolve(import.meta.dirname, "..");
const report = path.resolve(process.env.BONSAI_UI_EVIDENCE_DIR || path.join(root, "reports/agent-ui-2026-11-01", `appearance-${Date.now()}`));
fs.mkdirSync(report, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-appearance-"));
const state = path.join(temp, "state"), project = path.join(temp, "project");
fs.mkdirSync(state); fs.mkdirSync(project);
fs.writeFileSync(path.join(project, "app.mjs"), `// Una idea pequeña. Un espacio para hacerla crecer.\nimport { createServer } from 'node:http';\n\nconst tasks = new Map();\n\nexport function addTask(title) {\n  const task = { id: crypto.randomUUID(), title, done: false };\n  tasks.set(task.id, task);\n  return task;\n}\n\nexport function completeTask(id) {\n  const task = tasks.get(id);\n  if (!task) throw new Error('Tarea no encontrada');\n  task.done = true;\n  return task;\n}\n\nexport const listTasks = () => [...tasks.values()];\n`);
fs.writeFileSync(path.join(project, "README.md"), "# Mi próximo proyecto\nUna aplicación de tareas local.\n");
fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "mi-proyecto", type: "module" }));
fs.writeFileSync(path.join(state, "ui-workspace.json"), JSON.stringify({ path: project }));
fs.writeFileSync(path.join(state, "ui-settings.json"), JSON.stringify({ tema: "slate", preguntarModelo: false }));
const model = http.createServer((req, res) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(req.url === "/props" ? { default_generation_settings: { n_ctx: 65536 } } : req.url === "/v1/models" ? { data: [{ id: "local-test" }] } : { status: "ok" })); });
await new Promise(r => model.listen(0, "127.0.0.1", r));
const probe = http.createServer(); await new Promise(r => probe.listen(0, "127.0.0.1", r));
const port = probe.address().port; await new Promise(r => probe.close(r));
const base = `http://127.0.0.1:${port}`;
let ui, browser, log = "";
try {
  ui = spawn(process.execPath, ["chat/ui-server.mjs", "--port", String(port), "--llama-port", String(model.address().port)], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, BONSAI_STATE: state, BONSAI_SALIDA: path.join(temp, "out"), BONSAI_PTY: "0" } });
  ui.stdout.on("data", d => { log += d; }); ui.stderr.on("data", d => { log += d; });
  let ready = false;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + "/api/state")).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 100)); }
  assert.ok(ready, log);
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(fs.existsSync);
  browser = await chromium.launch({ executablePath, headless: true, args: ["--disable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.locator("#tree .name", { hasText: "app.mjs" }).click();
  await page.locator(".cm-content").waitFor();
  assert.ok(await page.locator(".top button .ico").count() >= 12);
  const sizes = async () => page.evaluate(() => Object.fromEntries(["sidebar", "editor", "chat"].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return [id, { x: r.x, y: r.y, width: r.width, height: r.height }]; })));
  let layout = await sizes();
  assert.ok(layout.editor.width > 800 && layout.sidebar.width <= 240 && layout.chat.width <= 480, JSON.stringify(layout));
  const editorBefore = layout.editor.width;
  await page.locator("#tog-history").click();
  assert.equal(await page.locator("#history").isVisible(), true);
  assert.equal(await page.locator("#files").isVisible(), false);
  assert.equal((await sizes()).editor.width, editorBefore, "el historial usa la misma columna");
  await page.locator("#tog-history").press("ArrowLeft");
  assert.equal(await page.locator("#tog-files").getAttribute("aria-selected"), "true");
  await page.locator('.gutter[data-pane="side"]').focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(Math.round((await sizes()).sidebar.width), Math.round(layout.sidebar.width + 20));
  assert.equal(await page.locator('.gutter[data-pane="side"]').getAttribute("aria-valuenow"), String(Math.round(layout.sidebar.width + 20)));
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(Math.round((await sizes()).sidebar.width), Math.round(layout.sidebar.width + 20), "tamaño guardado");
  await page.locator('.gutter[data-pane="side"]').dblclick();
  assert.equal(Math.round((await sizes()).sidebar.width), Math.round(layout.sidebar.width), "doble clic restablece el tamaño");
  const divider = await page.locator('.gutter[data-pane="side"]').boundingBox();
  await page.mouse.move(divider.x + divider.width / 2, divider.y + divider.height / 2);
  await page.mouse.down(); await page.mouse.move(divider.x + divider.width / 2 + 30, divider.y + divider.height / 2, { steps: 4 }); await page.mouse.up();
  assert.equal(Math.round((await sizes()).sidebar.width), Math.round(layout.sidebar.width + 30), "arrastrar redimensiona la barra");
  await page.locator('.gutter[data-pane="side"]').dblclick();
  await page.locator("#tree .name", { hasText: "app.mjs" }).click();
  await page.locator(".cm-content").waitFor();
  await page.screenshot({ path: path.join(report, "appearance-graphite.png") });
  await page.locator("#tema").click();
  assert.equal(await page.locator(".theme-dialog .theme-card").count(), 12);
  await page.locator(".theme-dialog").evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  await page.screenshot({ path: path.join(report, "theme-gallery.png") });
  const themes = JSON.parse(fs.readFileSync(path.join(root, "chat/ui/themes.json")));
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).map(component => { const value = parseInt(component, 16) / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  };
  for (const theme of themes) {
    for (const color of [theme.colors[3], theme.colors[4]]) {
      const [high, low] = [luminance(color), luminance(theme.colors[1])].sort((a, b) => b - a);
      assert.ok((high + .05) / (low + .05) >= 4.5, `contraste de texto en ${theme.id}`);
    }
    await page.locator(`.theme-dialog [data-theme-id="${theme.id}"]`).click();
    await page.waitForFunction(id => document.documentElement.dataset.theme === id, theme.id);
    assert.equal((await (await fetch(base + "/api/settings")).json()).tema, theme.id);
    assert.equal(await page.locator(`.theme-dialog [data-theme-id="${theme.id}"]`).getAttribute("aria-pressed"), "true");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, `overflow en ${theme.id}`);
  }
  await page.locator('.theme-dialog [data-theme-id="light"]').click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await page.keyboard.press("Escape");
  await page.locator(".theme-dialog").waitFor({ state: "detached" });
  await page.screenshot({ path: path.join(report, "appearance-porcelain.png") });
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator("#tema").click();
  assert.equal(await page.locator(".theme-dialog").evaluate(e => getComputedStyle(e).animationName), "none");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  layout = await sizes();
  assert.ok(layout.editor.width >= 600 && layout.chat.width >= 330, JSON.stringify(layout));
  await page.screenshot({ path: path.join(report, "layout-1280.png") });
  await page.setViewportSize({ width: 960, height: 800 });
  await page.waitForFunction(() => document.querySelector('.gutter[data-pane="chat"]').getAttribute("aria-orientation") === "horizontal");
  layout = await sizes();
  assert.ok(layout.editor.width > 680 && layout.chat.y > layout.editor.y && layout.chat.width > 940, JSON.stringify(layout));
  assert.equal(await page.locator('.gutter[data-pane="chat"]').getAttribute("aria-orientation"), "horizontal");
  const previousHeight = layout.chat.height;
  await page.locator('.gutter[data-pane="chat"]').focus();
  await page.keyboard.press("ArrowUp");
  await page.waitForFunction(height => document.getElementById("chat").getBoundingClientRect().height >= height + 19, previousHeight);
  await page.screenshot({ path: path.join(report, "layout-960.png") });
  await page.locator("#tog-editor").click();
  assert.equal(await page.locator("#editor").isVisible(), false);
  await page.locator("#tog-chat").click();
  assert.equal(await page.locator("#editor").isVisible(), true, "siempre hay editor o conversación");
  await page.locator("#tog-chat").click();
  await page.locator("#tog-sidebar").click();
  assert.equal(await page.locator("#sidebar").isVisible(), false);
  assert.ok((await sizes()).editor.width > 940);
  await page.locator("#tog-sidebar").click();
  for (const width of [560, 720, 960, 1280, 1600]) {
    await page.setViewportSize({ width, height: 800 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `overflow a ${width}px`);
  }
  const rejected = await fetch(base + "/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tema: "invalid" }) });
  assert.equal(rejected.status, 400);
  assert.deepEqual(errors, []);
  console.log("Apariencia: 12 temas, navegación por pestañas sin desplazar el editor, divisores accesibles y persistentes, tamaños 560–1600, chat adaptable y movimiento reducido OK.");
  console.log(`Capturas: ${report}`);
} finally {
  if (browser) await browser.close();
  if (ui?.exitCode === null) { const exited = once(ui, "exit"); ui.kill(); await exited; }
  model.closeAllConnections(); await new Promise(r => model.close(r));
  assert.equal(path.dirname(temp), os.tmpdir()); assert.ok(path.basename(temp).startsWith("bonsai-appearance-"));
  fs.rmSync(temp, { recursive: true, force: true });
}
