/**
 * Pruebas de la compactación de contexto y del presupuesto adaptativo:
 *
 *  - Hallazgo 18: al plegar no puede quedar un `tool` cuyo `assistant.tool_calls` se fue
 *    (repro del informe: dropdown=2, roles [system,user,tool]) ni un id huérfano. El ancla
 *    tool se convierte en nota explícita o conserva su llamada; la salida de emergencia de
 *    packHistory tampoco deja huérfanos.
 *  - Hallazgo 21: la memoria de respaldo reserva espacio para hechos recientes/fallos antes
 *    de recortar notas viejas.
 *  - Hallazgo 16: `faseSalto`, reserva de salida adaptativa y `presupuestoContexto()`.
 *
 *   node chat/prueba-contexto.mjs
 *
 * Sin GPU y sin estado del usuario: el único servidor es un llama-server falso local.
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { BonsaiChat, AGENT_SLICE_TOKENS } from "./bonsai-chat.mjs";
import {
  MEMORY_CAP_TOKENS,
  MIN_ROOM,
  estimateTokens,
  selectContext,
} from "./context.mjs";

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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-prueba-contexto-"));

/**
 * ¿El historial de mensajes respeta las llamadas a herramientas? Cada `tool` tiene que venir
 * detrás del assistant que lo pidió (o de otro resultado de esa misma llamada); ningún id
 * puede quedar huérfano.
 * @param {Array<Record<string, any>>} messages
 * @returns {boolean}
 */
function sinHuerfanos(messages) {
  let abierto = false;
  /** @type {Set<string>} */
  let ids = new Set();
  for (const msg of messages) {
    if (msg.role === "system") continue;
    if (msg.role === "tool") {
      if (!abierto || !ids.has(msg.tool_call_id)) return false;
      continue;
    }
    if (msg.role === "assistant") {
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      ids = new Set(calls.map((call, index) => call?.id || `call_${index}`));
      abierto = true;
    } else {
      abierto = false;
      ids = new Set();
    }
  }
  return true;
}

/**
 * ¿Hay algún mensaje `tool` en el historial?
 * @param {Array<Record<string, any>>} messages
 */
const hayTool = (messages) => messages.some((msg) => msg.role === "tool");

// =====================================================================================
// 1. Hallazgo 18: el repro del informe
// =====================================================================================
{
  const plan = selectContext({
    turns: [
      { role: "user", content: "Completa el archivo y comprueba su resultado." },
      { role: "assistant", content: "", toolCalls: [{ id: "read1", name: "leer", arguments: JSON.stringify({ ruta: "archivo.txt", padding: "x".repeat(6000) }) }] },
      { role: "tool", content: "Contenido del archivo", toolCallId: "read1" },
    ],
    memory: "",
    historyCap: 1200,
    countText: estimateTokens,
    pinned: { index: 0, content: "Completa el archivo y comprueba su resultado." },
  });
  const mensajes = plan.messages || [];
  check("repro: hubo pliegue (dropCount > 0)", plan.dropCount > 0, String(plan.dropCount));
  check("repro: no queda ningún role tool suelto", !hayTool(mensajes), JSON.stringify(mensajes.map((m) => m.role)));
  check("repro: el historial es válido (ids no huérfanos)", sinHuerfanos(mensajes));
  check("repro: no se fabrican llamadas", mensajes.every((m) => !Array.isArray(m.tool_calls) || m.tool_calls.length === 0));
  const nota = mensajes.map((m) => String(m.content || "")).join("\n");
  check("repro: el resultado se conserva como nota identificada", /Resultado de la herramienta read1/.test(nota) && nota.includes("Contenido del archivo"));
  check("repro: la nota dice que no es una instrucción nueva", /no una instrucción nueva/.test(nota));
}

