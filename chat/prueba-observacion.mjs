/** node chat/prueba-observacion.mjs [--real]: navegador real, API aislada y, opcionalmente, modelo GPU real. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NavegadorLocal } from "./navegador.mjs";
import { PC_TOOLS } from "./actions.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const REAL = process.argv.includes("--real");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-observacion-"));
const ws = path.join(tmp, "proyecto");
const output = process.env.BONSAI_TEST_OUTPUT || path.join(ROOT, "salida", `observacion-${REAL ? "real" : "api"}-2026-10-26`);
fs.mkdirSync(ws);
fs.mkdirSync(output, { recursive: true });
const informe = { real: REAL, comprobaciones: [], vision: null, respuesta: "", acciones: [] };
function check(name, value) { assert.ok(value, name); informe.comprobaciones.push(name); }
const listen = async (server) => { await new Promise((r) => server.listen(0, "127.0.0.1", r)); return server.address().port; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const textOf = (m) => Array.isArray(m?.content) ? m.content.filter((p) => p.type === "text").map((p) => p.text).join("\n") : String(m?.content || "");
const word = ["LUNA", "GATO", "CASA", "NUBE"][Math.floor(Math.random() * 4)];
const number = String(Math.floor(1000 + Math.random() * 8999));
const original = `<!doctype html><html lang="es"><meta charset="utf-8"><title>Contador de prueba</title>
<style>body{font:24px Arial;margin:24px}.panel{width:1600px}canvas{max-width:100%}</style>
<div class="panel"><h1>Contador</h1><button id="sumar">Sumar</button><output id="valor">0</output><input id="nombre" placeholder="Nombre"><select id="opcion"><option value="a">A</option><option value="b">B</option></select></div>
<img src="no-existe.png" alt="Logo"><canvas id="lienzo" width="640" height="180"></canvas>
<script>let total=0;document.querySelector('#sumar').onclick=()=>{total=incrementarRoto(total);document.querySelector('#valor').textContent=total};
const ctx=document.querySelector('#lienzo').getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,640,180);ctx.fillStyle='black';ctx.font='bold 64px Arial';ctx.fillText('${word} ${number}',20,110);</script></html>`;
fs.writeFileSync(path.join(ws, "index.html"), original);
fs.writeFileSync(path.join(ws, ".env"), "SECRETO_DE_PRUEBA");
let nav = new NavegadorLocal({ root: ws, output, blockedPorts: [8080, 8787] });
let fake, child, monitor;
let peakMiB = 0;
if (REAL) {
  monitor = spawn("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits", "--loop-ms=250"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  let buffer = "";
  monitor.stdout.on("data", (part) => {
    buffer += part;
    const lines = buffer.split(/\r?\n/); buffer = lines.pop();
    for (const line of lines) { const value = Number(line.trim()); if (Number.isFinite(value)) peakMiB = Math.max(peakMiB, value); }
  });
}
try {
  let state = JSON.parse((await nav.run({ accion: "abrir", ruta: "index.html" })).texto);
  check("detecta desborde horizontal", state.desbordeHorizontal);
  check("detecta imagen rota y HTTP 404", state.imagenesRotas.includes("no-existe.png") && state.eventos.some((e) => e.tipo === "http"));
  state = JSON.parse((await nav.run({ accion: "clic", selector: "#sumar" })).texto);
  check("recibe el error JavaScript real al pulsar", state.eventos.some((e) => e.texto.includes("incrementarRoto")));
  await nav.run({ accion: "escribir", selector: "#nombre", texto: "Ana" });
  state = JSON.parse((await nav.run({ accion: "seleccionar", selector: "#opcion", texto: "b" })).texto);
  check("escribe y selecciona valores reales", state.controles.some((c) => c.valor === "Ana") && state.controles.some((c) => c.valor === "b"));
  const fixed = original.replace("incrementarRoto(total)", "total + 1").replace("width:1600px", "width:100%;max-width:100%").replace('<img src="no-existe.png" alt="Logo">', "");
  fs.writeFileSync(path.join(ws, "index.html"), fixed);
  await nav.run({ accion: "recargar", ancho: 390, alto: 700 });
  state = JSON.parse((await nav.run({ accion: "clic", selector: "#sumar" })).texto);
  check("recarga el arreglo y cambia el contador", state.textoVisible.includes("1") && !state.eventos.some((e) => e.tipo === "javascript"));
  check("comprueba la disposición móvil corregida", !state.desbordeHorizontal && state.ventana.ancho === 390);
  const crop = await nav.run({ accion: "captura", selector: "#sumar" });
  const cropBytes = Buffer.from(crop.imagen.split(",")[1], "base64");
  check("captura de detalle recorta el elemento solicitado", cropBytes.readUInt32BE(16) < 100 && cropBytes.readUInt32BE(20) < 100);
  await assert.rejects(nav.run({ accion: "abrir", ruta: "../fuera.html" }));
  await assert.rejects(nav.run({ accion: "abrir", url: "https://example.com" }));
  await assert.rejects(nav.run({ accion: "abrir", url: "http://localhost:8080" }));
  check("limita rutas y separa IDE/modelo", true);
  const secret = await fetch(new URL("/.env", state.url));
  check("no sirve .env", secret.status === 404);
  if (REAL) {
    // Lectura visual independiente: la palabra/número SOLO viajan en los píxeles.
    // No se proporciona el HTML, la ruta, ni el valor esperado al modelo.
    const shot = await nav.run({ accion: "captura", ancho: 1280, alto: 800 });
    const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ max_tokens: 100, temperature: 0, tools: PC_TOOLS, tool_choice: "none", messages: [
        { role: "user", content: "Lee la palabra y los cuatro dígitos dibujados en el lienzo de la captura. Responde solo con ellos." },
        { role: "assistant", content: "", tool_calls: [{ id: "captura", type: "function", function: { name: "navegador", arguments: { accion: "captura" } } }] },
        { role: "tool", tool_call_id: "captura", content: [{ type: "text", text: "Captura del navegador:" }, { type: "image_url", image_url: { url: shot.imagen } }] }
      ] })
    });
    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content || JSON.stringify(data);
    informe.lecturaSoloPixeles = { esperado: `${word} ${number}`, respuesta: answer, coincide: answer.includes(word) && answer.includes(number) };
    check("lee píxeles de un resultado tool sin conocer el HTML", informe.lecturaSoloPixeles.coincide);
  }
  const ac = new AbortController();
  const start = Date.now();
  const wait = nav.run({ accion: "esperar", selector: "#ausente" }, ac.signal);
  setTimeout(() => ac.abort(), 100);
  await assert.rejects(wait);
  check("cancelar cierra el navegador sin esperar el timeout", nav.closed && Date.now() - start < 3000);

  const received = [];
  const native = (id, name, args) => ({ tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });
  let modelPort = 8080;
  if (!REAL) {
    fake = http.createServer(async (req, res) => {
      const json = (value) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(value)); };
      if (req.url === "/health") return json({ status: "ok" });
      if (req.url === "/props") return json({ default_generation_settings: { n_ctx: 16384 }, modalities: { vision: true } });
      if (req.url === "/v1/models") return json({ data: [{ id: "falso" }] });
      let raw = ""; for await (const part of req) raw += part;
      const body = JSON.parse(raw || "{}");
      if (req.url === "/v1/chat/completions/input_tokens") return json({ input_tokens: 2000 });
      if (!body.stream) return json({ choices: [{ message: { content: "resumen" } }] });
      received.push(body);
      const last = body.messages.at(-1);
      let delta = native("nav_open", "navegador", { accion: "abrir", ruta: "index.html" });
      if (last.tool_call_id === "nav_open") delta = native("nav_click", "navegador", { accion: "clic", selector: "#sumar" });
      if (last.tool_call_id === "nav_click") delta = { content: "Comprobado en el navegador." };
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
    modelPort = await listen(fake);
  }
  const probe = http.createServer(); const uiPort = await listen(probe); await new Promise((r) => probe.close(r));
  const stateDir = path.join(tmp, "estado");
  fs.mkdirSync(stateDir);
  fs.writeFileSync(path.join(stateDir, "ui-workspace.json"), JSON.stringify({ path: ws }));
  fs.writeFileSync(path.join(stateDir, "ui-permit.json"), JSON.stringify({ mode: "all" }));
  child = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(uiPort), "--llama-port", String(modelPort)], { cwd: ROOT, env: { ...process.env, BONSAI_STATE: stateDir, BONSAI_SALIDA: output }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let logs = ""; child.stdout.on("data", (p) => { logs += p; }); child.stderr.on("data", (p) => { logs += p; });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { ready = (await fetch(`http://127.0.0.1:${uiPort}/api/state`)).ok; } catch {}
    if (ready) break; await sleep(100);
  }
  assert.ok(ready, logs);
  // Fija la carpeta también por la API pública; el archivo de estado conserva el mismo formato.
  const post = (route, body) => fetch(`http://127.0.0.1:${uiPort}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.ok((await post("/api/workspace", { path: ws })).ok);
  if (REAL) fs.writeFileSync(path.join(ws, "index.html"), original);
  const prompt = REAL
    ? "Arregla el contador de index.html: al pulsar Sumar debe subir exactamente 1. Usa navegador para abrirlo y reproducir el fallo ANTES de editar. Corrige solo ese bug. Después recarga, pulsa dos veces y comprueba en navegador que muestra 2. Dime también la palabra y los cuatro dígitos que ves dibujados en el lienzo de la captura. No los adivines."
    : "Abre index.html con navegador, pulsa Sumar y comprueba la salida.";
  const response = await post("/api/chat", { text: prompt });
  assert.ok(response.ok, await response.clone().text());
  const stream = await response.text();
  const events = stream.split("\n").filter((s) => s.startsWith("data:")).map((s) => JSON.parse(s.slice(5)));
  informe.acciones = events.filter((e) => e.type === "action" && e.state !== "run").map(({ type, id, ...e }) => e);
  let answer = "";
  for (const e of events) { if (e.type === "token") answer += e.text; if (e.type === "replace") answer = e.text; }
  informe.respuesta = answer;
  assert.ok(!events.some((e) => e.type === "error"), JSON.stringify(events.filter((e) => e.type === "error")));
  check("la herramienta ejecuta acciones desde la API del agente", informe.acciones.filter((e) => e.kind === "browser" && e.state === "done").length >= 2);
  check("la API ofrece capturas revisables", informe.acciones.some((e) => e.captura));
  const saved = JSON.parse(fs.readFileSync(path.join(stateDir, "ui-session.json"), "utf8"));
  check("no guarda imágenes base64 en el historial", !JSON.stringify(saved).includes("data:image/"));
  if (!REAL) {
    check("la captura se adjunta a SU mensaje tool", received.slice(1).every((b) => b.messages.at(-1).role === "tool" && b.messages.at(-1).content.some((p) => p.type === "image_url")));
    check("no atribuye la captura al mensaje original del usuario", received.every((b) => b.messages.filter((m) => m.role === "user").every((m) => typeof m.content === "string")));
    if (process.platform === "win32") {
      check("el modelo recibe OCR local del lienzo como dato de la herramienta", received.some((b) => b.messages.some((m) => m.role === "tool" && textOf(m).includes("OCR local") && textOf(m).includes(word) && textOf(m).includes(number))));
    }
    const qa = new NavegadorLocal({ root: ws, output });
    try {
      await qa.run({ accion: "abrir", url: `http://127.0.0.1:${uiPort}` });
      await qa.run({ accion: "esperar", selector: ".browser-capture summary >> nth=0" });
      await qa.run({ accion: "clic", selector: ".browser-capture summary >> nth=0" });
      const cards = JSON.parse((await qa.run({ accion: "inspeccionar", selector: ".browser-capture img" })).texto);
      check("la interfaz muestra y abre la captura que recibió el modelo", cards.elementos.some((e) => e.visible && e.ancho > 0) && cards.imagenesRotas.length === 0);
    } finally { await qa.close(); }
  } else {
    informe.vision = { esperado: `${word} ${number}`, respuesta: answer, coincide: answer.includes(word) && answer.includes(number) };
    check("el modelo usa la captura para leer el lienzo", informe.vision.coincide);
    nav = new NavegadorLocal({ root: ws, output });
    await nav.run({ accion: "abrir", ruta: "index.html" });
    await nav.run({ accion: "clic", selector: "#sumar" });
    await nav.run({ accion: "clic", selector: "#sumar" });
    const observed = JSON.parse((await nav.run({ accion: "inspeccionar", selector: "#valor" })).texto);
    check("verificación independiente: dos clics dan 2 y no hay error JS", observed.elementos[0].texto === "2" && !observed.eventos.some((e) => e.tipo === "javascript"));
    fs.copyFileSync(path.join(ws, "index.html"), path.join(output, "index-corregido.html"));
  }
  console.log(`Observación ${REAL ? "modelo real" : "API"}: ${informe.comprobaciones.length} comprobaciones OK`);
} catch (err) {
  informe.error = err.stack || String(err);
  console.error(informe.error);
  process.exitCode = 1;
} finally {
  await nav.close().catch(() => {});
  monitor?.kill();
  if (REAL) informe.picoVRAMMiB = peakMiB;
  child?.kill();
  if (child) await new Promise((r) => child.exitCode !== null ? r() : child.once("exit", r));
  if (fake) await new Promise((r) => fake.close(r));
  fs.writeFileSync(path.join(output, "informe.json"), JSON.stringify(informe, null, 2));
  // Solo borra el directorio temporal creado al principio de esta prueba.
  if (path.dirname(tmp) === os.tmpdir() && path.basename(tmp).startsWith("bonsai-observacion-")) fs.rmSync(tmp, { recursive: true, force: true });
}
