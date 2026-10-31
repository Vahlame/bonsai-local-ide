#!/usr/bin/env node
/**
 * Laboratorio de modelos: arranca cada GGUF con SU plan (contexto, KV, visión)
 * y mide lo que de verdad importa antes de confiar en él:
 *
 *   · arranque, VRAM pico y ventana real de llama-server;
 *   · respuesta corta, JSON, código ejecutado, tool-calling y retrieval a ~8k;
 *   · velocidad (TTFT y tokens/s) con el muestreo recomendado del modelo.
 *
 * Uso:
 *   node scripts/model-lab.mjs list
 *   node scripts/model-lab.mjs plan --model qwen3-4b-2507
 *   node scripts/model-lab.mjs probe --model qwen3-4b-2507
 *   node scripts/model-lab.mjs probe --all
 *   node scripts/model-lab.mjs probe --all --skip-long --port 8097
 *
 * Escribe reports/model-lab-<fecha>/<clave>.json y un summary.md. Actualiza
 * models/hub-catalog.json con el resumen de pruebas de cada modelo.
 *
 * No usa el puerto 8080: cada prueba levanta su propio llama-server en --port
 * (8097 por defecto) y lo apaga al terminar. La GPU debe estar libre.
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawn, execFileSync, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MODELO } from "../chat/modelo.mjs";
import { planParaModelo, leerRegistro, guardarRegistro, listarInstalados, vramInfo } from "../chat/model-hub.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const MIB = 1024 * 1024;
const args = process.argv.slice(2);
const arg = (nombre, def = "") => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const bandera = (nombre) => args.includes(`--${nombre}`);
const comando = args[0] || "list";
const PORT = Math.max(1024, Number(arg("port", "8097")) || 8097);
const SKIP_LONG = bandera("skip-long");
const TIMEOUT_ARRANQUE = Number(arg("timeout", "240000")) || 240000;
const SOLO_JSON = bandera("json");

const binCands = [
  path.join(PROJECT, ".local", "opt", "bonsai-inference", "build-RTX4060-Opt-sm89", "bin", "llama-server.exe"),
  path.join(process.env.USERPROFILE || "", ".local", "opt", "bonsai-inference", "build-RTX4060-Opt-sm89", "bin", "llama-server.exe"),
];
let BIN = path.join(PROJECT, "bin", "llama-server.exe");
for (const c of binCands) if (fs.existsSync(c)) { BIN = c; break; }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mib = (n) => Math.round((Number(n) || 0) / MIB);

function salida(valor) {
  if (SOLO_JSON || (valor && typeof valor === "object")) process.stdout.write(`${JSON.stringify(valor, null, 2)}\n`);
  else process.stdout.write(`${valor}\n`);
}

function claveDeEntrada() {
  const modelo = String(arg("model", "")).trim();
  if (!modelo) throw new Error("falta --model <clave>");
  const entrada = MODELO.catalogo?.[modelo];
  if (!entrada) throw new Error(`modelo desconocido en el catálogo: ${modelo}`);
  if (!entrada.archivo) throw new Error(`modelo sin archivo: ${modelo}`);
  if (!fs.existsSync(path.join(PROJECT, "models", entrada.archivo))) throw new Error(`falta el GGUF: models/${entrada.archivo}`);
  return { clave: modelo, entrada };
}

async function vramUsada() {
  return new Promise((resolve) => {
    execFile("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      const n = Number.parseInt(String(stdout || "").trim(), 10);
      resolve(Number.isFinite(n) ? n : null);
    });
  });
}

async function esperarGpuLibre(umbral = 7000) {
  let estables = 0;
  for (let i = 0; i < 60; i += 1) {
    const libre = (await vramInfo(true)).libreMiB;
    if (libre >= umbral) estables += 1;
    else estables = 0;
    // Dos medidas seguidas: evita arrancar mientras el servidor anterior aún
    // está soltando el contexto CUDA.
    if (estables >= 2) return true;
    await sleep(700);
  }
  return false;
}

/**
 * Argumentos EXACTOS del lanzador optimizado, con el plan del modelo.
 * @param {{clave: string, entrada: any}} item
 * @param {any} plan
 */