// =====================================================================================
// 2. Hallazgo 18: varios grupos completos y ancla tool
// =====================================================================================
{
  const grande = (relleno) => JSON.stringify({ ruta: "a.txt", relleno: relleno.repeat(2400) });
  const turnos = [
    { role: "user", content: "crea y comprueba" },
    { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "archivo", arguments: grande("x") }] },
    { role: "tool", content: "Guardado a.txt", toolCallId: "c1" },
    { role: "assistant", content: "", toolCalls: [{ id: "c2", name: "leer", arguments: grande("y") }] },
    { role: "tool", content: "contenido leído", toolCallId: "c2" },
    { role: "user", content: "verifica" },
  ];
  const plan = selectContext({
    turns: turnos,
    memory: "",
    historyCap: 1800,
    countText: estimateTokens,
    pinned: { index: 0, content: "crea y comprueba" },
  });
  const mensajes = plan.messages || [];
  check("varios grupos: se pliegan unidades completas (3 turnos)", plan.dropCount === 3, String(plan.dropCount));
  check("varios grupos: el historial es válido", sinHuerfanos(mensajes));
  // El grupo c2 sobrevive entero: su llamada y su resultado.
  const idsLlamadas = mensajes.flatMap((m) => (Array.isArray(m.tool_calls) ? m.tool_calls.map((c) => c.id) : []));
  const idsResultados = mensajes.filter((m) => m.role === "tool").map((m) => m.tool_call_id);
  check("varios grupos: la llamada que queda tiene su resultado", idsLlamadas.includes("c2") && idsResultados.includes("c2"), JSON.stringify({ idsLlamadas, idsResultados }));
  check("varios grupos: no sobrevive el grupo plegado", !idsLlamadas.includes("c1") && !idsResultados.includes("c1"));
}
{
  // Ancla tool que SÍ cabe: se conserva la llamada.
  const plan = selectContext({
    turns: [
      { role: "user", content: "lee a.txt" },
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "leer", arguments: { ruta: "a.txt" } }] },
      { role: "tool", content: "contenido", toolCallId: "c1" },
    ],
    memory: "",
    historyCap: 5000,
    countText: estimateTokens,
  });
  const mensajes = plan.messages || [];
  check("ancla tool que cabe: sigue siendo role tool", mensajes.at(-1)?.role === "tool" && mensajes.at(-1)?.tool_call_id === "c1", JSON.stringify(mensajes.at(-1)));
  check("ancla tool que cabe: conserva la llamada", mensajes.at(-2)?.role === "assistant" && mensajes.at(-2)?.tool_calls?.[0]?.id === "c1");
  check("ancla tool que cabe: historial válido", sinHuerfanos(mensajes));
}
{
  // Historial viejo con un resultado suelto (sin llamada): viaja como nota, nunca como tool.
  const plan = selectContext({
    turns: [
      { role: "tool", content: "resultado viejo sin llamada", toolCallId: "perdida" },
      { role: "user", content: "hola" },
    ],
    memory: "",
    historyCap: 5000,
    countText: estimateTokens,
  });
  const mensajes = plan.messages || [];
  check("resultado suelto: no se manda como tool", !hayTool(mensajes), JSON.stringify(mensajes.map((m) => m.role)));
  check("resultado suelto: se conserva como nota", /Resultado de la herramienta perdida/.test(mensajes.map((m) => m.content).join("\n")));
  check("resultado suelto: historial válido", sinHuerfanos(mensajes));
}

// =====================================================================================
// 3. Hallazgo 18 (barrido): cualquier pliegue deja una estructura válida
// =====================================================================================
{
  // Generador determinista (LCG) para repetir siempre el mismo barrido.
  let estado = 123456789;
  const azar = () => {
    estado = (estado * 1103515245 + 12345) % 2147483648;
    return estado / 2147483648;
  };
  let barridos = 0;
  let invalidos = 0;
  for (let iteracion = 0; iteracion < 25; iteracion += 1) {
    /** @type {Array<Record<string, any>>} */
    const turnos = [{ role: "user", content: "pide algo" }];
    for (let grupo = 0; grupo < 4; grupo += 1) {
      const relleno = "p".repeat(100 + Math.floor(azar() * 1400));
      const id = `call_${iteracion}_${grupo}`;
      turnos.push({ role: "assistant", content: "", toolCalls: [{ id, name: "leer", arguments: JSON.stringify({ ruta: "a.txt", relleno }) }] });
      turnos.push({ role: "tool", content: `resultado ${grupo}`, toolCallId: id });
    }
    // La mitad de las veces el ancla es un resultado de herramienta.
    if (iteracion % 2 === 0) {
      const id = `call_${iteracion}_ancla`;
      turnos.push({ role: "assistant", content: "", toolCalls: [{ id, name: "leer", arguments: JSON.stringify({ ruta: "b.txt", relleno: "q".repeat(600) }) }] });
      turnos.push({ role: "tool", content: "resultado ancla", toolCallId: id });
    } else {
      turnos.push({ role: "user", content: "verifica" });
    }
    for (const cap of [700, 1000, 1500, 2500, 5000]) {
      const plan = selectContext({
        turns: turnos,
        memory: "",
        historyCap: cap,
        countText: estimateTokens,
        pinned: { index: 0, content: "pide algo" },
      });
      barridos += 1;
      if (!plan.messages) {
        invalidos += 1;
        continue;
      }
      if (!sinHuerfanos(plan.messages)) invalidos += 1;
    }
  }
  check("barrido: todo historial compactado es válido", invalidos === 0, `${invalidos}/${barridos}`);
}

