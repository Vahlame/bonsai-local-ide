#!/usr/bin/env node
/**
 * Banco de pruebas para modelos MoE con reparto VRAM/RAM/SSD.
 *
 * Arranca llama-server con distintas políticas de offload y mide:
 *   - tiempo de arranque y VRAM pico;
 *   - RAM residente del proceso (working set);
 *   - velocidad de prompt y de generación (tok/s) con /completion;
 *   - primer token tras un prompt largo (coste de traer expertos del SSD).
 *
 * Uso:
 *   node scripts/moe-bench.mjs --model qwen36-35b-a3b
 *   node scripts/moe-bench.mjs --model qwen3-30b-a3b-2507 --runs 2
 *   node scripts/moe-bench.mjs --model gpt-oss-20b --variant baseline,cpu
 *
 * Escribe reports/moe-bench-<fecha>/{results.json,summary.md}.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { MODELO } from "../chat/modelo.mjs";
import { planParaModelo, leerRegistro, fusionarCatalogo } from "../chat/model-hub.mjs";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const BIN = path.join(PROJECT, "bin", "llama-server.exe");
const args = process.argv.slice(2);
const arg = (n, d = "") => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const bandera = (n) => args.includes(`--${n}`);
const MODELO_CLAVE = arg("model", "");
const PUERTO = Number(arg("port", "8098"));
const REPETICIONES = Math.max(1, Math.min(3, Number(arg("runs", "1"))));
const VARIANTES_PEDIDAS = arg("variant", "").split(",").map((s) => s.trim()).filter(Boolean);
const TIMEOUT = Number(arg("timeout", "300000")) || 300000;
const FRIO = bandera("cold");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fusionarCatalogo();
const item = MODELO.catalogo?.[MODELO_CLAVE];
if (!item) {
  process.stderr.write(`Modelo desconocido: ${MODELO_CLAVE || "(falta --model)"}\n`);
  process.exit(2);
}
const registro = leerRegistro().modelos?.[MODELO_CLAVE];
const perfil = registro?.servidor || item.servidor;
if (!perfil?.moe) {
  process.stderr.write(`${MODELO_CLAVE} no tiene perfil MoE; usa model-lab para modelos densos.\n`);
  process.exit(2);
}

const plantilla = path.join(PROJECT, "logs", `chat_template_moe_${PUERTO}.jinja`);
if (item.chat_template) {
  fs.mkdirSync(path.dirname(plantilla), { recursive: true });
  fs.writeFileSync(plantilla, item.chat_template, "utf8");
}

/** @param {any} plan @param {{nCpuMoe?: number, cpuMoe?: boolean, threads?: number, threadsBatch?: number, loadMode?: string, batch?: number, ubatch?: number, ctx?: number, kv?: string, prio?: number, poll?: number, cpuMask?: string, noRepack?: boolean, specType?: string, draft?: string, draftN?: number}} o */
function argumentos(plan, o = {}) {
  const e = item;
  const kv = o.kv || plan.kv;
  const a = [
    "-m", path.join(PROJECT, "models", e.archivo),
    "--gpu-layers", "99", "--flash-attn", "on",
    "-c", String(o.ctx || plan.contexto), "-ctk", kv, "-ctv", kv,
    "-b", String(o.batch || e.servidor?.batch || 512),
    "-ub", String(o.ubatch || e.servidor?.ubatch || 256),
    "-t", String(o.threads || 8),
    "--host", "127.0.0.1", "--port", String(PUERTO),
    "--jinja", "--metrics", "-lv", "3", "--no-context-shift", "--ctx-checkpoints", "0",
    "--cache-ram", "0", "--reasoning-budget", "0",
    "--temp", "0.2", "--top-p", "0.9", "--top-k", "20", "--min-p", "0.05",
    "--presence-penalty", "0", "--repeat-penalty", "1",
    "--cors-origins", `http://127.0.0.1:${PUERTO},http://localhost:${PUERTO}`,
  ];
  if (o.threadsBatch) a.push("-tb", String(o.threadsBatch));
  if (o.prio !== undefined) a.push("--prio", String(o.prio));
  if (o.poll !== undefined) a.push("--poll", String(o.poll));
  if (o.cpuMask) a.push("--cpu-mask", String(o.cpuMask));
  if (o.noRepack) a.push("--no-repack");
  const spec = o.specType || "none";
  a.push("--spec-type", spec);
  if (o.draft) {
    const draftPath = path.join(PROJECT, "models", o.draft);
    if (fs.existsSync(draftPath)) {
      a.push("--spec-draft-model", draftPath, "--spec-draft-n-max", String(o.draftN || 4));
      if (o.specDraftKv) a.push("--spec-draft-type-k", o.specDraftKv, "--spec-draft-type-v", o.specDraftKv);
      if (o.specDraftNgl !== undefined) a.push("--spec-draft-ngl", String(o.specDraftNgl));
    }
  }
  a.push("--load-mode", o.loadMode || perfil.moe?.loadMode || "mmap");
  if (item.chat_template) a.push("--chat-template-file", plantilla);
  if (o.cpuMoe) a.push("--cpu-moe");
  else if (typeof o.nCpuMoe === "number") {
    if (o.nCpuMoe >= perfil.moe.capas) a.push("--cpu-moe");
    else if (o.nCpuMoe > 0) a.push("--n-cpu-moe", String(o.nCpuMoe));
  }
  return a;
}

