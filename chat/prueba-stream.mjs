/**
 * Prueba del lector SSE único (chat/sse.mjs) y de su uso desde BonsaiChat.streamSlice,
 * además de la escritura/lectura atómica de la sesión.
 *
 * Todo va contra un servidor HTTP local que controla EXACTAMENTE cómo corta cada respuesta
 * (nada de GPU, nada de red externa, estado en os.tmpdir()).
 *
 *   node chat/prueba-stream.mjs
 *
 * Casos: normal, corte tras un trozo válido sin [DONE], último evento sin salto, UTF-8
 * partido entre trozos, JSON inválido, CRLF (también partido), comentarios, data: multilínea,
 * BOM, aborto y recuperación de sesión corrupta con .bak.
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { BonsaiChat } from "./bonsai-chat.mjs";
import { ErrorSSE, leerSSE } from "./sse.mjs";

/** @type {string[]} */
const failures = [];
/**
 * @param {string} name
 * @param {boolean} cond
 * @param {string} [detail]
 */
const check = (name, cond, detail = "") => {
  if (!cond) failures.push(detail ? `${name} :: ${detail}` : name);
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-prueba-stream-"));

/** @type {{trozos: Array<string | Buffer>, corta?: boolean, espera?: boolean, pausa?: number} | null} */
let guion = null;
const abiertas = new Set();

/** Lo que el servidor "manda" a un POST de chat completions con stream. */
const servidor = http.createServer((req, res) => {
  const url = req.url || "";
  const json = (cuerpo) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(cuerpo));
  };
  if (req.method === "GET" && url === "/health") return json({ status: "ok" });
  if (req.method === "GET" && url === "/props") return json({ default_generation_settings: { n_ctx: 16384 }, modalities: { vision: false } });
  if (req.method === "GET" && url === "/v1/models") return json({ data: [{ id: "falso" }] });
  let raw = "";
  req.on("data", (trozo) => (raw += trozo));
  req.on("end", () => {
    if (url === "/v1/chat/completions/input_tokens") return json({ input_tokens: 100 });
    if (url !== "/v1/chat/completions") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }
    let cuerpo = {};
    try {
      cuerpo = raw ? JSON.parse(raw) : {};
    } catch {
      cuerpo = {};
    }
    if (!cuerpo.stream) return json({ choices: [{ message: { content: "resumen" } }] });
    const plan = guion || { trozos: [] };
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    abiertas.add(res);
    res.on("close", () => abiertas.delete(res));
    const escribir = (i) => {
      if (i >= plan.trozos.length) {
        if (plan.espera) return; // deja la conexión abierta (para probar abortar)
        res.end(); // cierre: si no hubo [DONE]/finish_reason, es prematuro
        return;
      }
      res.write(plan.trozos[i]);
      if (plan.pausa) setTimeout(() => escribir(i + 1), plan.pausa);
      else setImmediate(() => escribir(i + 1));
    };
    escribir(0);
  });
});
await new Promise((resolve) => servidor.listen(0, "127.0.0.1", () => resolve(undefined)));
const puerto = /** @type {import("node:net").AddressInfo} */ (servidor.address()).port;
const base = `http://127.0.0.1:${puerto}`;

/**
 * Deja el guion del servidor y devuelve el cuerpo del stream.
 * @param {Array<string | Buffer>} trozos
 * @param {{corta?: boolean, espera?: boolean, pausa?: number}} [extra]
 */
async function flujoHTTP(trozos, extra = {}) {
  guion = { trozos, ...extra };
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stream: true, messages: [] }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  return res.body;
}

/**
 * Consume un flujo y devuelve el resultado o el error (sin lanzar).
 * @param {unknown} flujo
 * @param {Parameters<typeof leerSSE>[1]} [opciones]
 */
async function consumir(flujo, opciones = {}) {
  try {
    return { ok: true, meta: await leerSSE(flujo, { exigirFin: true, ...opciones }) };
  } catch (err) {
    return { ok: false, err };
  }
}