// =====================================================================================
// 4. Hallazgo 18: la salida de emergencia de packHistory
// =====================================================================================
{
  // llama-server falso: el conteo de prompt siempre es enorme, así que packHistory agota sus
  // 8 intentos y cae en la salida de emergencia (que antes conservaba solo el último mensaje).
  const servidor = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (trozo) => (raw += trozo));
    req.on("end", () => {
      const responder = (cuerpo) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(cuerpo));
      };
      if (req.url === "/v1/chat/completions/input_tokens") return responder({ input_tokens: 999999 });
      if (req.url === "/v1/chat/completions") return responder({ choices: [{ message: { content: "- resumen de emergencia" } }] });
      responder({});
    });
  });
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", () => resolve(undefined)));
  const puerto = /** @type {import("node:net").AddressInfo} */ (servidor.address()).port;
  try {
    const chat = new BonsaiChat({
      host: "127.0.0.1",
      port: puerto,
      historyCap: 4096,
      sessionPath: path.join(TMP, "sesion-emergencia.json"),
      timingsPath: null,
    });
    chat.silent = true;
    chat.nCtx = 4096;
    chat.session = {
      memory: "notas anteriores",
      folded: 0,
      turns: [
        { role: "user", content: "lee y arregla el archivo" },
        { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "leer", arguments: { ruta: "a.txt" } }] },
        { role: "tool", content: "contenido de a.txt", toolCallId: "c1" },
      ],
      draft: "",
      files: [],
    };
    let error = "";
    try { await chat.packHistory(); } catch (err) { error = err.message; }
    check("packHistory informa cuando no puede contar el contexto", /no se pudo ajustar/i.test(error), error);
    check("packHistory conserva el historial al fallar", chat.session.folded === 0 && chat.session.turns.length === 3 && chat.session.memory === "notas anteriores");
  } finally {
    servidor.closeAllConnections?.();
    await new Promise((resolve) => servidor.close(() => resolve(undefined)));
  }
}

