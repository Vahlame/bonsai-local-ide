#!/usr/bin/env node
/**
 * Benchmark de coding REAL para proyectos complicados.
 *
 * Dos tareas con tests OCULTOS (el modelo no los escribe):
 *   1. `project`: implementar desde cero un proyecto Node ESM multifichero
 *      (PriorityQueue + Scheduler con concurrencia, prioridad y reintentos).
 *   2. `bugfix`: corregir un carrito con dos bugs sobre código existente.
 *
 * Cada respuesta se escribe en un directorio temporal, se copian los tests
 * ocultos y se ejecuta `node --test`. El score es tests que pasan, no "parece
 * correcto".
 *
 * También mide el pipeline: `--pipeline plan` (planificar antes de codificar) y
 * `--repair N` (enseñar al modelo la salida de los tests y pedir corrección).
 *
 * Uso:
 *   node scripts/bench-coding.mjs --models qwen3-30b-a3b-2507,qwen36-35b-a3b
 *   node scripts/bench-coding.mjs --models ornith9b --pipeline plan --repair 1
 *   node scripts/bench-coding.mjs --models qwen3-30b-a3b-2507 --task bugfix
 */
import fs from "node:fs";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { MODELO } from "../chat/modelo.mjs";
import { fusionarCatalogo, planParaModelo, leerRegistro, guardarRegistro } from "../chat/model-hub.mjs";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const args = process.argv.slice(2);
const arg = (n, d = "") => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const flag = (n) => args.includes(`--${n}`);
const PORT = Number(arg("port", "8096"));
const REPS = Math.max(1, Math.min(3, Number(arg("reps", "1")) || 1));
const PIPELINE = arg("pipeline", "single");
const REPAIR = Math.max(0, Math.min(2, Number(arg("repair", "0")) || 0));
const TASKS = arg("task", "project,bugfix").split(",").map((s) => s.trim()).filter(Boolean);
const MODELOS = (arg("models", "") || "ornith9b,qwen25-coder-7b,qwen3-30b-a3b-2507,qwen36-35b-a3b,gpt-oss-20b,qwen35-9b,qwen3-4b-2507")
  .split(",").map((s) => s.trim()).filter(Boolean);
const BIN = path.join(PROJECT, "bin", "llama-server.exe");
const FIXTURES = path.join(HERE, "fixtures", "coding");
const TIMEOUT_MS = Number(arg("timeout", "900000")) || 900000;
const MAX_PROJECT = Number(arg("max-project", "12000")) || 12000;
const MAX_BUGFIX = Number(arg("max-bugfix", "8000")) || 8000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROYECTO_MINIMO = path.join(FIXTURES, "taskforge");
const BUGFIX = path.join(FIXTURES, "bugfix");

const SISTEMA = "Eres un ingeniero de software senior. Escribes código completo, correcto y ejecutable. Sigues el formato pedido al pie de la letra y no añades explicaciones fuera de los archivos.";

const PROMPT_PROYECTO = `Implementa el núcleo de un proyecto Node.js ESM llamado "taskforge". NO escribas tests: el evaluador usará una suite oculta.

Debes crear exactamente estos archivos:

1) src/priority-queue.mjs
   export class PriorityQueue
   - enqueue(item, priority): encola.
   - dequeue(): devuelve y quita el item con MENOR priority. En empate, el que llegó antes (FIFO). Si está vacía, lanza Error.
   - size: propiedad o método que devuelve cuántos elementos hay.

2) src/scheduler.mjs
   export class Scheduler
   - constructor({ concurrency }): límite de tareas simultáneas.
   - add(fn, { priority = 0, retries = 0 }): registra una tarea async. Menor priority se ejecuta antes.
   - async run(): ejecuta todas las tareas respetando prioridad y concurrencia. Si fn lanza, reintenta hasta "retries" veces; si sigue fallando, el resultado es { ok:false, error }. Devuelve un array en ORDEN DE FINALIZACIÓN con { id, ok, value?, error?, attempts }. Cada tarea recibe un id único (puede ser numérico).
   - Nunca debe haber más de "concurrency" tareas ejecutándose a la vez.

Requisitos:
- Código real, sin dependencias externas.
- No escribas test/ ni modifiques package.json salvo que necesites "type":"module".
- Responde SOLO con los archivos, exactamente así, sin markdown:
===FILE: src/priority-queue.mjs===
contenido
===END FILE===
===FILE: src/scheduler.mjs===
contenido
===END FILE===`;