async function vramUsada() {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], { timeout: 10000 });
    return Number(String(stdout).trim()) || 0;
  } catch {
    return null;
  }
}

async function purgarCache() {
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(HERE, "win-cache.ps1"), "-PurgeStandby"], { timeout: 30000 });
  } catch { /* sin privilegios: se mide igual */ }
}

async function optimizarProceso(pid) {
  try {
    await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(HERE, "win-optimize-process.ps1"), "-Pid", String(pid)], { timeout: 30000 });
  } catch { /* opcional */ }
}

async function precargar() {
  const { stdout } = await execFileAsync(process.execPath, [path.join(HERE, "precargar-gguf.mjs"), "--model", MODELO_CLAVE], { timeout: 900000, maxBuffer: 8 * 1024 * 1024 });
  const r = JSON.parse(String(stdout));
  return Math.round(Number(r.segundos) * 1000);
}

async function ramProceso(pid) {
  try {
    const { stdout } = await execFileAsync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { timeout: 10000 });
    const m = /"([^"]+)","([^"]+)","([^"]+)","([^"]+)","([\d.,]+) K"/.exec(String(stdout));
    return m ? Math.round(Number(m[5].replace(/[.,]/g, "")) / 1024) : null;
  } catch {
    return null;
  }
}

let picoVram = 0;
let picoRam = 0;
let sampler = null;
function empezarMuestreo(pid) {
  picoVram = 0;
  picoRam = 0;
  sampler = setInterval(async () => {
    const v = await vramUsada();
    if (v !== null) picoVram = Math.max(picoVram, v);
    if (pid) {
      const r = await ramProceso(pid);
      if (r !== null) picoRam = Math.max(picoRam, r);
    }
  }, 900);
}
function pararMuestreo() {
  if (sampler) clearInterval(sampler);
  sampler = null;
}

