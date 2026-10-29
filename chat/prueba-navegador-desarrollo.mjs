/** Prueba real de WebGL, diagnóstico JS, workers, HMR y recursos entre servicios locales. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { NavegadorLocal } from "./navegador.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-browser-dev-"));
const sockets = new Set();
let protectedHits = 0;
const protegido = http.createServer((_req, res) => { protectedHits++; res.end("privado"); });
const recursos = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.url === "/recurso.js") { res.setHeader("Content-Type", "text/javascript"); return res.end("window.recursoExterno='RECURSO_OK';"); }
  res.end("API_OK");
});
recursos.on("upgrade", (req, socket) => {
  sockets.add(socket); socket.on("close", () => sockets.delete(socket));
  const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const text = Buffer.from("HMR_OK");
  socket.write(Buffer.concat([Buffer.from([0x81, text.length]), text]));
  socket.on("error", () => socket.destroy());
});
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const protectedPort = await listen(protegido), apiPort = await listen(recursos);
fs.writeFileSync(path.join(tmp, "worker.js"), "postMessage('WORKER_OK');");
fs.writeFileSync(path.join(tmp, "sw.js"), "self.addEventListener('install',()=>self.skipWaiting());");
fs.mkdirSync(path.join(tmp, "node_modules", "paquete"), { recursive: true });
fs.writeFileSync(path.join(tmp, "node_modules", "paquete", "local.js"), "window.moduloLocal='MODULO_OK';");
fs.writeFileSync(path.join(tmp, "index.html"), `<!doctype html><title>Desarrollo local</title>
<canvas id="scene" width="120" height="100"></canvas><div id="diag" style="display:none">DIAGNOSTICO_OCULTO</div>
<select id="tema"><option value="a">A</option><option value="b">B</option></select>
<script src="http://127.0.0.1:${apiPort}/recurso.js"></script><script src="node_modules/paquete/local.js"></script>
<script>
const worker=new Worker('worker.js');worker.onmessage=e=>document.body.dataset.worker=e.data;
const ws=new WebSocket('ws://127.0.0.1:${apiPort}/hmr');ws.onmessage=e=>document.body.dataset.hmr=e.data;
fetch('http://127.0.0.1:${apiPort}/api').then(r=>r.text()).then(t=>document.body.dataset.api=t);
fetch('http://127.0.0.1:${protectedPort}/privado').catch(()=>{});
navigator.serviceWorker.register('sw.js').then(()=>document.body.dataset.sw='SW_OK');
</script>`);
const nav = new NavegadorLocal({ root: tmp, output: path.join(tmp, "capturas"), blockedPorts: [protectedPort], policy: "desarrollo" });
try {
  const url = await nav.fileUrl("index.html");
  let state = JSON.parse((await nav.run({ accion: "abrir", ruta: url })).texto);
  assert.equal(state.url, url, "una URL en ruta se trata como URL");
  await nav.page.waitForFunction(() => document.body.dataset.worker && document.body.dataset.hmr && document.body.dataset.api && document.body.dataset.sw, { timeout: 10000 });
  const evaluated = JSON.parse((await nav.run({ accion: "evaluar", expresion: "({diag:document.querySelector('#diag').textContent,webgl2:!!document.createElement('canvas').getContext('webgl2'),...document.body.dataset,recurso:window.recursoExterno,modulo:window.moduloLocal})" })).texto);
  const result = JSON.parse(evaluated.resultado);
  assert.equal(result.diag, "DIAGNOSTICO_OCULTO");
  assert.equal(result.webgl2, true, "WebGL2 disponible sin --disable-gpu");
  assert.equal(result.worker, "WORKER_OK"); assert.equal(result.hmr, "HMR_OK");
  assert.equal(result.api, "API_OK"); assert.equal(result.sw, "SW_OK");
  assert.equal(result.recurso, "RECURSO_OK"); assert.equal(result.modulo, "MODULO_OK");
  assert.equal(protectedHits, 0, "la página no accede a los puertos protegidos del IDE/modelo");
  assert.equal(evaluated.canvas[0].selector, "#scene");
  state = JSON.parse((await nav.run({ accion: "inspeccion", selector: "#diag" })).texto);
  assert.equal(state.elementos[0].texto, "DIAGNOSTICO_OCULTO"); assert.equal(state.elementos[0].visible, false);
  await nav.run({ accion: "escribir", selector: "#tema", texto: "b" });
  assert.equal(await nav.page.locator("#tema").inputValue(), "b");
  state = JSON.parse((await nav.run({ accion: "abrir", url, ruta: "C:\\incorrecta.html" })).texto);
  assert.equal(state.url, url, "url explícita tiene prioridad sobre ruta");
  assert.throws(() => nav.localUrl(`http://127.0.0.1:${protectedPort}/`), /puerto pertenece/);
  await assert.rejects(nav.run({ accion: "evaluar", expresion: "new Promise(()=>{})" }), /superó 6 s/);
  assert.equal(nav.closed, true, "un diagnóstico colgado cierra su navegador");
  console.log("Navegador desarrollo: URL, JS, WebGL2, workers, service worker, API, WebSocket y puertos protegidos verificados.");
} finally {
  await nav.close();
  for (const socket of sockets) socket.destroy();
  recursos.closeAllConnections(); protegido.closeAllConnections();
  await Promise.all([new Promise((r) => recursos.close(r)), new Promise((r) => protegido.close(r))]);
  fs.rmSync(tmp, { recursive: true, force: true });
}
