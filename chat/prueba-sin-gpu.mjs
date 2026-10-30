/**
 * Prueba el cliente contra un llama-server FALSO: sin GPU y sin cargar el modelo.
 * Comprueba lo que viaja al servidor (muestreo, razonamiento apagado/encendido, herramientas
 * en paralelo, continuación, resúmenes) y que se registre la velocidad y la caché.
 *   node chat/prueba-sin-gpu.mjs
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { BonsaiChat } from "./bonsai-chat.mjs";

/** @type {string[]} */
const failures = [];
/**
 * @param {string} name
 * @param {boolean} cond
 */
const check = (name, cond) => {
  if (!cond) failures.push(name);
};

/**
 * @param {(body: Record<string, any>, n: number) => {deltas: object[], finish?: string, timings?: object}} script qué contesta a cada petición de chat
 */
function mock(script) {
  /** @type {Array<Record<string, any>>} */
  const seen = [];
  const server = http.createServer((req, res) => {
    const url = req.url || "";
    const json = (code, body) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.method === "GET" && url === "/health") return json(200, { status: "ok" });
    if (req.method === "GET" && url === "/props") return json(200, { default_generation_settings: { n_ctx: 65536 } });
    if (req.method === "GET" && url === "/v1/models") return json(200, { data: [{ id: "mock" }] });
    let raw = "";
    req.on("data", (piece) => {
      raw += piece;
    });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      if (url === "/v1/chat/completions/input_tokens") {
        return json(200, { input_tokens: Math.ceil(JSON.stringify(body.messages).length / 4) });
      }
      if (url !== "/v1/chat/completions") return json(404, {});
      seen.push(body);
      if (!body.stream) return json(200, { choices: [{ message: { content: "resumen de prueba" } }] });
      const step = script(body, seen.length);
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const delta of step.deltas) res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: step.finish || "stop" }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 111, completion_tokens: 7 }, timings: step.timings })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, seen, port: /** @type {import("node:net").AddressInfo} */ (server.address()).port }));
  });
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-mock-"));
let counter = 0;

/**
 * @param {number} port
 * @param {Record<string, unknown>} [extra]
 */
function client(port, extra = {}) {
  counter += 1;
  const chat = new BonsaiChat({
    host: "127.0.0.1",
    port,
    historyCap: 8192,
    sessionPath: path.join(dir, `sesion-${counter}.json`),
    timingsPath: path.join(dir, "velocidad.jsonl"),
    ...extra,
  });
  chat.silent = true;
  return chat;
}

const TIMINGS = { cache_n: 100, prompt_n: 20, prompt_per_second: 800, predicted_n: 7, predicted_per_second: 31.5 };
const say = (text) => ({ deltas: [{ content: text }], timings: TIMINGS });