async function pedir(ruta, cuerpo, timeout = 180000) {
  const r = await fetch(`http://127.0.0.1:${PUERTO}${ruta}`, {
    method: cuerpo ? "POST" : "GET",
    headers: cuerpo ? { "Content-Type": "application/json" } : undefined,
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (!r.ok) throw new Error(`${ruta}: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

async function arrancar(plan, o) {
  const logBase = path.join(PROJECT, "logs", `moe-bench-${MODELO_CLAVE}-${PUERTO}`);
  fs.mkdirSync(path.dirname(logBase), { recursive: true });
  const out = fs.openSync(`${logBase}.out.log`, "w");
  const err = fs.openSync(`${logBase}.err.log`, "w");
  const inicio = Date.now();
  const hijo = spawn(BIN, argumentos(plan, o), { cwd: PROJECT, stdio: ["ignore", out, err], windowsHide: true });
  empezarMuestreo(hijo.pid);
  void optimizarProceso(hijo.pid);
  let salio = false;
  hijo.on("exit", () => { salio = true; });
  const deadline = Date.now() + TIMEOUT;
  while (Date.now() < deadline) {
    if (salio) {
      const cola = fs.readFileSync(`${logBase}.err.log`, "utf8").split(/\r?\n/).filter(Boolean).slice(-14).join("\n");
      pararMuestreo();
      throw new Error(`llama-server terminó al arrancar:\n${cola}`);
    }
    try {
      const r = await fetch(`http://127.0.0.1:${PUERTO}/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) {
        const props = await pedir("/props", null, 5000);
        const nCtx = Number(props?.default_generation_settings?.n_ctx || props?.n_ctx || 0);
        await sleep(600);
        return { hijo, nCtx, arranqueMs: Date.now() - inicio, logBase };
      }
    } catch { /* cargando */ }
    await sleep(500);
  }
  try { hijo.kill("SIGKILL"); } catch { /* ya */ }
  pararMuestreo();
  throw new Error(`timeout de arranque (${Math.round(TIMEOUT / 1000)} s)`);
}

function parar(hijo) {
  return new Promise((resolve) => {
    if (!hijo) return resolve();
    const t = setTimeout(() => { try { hijo.kill("SIGKILL"); } catch { /* ya */ } resolve(); }, 6000);
    hijo.once("exit", () => { clearTimeout(t); resolve(); });
    try { execFile("taskkill", ["/pid", String(hijo.pid), "/T", "/F"], () => {}); } catch { /* ya */ }
  });
}

const PROMPT_CORTO = "Escribe una función de JavaScript que reciba una lista de números y devuelva la suma de los pares. Responde solo con el código.";const PROMPT_LARGO = Array.from({ length: 220 }, (_, i) =>
  `Línea ${i + 1}: el sistema guarda el estado del editor, valida el archivo y registra el resultado en el historial.`).join("\n");

async function medir(plan, o) {
  if (FRIO) await purgarCache();
  let precargaMs = 0;
  if (o.precargar) precargaMs = await precargar();
  const srv = await arrancar(plan, o);
  try {
    // Calentamiento: primer token y primeras páginas de expertos.
    await pedir("/completion", { prompt: "Hola", n_predict: 8, temperature: 0.2, cache_prompt: false, stream: false }, 120000);
    const gen = await pedir("/completion", {
      prompt: PROMPT_CORTO, n_predict: 128, temperature: 0.2, cache_prompt: false, stream: false, ignore_eos: true,
    }, 240000);
    const chatInicio = Date.now();
    const chat = await pedir("/v1/chat/completions", {
      messages: [
        { role: "system", content: "Eres un asistente técnico preciso. Responde en español y no añadas texto extra." },
        { role: "user", content: PROMPT_CORTO },
      ],
      max_tokens: 128, temperature: 0.2, stream: false,
    }, 240000);
    const chatMs = Date.now() - chatInicio;
    const tc = chat.timings || {};
    const chatTokens = Number(tc.predicted_n || chat.usage?.completion_tokens || 0);
    const chatTps = Number(tc.predicted_per_second) || (chatTokens > 0 ? chatTokens / (chatMs / 1000) : 0);
    const largo = await pedir("/completion", {
      prompt: PROMPT_LARGO, n_predict: 1, temperature: 0.2, cache_prompt: false, stream: false,
    }, 300000);
    const t = gen.timings || {};
    const tl = largo.timings || {};
    return {
      ok: true,
      precargaMs,
      arranqueMs: srv.arranqueMs,
      ctx: srv.nCtx,
      vramPicoMiB: picoVram,
      ramPicoMiB: picoRam,
      generacion: {
        tokens: t.predicted_n,
        tokPorSegundo: redondear(t.predicted_per_second),
        ms: Math.round(t.predicted_ms || 0),
        ttftMs: Math.round((t.prompt_ms || 0) + (t.predicted_ms || 0) / Math.max(1, t.predicted_n || 1)),
      },
      chat: {
        plantilla: Boolean(item.chat_template),
        tokens: chatTokens,
        tokPorSegundo: redondear(chatTps),
        ms: Math.round(chatMs),
        promptTokens: Number(tc.prompt_n || chat.usage?.prompt_tokens || 0),
      },
      promptLargo: {
        tokens: tl.prompt_n,
        tokPorSegundo: redondear(tl.prompt_per_second),
        ms: Math.round(tl.prompt_ms || 0),
      },
      muestra: String(gen.content || "").slice(0, 160).replace(/\s+/g, " "),
    };
  } finally {
    pararMuestreo();
    await parar(srv.hijo);
    await sleep(1200);
  }
}