const PROMPT_BUGFIX = (archivos, salidaTests) => `Este proyecto Node.js ESM tiene tests que fallan. Corrige el código.

Archivos actuales:

${archivos.map((f) => `===FILE: ${f.rel}===\n${f.body}===END FILE===`).join("\n\n")}

Salida de los tests que fallan:

${salidaTests.slice(-4000)}

Devuelve SOLO los archivos corregidos, con el mismo formato:
===FILE: src/discount.mjs===
contenido
===END FILE===
===FILE: src/cart.mjs===
contenido
===END FILE===`;

function copiarDir(origen, destino) {
  fs.mkdirSync(destino, { recursive: true });
  for (const e of fs.readdirSync(origen, { withFileTypes: true })) {
    const src = path.join(origen, e.name);
    const dst = path.join(destino, e.name);
    if (e.isDirectory()) copiarDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

function archivosDe(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) archivosDe(abs, base, out);
    else if (/\.(mjs|js|json)$/i.test(e.name)) out.push({ rel: path.relative(base, abs).replace(/\\/g, "/"), body: fs.readFileSync(abs, "utf8") });
  }
  return out;
}

function limpiarCuerpo(body) {
  let b = String(body || "").replace(/\r\n/g, "\n");
  // Muchos modelos envuelven el archivo en ```lenguaje ... ``` aunque se pida
  // lo contrario. Se quitan solo las cercas exteriores, no las de dentro.
  b = b.replace(/^\s*```[A-Za-z0-9_+-]*[ \t]*\n/, "");
  b = b.replace(/\n```[ \t]*\s*$/, "");
  return b.replace(/^\n/, "");
}

function parseFiles(text) {
  const out = [];
  const re = /===FILE:\s*(.+?)===\s*\r?\n([\s\S]*?)===END FILE===/g;
  let m;
  while ((m = re.exec(text))) {
    let rel = m[1].trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!rel || rel.includes("..") || rel.startsWith("/") || /^[a-zA-Z]:/.test(rel)) continue;
    // Algunos modelos devuelven solo el nombre base (`discount.mjs`) o una ruta
    // absoluta del proyecto. Se normaliza a src/ si es uno de los archivos de la
    // tarea; así no se pierde una respuesta correcta por el prefijo.
    const base = path.basename(rel);
    if (!(rel === "package.json" || rel.startsWith("src/"))) {
      if (/^(priority-queue|scheduler|discount|cart)\.mjs$/.test(base)) rel = `src/${base}`;
      else continue;
    }
    out.push({ rel, body: limpiarCuerpo(m[2]) });
    if (out.length >= 20) break;
  }
  return out;
}

