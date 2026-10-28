#!/usr/bin/env node
/**
 * Evalúa la app Bonsai de punta a punta con el modelo real.
 * Lanza la interfaz (una copia aislada del código y con su propio estado), le manda cada tarea por
 * su API como lo haría el navegador y comprueba el resultado con validadores propios.
 * Mide aciertos, tiempo, saltos del agente, velocidad del modelo y uso de la GPU.
 *
 *   node chat/evaluar/ejecutar.mjs                         # todas las tareas
 *   node chat/evaluar/ejecutar.mjs --tareas hola-py,sqlite # solo esas
 *   node chat/evaluar/ejecutar.mjs --salida C:\ruta        # dónde dejar carpetas de trabajo e informe
 * Necesita llama-server abierto (scripts\start-server.ps1).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TAREAS } from "./tareas.mjs";
import { copiarApp } from "./copia-app.mjs";
import { leerSSE } from "../sse.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CHAT = path.dirname(AQUI);

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const out = { tareas: /** @type {string[]} */ ([]), salida: "", uiPort: 8791, llamaPort: 8080, enVivo: false, maxMin: 0, pensar: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--tareas") out.tareas = String(argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--salida") out.salida = argv[++i] || "";
    else if (arg === "--ui-port") out.uiPort = Number(argv[++i]);
    else if (arg === "--llama-port") out.llamaPort = Number(argv[++i]);
    else if (arg === "--max-min") out.maxMin = Number(argv[++i]);
    else if (arg === "--en-vivo") out.enVivo = true;
    else if (arg === "--pensar") out.pensar = Number(argv[++i]);
    else throw new Error(`Argumento desconocido: ${arg}`);
  }
  return out;
}

const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Muestrea la GPU una vez por segundo mientras dura una tarea. */
function vigilarGpu() {
  /** @type {Array<{util: number, mem: number, w: number, t: number, mhz: number}>} */
  const muestras = [];
  const tomar = () => execFile("nvidia-smi", ["--query-gpu=utilization.gpu,memory.used,power.draw,temperature.gpu,clocks.sm", "--format=csv,noheader,nounits"], { timeout: 4000 }, (err, stdout) => {
    if (err) return;
    const p = String(stdout).trim().split(",").map((s) => Number(s.trim()));
    if (p.length >= 5 && p.every((n) => Number.isFinite(n))) muestras.push({ util: p[0], mem: p[1], w: p[2], t: p[3], mhz: p[4] });
  });
  const timer = setInterval(tomar, 1000);
  return {
    parar() {
      clearInterval(timer);
      const n = muestras.length || 1;
      const prom = (key) => muestras.reduce((s, m) => s + m[key], 0) / n;
      return {
        muestras: muestras.length,
        utilMedia: Math.round(prom("util")),
        utilMaxima: Math.max(0, ...muestras.map((m) => m.util)),
        pctAlto: Math.round((muestras.filter((m) => m.util >= 85).length / n) * 100),
        pctOcioso: Math.round((muestras.filter((m) => m.util < 30).length / n) * 100),
        vatios: Math.round(prom("w")),
        tempMax: Math.max(0, ...muestras.map((m) => m.t)),
        mhz: Math.round(prom("mhz")),
        vramMax: Math.max(0, ...muestras.map((m) => m.mem)),
      };
    },
  };
}

/**
 * Manda un mensaje al chat de la interfaz y recoge los eventos hasta que termina.
 * @param {string} base
 * @param {string} text
 * @param {number} timeoutMs
 */
async function preguntar(base, text, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  /** @type {Array<Record<string, any>>} */
  const events = [];
  let timedOut = false;
  let httpError = "";
  try {
    for (let intento = 0; intento < 20; intento += 1) {
      const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: ac.signal });
      if (res.status === 409) {
        await dormir(1000);
        continue;
      }
      if (!res.ok || !res.body) {
        httpError = `HTTP ${res.status}: ${await res.text()}`;
        break;
      }
      // Un único lector SSE (chat/sse.mjs) en vez del split por "\n\n" de cada script.
      await leerSSE(res.body, {
        señal: ac.signal,
        exigirFin: false,
        jsonInvalido: "ignorar",
        guardarEventos: false,
        alEvento: (evento) => events.push(/** @type {Record<string, any>} */ (evento)),
      });
      break;
    }
  } catch (err) {
    if (ac.signal.aborted) timedOut = true;
    else httpError = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }
  return { events, timedOut, httpError };
}

/**
 * Convierte los eventos en métricas y en el resultado que ven los validadores.
 * @param {Array<Record<string, any>>} events
 */