function argumentosServidor(item, plan) {
  const e = item.entrada;
  const plantilla = path.join(PROJECT, "logs", `chat_template_lab_${PORT}.jinja`);
  const a = ["-m", path.join(PROJECT, "models", e.archivo), "--gpu-layers", "99", "--flash-attn", "on",
    "-c", String(plan.contexto), "-ctk", plan.kv, "-ctv", plan.kv,
    "-b", String(e.servidor?.batch || 512), "-ub", String(e.servidor?.ubatch || 256), "-t", String(e.servidor?.threads || 4),
    "--host", "127.0.0.1", "--port", String(PORT), "--jinja", "--metrics", "-lv", "3",
    "--cors-origins", `http://127.0.0.1:${PORT},http://localhost:${PORT}`,
    "--spec-type", "none", "--no-context-shift", "--ctx-checkpoints", "0"];
  const muestreo = e.muestreo?.codigo || {};
  a.push("--temp", String(muestreo.temperature ?? 0.6));
  a.push("--top-p", String(muestreo.top_p ?? 0.9));
  a.push("--top-k", String(muestreo.top_k ?? 20));
  a.push("--min-p", String(muestreo.min_p ?? 0.05));
  a.push("--presence-penalty", String(muestreo.presence_penalty ?? 0));
  a.push("--repeat-penalty", String(muestreo.repeat_penalty ?? 1));
  if (e.chat_template) {
    fs.mkdirSync(path.dirname(plantilla), { recursive: true });
    fs.writeFileSync(plantilla, e.chat_template, "utf8");
    a.push("--chat-template-file", plantilla);
  }
  if (plan.vision && e.vision?.archivo && fs.existsSync(path.join(PROJECT, "models", e.vision.archivo))) {
    a.push("--mmproj", path.join(PROJECT, "models", e.vision.archivo));
    if (plan.mmprojCPU) a.push("--no-mmproj-offload");
    else a.push("--mmproj-offload", "--mmproj-device", "CUDA0");
    a.push("--image-max-tokens", "512");
  }
  const draft = e.servidor?.draftModel || e.draft?.archivo;
  if (draft && fs.existsSync(path.join(PROJECT, "models", draft))) {
    a.push("--spec-type", "draft-simple", "--spec-draft-model", path.join(PROJECT, "models", draft), "--spec-draft-n-max", String(e.servidor?.draftTokens || e.draft?.tokens || 4));
  }
  // Para medir la respuesta directa, sin gastar el presupuesto en thinking.
  a.push("--reasoning-budget", "0");
  return a;
}

async function iniciar(item) {
  const planCalculado = await planParaModelo(item.clave, { vision: true });
  const plan = planCalculado.plan;
  if (!plan.ok) throw new Error(`el plan no cabe: ${plan.motivo}`);
  await esperarGpuLibre(Math.max(3500, plan.totalMiB + 200));
  const logBase = path.join(PROJECT, "logs", `model-lab-${item.clave}-${PORT}`);
  fs.mkdirSync(path.dirname(logBase), { recursive: true });
  const out = fs.openSync(`${logBase}.out.log`, "w");
  const err = fs.openSync(`${logBase}.err.log`, "w");
  const a = argumentosServidor(item, plan);
  const inicio = Date.now();
  const hijo = spawn(BIN, a, { cwd: PROJECT, stdio: ["ignore", out, err], windowsHide: true });
  let salida = false;
  hijo.on("exit", () => { salida = true; });
  let pico = 0;
  let nCtx = 0;
  const deadline = Date.now() + TIMEOUT_ARRANQUE;
  while (Date.now() < deadline) {
    if (salida) {
      const cola = leerCola(`${logBase}.err.log`);
      throw new Error(`llama-server terminó al arrancar: ${cola}`);
    }
    const usado = await vramUsada();
    if (usado !== null) pico = Math.max(pico, usado);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        const props = await (await fetch(`http://127.0.0.1:${PORT}/props`, { signal: AbortSignal.timeout(3000) })).json();
        nCtx = Number(props?.default_generation_settings?.n_ctx || props?.n_ctx || 0);
        // Unos ms más para que la VRAM se estabilice.
        await sleep(700);
        const usadoFin = await vramUsada();
        if (usadoFin !== null) pico = Math.max(pico, usadoFin);
        return { hijo, plan, nCtx, vramPicoMiB: pico, arranqueMs: Date.now() - inicio, logBase };
      }
    } catch { /* aún cargando */ }
    await sleep(700);
  }
  try { hijo.kill("SIGKILL"); } catch { /* ya */ }
  throw new Error(`timeout de arranque (${Math.round(TIMEOUT_ARRANQUE / 1000)} s); revisa ${logBase}.err.log`);
}

