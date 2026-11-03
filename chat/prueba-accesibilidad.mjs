#!/usr/bin/env node
/**
 * Auditoría de accesibilidad con axe-core sobre la UI real.
 *   node chat/prueba-accesibilidad.mjs
 *
 * Levanta un llama-server simulado y un ui-server temporal. No usa GPU ni el
 * modelo real. Falla solo con violaciones `critical` o `serious` de WCAG 2 A/AA.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
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
  console.error("prueba accesibilidad: no encontré Edge ni Chrome.");
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-a11y-"));
const estado = path.join(tmp, "estado");
const proyecto = path.join(tmp, "proyecto");
const salida = path.join(tmp, "salida");
fs.mkdirSync(estado, { recursive: true });
fs.mkdirSync(proyecto, { recursive: true });
fs.writeFileSync(path.join(estado, "ui-workspace.json"), JSON.stringify({ path: proyecto }));
fs.writeFileSync(path.join(estado, "ui-settings.json"), JSON.stringify({ historial: 8192, pensar: 0, reglas: false }));
fs.writeFileSync(path.join(estado, "ui-permit.json"), JSON.stringify({ mode: "ask" }));
fs.writeFileSync(path.join(proyecto, "x.txt"), "uno\ndos\ntres\n", "utf8");
fs.writeFileSync(path.join(proyecto, "nota.md"), "# nota\n", "utf8");

const falsoLlama = http.createServer((req, res) => {
  const url = req.url || "";
  const json = (cuerpo) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(cuerpo));
  };
  if (url === "/health") return json({ status: "ok" });
  if (url === "/props") return json({ default_generation_settings: { n_ctx: 16384 }, modalities: { vision: false }, model_path: path.join(RAIZ, "models", "falso.gguf") });
  if (url === "/v1/models") return json({ data: [{ id: "falso.gguf" }] });
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end("{}");
});
falsoLlama.listen(0, "127.0.0.1");
await once(falsoLlama, "listening");
const puertoLlama = /** @type {import("node:net").AddressInfo} */ (falsoLlama.address()).port;

const sonda = http.createServer();
sonda.listen(0, "127.0.0.1");
await once(sonda, "listening");
const puertoUi = /** @type {import("node:net").AddressInfo} */ (sonda.address()).port;
await new Promise((resolver) => sonda.close(resolver));

let logServidor = "";
const servidor = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(puertoUi), "--llama-port", String(puertoLlama)], {
  cwd: RAIZ,
  env: { ...process.env, BONSAI_STATE: estado, BONSAI_SALIDA: salida },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
servidor.stdout.on("data", (trozo) => (logServidor += trozo));
servidor.stderr.on("data", (trozo) => (logServidor += trozo));

const url = `http://127.0.0.1:${puertoUi}/`;
let navegador = null;
let pagina = null;
let fallos = 0;
try {
  let listo = false;
  for (let i = 0; i < 150; i += 1) {
    if (servidor.exitCode !== null) throw new Error(`el ui-server terminó antes de arrancar:\n${logServidor}`);
    try {
      const res = await fetch(`${url}api/state`, { signal: AbortSignal.timeout(500) });
      if (res.ok) { listo = true; break; }
    } catch { /* aún arrancando */ }
    await new Promise((resolver) => setTimeout(resolver, 100));
  }
  assert.ok(listo, `el ui-server no arrancó:\n${logServidor}`);

  navegador = await chromium.launch({ executablePath: EDGE, headless: true });
  pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 } });
  // `addScriptTag` crea un <script> inline y la CSP lo bloquea; `addInitScript`
  // se inyecta por CDP antes de cargar la página.
  const axeFuente = fs.readFileSync(path.join(HERE, "node_modules", "axe-core", "axe.min.js"), "utf8");
  await pagina.addInitScript({ content: axeFuente });
  await pagina.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await pagina.waitForSelector("#tree .row", { timeout: 15000 });
  const resultado = await pagina.evaluate(async () => {
    return await globalThis.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
  });
  const graves = resultado.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  for (const violacion of graves) {
    process.stderr.write(`FALLO axe: ${violacion.id} (${violacion.impact}) · ${violacion.help}\n`);
    for (const nodo of violacion.nodes.slice(0, 3)) process.stderr.write(`  ${nodo.target.join(" ")}\n`);
  }
  fallos = graves.length;
  assert.equal(fallos, 0, `${fallos} violación(es) graves de accesibilidad`);
  process.stdout.write(`accesibilidad: 0 violaciones graves (${resultado.violations.length} totales, ${resultado.passes.length} reglas OK).\n`);
} finally {
  if (pagina) await pagina.close().catch(() => {});
  if (navegador) await navegador.close().catch(() => {});
  if (servidor.exitCode === null) {
    servidor.kill();
    await once(servidor, "exit").catch(() => {});
  }
  await new Promise((resolver) => falsoLlama.close(resolver));
  fs.rmSync(tmp, { recursive: true, force: true });
}