function resumir(events) {
  let saltos = 0;
  let predichos = 0;
  let leidos = 0;
  let cache = 0;
  /** @type {string[]} */
  const errores = [];
  /** @type {number[]} */
  const ritmos = [];
  // La interfaz repite cada acción con estados "run" -> "done": vale el último estado de cada id
  /** @type {Map<string, {kind: string, title: string, state: string, detail: string, code?: number}>} */
  const ultimas = new Map();
  for (const ev of events) {
    if (ev.type === "action") ultimas.set(ev.id, { kind: ev.kind, title: ev.title, state: ev.state, detail: ev.detail || "", code: ev.code });
    else if (ev.type === "start") saltos += 1;
    else if (ev.type === "speed") {
      predichos += ev.predicted_n || 0;
      leidos += ev.prompt_n || 0;
      cache += ev.cache_n || 0;
      if (ev.predicted_ps) ritmos.push(ev.predicted_ps);
    } else if (ev.type === "error") errores.push(String(ev.text || ev.message || "error"));
  }
  // "replace" lleva el texto limpio de cada mensaje del asistente; el último con contenido es la respuesta final
  const reemplazos = events.filter((e) => e.type === "replace").map((e) => String(e.text || ""));
  const texto = reemplazos.filter((t) => t.trim()).slice(-1)[0] || events.filter((e) => e.type === "token").map((e) => e.text).join("");
  return {
    acciones: [...ultimas.values()],
    texto: texto.trim(),
    saltos,
    predichos,
    leidos,
    cache,
    tokPorSeg: ritmos.length ? Math.round((ritmos.reduce((a, b) => a + b, 0) / ritmos.length) * 10) / 10 : 0,
    errores,
  };
}

/**
 * Etiquetas de fallo a partir de lo que pasó, no del veredicto: sirven para agrupar problemas.
 * @param {ReturnType<typeof resumir>} r
 * @param {{ok: boolean}} veredicto
 * @param {boolean} timedOut
 * @param {string} httpError
 */
function etiquetar(r, veredicto, timedOut, httpError) {
  const tags = [];
  if (timedOut) tags.push("tiempo-agotado");
  if (httpError) tags.push("error-http");
  if (r.errores.length) tags.push("error-servidor");
  if (r.saltos >= 20) tags.push("muchos-saltos");
  const cmds = r.acciones.filter((a) => a.kind === "cmd");
  const repetidos = cmds.length - new Set(cmds.map((a) => a.title.toLowerCase().replace(/\s+/g, " "))).size;
  if (repetidos >= 2) tags.push("comandos-repetidos");
  if (r.acciones.some((a) => a.state === "denied")) tags.push("accion-denegada");
  const ultimoCmd = cmds[cmds.length - 1];
  if (ultimoCmd && ultimoCmd.code !== undefined && ultimoCmd.code !== 0) tags.push("ultimo-comando-fallo");
  if (!r.acciones.length && !veredicto.ok) tags.push("no-uso-herramientas");
  if (!r.texto && !veredicto.ok) tags.push("sin-respuesta-final");
  if (!veredicto.ok && !tags.length) tags.push("resultado-incorrecto");
  return tags;
}