function leerCola(archivo, lineas = 12) {
  try {
    return fs.readFileSync(archivo, "utf8").split(/\r?\n/).filter(Boolean).slice(-lineas).join("\n");
  } catch {
    return "(sin log)";
  }
}

async function detener(hijo) {
  if (!hijo) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(hijo.pid), "/T", "/F"], { stdio: "ignore" });
    else hijo.kill("SIGKILL");
  } catch { /* ya terminó */ }
  for (let i = 0; i < 20; i += 1) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(500) });
    } catch {
      return;
    }
    await sleep(400);
  }
}

/**
 * Chat con streaming: devuelve texto, razonamiento, tool_calls y métricas.
 * @param {Array<{role: string, content: any}>} messages
 * @param {{tools?: any[], maxTokens?: number, temperature?: number}} [opciones]
 */
async function chat(messages, opciones = {}) {
  const cuerpo = {
    model: "local",
    messages,
    stream: true,
    max_tokens: opciones.maxTokens || 512,
    temperature: opciones.temperature ?? 0.2,
    top_p: 0.9,
    top_k: 20,
    min_p: 0,
  };
  if (opciones.tools) { cuerpo.tools = opciones.tools; cuerpo.tool_choice = "auto"; }
  const inicio = Date.now();
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(240000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  let texto = "";
  let razonamiento = "";
  /** @type {Map<number, any>} */
  const tools = new Map();
  let ttft = 0;
  let tokens = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const partes = buffer.split("\n\n");
    buffer = partes.pop() || "";
    for (const bloque of partes) {
      for (const linea of bloque.split("\n")) {
        if (!linea.startsWith("data:")) continue;
        const dato = linea.slice(5).trim();
        if (!dato || dato === "[DONE]") continue;
        let ev;
        try { ev = JSON.parse(dato); } catch { continue; }
        const delta = ev.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          if (!ttft) ttft = Date.now() - inicio;
          texto += delta.content;
          tokens += 1;
        }
        if (delta.reasoning_content) {
          if (!ttft) ttft = Date.now() - inicio;
          razonamiento += delta.reasoning_content;
          tokens += 1;
        }
        if (Array.isArray(delta.tool_calls)) {
          if (!ttft) ttft = Date.now() - inicio;
          for (const tc of delta.tool_calls) {
            const idx = Number(tc.index || 0);
            const prev = tools.get(idx) || { id: "", type: "function", function: { name: "", arguments: "" } };
            if (tc.id) prev.id = tc.id;
            if (tc.function?.name) prev.function.name = tc.function.name;
            if (tc.function?.arguments) prev.function.arguments += tc.function.arguments;
            tools.set(idx, prev);
          }
        }
      }
    }
  }
  const ms = Date.now() - inicio;
  return {
    texto,
    razonamiento,
    toolCalls: [...tools.values()],
    ttftMs: ttft,
    ms,
    tokens,
    tps: ms > 0 ? (tokens / (ms / 1000)) : 0,
  };
}

function extraerJSON(texto) {
  const s = String(texto || "");
  const inicio = s.indexOf("{");
  const fin = s.lastIndexOf("}");
  if (inicio < 0 || fin <= inicio) return null;
  try { return JSON.parse(s.slice(inicio, fin + 1)); } catch { return null; }
}

function extraerCodigo(texto) {
  const m = String(texto || "").match(/```(?:js|javascript)?\s*\n([\s\S]*?)```/i);
  return (m ? m[1] : String(texto || "")).trim();
}

function ejecutarJS(codigo) {
  try {
    const contexto = { resultado: null };
    vm.createContext(contexto);
    vm.runInContext(`${codigo}\nresultado = sumaPares([1,2,3,4,6]);`, contexto, { timeout: 2000 });
    return contexto.resultado === 12;
  } catch {
    return false;
  }
}

/** Prompt de ~8k tokens con una aguja en el centro. */
function promptLargo() {
  const relleno = "La arquitectura de software local prioriza la latencia y la privacidad. ";
  const bloque = relleno.repeat(400);
  const aguja = "\n\nDATO SECRETO: la clave de despliegue es CLAVE-7391.\n\n";
  return `${bloque.slice(0, 16000)}${aguja}${bloque.slice(16000)}${relleno.repeat(40)}\n\nPregunta: ¿cuál es la clave de despliegue? Responde solo la clave, sin explicar.`;
}