/** Un evento OpenAI de contenido. */
const token = (texto) => `data: ${JSON.stringify({ choices: [{ delta: { content: texto }, finish_reason: null }] })}\n\n`;
/** Un evento OpenAI de cierre. */
const fin = (reason = "stop") => `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }] })}\n\n`;
const DONE = "data: [DONE]\n\n";

/**
 * Trocea un Buffer/texto en trozos de tamaños dados (Fuerza UTF-8 partido y CRLF partido).
 * @param {string} texto
 * @param {number[]} tamanos
 * @returns {Buffer[]}
 */
function trocear(texto, tamanos) {
  const bytes = Buffer.from(texto, "utf8");
  /** @type {Buffer[]} */
  const trozos = [];
  let i = 0;
  let n = 0;
  while (i < bytes.length) {
    const tamano = tamanos[n % tamanos.length];
    trozos.push(bytes.subarray(i, i + tamano));
    i += tamano;
    n += 1;
  }
  return trozos;
}

/** Generador asíncrono que entrega los trozos tal cual (stream sin HTTP). */
async function* generador(trozos) {
  for (const trozo of trozos) yield trozo;
}

try {
  // ============================ 1. Parser: normal ============================
  {
    const cuerpo = await flujoHTTP([token("Hola "), token("mundo"), fin("stop"), `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 11 } })}\n\n`, DONE]);
    const { ok, meta, err } = await consumir(cuerpo);
    check("normal: no lanza", ok, String(err));
    check("normal: une los trozos de texto", meta?.texto === "Hola mundo", JSON.stringify(meta?.texto));
    check("normal: fin legítimo", meta?.completo === true && meta?.motivo === "done", JSON.stringify(meta && { completo: meta.completo, motivo: meta.motivo }));
    check("normal: cuenta los eventos", meta?.nEventos === 4, String(meta?.nEventos));
  }

  // ================== 2. Corte tras un trozo válido sin [DONE] ==================
  {
    const cuerpo = await flujoHTTP([token("parcial"), token(" recibido")]); // y res.end()
    const { ok, err } = await consumir(cuerpo);
    check("corte: lanza un error tipado", ok === false && err instanceof ErrorSSE, String(err));
    check("corte: motivo de cierre prematuro", err?.motivo === "cierre_prematuro", String(err?.motivo));
    check("corte: conserva el texto parcial", err?.parcial === "parcial recibido", JSON.stringify(err?.parcial));
    check("corte: adjunta los eventos ya vistos", Array.isArray(err?.eventos) && err.eventos.length === 2, String(err?.eventos?.length));
    check("corte: el error se puede distinguir (esSSE)", err?.esSSE === true);
  }

  // ===================== 3. Último evento sin salto de línea =====================
  {
    const sinSalto = `data: ${JSON.stringify({ choices: [{ delta: { content: "final sin salto" }, finish_reason: "stop" }] })}`;
    const cuerpo = await flujoHTTP([sinSalto]);
    const { ok, meta, err } = await consumir(cuerpo);
    check("sin salto final: el evento se procesa", ok, String(err));
    check("sin salto final: su texto llega", meta?.texto === "final sin salto", JSON.stringify(meta?.texto));
    check("sin salto final: el finish_reason cuenta como fin", meta?.completo === true && meta?.motivo === "finish_reason", JSON.stringify(meta?.motivo));
  }
  {
    const cuerpo = await flujoHTTP([token("hecho"), "data: [DONE]"]); // [DONE] sin \n ni \n\n
    const { ok, meta, err } = await consumir(cuerpo);
    check("[DONE] sin salto final: se reconoce", ok && meta?.completo === true && meta?.motivo === "done", String(err || meta?.motivo));
  }

  // ==================== 4. UTF-8 partido entre trozos (byte a byte) ====================
  {
    const texto = `${token("Ñandú 🦫 fin")}${fin("stop")}${DONE}`;
    const bytes = Buffer.from(texto, "utf8");
    /** @type {Buffer[]} */
    const trozos = [];
    for (let i = 0; i < bytes.length; i += 2) trozos.push(bytes.subarray(i, i + 2));
    const { ok, meta, err } = await consumir(generador(trozos));
    check("utf-8 partido: no se corrompe", ok, String(err));
    check("utf-8 partido: el texto queda exacto", meta?.texto === "Ñandú 🦫 fin", JSON.stringify(meta?.texto));
    check("utf-8 partido: termina bien", meta?.completo === true);
  }

  // ============= 4b. UTF-8 y CRLF partidos también por el servidor HTTP =============
  {
    // El servidor escribe el primer byte de "Ñ" y los primeros de "🦫" y espera 20 ms
    // antes de seguir: el cliente recibe caracteres multibyte partidos de verdad.
    const completo = `${token("Ñandú 🦫")}${fin("stop")}${DONE}`;
    const bytes = Buffer.from(completo, "utf8");
    const corte1 = bytes.indexOf(Buffer.from("Ñ", "utf8")) + 1;
    const corte2 = bytes.indexOf(Buffer.from("🦫", "utf8")) + 2;
    const cuerpo = await flujoHTTP([bytes.subarray(0, corte1), bytes.subarray(corte1, corte2), bytes.subarray(corte2)], { pausa: 20 });
    const { ok, meta, err } = await consumir(cuerpo);
    check("HTTP UTF-8 partido: no se corrompe ni lanza", ok && meta?.texto === "Ñandú 🦫", String(err || JSON.stringify(meta?.texto)));
    check("HTTP UTF-8 partido: termina bien", meta?.completo === true);
  }
  {
    // Cada fin de línea CRLF viaja partido en dos trozos ("\r" y "\n" separados 5 ms).
    const crudo = `${token("CRLF por HTTP").replace(/\n/g, "\r\n")}${fin("stop").replace(/\n/g, "\r\n")}${DONE.replace(/\n/g, "\r\n")}`;
    const trozos = crudo.split("\r").flatMap((parte, i) => (i === 0 ? [parte] : ["\r", parte])).filter((parte) => parte.length > 0);
    const cuerpo = await flujoHTTP(trozos, { pausa: 5 });
    const { ok, meta, err } = await consumir(cuerpo);
    check("HTTP CRLF partido: se parsea", ok && meta?.texto === "CRLF por HTTP" && meta.completo === true, String(err || JSON.stringify(meta && { texto: meta.texto, completo: meta.completo })));
  }

  // ============================ 5. JSON inválido ============================
  {
    const cuerpo = await flujoHTTP([token("antes"), "data: {esto no es json}\n\n", fin("stop"), DONE]);
    const { ok, err } = await consumir(cuerpo);
    check("json inválido: lanza ErrorSSE", ok === false && err instanceof ErrorSSE, String(err));
    check("json inválido: motivo correcto", err?.motivo === "json_invalido", String(err?.motivo));
    check("json inválido: conserva el texto previo", err?.parcial === "antes", JSON.stringify(err?.parcial));
    check("json inválido: lleva los eventos ya vistos", Array.isArray(err?.eventos) && err.eventos.length === 1, String(err?.eventos?.length));
  }
  {
    // Modo tolerante (scripts de medición): ignora el JSON roto y sigue.
    const cuerpo = await flujoHTTP([token("a"), "data: {roto}\n\n", token("b"), fin("stop"), DONE]);
    const { ok, meta, err } = await consumir(cuerpo, { jsonInvalido: "ignorar" });
    check("json inválido tolerante: no lanza", ok, String(err));
    check("json inválido tolerante: conserva el texto válido", meta?.texto === "ab", JSON.stringify(meta?.texto));
    check("json inválido tolerante: termina con [DONE]", meta?.completo === true && meta?.motivo === "done");
  }

  // ====================== 6. CRLF, comentarios y multilínea ======================
  {
    const crudo = `: keep-alive\r\n\r\n${token("CRLF ok").replace(/\n/g, "\r\n")}: otro ping\r\n${fin("stop").replace(/\n/g, "\r\n")}${DONE.replace(/\n/g, "\r\n")}`;
    // CRLF partido justo entre el \r y el \n.
    const trozos = trocear(crudo, [1]);
    const { ok, meta, err } = await consumir(generador(trozos));
    check("CRLF partido: se parsea", ok, String(err));
    check("CRLF partido: texto y fin correctos", meta?.texto === "CRLF ok" && meta?.completo === true, JSON.stringify(meta && { texto: meta.texto, completo: meta.completo }));
  }
  {
    // data: multilínea (la especificación une las líneas con \n antes de interpretar).
    const multilinea = `data: {"choices":\ndata: [{"delta": {"content": "multi"}, "finish_reason": null}]}\n\n${fin("stop")}${DONE}`;
    const { ok, meta, err } = await consumir(generador([multilinea]));
    check("data: multilínea: se une antes de parsear", ok && meta?.texto === "multi", String(err || JSON.stringify(meta?.texto)));
  }
  {
    // BOM al principio y finales de línea con CR suelto.
    const crudo = `\uFEFF${token("con BOM").replace(/\n/g, "\r")}${fin("stop").replace(/\n/g, "\r")}${DONE.replace(/\n/g, "\r")}`;
    const { ok, meta, err } = await consumir(generador([crudo]));
    check("BOM + CR suelto: se parsea", ok && meta?.texto === "con BOM" && meta.completo === true, String(err || JSON.stringify(meta && { texto: meta.texto, completo: meta.completo })));
  }

  // ============================ 7. Aborto del llamador ============================
  {
    const control = new AbortController();
    const cuerpo = await flujoHTTP([token("a medias")], { espera: true });
    const espera = consumir(cuerpo, { señal: control.signal });
    setTimeout(() => control.abort(), 120);
    const resultado = await espera;
    check("aborto: no se confunde con cierre prematuro", resultado.ok === false && resultado.err?.name === "AbortError", String(resultado.err?.name || resultado.err));
  }

  // ======================= 8. BonsaiChat.streamSlice =======================
  const chat = new BonsaiChat({
    host: "127.0.0.1",
    port: puerto,
    historyCap: 8192,
    sessionPath: path.join(TMP, "sesion-stream.json"),
    timingsPath: null,
  });
  chat.silent = true;
  /** @type {Array<Record<string, any>>} */
  const eventosInterfaz = [];
  chat.push = (evento) => eventosInterfaz.push(evento);
  await chat.connect();

  /**
   * @param {{trozos: Array<string | Buffer>, espera?: boolean, pausa?: number}} plan
   * @param {AbortSignal} [senal]
   */
  async function pedirSlice(plan, senal) {
    guion = plan;
    try {
      const r = await chat.streamSlice([{ role: "user", content: "hola" }], 512, false, senal || AbortSignal.timeout(10000));
      return { ok: true, r };
    } catch (err) {
      return { ok: false, err };
    }
  }

  {
    const plan = {
      trozos: [
        token("Hola "),
        token("mundo"),
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], timings: { cache_n: 7, prompt_n: 3, predicted_per_second: 28.5 }, usage: { prompt_tokens: 9, completion_tokens: 2 } })}\n\n`,
        DONE,
      ],
    };
    const { ok, r, err } = await pedirSlice(plan);
    check("slice normal: no lanza", ok, String(err));
    check("slice normal: texto completo", r?.chunk === "Hola mundo", JSON.stringify(r?.chunk));
    check("slice normal: finish_reason 'stop'", r?.reason === "stop", String(r?.reason));
    check("slice normal: añade completo/motivo", r?.completo === true && r?.motivo === "done", JSON.stringify(r && { completo: r.completo, motivo: r.motivo }));
    check("slice normal: timings y usage se leen", r?.timings?.cache_n === 7 && r?.usage?.prompt_tokens === 9, JSON.stringify(r?.timings));
    check("slice normal: se emiten tokens a la interfaz", eventosInterfaz.some((e) => e.type === "token" && e.text === "Hola "));
  }
  {
    const args = JSON.stringify({ ruta: "a.txt", contenido: "x".repeat(50) });
    const plan = {
      trozos: [
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "leer", arguments: args.slice(0, 10) } }] }, finish_reason: null }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(10) } }] }, finish_reason: "tool_calls" }] })}\n\n`,
        DONE,
      ],
    };
    const { ok, r, err } = await pedirSlice(plan);
    check("slice tool_calls: no lanza", ok, String(err));
    check("slice tool_calls: la llamada partida se funde por index", r?.toolCalls?.length === 1 && r.toolCalls[0].id === "call_1" && r.toolCalls[0].name === "leer" && r.toolCalls[0].arguments === args, JSON.stringify(r?.toolCalls));
    check("slice tool_calls: reason tool_calls", r?.reason === "tool_calls" && r?.completo === true, String(r?.reason));
  }
  {
    // El fallo original: la conexión se corta tras un trozo válido y sin [DONE].
    const plan = { trozos: [token("me quedo a medias")] };
    const { ok, err } = await pedirSlice(plan);
    check("slice corte: lanza en vez de fingir respuesta completa", ok === false && err instanceof ErrorSSE, String(err));
    check("slice corte: parcial disponible para conservarlo", err?.parcial === "me quedo a medias", JSON.stringify(err?.parcial));
    check("slice corte: API de retorno intacta (err.partial)", err?.partial === "me quedo a medias", JSON.stringify(err?.partial));
    check("slice corte: motivo visible para avisar/reintentar", err?.motivo === "cierre_prematuro", String(err?.motivo));
  }
  {
    const plan = { trozos: [token("antes"), "data: {roto}\n\n"] };
    const { ok, err } = await pedirSlice(plan);
    check("slice json inválido: lanza ErrorSSE", ok === false && err instanceof ErrorSSE && err.motivo === "json_invalido", String(err?.motivo || err));
    check("slice json inválido: conserva lo anterior", err?.parcial === "antes" && err?.partial === "antes", JSON.stringify(err?.parcial));
  }
  {
    const plan = { trozos: [token("solo done"), "data: [DONE]\n\n"] };
    const { ok, r, err } = await pedirSlice(plan);
    check("[DONE] sin finish_reason: se acepta como fin", ok && r?.completo === true && r?.motivo === "done", String(err || r?.motivo));
    check("[DONE] sin finish_reason: reason de respaldo 'stop'", r?.reason === "stop", String(r?.reason));
  }
  {
    const sinSalto = `data: ${JSON.stringify({ choices: [{ delta: { content: "último" }, finish_reason: "stop" }] })}`;
    const plan = { trozos: [sinSalto] };
    const { ok, r, err } = await pedirSlice(plan);
    check("slice último evento sin salto: no se pierde", ok && r?.chunk === "último" && r?.completo === true, String(err || JSON.stringify(r?.chunk)));
  }
  {
    const plan = {
      trozos: [
        `data: ${JSON.stringify({ choices: [{ delta: { content: "CRLF" } }] })}\r\n\r\n`,
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\r\n\r\n`,
        "data: [DONE]\r\n\r\n",
      ],
    };
    const { ok, r, err } = await pedirSlice(plan);
    check("slice CRLF: se parsea", ok && r?.chunk === "CRLF" && r?.completo === true, String(err || JSON.stringify(r?.chunk)));
  }
  {
    const control = new AbortController();
    const espera = pedirSlice({ trozos: [token("a medias")], espera: true }, control.signal);
    setTimeout(() => control.abort(), 120);
    const { ok, err } = await espera;
    check("slice aborto: sigue siendo AbortError (Detener no es un error de protocolo)", ok === false && err?.name === "AbortError", String(err?.name || err));
  }
  chat.active = null;

  // ============ 9. Sesión: escritura atómica, .bak y apartado de corruptos ============
  {
    const ruta = path.join(TMP, "sesion-atomica.json");
    const uno = new BonsaiChat({ host: "127.0.0.1", port: puerto, historyCap: 8192, sessionPath: ruta, timingsPath: null });
    uno.silent = true;
    const avisos = [];
    uno.push = (evento) => { if (evento.type === "status") avisos.push(String(evento.text)); };
    uno.session = {
      memory: "nota",
      folded: 0,
      turns: [
        { role: "user", content: "uno" },
        { role: "assistant", content: "dos" },
      ],
      draft: "",
      files: [],
    };
    uno.saveSession();
    const guardado = JSON.parse(fs.readFileSync(ruta, "utf8"));
    check("saveSession: escribe JSON válido y completo", guardado.turns?.length === 2 && guardado.memory === "nota");

    // Segunda escritura: la anterior queda en .bak.
    uno.session.turns.push({ role: "user", content: "tres" });
    uno.saveSession();
    check("saveSession: deja respaldo .bak", fs.existsSync(`${ruta}.bak`));

    // Principal corrupto: se recupera del .bak (2 turnos) y el malo se conserva aparte.
    fs.writeFileSync(ruta, "{ esto no es json");
    const dos = new BonsaiChat({ host: "127.0.0.1", port: puerto, historyCap: 8192, sessionPath: ruta, timingsPath: null });
    dos.silent = true;
    const avisosDos = [];
    dos.push = (evento) => { if (evento.type === "status") avisosDos.push(String(evento.text)); };
    dos.loadSession();
    check("loadSession: recupera del .bak", dos.session.turns.length === 2, String(dos.session.turns.length));
    check("loadSession: avisa de que recuperó del respaldo", avisosDos.some((texto) => /respaldo \.bak/.test(texto)), JSON.stringify(avisosDos));
    check(
      "loadSession: el archivo corrupto se aparta, no se borra",
      fs.readdirSync(TMP).some((nombre) => nombre.startsWith("sesion-atomica.json.corrupto-")),
      fs.readdirSync(TMP).join(","),
    );

    // Corrupto sin .bak: mensaje de siempre y sesión vacía.
    const rutaSola = path.join(TMP, "sesion-rota.json");
    fs.writeFileSync(rutaSola, "no es json");
    const tres = new BonsaiChat({ host: "127.0.0.1", port: puerto, historyCap: 8192, sessionPath: rutaSola, timingsPath: null });
    tres.silent = true;
    const avisosTres = [];
    tres.push = (evento) => { if (evento.type === "status") avisosTres.push(String(evento.text)); };
    tres.loadSession();
    check(
      "loadSession: conserva el mensaje de sesión ilegible y empieza vacía",
      tres.session.turns.length === 0 && avisosTres.some((texto) => /sesión ilegible/.test(texto) && /\.corrupto/.test(texto)),
      JSON.stringify(avisosTres),
    );

    // Archivo válido: carga normal (sin avisos de corrupción).
    const cuatro = new BonsaiChat({ host: "127.0.0.1", port: puerto, historyCap: 8192, sessionPath: `${ruta}.bak`, timingsPath: null });
    cuatro.silent = true;
    const avisosCuatro = [];
    cuatro.push = (evento) => { if (evento.type === "status") avisosCuatro.push(String(evento.text)); };
    cuatro.loadSession();
    check("loadSession: una sesión válida se carga sin avisos", cuatro.session.turns.length === 2 && avisosCuatro.length === 0, JSON.stringify(avisosCuatro));
  }
} finally {
  guion = { trozos: [] };
  for (const respuesta of abiertas) {
    try {
      respuesta.destroy();
    } catch {
      /* ya cerrada */
    }
  }
  servidor.closeAllConnections?.();
  await new Promise((resolve) => servidor.close(() => resolve(undefined)));
  try {
    fs.rmSync(TMP, { recursive: true, force: true });
  } catch {
    /* limpieza best-effort */
  }
}

if (failures.length) {
  process.stderr.write(`prueba stream: ${failures.length} fallo(s)\n${failures.map((fallo) => `  - ${fallo}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("prueba stream ok\n");
}