async function esperarUi(base) {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${base}/api/stats`);
      if (res.ok) return;
    } catch {
      /* todavía arranca */
    }
    await dormir(500);
  }
  throw new Error(`La interfaz no respondió en ${base}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const lista = args.tareas.length ? TAREAS.filter((t) => args.tareas.includes(t.id)) : TAREAS;
  if (!lista.length) throw new Error("No hay tareas con esos ids");
  const marca = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const salida = args.salida ? path.resolve(args.salida) : path.join(os.tmpdir(), `bonsai-eval-${marca}`);
  fs.mkdirSync(salida, { recursive: true });
  const appDir = args.enVivo ? CHAT : path.join(salida, "app");
  if (!args.enVivo) copiarApp(CHAT, appDir);

  // El servidor de modelo tiene que estar arriba
  try {
    const h = await fetch(`http://127.0.0.1:${args.llamaPort}/health`);
    if (!h.ok) throw new Error(String(h.status));
  } catch {
    throw new Error(`No hay llama-server en el puerto ${args.llamaPort}. Arranca scripts\\start-server.ps1 primero.`);
  }

  const estado = path.join(salida, "estado");
  fs.mkdirSync(estado, { recursive: true });
  // Por defecto SIN razonamiento (estado nuevo = ajustes por defecto), para comparar con las
  // corridas anteriores; con --pensar N se mide con él (si el modelo cargado lo admite).
  if (Number.isInteger(args.pensar) && args.pensar > 0) {
    fs.writeFileSync(path.join(estado, "ui-settings.json"), JSON.stringify({ pensar: args.pensar }), "utf8");
  }
  const base = `http://127.0.0.1:${args.uiPort}`;
  const logUi = fs.openSync(path.join(salida, "ui.log"), "w");
  const ui = spawn(process.execPath, [path.join(appDir, "ui-server.mjs"), "--port", String(args.uiPort), "--llama-port", String(args.llamaPort), "--prompt-cap", "8192"], {
    env: { ...process.env, BONSAI_STATE: estado, BONSAI_SALIDA: path.join(salida, "salida"), BONSAI_OCR_SCRIPT: path.join(CHAT, "..", "scripts", "ocr-winrt.ps1"), BONSAI_PLAYWRIGHT_MODULE: path.join(CHAT, "node_modules", "playwright-core", "index.mjs") },
    stdio: ["ignore", logUi, logUi],
  });
  const cerrar = () => { try { ui.kill(); } catch { /* ya cerrada */ } };
  process.on("exit", cerrar);
  process.on("SIGINT", () => { cerrar(); process.exit(130); });
  await esperarUi(base);
  await fetch(`${base}/api/permit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "all" }) });

  process.stdout.write(`Evaluando ${lista.length} tareas · carpeta ${salida}\n`);
  /** @type {Array<Record<string, any>>} */
  const informe = [];
  const inicio = Date.now();
  for (const tarea of lista) {
    const dir = path.join(salida, "ws", tarea.id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    tarea.setup?.(dir);
    await fetch(`${base}/api/workspace`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: dir }) });
    await fetch(`${base}/api/reset`, { method: "POST" });
    const gpu = vigilarGpu();
    const t0 = Date.now();
    const limite = (args.maxMin || tarea.maxMin || 8) * 60_000;
    const { events, timedOut, httpError } = await preguntar(base, tarea.prompt, limite);
    const segundos = Math.round((Date.now() - t0) / 100) / 10;
    const g = gpu.parar();
    const r = resumir(events);
    let veredicto;
    try {
      veredicto = tarea.check(dir, { texto: r.texto, acciones: r.acciones });
    } catch (err) {
      veredicto = { ok: false, notas: [`el validador falló: ${err instanceof Error ? err.message : err}`] };
    }
    const fallos = veredicto.ok ? [] : etiquetar(r, veredicto, timedOut, httpError);
    const fila = { id: tarea.id, titulo: tarea.titulo, nivel: tarea.nivel, ok: veredicto.ok, segundos, saltos: r.saltos, acciones: r.acciones.length, predichos: r.predichos, leidos: r.leidos, cache: r.cache, tokPorSeg: r.tokPorSeg, gpu: g, fallos, notas: veredicto.notas, httpError, errores: r.errores, textoFinal: r.texto.slice(0, 600), pasos: r.acciones.map((a) => `${a.kind}:${a.state}${a.code !== undefined ? `(${a.code})` : ""} ${a.title.slice(0, 90)}`) };
    informe.push(fila);
    fs.writeFileSync(path.join(salida, `tarea-${tarea.id}.json`), JSON.stringify({ ...fila, eventos: events.filter((e) => e.type !== "token").slice(0, 400), texto: r.texto, acciones: r.acciones }, null, 1));
    process.stdout.write(`${veredicto.ok ? "OK   " : "FALLO"} ${tarea.id.padEnd(18)} ${String(segundos).padStart(6)} s · ${String(r.saltos).padStart(2)} saltos · ${String(r.acciones.length).padStart(2)} acc · ${String(r.tokPorSeg).padStart(5)} t/s · GPU ${String(g.utilMedia).padStart(3)} % (≥85 %: ${g.pctAlto} %)${fallos.length ? ` · ${fallos.join(",")}` : ""}\n`);
    if (!veredicto.ok) process.stdout.write(`      ${veredicto.notas.join(" | ")}\n`);
  }
  cerrar();

  const ok = informe.filter((f) => f.ok).length;
  const total = Math.round((Date.now() - inicio) / 1000);
  const suma = (key) => informe.reduce((s, f) => s + (f[key] || 0), 0);
  const md = [
    `# Evaluación de Bonsai · ${marca}`,
    "",
    `**${ok}/${informe.length} tareas correctas** en ${Math.round(total / 60)} min ${total % 60} s · ${suma("predichos")} tokens generados · ${suma("leidos")} leídos + ${suma("cache")} de caché · razonamiento ${args.pensar > 0 ? `${args.pensar} tokens (si el modelo lo admite)` : "apagado"}.`,
    "",
    "| tarea | nivel | resultado | s | saltos | acc. | t/s | GPU media | GPU ≥85 % | fallos |",
    "|---|---|---|---:|---:|---:|---:|---:|---:|---|",
    ...informe.map((f) => `| ${f.id} | ${f.nivel} | ${f.ok ? "✅" : "❌"} | ${f.segundos} | ${f.saltos} | ${f.acciones} | ${f.tokPorSeg} | ${f.gpu.utilMedia} % | ${f.gpu.pctAlto} % | ${f.fallos.join(", ")} |`),
    "",
    "## Detalle de los fallos",
    ...informe.filter((f) => !f.ok).map((f) => `### ${f.id}\n- ${f.notas.join("\n- ")}\n- pasos: ${f.pasos.join(" → ") || "(ninguno)"}\n- respuesta final: ${f.textoFinal.replace(/\n/g, " ").slice(0, 300)}`),
  ].join("\n");
  fs.writeFileSync(path.join(salida, "informe.md"), md);
  fs.writeFileSync(path.join(salida, "informe.json"), JSON.stringify(informe, null, 1));
  process.stdout.write(`\n${ok}/${informe.length} correctas · informe en ${path.join(salida, "informe.md")}\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : err}\n`);
  process.exitCode = 1;
});