/**
 * @param {{clave: string, entrada: any}} item
 */
async function probar(item) {
  const srv = await iniciar(item);
  const pruebas = [];
  /**
   * @param {string} id
   * @param {() => Promise<{ok: boolean, detalle: string, metrica?: any}>} fn
   */
  const añadir = async (id, fn) => {
    const t0 = Date.now();
    try {
      const r = await fn();
      pruebas.push({ id, ok: r.ok, detalle: r.detalle, ms: Date.now() - t0, ...(r.metrica || {}) });
    } catch (error) {
      pruebas.push({ id, ok: false, detalle: error instanceof Error ? error.message : String(error), ms: Date.now() - t0 });
    }
  };

  try {
    await añadir("saludo", async () => {
      const r = await chat([{ role: "user", content: "Responde exactamente BONSAI_OK y nada más." }], { maxTokens: 48 });
      return { ok: /BONSAI_OK/i.test(r.texto), detalle: r.texto.slice(0, 120), metrica: { ttftMs: r.ttftMs, tps: Number(r.tps.toFixed(2)) } };
    });
    await añadir("json", async () => {
      const r = await chat([
        { role: "system", content: "Devuelve únicamente un objeto JSON válido, sin markdown." },
        { role: "user", content: 'Devuelve {"ok":true,"n":7} exactamente.' },
      ], { maxTokens: 120, temperature: 0 });
      const j = extraerJSON(r.texto);
      return { ok: Boolean(j && j.ok === true && j.n === 7), detalle: r.texto.slice(0, 160), metrica: { ttftMs: r.ttftMs, tps: Number(r.tps.toFixed(2)) } };
    });
    await añadir("codigo", async () => {
      const r = await chat([
        { role: "user", content: "Escribe SOLO un bloque ```js con una función llamada sumaPares(nums) que devuelva la suma de los números pares del array. Sin ejemplos ni explicación." },
      ], { maxTokens: 220, temperature: 0 });
      const codigo = extraerCodigo(r.texto);
      const ok = /function\s+sumaPares|const\s+sumaPares|let\s+sumaPares/.test(codigo) && ejecutarJS(codigo);
      return { ok, detalle: codigo.slice(0, 240), metrica: { ttftMs: r.ttftMs, tps: Number(r.tps.toFixed(2)) } };
    });
    await añadir("herramienta", async () => {
      const tools = [{
        type: "function",
        function: {
          name: "sumar",
          description: "Suma dos números enteros.",
          parameters: { type: "object", properties: { a: { type: "integer" }, b: { type: "integer" } }, required: ["a", "b"] },
        },
      }];
      const r = await chat([{ role: "user", content: "Usa la herramienta sumar para calcular 17+25. No respondas de memoria: llama a la función." }], { tools, maxTokens: 180, temperature: 0 });
      const llamada = r.toolCalls.find((t) => /sumar/i.test(t.function?.name || ""));
      let args = null;
      let formato = "nativo";
      try { args = llamada ? JSON.parse(llamada.function.arguments) : null; } catch { args = null; }
      if (!llamada) {
        // Algunos modelos (Qwen2.5 Coder) escriben la llamada en texto:
        //   <function-call>{"name":"sumar","arguments":{"a":17,"b":25}}</function-call>
        const m = String(r.texto || "").match(/<(function-call|xml|tools)>([\s\S]*?)<\/\1>/i);
        if (m) {
          try {
            const j = JSON.parse(m[2].trim());
            if (j && /sumar/i.test(j.name || "")) {
              args = j.arguments && typeof j.arguments === "object" ? j.arguments : JSON.parse(j.arguments || "{}");
              formato = m[1] === "xml" ? "xml-json" : m[1] === "tools" ? "tools-json" : "function-call";
            }
          } catch { /* texto no JSON */ }
        }
      }
      const ok = Boolean(args && Number(args.a) === 17 && Number(args.b) === 25);
      return { ok, detalle: llamada ? `${formato}: ${llamada.function.name}(${llamada.function.arguments})` : formato === "function-call" ? `${formato}: sumar(${JSON.stringify(args)})` : r.texto.slice(0, 160), metrica: { ttftMs: r.ttftMs, tps: Number(r.tps.toFixed(2)) } };
    });
    if (!SKIP_LONG) {
      await añadir("contexto8k", async () => {
        const r = await chat([{ role: "user", content: promptLargo() }], { maxTokens: 80, temperature: 0 });
        return { ok: /CLAVE-7391/i.test(r.texto), detalle: r.texto.slice(0, 160), metrica: { ttftMs: r.ttftMs, tps: Number(r.tps.toFixed(2)) } };
      });
    }
    if (srv.plan.vision && item.entrada.vision?.archivo) {
      await añadir("vision", async () => {
        const capturas = path.join(PROJECT, "capturas");
        const archivos = fs.existsSync(capturas) ? fs.readdirSync(capturas).filter((n) => /\.(png|jpg|jpeg)$/i.test(n)) : [];
        if (!archivos.length) return { ok: false, detalle: "no hay capturas/ para probar visión" };
        const archivoImagen = archivos[0];
        const datos = fs.readFileSync(path.join(capturas, archivoImagen));
        const b64 = datos.toString("base64");
        const mime = /\.jpe?g$/i.test(archivoImagen) ? "image/jpeg" : "image/png";
        const r = await chat([{
          role: "user",
          content: [
            { type: "text", text: "Describe en una frase qué se ve en la imagen. Si hay texto legible, menciona una palabra." },
            { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } },
          ],
        }], { maxTokens: 120, temperature: 0 });
        return { ok: r.texto.trim().length > 8, detalle: r.texto.slice(0, 200), metrica: { ttftMs: r.ttftMs, tps: Number(r.tps.toFixed(2)) } };
      });
    }
  } finally {
    await detener(srv.hijo);
  }
  const pasadas = pruebas.filter((p) => p.ok).length;
  const resumen = {
    clave: item.clave,
    nombre: item.entrada.nombre,
    archivo: item.entrada.archivo,
    fecha: new Date().toISOString(),
    plan: srv.plan,
    arranqueMs: srv.arranqueMs,
    nCtx: srv.nCtx,
    vramPicoMiB: srv.vramPicoMiB,
    pruebas,
    resumen: `${pasadas}/${pruebas.length} pruebas`,
    medido: true,
  };
  return resumen;
}

