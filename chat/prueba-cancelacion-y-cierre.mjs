/**
 * Regresiones de dos fallos reales del agente:
 *  1. El botón Detener solo cerraba el fetch; el servidor seguía generando y `busy`
 *     contestaba 409 para siempre. Ahora /api/stop aborta la inferencia y el turno.
 *  2. Tras una verificación correcta el agente podía encadenar decenas de lecturas.
 *     Ahora, sin escrituras nuevas, se cierra y pide el resumen final.
 *
 * Usa un llama-server falso y un proyecto temporal. No necesita GPU.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { leerSSE } from "./sse.mjs";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-stop-loop-"));
const project = path.join(temp, "project");
const state = path.join(temp, "state");
fs.mkdirSync(project, { recursive: true });
fs.mkdirSync(state, { recursive: true });
fs.writeFileSync(path.join(project, "x.txt"), "hola\n");
const contenidoNuevo = Array.from({ length: 40 }, (_, i) => `export const linea${i + 1} = ${i + 1};`).join("\n") + "\n";
fs.writeFileSync(path.join(state, "ui-workspace.json"), JSON.stringify({ path: project }));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let model;
let ui;
let abiertosSinTerminar = 0;
let peticiones = 0;
let lecturas = 0;
let escrituraEnviada = false;
let reescrituraPaso = 0;
let paradaSolicitada = false;

/**
 * @param {http.ServerResponse} res
 * @param {Record<string, unknown>} delta
 * @param {string} finish
 */
function sse(res, delta, finish) {
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\n`);
  res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }], usage: { prompt_tokens: 900, completion_tokens: 8 }, timings: { prompt_n: 900, predicted_n: 8, predicted_per_second: 50 } })}\n\n`);
  res.end("data: [DONE]\n\n");
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} args
 */
function tool(name, args, id = "c1") {
  return { tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] };
}

/** @param {unknown} texto */
function textoDe(texto) {
  return typeof texto === "string" ? texto : JSON.stringify(texto ?? "");
}