function runTests(cwd, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const hijo = spawn("node", ["--test", "--test-reporter=tap"], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let terminado = false;
    const timer = setTimeout(() => {
      if (terminado) return;
      try { execFile("taskkill", ["/pid", String(hijo.pid), "/T", "/F"]); } catch { /* ya */ }
      const text = `${stdout}\n${stderr}\n# timeout ${timeoutMs} ms`;
      const okTap = (text.match(/^ok \d+/gm) || []).length;
      const failTap = (text.match(/^not ok \d+/gm) || []).length;
      const pass = Number((text.match(/^# pass (\d+)/m) || [])[1] || okTap || 0);
      const fail = Number((text.match(/^# fail (\d+)/m) || [])[1] || failTap || 0);
      const tests = Number((text.match(/^# tests (\d+)/m) || [])[1] || (pass + fail));
      terminado = true;
      resolve({ code: 124, pass, fail, tests, text, timeout: true });
    }, timeoutMs);
    hijo.stdout.on("data", (d) => { stdout += String(d); });
    hijo.stderr.on("data", (d) => { stderr += String(d); });
    hijo.on("error", (error) => {
      if (terminado) return;
      clearTimeout(timer);
      terminado = true;
      resolve({ code: 1, pass: 0, fail: 0, tests: 0, text: `error: ${error.message}` });
    });
    hijo.on("close", (code) => {
      if (terminado) return;
      clearTimeout(timer);
      terminado = true;
      const text = `${stdout}\n${stderr}`;
      const okTap = (text.match(/^ok \d+/gm) || []).length;
      const failTap = (text.match(/^not ok \d+/gm) || []).length;
      const pass = Number((text.match(/^# pass (\d+)/m) || [])[1] || okTap || 0);
      const fail = Number((text.match(/^# fail (\d+)/m) || [])[1] || failTap || 0);
      const tests = Number((text.match(/^# tests (\d+)/m) || [])[1] || (pass + fail));
      resolve({ code: code ?? 1, pass, fail, tests, text });
    });
  });
}

async function vramUsada() {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], { timeout: 10000 });
    return Number(String(stdout).trim()) || 0;
  } catch { return 0; }
}

function pensarDe(entrada) {
  if (entrada.pensar?.compatible !== true) return 0;
  return Math.max(0, Math.min(2048, Number(entrada.pensar.presupuesto) || 2048));
}

function argumentos(entrada, plan, think) {
  const modelo = path.join(PROJECT, "models", entrada.archivo);
  const a = ["-m", modelo, "--gpu-layers", "99", "--flash-attn", "on",
    "-c", String(plan.contexto), "-ctk", plan.kv, "-ctv", plan.kv,
    "-b", String(entrada.servidor?.batch || 512), "-ub", String(entrada.servidor?.ubatch || 256),
    "-t", String(entrada.servidor?.threads || 4), "--host", "127.0.0.1", "--port", String(PORT),
    "--jinja", "--metrics", "-lv", "2", "--cache-ram", "0", "--no-context-shift",
    "--ctx-checkpoints", "0", "--spec-type", "none",
    "--temp", "0.2", "--top-p", "0.9", "--top-k", "20", "--min-p", "0.05",
    "--presence-penalty", "0", "--repeat-penalty", "1"];
  if (entrada.chat_template) {
    const tpl = path.join(PROJECT, "logs", `chat_template_coding_${PORT}.jinja`);
    fs.mkdirSync(path.dirname(tpl), { recursive: true });
    fs.writeFileSync(tpl, entrada.chat_template, "utf8");
    a.push("--chat-template-file", tpl);
  }
  if (plan.moe?.activo) {
    a.push("--fit", "off", "--load-mode", plan.moe.loadMode || "mmap");
    if (plan.moe.nCpuMoe >= plan.moe.capas) a.push("--cpu-moe");
    else if (plan.moe.nCpuMoe > 0) a.push("--n-cpu-moe", String(plan.moe.nCpuMoe));
  }
  if (think > 0) a.push("--reasoning-budget", String(think), "--reasoning-format", "deepseek");
  const draft = entrada.servidor?.draftModel;
  if (draft && fs.existsSync(path.join(PROJECT, "models", draft))) {
    a.push("--spec-type", "draft-simple", "--spec-draft-model", path.join(PROJECT, "models", draft));
    a.push("--spec-draft-n-max", String(entrada.servidor?.draftTokens || 4));
  }
  return a;
}

async function arrancar(entrada, plan, think) {
  const out = fs.openSync(path.join(PROJECT, "logs", `coding-${entrada.clave}-${PORT}.out.log`), "w");
  const err = fs.openSync(path.join(PROJECT, "logs", `coding-${entrada.clave}-${PORT}.err.log`), "w");
  const i0 = Date.now();
  const hijo = spawn(BIN, argumentos(entrada, plan, think), { cwd: PROJECT, stdio: ["ignore", out, err], windowsHide: true });
  let pico = 0;
  let salio = false;
  hijo.on("exit", () => { salio = true; });
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    if (salio) {
      const cola = fs.readFileSync(path.join(PROJECT, "logs", `coding-${entrada.clave}-${PORT}.err.log`), "utf8").split(/\r?\n/).filter(Boolean).slice(-10).join("\n");
      throw new Error(`el servidor terminó al arrancar:\n${cola}`);
    }
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) {
        await sleep(500);
        pico = Math.max(pico, await vramUsada());
        return { hijo, ms: Date.now() - i0, vram: pico };
      }
    } catch { /* cargando */ }
    pico = Math.max(pico, await vramUsada());
    await sleep(800);
  }
  try { hijo.kill("SIGKILL"); } catch { /* ya */ }
  throw new Error("timeout de arranque");
}

async function parar(hijo) {
  if (!hijo) return;
  try { await execFileAsync("taskkill", ["/pid", String(hijo.pid), "/T", "/F"], { timeout: 15000 }); } catch { /* ya */ }
  await sleep(1200);
}

async function preguntar(messages, maxTokens, think) {
  const body = {
    model: "local", messages,
    temperature: 0.1, top_p: 0.9, top_k: 20, min_p: 0.05,
    presence_penalty: 0, repeat_penalty: 1, max_tokens: maxTokens,
    reasoning_budget: think,
  };
  const t0 = Date.now();
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const raw = await res.json();
  const msg = raw?.choices?.[0]?.message || {};
  return {
    content: String(msg.content || ""),
    reasoning: String(msg.reasoning_content || ""),
    ms: Date.now() - t0,
    tps: Number(raw?.timings?.predicted_per_second) || 0,
    finish: raw?.choices?.[0]?.finish_reason || "",
    usage: raw?.usage || {},
  };
}

/**
 * Si el modelo se corta por longitud, pide continuación en vez de puntuar una
 * respuesta incompleta. Es lo que hace un agente real: reintentar, no aceptar
 * un archivo a medias.
 */
async function preguntarRobusto(messages, maxTokens, think) {
  let r = await preguntar(messages, maxTokens, think);
  let ms = r.ms;
  if (r.finish === "length") {
    const cont = await preguntar([
      ...messages,
      { role: "assistant", content: r.content.slice(-12000) },
      { role: "user", content: "Tu respuesta se cortó. Continúa exactamente donde se quedó, sin repetir lo anterior, y termina todos los archivos con ===END FILE===. No añadas explicaciones." },
    ], Math.min(16000, Math.round(maxTokens * 1.5)), Math.min(1024, think));
    r = { ...cont, content: `${r.content}\n${cont.content}`, ms: ms + cont.ms, retryLength: true, finish: cont.finish };
  }
  return r;
}

function escribirArchivos(runDir, files) {
  for (const f of files) {
    const abs = path.join(runDir, f.rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.body, "utf8");
  }
}

function prepararProyecto(runDir) {
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(runDir, { recursive: true });
  copiarDir(path.join(PROYECTO_MINIMO, "test"), path.join(runDir, "test"));
  fs.copyFileSync(path.join(PROYECTO_MINIMO, "package.json"), path.join(runDir, "package.json"));
}

function prepararBugfix(runDir) {
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(runDir, { recursive: true });
  copiarDir(path.join(BUGFIX, "src"), path.join(runDir, "src"));
  copiarDir(path.join(BUGFIX, "test"), path.join(runDir, "test"));
  fs.copyFileSync(path.join(BUGFIX, "package.json"), path.join(runDir, "package.json"));
}

async function tareaProject(entrada, runDir, think) {
  prepararProyecto(runDir);
  const base = [{ role: "system", content: SISTEMA }, { role: "user", content: PROMPT_PROYECTO }];
  let plan = null;
  let planMs = 0;
  if (PIPELINE === "plan") {
    const p = await preguntar([
      { role: "system", content: SISTEMA },
      { role: "user", content: `Antes de programar, escribe un plan breve (máximo 12 líneas) para este proyecto, con archivos, estructuras de datos y algoritmo:\n\n${PROMPT_PROYECTO}` },
    ], 800, think);
    plan = p.content;
    planMs = p.ms;
    base[1] = { role: "user", content: `${PROMPT_PROYECTO}\n\nPlan aprobado:\n${plan}` };
  }
  let respuesta = await preguntarRobusto(base, MAX_PROJECT, think);
  let files = parseFiles(respuesta.content);
  escribirArchivos(runDir, files);
  let test = await runTests(runDir);
  const rondas = [];
  for (let r = 0; r < REPAIR && (test.fail > 0 || test.code !== 0); r += 1) {
    const actuales = archivosDe(path.join(runDir, "src"));
    const feedback = `El intento anterior falló. Salida de tests:\n\n${test.text.slice(-5000)}\n\nArchivos actuales:\n\n${actuales.map((f) => `===FILE: ${f.rel}===\n${f.body}===END FILE===`).join("\n\n")}\n\nDevuelve SOLO los archivos corregidos con ===FILE: ...===.`;
    const fix = await preguntar([...base, { role: "assistant", content: respuesta.content.slice(0, 12000) }, { role: "user", content: feedback }], MAX_PROJECT, think);
    const nuevos = parseFiles(fix.content);
    escribirArchivos(runDir, nuevos);
    test = await runTests(runDir);
    rondas.push({ ms: fix.ms, tps: fix.tps, files: nuevos.map((f) => f.rel), pass: test.pass, fail: test.fail });
    respuesta = { ...fix, content: `${respuesta.content}\n\n--- REPARACION ---\n${fix.content}` };
  }
  return {
    task: "project", think, plan, planMs, pipeline: PIPELINE, repair: REPAIR, expected: 9,
    files: files.map((f) => f.rel), rondas,
    ms: respuesta.ms + planMs, tps: respuesta.tps,
    genTokens: respuesta.usage?.completion_tokens || 0,
    promptTokens: respuesta.usage?.prompt_tokens || 0,
    finish: respuesta.finish,
    test, content: respuesta.content,
  };
}

async function tareaBugfix(entrada, runDir, think) {
  prepararBugfix(runDir);
  const antes = await runTests(runDir);
  const actuales = archivosDe(path.join(runDir, "src"));
  const prompt = PROMPT_BUGFIX(actuales, antes.text);
  const base = [{ role: "system", content: SISTEMA }, { role: "user", content: prompt }];
  let respuesta = await preguntarRobusto(base, MAX_BUGFIX, think);
  let files = parseFiles(respuesta.content);
  escribirArchivos(runDir, files);
  let test = await runTests(runDir);
  const rondas = [];
  for (let r = 0; r < REPAIR && (test.fail > 0 || test.code !== 0); r += 1) {
    const despues = archivosDe(path.join(runDir, "src"));
    const feedback = `El intento anterior no pasó los tests. Salida:\n\n${test.text.slice(-5000)}\n\nArchivos actuales:\n\n${despues.map((f) => `===FILE: ${f.rel}===\n${f.body}===END FILE===`).join("\n\n")}\n\nDevuelve SOLO los archivos corregidos.`;
    const fix = await preguntar([...base, { role: "assistant", content: respuesta.content.slice(0, 5000) }, { role: "user", content: feedback }], MAX_BUGFIX, think);
    const nuevos = parseFiles(fix.content);
    escribirArchivos(runDir, nuevos);
    test = await runTests(runDir);
    rondas.push({ ms: fix.ms, tps: fix.tps, files: nuevos.map((f) => f.rel), pass: test.pass, fail: test.fail });
    respuesta = { ...fix, content: `${respuesta.content}\n\n--- REPARACION ---\n${fix.content}` };
  }
  return {
    task: "bugfix", think, pipeline: "single", repair: REPAIR, expected: 5,
    antes: { pass: antes.pass, fail: antes.fail, tests: antes.tests },
    files: files.map((f) => f.rel), rondas,
    ms: respuesta.ms, tps: respuesta.tps,
    genTokens: respuesta.usage?.completion_tokens || 0,
    promptTokens: respuesta.usage?.prompt_tokens || 0,
    finish: respuesta.finish,
    test, content: respuesta.content,
  };
}

function svgBarras(rows, titulo, subtitulo) {
  const W = 1000, rowH = 48, top = 100, left = 320, chartW = 520;
  const H = top + rows.length * rowH + 60;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, system-ui, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#0d100b"/>`,
    `<text x="24" y="34" fill="#e9eee0" font-size="18" font-weight="600">${titulo}</text>`,
    `<text x="24" y="54" fill="#8d9680" font-size="12">${subtitulo}</text>`];
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const w = Math.round(chartW * Math.max(0, Math.min(100, r.score)) / 100);
    out.push(`<text x="24" y="${y + 20}" fill="#e9eee0" font-size="11">${r.name}</text>`);
    out.push(`<rect x="${left}" y="${y + 6}" width="${chartW}" height="20" rx="4" fill="#1a2014"/>`);
    out.push(`<rect x="${left}" y="${y + 6}" width="${w}" height="20" rx="4" fill="${r.score >= 99 ? "#cde86e" : r.score >= 60 ? "#e8c06a" : "#d97878"}"/>`);
    out.push(`<text x="${left + chartW + 10}" y="${y + 21}" fill="#e9eee0" font-size="12" font-weight="700">${r.score.toFixed(0)}%</text>`);
    out.push(`<text x="${left + 6}" y="${y + 21}" fill="#0d100b" font-size="10" font-weight="600">${r.pass}/${r.total} tests</text>`);
  });
  out.push("</svg>");
  return out.join("\n");
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(PROJECT, "reports", `coding-bench-${stamp}`);
fs.mkdirSync(outDir, { recursive: true });
fusionarCatalogo();

const resultados = [];
for (const clave of MODELOS) {
  const entrada = MODELO.catalogo?.[clave];
  const modelo = path.join(PROJECT, "models", entrada?.archivo || "");
  if (!entrada || !fs.existsSync(modelo)) {
    process.stderr.write(`\n### ${clave}: no instalado, se omite\n`);
    continue;
  }
  const { plan } = await planParaModelo(clave, { vision: false });
  if (!plan.ok) {
    process.stderr.write(`\n### ${clave}: plan no cabe (${plan.motivo}), se omite\n`);
    continue;
  }
  entrada.clave = clave;
  const think = pensarDe(entrada);
  process.stderr.write(`\n=== ${entrada.nombre || clave} · ctx ${plan.contexto} · ${plan.kv} · think ${think} ===\n`);
  const srv = await arrancar(entrada, plan, think);
  try {
    for (const task of TASKS) {
      for (let rep = 1; rep <= REPS; rep += 1) {
        const runDir = path.join(outDir, clave, `${task}-r${rep}`);
        process.stderr.write(`  ${task} r${rep}: generando…\n`);
        const t0 = Date.now();
        let r;
        try {
          r = task === "project" ? await tareaProject(entrada, runDir, think) : await tareaBugfix(entrada, runDir, think);
        } catch (error) {
          r = { task, error: String(error?.message || error).slice(0, 300), test: { pass: 0, fail: 0, tests: 0, code: 1 }, ms: Date.now() - t0 };
        }
        r.rep = rep;
        r.vramPicoMiB = task === "project" ? srv.vram : srv.vram;
        fs.mkdirSync(runDir, { recursive: true });
        fs.writeFileSync(path.join(runDir, "response.txt"), r.content || "", "utf8");
        if (r.plan) fs.writeFileSync(path.join(runDir, "plan.txt"), r.plan, "utf8");
        if (r.test?.text) fs.writeFileSync(path.join(runDir, "test-output.txt"), r.test.text, "utf8");
        resultados.push({ clave, nombre: entrada.nombre || clave, ...r });
        process.stderr.write(`    ${r.test?.pass ?? 0}/${r.test?.tests ?? 0} tests · ${(r.ms / 1000).toFixed(1)} s · ${r.tps.toFixed(1)} tok/s\n`);
      }
    }
  } finally {
    await parar(srv.hijo);
  }
}

// Agregado por modelo y tarea (si hay reps).
const agregados = [];
for (const clave of [...new Set(resultados.map((r) => r.clave))]) {
  const nombre = resultados.find((r) => r.clave === clave)?.nombre || clave;
  const row = { clave, nombre, project: null, bugfix: null, global: 0 };
  for (const task of ["project", "bugfix"]) {
    const rs = resultados.filter((r) => r.clave === clave && r.task === task);
    if (!rs.length) continue;
    const esperado = task === "project" ? 9 : 5;
    const pass = rs.reduce((a, r) => a + (r.test?.pass || 0), 0);
    const total = esperado * rs.length;
    const fail = Math.max(0, total - pass);
    const ms = rs.reduce((a, r) => a + (r.ms || 0), 0) / rs.length;
    const tps = rs.reduce((a, r) => a + (r.tps || 0), 0) / rs.length;
    const timeout = rs.some((r) => r.test?.timeout);
    row[task] = { pass, total, fail, score: total ? (pass / total) * 100 : 0, ms, tps, allPass: total > 0 && pass === total, timeout, runs: rs.length };
  }
  row.global = row.project && row.bugfix
    ? row.project.score * 0.65 + row.bugfix.score * 0.35
    : (row.project?.score ?? row.bugfix?.score ?? 0);
  agregados.push(row);
}
agregados.sort((a, b) => b.global - a.global || b.project?.score - a.project?.score);

fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ stamp, pipeline: PIPELINE, repair: REPAIR, think: "auto", agregados, resultados }, null, 2), "utf8");
const md = [
  `# Coding real · ${stamp}`,
  "",
  "Dos tareas con tests ocultos, ejecutadas con `node --test`. No los escribe el modelo.",
  "",
  "| # | Modelo | Proyecto | Bugfix | Global | tests | tok/s | tiempo |",
  "|---:|---|---:|---:|---:|---:|---:|---:|",
  ...agregados.map((r, i) => `| ${i + 1} | ${r.nombre} | ${r.project ? `${r.project.pass}/${r.project.total} (${r.project.score.toFixed(0)}%)` : "—"} | ${r.bugfix ? `${r.bugfix.pass}/${r.bugfix.total} (${r.bugfix.score.toFixed(0)}%)` : "—"} | **${r.global.toFixed(0)}%** | ${(r.project?.pass || 0) + (r.bugfix?.pass || 0)}/${(r.project?.total || 0) + (r.bugfix?.total || 0)} | ${Math.round(r.project?.tps || r.bugfix?.tps || 0)} | ${((r.project?.ms || 0) / 1000).toFixed(0)} s |`),
  "",
  `Pipeline: **${PIPELINE}** · reparaciones: **${REPAIR}**.`,
  "",
  "## Fallos por modelo",
  "",
  ...agregados.flatMap((r) => [
    `### ${r.nombre}`,
    "",
    ...(["project", "bugfix"].filter((t) => r[t] && r[t].fail > 0).map((t) => `- ${t}: ${r[t].fail} test(s) fallan de ${r[t].total}`)),
    ...(r.project?.allPass ? ["- Proyecto: **todos los tests pasan**"] : []),
    ...(r.bugfix?.allPass ? ["- Bugfix: **todos los tests pasan**"] : []),
    "",
  ]),
].join("\n");
fs.writeFileSync(path.join(outDir, "results.md"), md, "utf8");

const chartPath = path.join(PROJECT, "docs", "graficos", "bench-coding.svg");
fs.mkdirSync(path.dirname(chartPath), { recursive: true });
fs.writeFileSync(chartPath, svgBarras(agregados.map((r) => ({ name: r.nombre, score: r.global, pass: (r.project?.pass || 0) + (r.bugfix?.pass || 0), total: (r.project?.total || 0) + (r.bugfix?.total || 0) })), "Coding real: proyecto multifichero + bugfix", "Tests ocultos ejecutados con node --test · global = 65% proyecto + 35% bugfix"), "utf8");

// Guardar en el registro para que el Hub lo muestre.
try {
  const reg = leerRegistro();
  for (const r of agregados) {
    const e = reg.modelos?.[r.clave];
    if (!e) continue;
    e.pruebas = e.pruebas || {};
    e.pruebas.coding = {
      fecha: new Date().toISOString(),
      global: Math.round(r.global * 10) / 10,
      project: r.project ? { pass: r.project.pass, total: r.project.total, score: Math.round(r.project.score * 10) / 10, ms: Math.round(r.project.ms), tps: Math.round(r.project.tps) } : null,
      bugfix: r.bugfix ? { pass: r.bugfix.pass, total: r.bugfix.total, score: Math.round(r.bugfix.score * 10) / 10, ms: Math.round(r.bugfix.ms), tps: Math.round(r.bugfix.tps) } : null,
    };
  }
  guardarRegistro(reg);
} catch { /* el benchmark ya está guardado */ }

process.stdout.write(`${JSON.stringify({ dir: outDir, agregados }, null, 2)}\n`);


