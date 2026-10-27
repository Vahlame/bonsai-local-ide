/** Git y API reales en un repositorio temporal; no toca el índice ni los archivos del usuario. */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-git-"));
const repo = path.join(tmp, "proyecto");
fs.mkdirSync(repo);
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true }).trim();
git("init", "-q");
git("config", "user.name", "Prueba local");
git("config", "user.email", "prueba@local.invalid");
for (const [name, text] of Object.entries({ "base.txt": "antes", "otro.txt": "antes otro", "viejo.txt": "renombrado", ".gitignore": ".env\n" })) fs.writeFileSync(path.join(repo, name), text);
git("add", "-A"); git("commit", "-qm", "inicial");
fs.writeFileSync(path.join(repo, "base.txt"), "despues");
fs.writeFileSync(path.join(repo, "otro.txt"), "cambio ajeno");
fs.writeFileSync(path.join(repo, "nuevo [x].txt"), "archivo elegido");
fs.writeFileSync(path.join(repo, ".env"), "SECRETO_FICTICIO");
git("add", "otro.txt");
git("mv", "viejo.txt", "nombre nuevo.txt");
const model = http.createServer((req, res) => {
  const value = req.url === "/health" ? { status: "ok" } : req.url === "/props" ? { model_path: "falso", default_generation_settings: { n_ctx: 16384 }, modalities: { vision: false } } : { data: [{ id: "falso" }] };
  res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(value));
});
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
let ui;
try {
  const modelPort = await listen(model);
  const p = net.createServer(); const uiPort = await listen(p); await new Promise((r) => p.close(r));
  ui = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(uiPort), "--llama-port", String(modelPort)], { cwd: repo, env: { ...process.env, BONSAI_STATE: path.join(tmp, "estado"), BONSAI_SALIDA: path.join(tmp, "salida") }, stdio: "ignore", windowsHide: true });
  const base = `http://127.0.0.1:${uiPort}`;
  let ready = false;
  for (let i = 0; i < 80; i += 1) {
    try { ready = (await fetch(`${base}/api/state`)).ok; } catch {}
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, "UI de prueba no inició");
  const post = (route, data) => fetch(`${base}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  assert.ok((await post("/api/workspace", { path: repo })).ok);
  let status = await (await fetch(`${base}/api/git`)).json();
  assert.ok(status.archivos.some((f) => f.rel === "nuevo [x].txt"), "archivo sin seguimiento aparece individualmente");
  assert.ok(!status.archivos.some((f) => f.rel === ".env"), "secreto excluido");
  assert.ok(status.archivos.some((f) => f.rel === "nombre nuevo.txt" && f.anterior === "viejo.txt"), "renombrado conserva origen");
  const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => fs.existsSync(p));
  assert.ok(edge, "se necesita Edge o Chrome");
  const browser = await chromium.launch({ executablePath: edge, headless: true, args: ["--disable-gpu", "--disable-extensions"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.route("**/api/gpu", (route) => route.fulfill({ json: {
      ok: true, name: "NVIDIA GeForce Prueba Laptop GPU", util: 99,
      vramUsedMiB: 7300, vramTotalMiB: 8188, temp: 44,
      watts: 9.3, wattsLimit: 10, wattsDefault: 80, mhz: 210, mhzMax: 2000,
      pstate: "P8", ramFreeMiB: 8192, ramTotalMiB: 16384,
    } }));
    await page.goto(base);
    const powerWarning = page.locator('#hud .cell.warn[title*="limitada a 10 W"]');
    await powerWarning.waitFor({ state: "visible", timeout: 10000 });
    await page.locator("#hud").click();
    await page.getByText(/El equipo limita la GPU a 10 W frente a 80 W habituales/).waitFor({ state: "visible" });
    await page.locator("#hud").click();
    await page.locator("#git-chip").waitFor({ state: "visible", timeout: 10000 });
    await page.waitForFunction((branch) => document.querySelector("#git-chip")?.textContent.includes(branch), git("branch", "--show-current"));
    await page.locator("#git-chip").click();
    await page.getByText(/Elegir archivos para commit/).click();
    const boxes = page.locator('.dialogo input[type="checkbox"]');
    assert.ok(await boxes.count() >= 3, "se muestran archivos separados");
    assert.equal(await page.locator('.dialogo input[type="checkbox"]:checked').count(), 0, "ningún archivo se selecciona automáticamente");
    await page.getByText("?? nuevo [x].txt", { exact: true }).click();
    assert.equal(await page.locator('.dialogo input[type="checkbox"]:checked').count(), 1, "puede seleccionar un archivo concreto");
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  } finally { await browser.close(); }
  assert.equal((await post("/api/git", { op: "commit", mensaje: "sin seleccion" })).status, 409);
  assert.equal((await post("/api/git", { op: "commit", mensaje: "ruta no elegible", archivos: [".env"] })).status, 409);
  let response = await post("/api/git", { op: "commit", mensaje: "solo seleccion", archivos: ["base.txt", "nuevo [x].txt"] });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(git("show", "HEAD:base.txt"), "despues");
  assert.equal(git("show", "HEAD:nuevo [x].txt"), "archivo elegido");
  assert.equal(git("show", "HEAD:otro.txt"), "antes otro", "otro archivo preparado no entra en el commit");
  assert.match(git("diff", "--cached", "--name-only"), /otro\.txt/, "se conserva la preparación anterior");
  status = await (await fetch(`${base}/api/git`)).json();
  assert.ok(status.archivos.some((f) => f.rel === "nombre nuevo.txt" && f.anterior === "viejo.txt"));
  response = await post("/api/git", { op: "commit", mensaje: "renombrar", archivos: ["nombre nuevo.txt"] });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(git("show", "HEAD:nombre nuevo.txt"), "renombrado");
  assert.match(git("diff", "--cached", "--name-only"), /otro\.txt/);
  console.log("prueba Git seguro: selección, nombres literales, secretos, cambios preparados y renombrado OK; aviso de potencia GPU OK");
} finally {
  ui?.kill();
  if (ui && ui.exitCode === null) await new Promise((r) => ui.once("exit", r));
  if (model.listening) await new Promise((r) => model.close(r));
  if (path.dirname(tmp) === os.tmpdir() && path.basename(tmp).startsWith("bonsai-git-")) fs.rmSync(tmp, { recursive: true, force: true });
}