try {
  model = http.createServer(async (req, res) => {
    let raw = "";
    for await (const trozo of req) raw += trozo;
    const body = raw ? JSON.parse(raw) : {};
    const json = (valor) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(valor));
    };
    if (req.url === "/health") return json({ status: "ok" });
    if (req.url === "/props") return json({ default_generation_settings: { n_ctx: 8192 }, modalities: { vision: false }, model_path: "falso.gguf" });
    if (req.url === "/slots") return json([{ n_ctx: 8192 }]);
    if (req.url === "/v1/models") return json({ data: [{ id: "falso" }] });
    if (req.url === "/v1/chat/completions/input_tokens") return json({ input_tokens: Math.max(100, Math.ceil(JSON.stringify(body).length / 4)) });
    if (req.url === "/tokenize") return json({ tokens: [1, 2, 3] });
    if (req.url === "/apply-template") return json({ prompt: JSON.stringify(body) });
    if (req.url !== "/v1/chat/completions") {
      res.writeHead(404);
      return res.end("{}");
    }

    peticiones += 1;
    const todo = textoDe(body.messages);
    const finalPedido = body.tool_choice === "none" || (body.tool_choice && body.tool_choice.type === "none");

    if (!paradaSolicitada && todo.includes("PRUEBA_STOP")) {
      paradaSolicitada = true;
      // Nunca termina solo: el test debe cancelarlo por /api/stop.
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      let n = 0;
      const timer = setInterval(() => {
        n += 1;
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `t${n} ` }, finish_reason: null }] })}\n\n`);
      }, 40);
      res.on("close", () => {
        clearInterval(timer);
        if (!res.writableEnded) abiertosSinTerminar += 1;
      });
      return;
    }

    if (finalPedido) {
      return sse(res, { content: "Verificado. El archivo existe y no quedan cambios pendientes." }, "stop");
    }

    if (todo.includes("PRUEBA_REESCRITURA")) {
      reescrituraPaso += 1;
      if (reescrituraPaso === 1) {
        return sse(res, tool("archivo", { ruta: "rehacer.mjs", contenido: "export const a = 1;\n" }, "crear"), "tool_calls");
      }
      if (reescrituraPaso === 2) {
        // El host acaba de crear el archivo en este mismo turno: debe poder corregirlo
        // sin obligar a una lectura intermedia.
        return sse(res, tool("reemplazar", { ruta: "rehacer.mjs", buscar: "export const a = 1;", poner: "export const a = 2;" }, "corregir"), "tool_calls");
      }
      return sse(res, { content: "Corregido: rehacer.mjs usa a = 2." }, "stop");
    }

    if (todo.includes("PRUEBA_BUCLE")) {
      if (!escrituraEnviada) {
        // Lo crea para que el host tenga algo que verificar. Después solo leerá, que es
        // el bucle real que se quiere cortar.
        escrituraEnviada = true;
        return sse(res, tool("archivo", { ruta: "nuevo.mjs", contenido: contenidoNuevo }), "tool_calls");
      }
      lecturas += 1;
      return sse(res, tool("leer", { ruta: "nuevo.mjs", desde: Math.min(35, lecturas), hasta: Math.min(40, lecturas + 3) }, `read${lecturas}`), "tool_calls");
    }

    return sse(res, { content: "Hola. ¿En qué te ayudo?" }, "stop");
  });
  await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));

  const libre = http.createServer();
  await new Promise((resolve) => libre.listen(0, "127.0.0.1", resolve));
  const port = libre.address().port;
  await new Promise((resolve) => libre.close(resolve));

  ui = spawn(process.execPath, [fileURLToPath(new URL("./ui-server.mjs", import.meta.url)), "--port", String(port), "--llama-port", String(model.address().port)], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    env: { ...process.env, BONSAI_AGENT_PROFILE: "small-local-coder", BONSAI_STATE: state, BONSAI_SALIDA: path.join(temp, "salida") },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  ui.stdout.on("data", (trozo) => (log += trozo));
  ui.stderr.on("data", (trozo) => (log += trozo));

  const base = `http://127.0.0.1:${port}`;
  let listo = false;
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(`${base}/api/state`)).ok) {
        listo = true;
        break;
      }
    } catch {}
    await wait(100);
  }
  assert.ok(listo, log);

  const post = (ruta, valor) => fetch(base + ruta, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(valor),
  });
  await post("/api/workspace", { path: project });
  await post("/api/permit", { mode: "all" });

  // --- 1) Cierre tras verificar sin escrituras nuevas ---------------------
  const respuesta = await post("/api/chat", { text: "PRUEBA_BUCLE: crea y revisa nuevo.mjs", files: ["x.txt"] });
  assert.equal(respuesta.status, 200);
  const eventos = [];
  await leerSSE(respuesta.body, { exigirFin: false, alEvento: (evento) => eventos.push(evento) });
  const done = eventos.findLast((evento) => evento.type === "done");
  assert.ok(done, JSON.stringify(eventos.slice(-8)));
  assert.equal(done.motivo, "verified", `el turno debía cerrar tras verificar, no seguir leyendo: ${JSON.stringify(eventos.slice(-12))}`);
  assert.equal(done.incompleto, false);
  assert.ok(lecturas <= 4, `se permitieron demasiadas lecturas después de verificar: ${lecturas}`);
  assert.ok(peticiones <= 7, `demasiadas peticiones al modelo: ${peticiones}`);
  assert.ok(eventos.some((evento) => evento.type === "action" && evento.kind === "write" && evento.state === "done"));
  assert.ok(eventos.some((evento) => evento.type === "action" && /Verificación automática|Sintaxis comprobada/.test(String(evento.detail || ""))) || eventos.some((evento) => evento.type === "done" && evento.motivo === "verified"));

  // Un archivo creado en el turno ya es conocido: la corrección siguiente no puede
  // rebotar con «Inspecciona primero ese archivo con leer».
  const rehacer = await post("/api/chat", { text: "PRUEBA_REESCRITURA: corrige rehacer.mjs", files: ["x.txt"] });
  const eventosRehacer = [];
  await leerSSE(rehacer.body, { exigirFin: false, alEvento: (evento) => eventosRehacer.push(evento) });
  assert.ok(!eventosRehacer.some((evento) => evento.type === "action" && /Inspecciona primero/.test(String(evento.detail || ""))), JSON.stringify(eventosRehacer.filter((e) => e.type === "action")));
  assert.equal(fs.readFileSync(path.join(project, "rehacer.mjs"), "utf8"), "export const a = 2;\n");

  // --- 2) Detener de verdad y poder enviar otro turno ---------------------
  const antesStop = peticiones;
  const turno = await post("/api/chat", { text: "PRUEBA_STOP: escribe un texto larguísimo", files: ["x.txt"] });
  assert.equal(turno.status, 200);
  const lector = turno.body.getReader();
  const decodificadorTemprano = new TextDecoder();
  let temprano = "";
  while (!temprano.includes('"type":"token"')) {
    const { done: fin, value } = await lector.read();
    assert.equal(fin, false, "el stream terminó antes de emitir un token");
    temprano += decodificadorTemprano.decode(value, { stream: true });
  }
  const parada = await post("/api/stop", {});
  assert.equal(parada.status, 200);
  assert.equal((await parada.json()).ok, true);
  // Drenar el stream hasta su cierre: el servidor debe terminar el turno, no dejarlo vivo.
  const restantes = [];
  const decoder = new TextDecoder();
  let buffer = "";
  const drenar = (async () => {
    while (true) {
      const { done: fin, value } = await lector.read();
      if (fin) break;
      buffer += decoder.decode(value, { stream: true });
      let salto = buffer.indexOf("\n");
      while (salto !== -1) {
        const linea = buffer.slice(0, salto).trim();
        buffer = buffer.slice(salto + 1);
        salto = buffer.indexOf("\n");
        if (linea.startsWith("data:")) {
          try { restantes.push(JSON.parse(linea.slice(5))); } catch {}
        }
      }
    }
  })();
  const cerro = await Promise.race([drenar.then(() => true), wait(5000).then(() => false)]);
  const estadoTrasStop = await (await fetch(`${base}/api/servidor`)).json();
  assert.ok(cerro, "el stream del turno cancelado no se cerró");
  assert.ok(restantes.some((evento) => evento.type === "done"), JSON.stringify(restantes.slice(-8)));
  for (let i = 0; i < 40 && abiertosSinTerminar < 1; i += 1) await wait(50);
  assert.ok(abiertosSinTerminar >= 1, "la petición al modelo debía abortarse, no terminar sola");
  assert.ok(peticiones > antesStop);

  const libreEstado = await (await fetch(`${base}/api/servidor`)).json();
  assert.equal(libreEstado.ocupado, false);
  const segundo = await post("/api/chat", { text: "hola" });
  assert.equal(segundo.status, 200, "un turno nuevo debe funcionar después de Detener");
  const segundoEventos = [];
  await leerSSE(segundo.body, { exigirFin: false, alEvento: (evento) => segundoEventos.push(evento) });
  assert.ok(segundoEventos.some((evento) => evento.type === "done"));

  console.log("Cancelación y cierre tras verificar: OK (modelo abortado, turno nuevo aceptado).");
} finally {
  if (ui && ui.exitCode === null) {
    ui.kill();
    await new Promise((resolve) => ui.once("exit", resolve));
  }
  if (model) await new Promise((resolve) => model.close(resolve));
  const resuelto = path.resolve(temp);
  assert.equal(path.dirname(resuelto), path.resolve(os.tmpdir()));
  fs.rmSync(resuelto, { recursive: true, force: true });
}
