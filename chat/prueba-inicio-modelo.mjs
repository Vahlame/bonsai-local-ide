/**
 * Primer arranque sin modelos ni servidor de IA:
 *   node chat/prueba-inicio-modelo.mjs
 *
 * Comprueba el camino de un clon recién descargado: la UI pregunta qué modelo
 * cargar, explica que todavía no hay ninguno y ofrece abrir el Model Hub. No
 * necesita GPU, llama-server real ni los GGUF del equipo.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
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
  console.error("prueba inicio de modelo: no encontré Edge ni Chrome.");
  process.exit(1);
}

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-inicio-modelo-"));
const estado = path.join(tmp, "estado");
const modelos = path.join(tmp, "models");
const salida = path.join(tmp, "salida");
fs.mkdirSync(estado, { recursive: true });
fs.mkdirSync(modelos, { recursive: true });
fs.mkdirSync(salida, { recursive: true });
fs.writeFileSync(path.join(estado, "ui-settings.json"), JSON.stringify({ tema: "slate", preguntarModelo: true }));
fs.writeFileSync(path.join(modelos, "hub-catalog.json"), JSON.stringify({ modelos: {} }));

/** Reserva un puerto libre y lo suelta. */
async function puertoLibre() {
  const sonda = net.createServer();
  sonda.listen(0, "127.0.0.1");
  await once(sonda, "listening");
  const puerto = sonda.address().port;
  await new Promise((resolver) => sonda.close(resolver));
  return puerto;
}

const puertoUi = await puertoLibre();
const puertoModelo = await puertoLibre();
let logServidor = "";
const servidor = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(puertoUi), "--llama-port", String(puertoModelo)], {
  cwd: RAIZ,
  env: {
    ...process.env,
    BONSAI_STATE: estado,
    BONSAI_SALIDA: salida,
    BONSAI_MODELS_DIR: modelos,
    BONSAI_HUB_CATALOG: path.join(modelos, "hub-catalog.json"),
    BONSAI_HUB_DISABLE_SCAN: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
servidor.stdout.on("data", (trozo) => (logServidor += trozo));
servidor.stderr.on("data", (trozo) => (logServidor += trozo));

const base = `http://127.0.0.1:${puertoUi}/`;
let navegador = null;
try {
  let listo = false;
  for (let i = 0; i < 120; i += 1) {
    if (servidor.exitCode !== null) throw new Error(`el ui-server terminó antes de arrancar:\n${logServidor}`);
    try {
      const res = await fetch(`${base}api/state`, { signal: AbortSignal.timeout(500) });
      if (res.ok) { listo = true; break; }
    } catch { /* aún arrancando */ }
    await esperar(100);
  }
  assert.ok(listo, `el ui-server no arrancó:\n${logServidor}`);

  const modelosApi = await (await fetch(`${base}api/modelos`)).json();
  assert.equal(modelosApi.actual, "", "sin servidor no hay modelo actual");
  assert.equal(modelosApi.modelos.filter((m) => m.existe).length, 0, "el escenario no debe tener GGUF locales");

  navegador = await chromium.launch({ executablePath: EDGE, headless: true, args: ["--disable-gpu"] });
  const pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 } });
  const errores = [];
  pagina.on("console", (mensaje) => {
    if (mensaje.type() !== "error") return;
    const origen = mensaje.location()?.url || "";
    if (/favicon\.ico/i.test(mensaje.text()) || /favicon\.ico/i.test(origen)) return;
    errores.push(`${mensaje.text()}${origen ? ` @ ${origen}` : ""}`);
  });
  pagina.on("pageerror", (error) => errores.push(`pageerror: ${error.message}`));

  await pagina.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
  const dialogo = pagina.locator(".inicio-modelo");
  await dialogo.waitFor({ state: "visible", timeout: 10000 });
  assert.match(await dialogo.locator("h3").textContent(), /Qué modelo quieres cargar/);
  const vacio = await dialogo.locator(".inicio-modelo-vacio").textContent();
  assert.match(vacio, /Todavía no hay modelos instalados/);
  const botones = await dialogo.locator(".d-botones button").allTextContents();
  assert.deepEqual(botones, ["Ahora no", "Abrir Model Hub"]);

  await dialogo.getByRole("button", { name: "Ahora no", exact: true }).click();
  await dialogo.waitFor({ state: "detached", timeout: 5000 });
  assert.equal(await pagina.evaluate(() => sessionStorage.getItem("bonsai-modelo-inicio")), "1");

  await pagina.reload({ waitUntil: "domcontentloaded" });
  await esperar(1200);
  assert.equal(await pagina.locator(".inicio-modelo").count(), 0, "no vuelve a preguntar en la misma sesión");

  await pagina.getByRole("button", { name: "Ajustes", exact: true }).click();
  const fila = pagina.locator(".setting-row").filter({ hasText: "Preguntar modelo al iniciar" });
  await fila.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await fila.locator('input[type="checkbox"]').isChecked(), true, "la opción viene activada por defecto");

  assert.deepEqual(errores, [], `errores de consola:\n${errores.join("\n")}`);
  console.log("Primer arranque: pregunta de modelo, estado sin GGUF, Hub y ajuste por defecto verificados.");
} finally {
  if (navegador) await navegador.close().catch(() => {});
  if (servidor.exitCode === null) servidor.kill();
  await esperar(150);
  fs.rmSync(tmp, { recursive: true, force: true });
}