try {
  // 1. Por defecto: sin razonamiento, muestreo de código, caché de prompt y uso exacto.
  {
    const { server, seen, port } = await mock(() => say("Hola mundo"));
    const chat = client(port);
    /** @type {Array<Record<string, any>>} */
    const events = [];
    chat.push = (event) => events.push(event);
    await chat.connect();
    await chat.runTurn("hola", AbortSignal.timeout(5000));
    const body = seen[0] || {};
    check("sin razonamiento por defecto", body.chat_template_kwargs?.enable_thinking === false && body.thinking_budget_tokens === undefined);
    check("muestreo del perfil codigo", body.temperature === 0.6 && body.top_p === 0.9 && body.top_k === 20 && body.min_p === 0.05 && body.presence_penalty === 0);
    check("pide caché de prompt y uso exacto", body.cache_prompt === true && body.stream_options?.include_usage === true);
    check("una tanda no pasa de 2048 tokens", body.max_tokens <= 2048);
    check("sin herramientas no manda parallel_tool_calls", body.parallel_tool_calls === undefined);
    const last = chat.session.turns[chat.session.turns.length - 1];
    check("guarda la respuesta", last?.role === "assistant" && last.content === "Hola mundo");
    check("lee la velocidad del servidor", chat.lastTimings?.cache_n === 100 && chat.lastTimings?.predicted_per_second === 31.5);
    check("avisa a la interfaz de la velocidad", events.some((e) => e.type === "speed" && e.cache_n === 100 && e.predicted_ps === 31.5));
    const log = fs.readFileSync(path.join(dir, "velocidad.jsonl"), "utf8").trim().split("\n");
    check("deja una línea de velocidad", log.length === 1 && JSON.parse(log[0]).prompt_tokens === 111);
    server.close();
  }

  // 2. Con herramientas: llamadas en paralelo permitidas (y se pueden apagar).
  {
    const { server, seen, port } = await mock(() => say("ok"));
    const chat = client(port);
    chat.actOnPc = true;
    await chat.connect();
    await chat.runTurn("lee dos archivos", AbortSignal.timeout(5000));
    check("manda las herramientas en paralelo", seen[0]?.parallel_tool_calls === true && seen[0]?.tools?.length > 0 && seen[0]?.tool_choice === "auto");
    const off = client(port, { parallelTools: false });
    off.actOnPc = true;
    await off.connect();
    await off.runTurn("otra", AbortSignal.timeout(5000));
    check("se puede apagar el paralelo", seen[seen.length - 1]?.parallel_tool_calls === false);
    server.close();
  }

  // 3. Razonamiento (opt-in): presupuesto en la raíz, muestreo de razonar y el pensamiento no entra al historial.
  {
    const { server, seen, port } = await mock(() => ({
      deltas: [{ reasoning_content: "hay que " }, { reasoning_content: "pensar" }, { content: "respuesta final" }],
      timings: TIMINGS,
    }));
    const chat = client(port, { think: 2048 });
    /** @type {Array<Record<string, any>>} */
    const events = [];
    chat.push = (event) => events.push(event);
    await chat.connect();
    await chat.runTurn("algo difícil", AbortSignal.timeout(5000));
    const body = seen[0] || {};
    check("razonamiento: presupuesto en la raíz", body.thinking_budget_tokens > 0 && body.thinking_budget_tokens <= 2048 && body.chat_template_kwargs?.enable_thinking === true);
    check("razonamiento: esfuerzo medium (high da 500)", body.chat_template_kwargs?.reasoning_effort === "medium");
    check("razonamiento: muestreo de razonar", body.temperature === 0.6 && body.min_p === 0.05 && body.top_p === 0.9);
    check("razonamiento: la tanda incluye el presupuesto", body.max_tokens === 2048 + body.thinking_budget_tokens);
    const last = chat.session.turns[chat.session.turns.length - 1];
    check("razonamiento: el pensamiento no entra al historial", last?.content === "respuesta final");
    check("razonamiento: avisa que está pensando", events.some((e) => e.type === "status" && /pensando/.test(e.text || "")));
    server.close();
  }

  // 4. Continuación tras cortar por longitud: sin razonamiento y con el muestreo de código.
  {
    const { server, seen, port } = await mock((_body, n) => (n === 1
      ? { deltas: [{ content: "parte uno de la respuesta, " }], finish: "length", timings: TIMINGS }
      : { deltas: [{ content: "parte dos" }], timings: TIMINGS }));
    const chat = client(port, { think: 2048 });
    await chat.connect();
    await chat.runTurn("algo largo", AbortSignal.timeout(5000));
    const second = seen[1] || {};
    check("continúa con continue_final_message", second.continue_final_message === true && second.add_generation_prompt === false);
    check("la continuación no razona", second.chat_template_kwargs?.enable_thinking === false && second.thinking_budget_tokens === undefined);
    check("la continuación vuelve al muestreo de código", second.temperature === 0.6);
    const last = chat.session.turns[chat.session.turns.length - 1];
    check("une las dos tandas", last?.content === "parte uno de la respuesta, parte dos");
    server.close();
  }

  // 5. Historial largo: pliega de golpe, el resumen nunca razona y las notas llegan al sistema.
  {
    const { server, seen, port } = await mock(() => say("listo"));
    const chat = client(port, { think: 2048, historyCap: 600 });
    await chat.connect();
    for (let i = 0; i < 8; i += 1) {
      chat.session.turns.push({ role: i % 2 === 0 ? "user" : "assistant", content: `turno ${i} ${"z".repeat(1200)}` });
    }
    await chat.runTurn("pregunta viva", AbortSignal.timeout(5000));
    const summary = seen.find((body) => body.stream === false);
    check("hizo un resumen", Boolean(summary));
    check("el resumen razona con presupuesto limitado", summary?.chat_template_kwargs?.enable_thinking === true && summary?.thinking_budget_tokens > 0 && summary?.thinking_budget_tokens < summary?.max_tokens);
    const main = seen.find((body) => body.stream === true);
    check("las notas viajan en el mensaje de sistema", String(main?.messages?.[0]?.content || "").includes("resumen de prueba"));
    check("quedó plegado el historial viejo", chat.session.folded >= 4);
    server.close();
  }
  // 6. Reglas del proyecto: entran en el mensaje de sistema delante de las notas.
  {
    const { server, seen, port } = await mock(() => say("ok"));
    const chat = client(port);
    chat.rules = "Regla de prueba: usa punto y coma.";
    await chat.connect();
    await chat.runTurn("hola", AbortSignal.timeout(5000));
    const sistema = String(seen[0]?.messages?.[0]?.content || "");
    check("las reglas del proyecto van al mensaje de sistema", sistema.includes("Regla de prueba: usa punto y coma."), sistema.slice(0, 120));
    server.close();
  }
  // 7. Visión: la imagen viaja como parte `image_url` del mensaje del usuario.
  {
    const { server, seen, port } = await mock(() => say("veo la imagen"));
    const datos = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const chat = client(port);
    chat.vision = true;
    await chat.connect();
    await chat.runTurn("¿qué ves?", AbortSignal.timeout(5000), [datos]);
    const mensajes = seen[0]?.messages || [];
    const ultimo = mensajes[mensajes.length - 1] || {};
    const partes = Array.isArray(ultimo.content) ? ultimo.content : [];
    check("con visión la imagen viaja como image_url", partes.some((p) => p.type === "image_url" && p.image_url?.url === datos));
    check("el texto sigue en su parte", partes[0]?.type === "text" && String(partes[0].text).includes("¿qué ves?"));
    check("el historial guarda texto, no la imagen", chat.session.turns.every((t) => typeof t.content === "string"));
    check("la ventana reserva los tokens de la imagen", chat.livePrompt >= 1024);

    const ciego = client(port);
    await ciego.connect();
    await ciego.runTurn("otra", AbortSignal.timeout(5000), [datos]);
    const mensajes2 = seen[seen.length - 1]?.messages || [];
    check("sin visión la imagen no se manda", typeof mensajes2[mensajes2.length - 1]?.content === "string");
    server.close();
  }
  // Un conteo que no responde debe cancelarse al pulsar Detener, sin esperar
  // el timeout del servidor ni intentar otros endpoints despues de cancelar.
  {
    let peticiones = 0;
    const colgado = http.createServer((req, _res) => { peticiones += 1; req.resume(); });
    await new Promise((resolve) => colgado.listen(0, "127.0.0.1", resolve));
    const puerto = colgado.address().port;
    const chat = client(puerto);
    chat.active = new AbortController();
    const trabajo = chat.countPrompt([{ role: "user", content: "hola" }], false);
    const inicio = Date.now();
    const timer = setTimeout(() => chat.active.abort(), 40);
    const resultado = await Promise.race([
      trabajo.then(() => "no cancelado", (error) => error.name),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 600)),
    ]);
    clearTimeout(timer);
    check("Detener interrumpe el conteo colgado", resultado === "AbortError" && Date.now() - inicio < 600);
    check("cancelar no dispara endpoints de respaldo", peticiones === 1);
    colgado.closeAllConnections();
    colgado.close();
  }
  {
    const chat = client(1);
    chat.props = { model_path: "C:/models/Ornith-1.5-9B-Q4_K_M.gguf" };
    check("Ornith usa su propio muestreo de codigo", chat.samplingFields().temperature === 0.6 && chat.samplingFields().top_p === 0.9);
    chat.nCtx = 32768;
    chat.configuredCap = 32768;
    chat.actOnPc = true;
    check("una ventana de 32K reserva al menos 16K para escribir codigo", chat.historyCap() <= 16384 && chat.historyCap() >= 8192);
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

if (failures.length) {
  process.stderr.write(`FALLÓ:\n- ${failures.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("prueba sin GPU ok\n");
}