// =====================================================================================
// 5. Hallazgo 21: la memoria de respaldo reserva espacio para lo reciente
// =====================================================================================
{
  const caps = new BonsaiChat({
    host: "127.0.0.1",
    port: 1,
    historyCap: 32768,
    sessionPath: path.join(TMP, "memoria.json"),
    timingsPath: null,
  });
  caps.silent = true;

  const notasViejas = "NOTA_VIEJA ".repeat(700); // más de 2000 tokens
  const memoria = caps.fallbackNotes(notasViejas, [{ role: "tool", content: "ERROR_NUEVO_IMPORTANTE: el test sigue fallando." }], "");
  check("memoria: el error nuevo no desaparece con notas viejas llenas", memoria.includes("ERROR_NUEVO_IMPORTANTE"), JSON.stringify(memoria.slice(-200)));
  check("memoria: sigue dentro del tope", estimateTokens(memoria) <= MEMORY_CAP_TOKENS, String(estimateTokens(memoria)));
  check("memoria: conserva parte de las notas viejas", memoria.includes("NOTA_VIEJA"));
  check("memoria: marca el fallo como hecho reciente", /R: ERROR_NUEVO_IMPORTANTE/.test(memoria));

  // Un fallo reciente seguido de muchos turnos normales tampoco se pierde.
  const turnos = [{ role: "tool", content: "VERIFICACION_FALLIDA: unittest no pasa" }];
  for (let i = 0; i < 20; i += 1) turnos.push({ role: "assistant", content: `paso ${i}: ${"texto normal ".repeat(20)}` });
  const memoria2 = caps.fallbackNotes(notasViejas, turnos, "");
  check("memoria: el fallo se conserva aunque lleguen muchos turnos normales", memoria2.includes("VERIFICACION_FALLIDA"));
  check("memoria: lo más reciente también aparece", memoria2.includes("paso 19"));
  check("memoria: segundo caso dentro del tope", estimateTokens(memoria2) <= MEMORY_CAP_TOKENS, String(estimateTokens(memoria2)));

  // Sin notas viejas se guarda lo nuevo tal cual.
  const memoria3 = caps.fallbackNotes("", [{ role: "assistant", content: "Escribí a.txt y el test pasó." }], "");
  check("memoria: sin notas viejas se guarda el turno", memoria3.includes("Escribí a.txt"), JSON.stringify(memoria3));

  // La ruta de resumen que devuelve notas vacías también conserva lo nuevo.
  const memoria4 = caps.fallbackNotes(notasViejas, [], "borrador en curso con una decisión");
  check("memoria: el borrador en curso se conserva", memoria4.includes("Ya dicho:") && estimateTokens(memoria4) <= MEMORY_CAP_TOKENS);
}