const redondear = (n) => Number.isFinite(Number(n)) ? Math.round(Number(n) * 10) / 10 : 0;

function variantes(plan) {
  const n = Number(plan.moe?.nCpuMoe ?? perfil.moe.nCpuMoe ?? 0);
  const capas = Number(plan.moe?.capas || perfil.moe.capas || 0);
  const hilosPlan = Number(perfil.threads) || 12;
  const batchPlan = Number(perfil.batch) || 1024;
  const ubatchPlan = Number(perfil.ubatch) || 512;
  const ajuste = [
    { id: "ngram-simple", nombre: "especulación ngram-simple", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 512, specType: "ngram-simple" } },
    { id: "ngram-map-k", nombre: "especulación ngram-map-k", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 512, specType: "ngram-map-k" } },
    { id: "ngram-mod", nombre: "especulación ngram-mod", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 512, specType: "ngram-mod" } },
    { id: "draft-qwen3", nombre: "draft Qwen3 0.6B (n=4)", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 512, specType: "draft-simple", draft: "Qwen3-0.6B-Q8_0.gguf", draftN: 4 } },
    { id: "draft-qwen3-8", nombre: "draft Qwen3 0.6B (n=8)", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 512, specType: "draft-simple", draft: "Qwen3-0.6B-Q8_0.gguf", draftN: 8 } },
    { id: "draft-qwen3-16k", nombre: "draft Qwen3 0.6B, 16k y KV q4", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 512, ctx: 16384, specType: "draft-simple", draft: "Qwen3-0.6B-Q8_0.gguf", draftN: 4, specDraftKv: "q4_0" } },
    { id: "draft-qwen3-cpu", nombre: "draft Qwen3 0.6B en CPU", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 512, specType: "draft-simple", draft: "Qwen3-0.6B-Q8_0.gguf", draftN: 4, specDraftNgl: 0 } },
    { id: "draft-qwen25", nombre: "draft Qwen2.5 0.5B (n=4)", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 512, specType: "draft-simple", draft: "qwen2.5-0.5b-instruct-q4_k_m.gguf", draftN: 4 } },
    { id: "prio2", nombre: "prioridad de proceso alta", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 512, prio: 2 } },
    { id: "poll0", nombre: "sin polling de CPU", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 512, poll: 0 } },
    { id: "tb16", nombre: "12 hilos + 16 en prompt", o: { nCpuMoe: n, threads: 12, threadsBatch: 16, batch: 1024, ubatch: 512 } },
    { id: "norepack", nombre: "sin repack de pesos", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 512, noRepack: true } },
    { id: "kvq4", nombre: "KV q4_0", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 512, kv: "q4_0" } },
    { id: "ctx16k", nombre: "contexto 16k", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 512, ctx: 16384 } },
    { id: "batch2048", nombre: "batch 2048/1024", o: { nCpuMoe: n, threads: 12, batch: 2048, ubatch: 1024 } },
    { id: "ub256", nombre: "batch 1024 / ubatch 256", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 256 } },
    { id: "mask12", nombre: "afinidad a 12 CPU lógicas", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 512, cpuMask: "0xFFF" } },
  ];
  const lista = [
    { id: "baseline", nombre: "plan automático", o: { nCpuMoe: n, threads: hilosPlan, batch: batchPlan, ubatch: ubatchPlan } },
    { id: "cpu", nombre: "todos los expertos en CPU", o: { cpuMoe: true, threads: 8, loadMode: "mmap" } },
    { id: "gpu-mas", nombre: "8 capas más de expertos en GPU", o: { nCpuMoe: Math.max(0, n - 8), threads: 8 } },
    { id: "gpu-menos", nombre: "8 capas menos de expertos en GPU", o: { nCpuMoe: Math.min(capas, n + 8), threads: 8 } },
    { id: "hilos12", nombre: "plan automático, 12 hilos", o: { nCpuMoe: n, threads: 12 } },
    { id: "hilos16", nombre: "plan automático, 16 hilos", o: { nCpuMoe: n, threads: 16 } },
    { id: "hilos20", nombre: "plan automático, 20 hilos", o: { nCpuMoe: n, threads: 20 } },
    { id: "cpu16", nombre: "todos los expertos en CPU, 16 hilos", o: { cpuMoe: true, threads: 16, loadMode: "mmap" } },
    { id: "gpu-menos16", nombre: "8 capas menos en GPU, 16 hilos", o: { nCpuMoe: Math.min(capas, n + 8), threads: 16 } },
    { id: "gpu-3", nombre: "3 capas más de expertos en GPU", o: { nCpuMoe: Math.max(0, n - 3), threads: 12, batch: 1024, ubatch: 512 } },
    { id: "gpu-4", nombre: "4 capas más de expertos en GPU", o: { nCpuMoe: Math.max(0, n - 4), threads: 12, batch: 1024, ubatch: 512 } },
    { id: "gpu-5", nombre: "5 capas más de expertos en GPU", o: { nCpuMoe: Math.max(0, n - 5), threads: 12, batch: 1024, ubatch: 512 } },
    { id: "gpu-6", nombre: "6 capas más de expertos en GPU", o: { nCpuMoe: Math.max(0, n - 6), threads: 12, batch: 1024, ubatch: 512 } },
    { id: "gpu-3-kvq4", nombre: "3 capas más + KV q4", o: { nCpuMoe: Math.max(0, n - 3), threads: 12, batch: 1024, ubatch: 512, kv: "q4_0" } },
    { id: "gpu-3-16k", nombre: "3 capas más + contexto 16k", o: { nCpuMoe: Math.max(0, n - 3), threads: 12, batch: 1024, ubatch: 512, ctx: 16384 } },
    { id: "batch1024", nombre: "plan automático, batch 1024/512", o: { nCpuMoe: n, threads: 8, batch: 1024, ubatch: 512 } },
    { id: "batch16", nombre: "16 hilos, batch 1024/512", o: { nCpuMoe: n, threads: 16, batch: 1024, ubatch: 512 } },
    { id: "batch12", nombre: "12 hilos, batch 1024/512", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 512 } },
    { id: "mmap", nombre: "mmap (page cache)", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 512, loadMode: "mmap" } },
    { id: "none", nombre: "sin mmap (carga a RAM)", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 512, loadMode: "none" } },
    { id: "precarga", nombre: "mmap + precarga de expertos CPU", o: { nCpuMoe: n, threads: 12, batch: 1024, ubatch: 512, loadMode: "mmap", precargar: true } },
    { id: "precarga16", nombre: "mmap + precarga + 16 hilos", o: { nCpuMoe: n, threads: 16, batch: 1024, ubatch: 512, loadMode: "mmap", precargar: true } },
    ...ajuste.filter((v) => VARIANTES_PEDIDAS.includes(v.id)),
  ].filter((v) => v.o.nCpuMoe === undefined || v.o.cpuMoe || v.o.nCpuMoe < capas);
  let salida = lista;
  if (!FRIO) salida = salida.filter((v) => v.id !== "precarga" && v.id !== "precarga16");
  if (VARIANTES_PEDIDAS.length) salida = salida.filter((v) => VARIANTES_PEDIDAS.includes(v.id));
  return salida;
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = path.join(PROJECT, "reports", `moe-bench-${stamp}`);
fs.mkdirSync(dir, { recursive: true });
const filas = [];
for (const rep of Array.from({ length: REPETICIONES }, (_, i) => i + 1)) {
  for (const v of variantes(await planParaModelo(MODELO_CLAVE))) {
    process.stderr.write(`\n=== ${MODELO_CLAVE} · ${v.id} · pasada ${rep} ===\n`);
    const plan = await planParaModelo(MODELO_CLAVE);
    if (!plan.plan.moe) { process.stderr.write("sin plan MoE\n"); continue; }
    const o = { ...v.o };
    if (o.nCpuMoe === undefined && !o.cpuMoe) o.nCpuMoe = plan.plan.moe.nCpuMoe;
    let r;
    try {
      r = await medir(plan.plan, o);
      process.stderr.write(`  ${r.generacion.tokPorSegundo} tok/s · ${r.promptLargo.tokPorSegundo} tok/s prompt · ${r.vramPicoMiB} MiB VRAM · ${r.ramPicoMiB} MiB RAM\n`);
    } catch (error) {
      r = { ok: false, error: error instanceof Error ? error.message : String(error) };
      process.stderr.write(`  FALLO: ${r.error.split("\n")[0]}\n`);
    }
    filas.push({
      modelo: MODELO_CLAVE,
      nombre: item.nombre,
      pasada: rep,
      variante: v.id,
      descripcion: v.nombre,
      nCpuMoe: o.cpuMoe ? "cpu-moe" : o.nCpuMoe,
      capas: plan.plan.moe.capas,
      threads: o.threads,
      batch: o.batch || 512,
      ubatch: o.ubatch || 256,
      loadMode: o.loadMode || plan.plan.moe?.loadMode || "mmap",
      ...r,
    });
  }
}

fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(filas, null, 2), "utf8");
const ok = filas.filter((f) => f.ok);
const md = [
  `# MoE en 8 GB VRAM + 16 GB RAM · ${MODELO_CLAVE}`,
  "",
  `Equipo: ${os.cpus()[0]?.model || "CPU"} · ${(os.totalmem() / 1073741824).toFixed(1)} GiB RAM · RTX 4060 Laptop.`,
  "",
  "| Variante | Reparto | Hilos | Carga | Arranque | VRAM pico | RAM pico | Generación | Chat | Prompt largo |",
  "|---|---|---:|---|---:|---:|---:|---:|---:|---:|",
  ...ok.map((f) => `| ${f.variante} | ${f.nCpuMoe === "cpu-moe" ? "todo CPU" : `${f.capas - f.nCpuMoe}/${f.capas} GPU`} | ${f.threads} | ${f.loadMode}${f.precargaMs ? ` +${(f.precargaMs / 1000).toFixed(1)} s precarga` : ""} | ${(f.arranqueMs / 1000).toFixed(1)} s | ${f.vramPicoMiB} MiB | ${f.ramPicoMiB} MiB | ${f.generacion.tokPorSegundo} tok/s | ${f.chat?.tokPorSegundo ?? "—"} tok/s${f.chat?.plantilla ? "" : " (sin plantilla)"} | ${f.promptLargo.tokPorSegundo} tok/s (${f.promptLargo.tokens} tok) |`),
  "",
  "## Fallos",
  "",
  ...filas.filter((f) => !f.ok).map((f) => `- **${f.variante}** (${f.descripcion}): ${f.error.split("\n").slice(0, 4).join(" ")}`),
  "",
  "## Notas",
  "",
  "- La primera pasada de cada modelo lee el GGUF del SSD; las siguientes reutilizan la page cache de Windows.",
  "- `RAM pico` es el working set del proceso: incluye pesos mapeados y KV en host, no la page cache compartida.",
  "- `prompt largo` mide el procesado de ~4k tokens: es donde más se nota el coste de traer expertos del SSD.",
  "",
].join("\n");
fs.writeFileSync(path.join(dir, "summary.md"), md, "utf8");
process.stdout.write(`${JSON.stringify({ dir, filas }, null, 2)}\n`);
