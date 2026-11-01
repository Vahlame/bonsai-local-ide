// Real GPU acceptance test. --prepare creates an isolated UI on 8787 if it is closed.
import assert from "node:assert/strict";
import { chromium } from "../chat/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";

const root = path.resolve(import.meta.dirname, "..");
const UI = "http://127.0.0.1:8787";
const MARKER = path.join(root, "logs", "servidor-administrado-8080.json");
const directory = path.resolve(process.env.BONSAI_EVIDENCE_DIR || path.join(root, "reports", "lifecycle-2026-11-01"));
fs.mkdirSync(directory, { recursive: true });
const run = promisify(execFile), wait = (ms) => new Promise((r) => setTimeout(r, ms));
const evidence = { started: new Date().toISOString(), node: process.version, snapshots: [], steps: [] };
const modelOptions = { model: "gpt-oss-20b", preset: "CUSTOM", contexto: 65536, kv: "q8_0", vision: false, pensar: 4096 };
let ownedUi, browser, temp, uiOutput = "";
function marker() { try { return JSON.parse(fs.readFileSync(MARKER, "utf8").replace(/^\uFEFF/, "")); } catch { return null; } }
function alive(pid) { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { if (e.code === "ESRCH") return false; throw e; } }
async function portOpen(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    const end = (v) => { s.destroy(); resolve(v); };
    s.setTimeout(700, () => end(false)); s.once("connect", () => end(true)); s.once("error", () => end(false));
  });
}
async function until(check, description, timeout = 35000) {
  const deadline = Date.now() + timeout;
  do { if (await check()) return; await wait(150); } while (Date.now() < deadline);
  throw new Error(`Timeout: ${description}`);
}
async function snapshot(name, pids = []) {
  const m = marker();
  let vramFreeMiB = null;
  try { vramFreeMiB = Number.parseInt((await run("nvidia-smi", ["--query-gpu=memory.free", "--format=csv,noheader,nounits"], { windowsHide: true })).stdout.trim(), 10); } catch { }
  const ids = [...new Set([...pids, m?.pidServidor, m?.wrapperPid].filter(Boolean))];
  const s = { name, time: new Date().toISOString(), marker: m, port8080: await portOpen(8080), port8787: await portOpen(8787), pids: ids.map((pid) => ({ pid, alive: alive(pid) })), vramFreeMiB };
  evidence.snapshots.push(s); console.log(JSON.stringify(s)); return s;
}
async function api(action, body = {}) {
  const response = await fetch(`${UI}/api/server/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(300000) });
  const text = await response.text();
  assert.equal(response.ok, true, `${action}: HTTP ${response.status} ${text}`);
  const result = JSON.parse(text); evidence.steps.push({ action, result }); return result;
}
async function assertStopped(m, uiAlive = true) {
  await until(async () => !await portOpen(8080), "puerto del modelo cerrado");
  assert.equal(alive(m.pidServidor), false, "llama-server sigue vivo");
  assert.equal(alive(m.wrapperPid), false, "wrapper sigue vivo");
  assert.equal(fs.existsSync(MARKER), false, "quedó marcador");
  assert.equal(await portOpen(8787), uiAlive);
}
try {
  await snapshot("initial");
  if (process.argv.includes("--prepare") && !await portOpen(8787)) {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-lifecycle-e2e-"));
    fs.writeFileSync(path.join(temp, "ui-settings.json"), JSON.stringify({ enginePreset: "CUSTOM", coderContextTokens: 65536, engineKv: "q8_0", engineVision: false }));
    ownedUi = spawn(process.execPath, ["chat/ui-server.mjs", "--port", "8787", "--llama-port", "8080"], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, BONSAI_STATE: temp, BONSAI_PTY: "0" } });
    ownedUi.stdout.on("data", (d) => { uiOutput += d; }); ownedUi.stderr.on("data", (d) => { uiOutput += d; });
    await until(() => portOpen(8787), "UI preparada");
  }
  assert.equal(await portOpen(8787), true, "la UI debe estar en 8787");
  if (process.argv.includes("--prepare") && !await portOpen(8080)) await api("start", modelOptions);
  const before = marker();
  assert.equal(before?.modelo, "gpt-oss-20b");
  assert.ok(Number.isInteger(before.pidServidor));
  assert.ok(before.binId && before.exe, "marcador nuevo con identidad del binario");
  await snapshot("ready-before-stop", [ownedUi?.pid]);
  const executablePath = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find(fs.existsSync);
  assert.ok(executablePath, "Falta Edge/Chrome");
  browser = await chromium.launch({ executablePath, headless: true, args: ["--disable-gpu"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = []; page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(UI, { waitUntil: "networkidle" });
  await page.waitForSelector("#server-stop", { state: "visible" });
  const stopping = page.waitForResponse((r) => r.url().endsWith("/api/server/stop") && r.request().method() === "POST");
  await page.locator("#server-stop").click();
  const stopResponse = await stopping;
  assert.equal(stopResponse.status(), 200, await stopResponse.text());
  await assertStopped(before);
  const idle = await snapshot("stopped-ui-alive", [before.pidServidor, before.wrapperPid, ownedUi?.pid]);
  await page.waitForSelector("#server-start", { state: "visible" });
  console.log("Detener: PIDs muertos, puerto cerrado, marcador eliminado, UI viva");

  const starting = page.waitForResponse((r) => r.url().endsWith("/api/server/start") && r.request().method() === "POST");
  await page.locator("#server-start").click();
  const startResponse = await starting;
  assert.equal(startResponse.status(), 200, await startResponse.text());
  const restarted = marker();
  assert.notEqual(restarted.pidServidor, before.pidServidor, "el rearranque debe tener un PID nuevo");
  await snapshot("restarted", [ownedUi?.pid]);
  // Real orphan: kill only the exact wrapper from our validated marker.
  await run("taskkill.exe", ["/PID", String(restarted.wrapperPid), "/F"], { windowsHide: true });
  await until(() => !alive(restarted.wrapperPid), "wrapper muerto");
  assert.equal(alive(restarted.pidServidor), true, "no se reprodujo wrapper muerto con hijo vivo");
  await snapshot("orphan-child-alive", [restarted.wrapperPid, restarted.pidServidor]);
  await Promise.all([api("stop"), api("stop")]);
  await assertStopped(restarted);
  await snapshot("orphan-concurrent-stops", [restarted.wrapperPid, restarted.pidServidor]);

  await api("start", modelOptions);
  const closing = marker();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("#cerrar-bonsai").click();
  await page.locator(".dialogo button.primary").click();
  await page.waitForFunction(() => document.body.textContent.includes("IDE e IA cerrados"));
  await until(async () => !await portOpen(8787), "puerto UI cerrado", 6000);
  await assertStopped(closing, false);
  if (ownedUi) await until(() => ownedUi.exitCode !== null, "proceso Node terminado", 6000);
  const final = await snapshot("closed", [closing.pidServidor, closing.wrapperPid, ownedUi?.pid]);
  if (idle.vramFreeMiB !== null && final.vramFreeMiB !== null) {
    assert.ok(final.vramFreeMiB >= idle.vramFreeMiB - 256, `VRAM no volvió al reposo: ${final.vramFreeMiB} frente a ${idle.vramFreeMiB}`);
  }
  assert.deepEqual(pageErrors, []);
  evidence.ok = true;
  console.log("Cerrar IDE e IA: modelo, wrapper y Node terminados; puertos cerrados; VRAM verificada");
} catch (err) {
  evidence.ok = false; evidence.error = err.stack;
  await snapshot("failure"); throw err;
} finally {
  evidence.finished = new Date().toISOString();
  fs.writeFileSync(path.join(directory, "e2e-evidence.json"), JSON.stringify(evidence, null, 2));
  fs.writeFileSync(path.join(directory, "e2e-ui.log"), uiOutput);
  if (browser) await browser.close();
  // Leave a failed model/UI available for diagnosis; never claim successful cleanup.
  if (temp && ownedUi?.exitCode !== null) {
    assert.equal(path.dirname(temp), os.tmpdir()); assert.ok(path.basename(temp).startsWith("bonsai-lifecycle-e2e-"));
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