// =====================================================================================
// 6. Hallazgo 16: faseSalto, reserva adaptativa y presupuestoContexto()
// =====================================================================================
{
  const chat = new BonsaiChat({
    host: "127.0.0.1",
    port: 1,
    historyCap: 32768,
    sessionPath: path.join(TMP, "presupuesto.json"),
    timingsPath: null,
  });
  chat.silent = true;
  chat.actOnPc = true;
  chat.toolChoice = "auto";

  const fases = ["lectura", "plan", "escritura", "final", "charla"];
  const ventanas = [8192, 16384, 24576, 32768];
  /** @type {Record<string, number[]>} */
  const capsPorFase = {};
  /** @type {Record<string, Array<Record<string, number>>>} */
  const presPorFase = {};
  for (const fase of fases) {
    capsPorFase[fase] = [];
    presPorFase[fase] = [];
    chat.faseSalto = /** @type {any} */ (fase);
    for (const nCtx of ventanas) {
      chat.nCtx = nCtx;
      const cap = chat.historyCap();
      const presupuesto = chat.presupuestoContexto();
      capsPorFase[fase].push(cap);
      presPorFase[fase].push(presupuesto);
      check(`presupuesto ${fase}: claves exactas`, Object.keys(presupuesto).join(",") === "ventana,solicitado,auto,efectivo,reservaSalida", Object.keys(presupuesto).join(","));
      check(`presupuesto ${fase}: ventana y solicitado`, presupuesto.ventana === nCtx && presupuesto.solicitado === 32768 && presupuesto.auto === false, JSON.stringify(presupuesto));
      check(`presupuesto ${fase}: efectivo = historyCap()`, presupuesto.efectivo === cap, `${presupuesto.efectivo} vs ${cap}`);
      check(`presupuesto ${fase}: salida y margen caben en la ventana`, presupuesto.reservaSalida >= 0 && presupuesto.reservaSalida === chat.reservaSalida() && cap + presupuesto.reservaSalida + 128 <= nCtx, JSON.stringify(presupuesto));
    }
  }
  for (const fase of fases) {
    const caps = capsPorFase[fase];
    check(`historial ${fase}: monótono con la ventana`, caps.every((cap, i) => i === 0 || cap >= caps[i - 1]), JSON.stringify(caps));
    check(`historial ${fase}: no negativo`, caps.every((cap) => cap >= 0), JSON.stringify(caps));
  }
  // Con 16K las fases cortas tienen que rendir MUCHO más historial que los 8064 de antes.
  chat.nCtx = 16384;
  chat.faseSalto = "lectura";
  const lectura16K = chat.historyCap();
  chat.faseSalto = "plan";
  const plan16K = chat.historyCap();
  chat.faseSalto = "escritura";
  const escritura16K = chat.historyCap();
  check("16K lectura: más historial que los 8064 anteriores", lectura16K > 8064, String(lectura16K));
  check("16K plan: más historial que los 8064 anteriores", plan16K > 8064, String(plan16K));
  check("16K: lectura/plan reservan menos salida que escritura", lectura16K > escritura16K && plan16K > escritura16K, JSON.stringify({ lectura16K, plan16K, escritura16K }));
  check("16K escritura: conserva el comportamiento anterior (8064)", escritura16K === 8064, String(escritura16K));
  // Sin fase conocida se conserva la reserva de siempre.
  chat.faseSalto = undefined;
  check("sin fase: reserva conservadora anterior (8064 a 16K)", chat.historyCap() === 8064, String(chat.historyCap()));
  // El tope pedido por el usuario sigue mandando.
  chat.configuredCap = 4096;
  chat.faseSalto = "lectura";
  chat.nCtx = 32768;
  const presupuestoLimitado = chat.presupuestoContexto();
  check("configuredCap: el tope solicitado se respeta", presupuestoLimitado.solicitado === 4096 && presupuestoLimitado.efectivo === 4096 && chat.historyCap() === 4096, JSON.stringify(presupuestoLimitado));
  // Ventana aún desconocida: no rompe y la reserva nominal nunca baja de MIN_ROOM.
  chat.configuredCap = 32768;
  chat.nCtx = 0;
  chat.faseSalto = "lectura";
  const presupuestoSinVentana = chat.presupuestoContexto();
  check("sin ventana: presupuesto válido", presupuestoSinVentana.ventana === 0 && presupuestoSinVentana.efectivo === 32768 && presupuestoSinVentana.reservaSalida >= MIN_ROOM, JSON.stringify(presupuestoSinVentana));
  check("reserva de salida: nunca menos de MIN_ROOM", chat.reservaSalida() >= MIN_ROOM, String(chat.reservaSalida()));
  // Con herramientas y sin fase, la reserva es la de siempre (media ventana como mucho).
  chat.nCtx = 16384;
  check("reserva: acotada a media ventana", chat.reservaSalida() <= Math.floor(16384 / 2), String(chat.reservaSalida()));
  chat.nCtx = 8192;
  chat.faseSalto = "escritura";
  check("reserva escritura: no pasa de media ventana", chat.reservaSalida() <= 4096, String(chat.reservaSalida()));
  check("reserva escritura: mantiene AGENT_SLICE como techo de la fase", AGENT_SLICE_TOKENS >= chat.reservaSalida());
}

// =====================================================================================
// Limpieza y resultado
// =====================================================================================
{
  const sessionPath = path.join(TMP, "reinicio-con-plan.json");
  const plan = { pasos: ["Compilar", "Verificar"], hechos: [1], ts: 123 };
  const lastStop = { motivo: "step_limit", saltos: 192, completo: false, ts: 456 };
  fs.writeFileSync(sessionPath, JSON.stringify({ memory: "", folded: 0, turns: [{ role: "user", content: "Continúa el trabajo pendiente" }], draft: "", files: [], plan, lastStop }));
  const chat = new BonsaiChat({ host: "127.0.0.1", port: 1, historyCap: 32768, sessionPath, timingsPath: null });
  chat.loadSession();
  chat.saveSession();
  chat.loadSession();
  check("reinicio: el plan y sus pasos hechos sobreviven a cargar/guardar", JSON.stringify(chat.session.plan) === JSON.stringify(plan));
  check("reinicio: conserva el motivo real de parada", JSON.stringify(chat.session.lastStop) === JSON.stringify(lastStop));
}
try {
  fs.rmSync(TMP, { recursive: true, force: true });
} catch {
  /* limpieza best-effort */
}

if (failures.length) {
  process.stderr.write(`prueba contexto: ${failures.length} fallo(s)\n${failures.map((fallo) => `  - ${fallo}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("prueba contexto ok\n");
}
