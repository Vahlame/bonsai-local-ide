// End-to-end real: Detener y Cerrar IDE e IA con el servidor GPT-OSS real.
// Requiere UI en 8787 y llama-server en 8080. No forma parte de `npm test`.
import assert from "node:assert/strict";
import { chromium } from "../chat/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
import net from "node:net";

const UI = "http://127.0.0.1:8787";
const MARKER = new URL("../logs/servidor-administrado-8080.json", import.meta.url);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function puertoAbierto(port) {
  return new Promise((resolve) => {
    const s = net.connect({ host: "127.0.0.1", port });
    const fin = (v) => { try { s.destroy(); } catch {} resolve(v); };
    s.setTimeout(700, () => fin(false));
    s.once("connect", () => fin(true));
    s.once("error", () => fin(false));
  });
}
async function esperarPuerto(port, abierto, timeout = 30000) {
  const fin = Date.now() + timeout;
  while (Date.now() < fin) {
    if ((await puertoAbierto(port)) === abierto) return true;
    await wait(200);
  }
  return false;
}
async function esperarMarcador(valor, timeout = 15000) {
  const fin = Date.now() + timeout;
  while (Date.now() < fin) {
    const actual = marcador();
    if ((valor === null && actual === null) || (valor !== null && actual?.pidServidor === valor)) return true;
    await wait(200);
  }
  return false;
}
function vivo(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function marcador() {
  try { return JSON.parse(fs.readFileSync(MARKER, "utf8")); } catch { return null; }
}

assert.equal(await puertoAbierto(8080), true, "llama-server no está escuchando en 8080");
assert.equal(await puertoAbierto(8787), true, "la UI no está escuchando en 8787");
const antes = marcador();
assert.ok(antes && Number.isInteger(antes.pidServidor), "no hay marcador administrado");

const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--disable-gpu"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("dialog", (d) => d.accept());
  await page.goto(UI, { waitUntil: "networkidle" });
  await page.waitForSelector("#server-stop", { state: "visible", timeout: 30000 });
  console.log("UI: botón Detener visible");

  // 1) Detener desde la UI: el modelo debe desaparecer, la UI debe seguir viva.
  await page.locator("#server-stop").click();
  assert.equal(await esperarPuerto(8080, false, 30000), true, "el puerto 8080 sigue abierto tras Detener");
  assert.equal(vivo(antes.pidServidor), false, "el PID de llama-server sigue vivo tras Detener");
  assert.equal(await puertoAbierto(8787), true, "la UI se cerró al pulsar Detener (no debía)");
  assert.equal(await esperarMarcador(null), true, "el marcador no se borró tras Detener");
  await page.waitForSelector("#server-start", { state: "visible", timeout: 20000 });
  console.log("Detener: llama-server cerrado, UI viva, marcador limpio");

  // 2) Volver a arrancar el modelo desde la API (la UI ya está en estado apagado).
  const arranque = await fetch(`${UI}/api/server/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-oss-20b", preset: "AUTO", pensar: 4096 }),
    signal: AbortSignal.timeout(300000),
  });
  assert.equal(arranque.ok, true, `no se pudo rearrancar: ${arranque.status} ${await arranque.text()}`);
  assert.equal(await esperarPuerto(8080, true, 30000), true, "el modelo no volvió a escuchar");
  const despues = marcador();
  assert.ok(despues && Number.isInteger(despues.pidServidor), "el rearranque no dejó marcador");
  console.log(`Rearranque: llama-server PID ${despues.pidServidor}`);

  // 3) Cerrar IDE e IA desde la UI: deben caer los dos y no quedar procesos.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#cerrar-bonsai", { state: "visible", timeout: 20000 });
  await page.locator("#cerrar-bonsai").click();
  await page.locator(".dialogo button.primary").click();
  await page.waitForFunction(() => document.body.textContent.includes("IDE e IA cerrados"), null, { timeout: 30000 });
  assert.equal(await esperarPuerto(8080, false, 30000), true, "el puerto 8080 sigue abierto tras Cerrar IDE e IA");
  assert.equal(await esperarPuerto(8787, false, 30000), true, "la UI sigue escuchando tras Cerrar IDE e IA");
  assert.equal(vivo(despues.pidServidor), false, "el llama-server del rearranque sigue vivo");
  assert.equal(await esperarMarcador(null), true, "el marcador no se borró tras Cerrar IDE e IA");
  console.log("Cerrar IDE e IA: UI y llama-server cerrados, sin marcador");
} finally {
  await browser.close();
}