function actualizarRegistro(resumen) {
  const registro = leerRegistro();
  const entrada = registro.modelos[resumen.clave];
  if (!entrada) return;
  entrada.pruebas = {
    ...(entrada.pruebas || {}),
    fecha: resumen.fecha,
    resumen: resumen.resumen,
    arranqueMs: resumen.arranqueMs,
    nCtx: resumen.nCtx,
    vramPicoMiB: resumen.vramPicoMiB,
    detalle: resumen.pruebas.map((p) => `${p.id}: ${p.ok ? "OK" : "FALLO"}`),
  };
  entrada.plan = {
    ...(entrada.plan || {}),
    contexto: resumen.plan.contexto,
    kv: resumen.plan.kv,
    vision: resumen.plan.vision,
    mmprojCPU: resumen.plan.mmprojCPU,
    totalMiB: resumen.plan.totalMiB,
    medido: true,
    calculado: resumen.fecha,
  };
  // Un plan medido que arrancó se guarda como techo seguro para el próximo arranque.
  if (entrada.servidor) {
    entrada.servidor.contexto = Math.max(Number(entrada.servidor.contexto) || 0, resumen.plan.contexto);
    entrada.servidor.reservaMiB = resumen.plan.reservaMiB;
    // El umbral de "GPU libre" no puede superar la VRAM total: si no, el cambio
    // de modelo se queda esperando una memoria que nunca va a existir.
    entrada.servidor.margenObjetivoMiB = Math.min(7600, Math.max(3000, resumen.plan.totalMiB + 100));
  }
  guardarRegistro(registro);
}

async function listar() {
  const instalados = candidatosInstalados();
  if (SOLO_JSON) return salida(instalados);
  const filas = [];
  for (const m of instalados) {
    const plan = m.plan ? `${m.plan.contexto} tok ${m.plan.kv}` : "sin plan";
    filas.push(`${m.clave.padEnd(30)} ${String(m.nombre).slice(0, 28).padEnd(30)} ${plan.padEnd(20)} ${m.pruebas?.resumen || "sin probar"}`);
  }
  process.stdout.write(`${filas.join("\n")}\n`);
}

/** Instalados del Hub + modelos curados cuyo GGUF ya está en disco. */
function candidatosInstalados() {
  const out = listarInstalados();
  const vistos = new Set(out.map((m) => m.archivo));
  for (const [clave, e] of Object.entries(MODELO.catalogo || {})) {
    if (!e || typeof e.archivo !== "string" || vistos.has(e.archivo) || e.oculto) continue;
    if (e.servidor?.tipo !== "gpu-completa") continue;
    let bytes = 0;
    try { bytes = fs.statSync(path.join(PROJECT, "models", e.archivo)).size; } catch { bytes = 0; }
    if (!bytes || (Number(e.bytes) > 0 && bytes !== Number(e.bytes))) continue;
    out.push({
      clave,
      nombre: e.nombre || clave,
      archivo: e.archivo,
      bytes,
      esperado: Number(e.bytes) || 0,
      existe: true,
      rol: e.rol || "",
      uso: e.uso || "",
      origen: e.origen || "",
      licencia: e.licencia || "",
      vision: Boolean(e.vision?.archivo),
      plan: e.plan || null,
      servidor: e.servidor || null,
      pruebas: e.pruebas || null,
      fuente: e.fuente || "curado",
      oculto: e.oculto === true,
    });
    vistos.add(e.archivo);
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

async function principal() {
  if (comando === "list") {
    await listar();
    return;
  }
  if (comando === "plan") {
    const item = claveDeEntrada();
    const r = await planParaModelo(item.clave, { vision: true });
    salida(r);
    return;
  }
  if (comando === "probe") {
    const modelos = [];
    if (bandera("all")) {
      for (const m of candidatosInstalados()) {
        if (!m.existe || m.oculto) continue;
        const e = MODELO.catalogo?.[m.clave];
        if (e && e.servidor?.tipo === "gpu-completa") modelos.push({ clave: m.clave, entrada: e });
      }
    } else {
      modelos.push(claveDeEntrada());
    }
    if (!modelos.length) throw new Error("no hay modelos instalados que probar");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dir = path.join(PROJECT, "reports", `model-lab-${stamp}`);
    fs.mkdirSync(dir, { recursive: true });
    const todos = [];
    for (const item of modelos) {
      process.stderr.write(`\n=== ${item.clave} (${item.entrada.nombre}) ===\n`);
      try {
        const r = await probar(item);
        todos.push(r);
        fs.writeFileSync(path.join(dir, `${item.clave}.json`), JSON.stringify(r, null, 2), "utf8");
        actualizarRegistro(r);
        process.stderr.write(`${r.resumen} · ${r.plan.contexto} tok ${r.plan.kv} · ${r.vramPicoMiB} MiB · ${r.arranqueMs} ms\n`);
        for (const p of r.pruebas) process.stderr.write(`  ${p.ok ? "OK  " : "FALLO"} ${p.id}: ${p.detalle.slice(0, 90)}\n`);
      } catch (error) {
        const r = { clave: item.clave, nombre: item.entrada.nombre, fecha: new Date().toISOString(), error: error instanceof Error ? error.message : String(error), pruebas: [], resumen: "no arrancó" };
        todos.push(r);
        fs.writeFileSync(path.join(dir, `${item.clave}.json`), JSON.stringify(r, null, 2), "utf8");
        process.stderr.write(`FALLO ${item.clave}: ${r.error}\n`);
      }
    }
    const md = [
      `# Model Lab · ${stamp}`,
      "",
      "| Modelo | Plan | Arranque | VRAM pico | Pruebas |",
      "|---|---|---:|---:|---|",
      ...todos.map((r) => `| ${r.clave} | ${r.error ? "no arrancó" : `${r.plan.contexto} tok · ${r.plan.kv}${r.plan.vision ? (r.plan.mmprojCPU ? " · visión CPU" : " · visión GPU") : ""}`} | ${r.arranqueMs ? `${(r.arranqueMs / 1000).toFixed(1)} s` : "-"} | ${r.vramPicoMiB || "-"} MiB | ${r.resumen} |`),
      "",
      ...todos.map((r) => `## ${r.clave}\n\n${r.error ? `Error: ${r.error}` : r.pruebas.map((p) => `- **${p.id}**: ${p.ok ? "OK" : "FALLO"} — ${p.detalle}`).join("\n")}\n`),
    ].join("\n");
    fs.writeFileSync(path.join(dir, "summary.md"), md, "utf8");
    salida({ dir, resultados: todos });
    return;
  }
  throw new Error(`comando desconocido: ${comando}. Usa list, plan o probe.`);
}

principal().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
