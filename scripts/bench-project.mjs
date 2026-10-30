/**
 * Benchmark de PROYECTO de codigo complejo (multi-archivo, ejecutado de verdad).
 *
 * Pide al modelo un proyecto Node ESM con varios archivos y tests node:test,
 * escribe los archivos en un directorio temporal y ejecuta `node --test`. Puntua
 * por tests que pasan, no por "parece correcto". Opcionalmente comprueba vision
 * con una captura del IDE.
 *
 * Uso:
 *   node scripts/bench-project.mjs
 *   node scripts/bench-project.mjs --reps 2
 *   node scripts/bench-project.mjs --profiles "8GB-VISION-MAX-F16:0.6:0.90:20:0.05;8GB-VISION-MAX-F16:0.6:0.95:20:0;8GB-RESEARCH:1.0:0.95:20:0.05"
 *
 * Escribe reports/project-bench-<stamp>/ y docs/graficos/bench-project.svg
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(`--${n}`);

const PORT = Number(arg("port", "8096"));
const REPS = Math.max(1, Number(arg("reps", "1")));
const THINK = Number(arg("think", "2048"));
const MAX_TOKENS = Number(arg("max-tokens", "6000"));
const VISION = !flag("no-vision");

const PRESETS = JSON.parse(fs.readFileSync(path.join(PROJECT, "config", "local-engine-presets-rtx4060-optimized.json"), "utf8"));
const MODELO = JSON.parse(fs.readFileSync(path.join(PROJECT, "chat", "modelo.json"), "utf8"));
const ITEM = MODELO.catalogo.ornith9b;

const binCands = [
  path.join(PROJECT, ".local", "opt", "bonsai-inference", "build-RTX4060-Opt-sm89", "bin", "llama-server.exe"),
  path.join(process.env.USERPROFILE || "", ".local", "opt", "bonsai-inference", "build-RTX4060-Opt-sm89", "bin", "llama-server.exe"),
];
let BIN = path.join(PROJECT, "bin", "llama-server.exe");
for (const c of binCands) if (fs.existsSync(c)) { BIN = c; break; }

const MODEL = path.join(PROJECT, "models", ITEM.archivo);
const MMPROJ = ITEM.vision?.archivo ? path.join(PROJECT, "models", ITEM.vision.archivo) : "";
const TEMPLATE = path.join(PROJECT, "logs", `chat_template_proj_${PORT}.jinja`);
if (ITEM.chat_template) fs.writeFileSync(TEMPLATE, ITEM.chat_template, "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Perfiles por defecto: mejor muestreo vs tarjeta code vs tarjeta razonar.
const DEFAULT_PROFILES = "8GB-VISION-MAX-F16:0.6:0.90:20:0.05;8GB-VISION-MAX-F16:0.6:0.95:20:0;8GB-VISION-MAX-F16:1.0:0.95:20:0.05";
const profiles = (arg("profiles", DEFAULT_PROFILES) || "").split(";").filter(Boolean).map((spec) => {
  const [preset, temperature, top_p, top_k, min_p] = spec.split(":");
  return { preset, temperature: Number(temperature), top_p: Number(top_p), top_k: Number(top_k), min_p: Number(min_p),
           name: `${preset} · T${temperature} p${top_p} k${top_k} m${min_p}` };
});

function buildArgs(preset) {
  const p = PRESETS[preset];
  if (!p) throw new Error(`Preset desconocido: ${preset}`);
  const kv = String(p.kv); const stable = true; const _unused = kv;
  const a = ["-m", MODEL, "--gpu-layers", "99"];
  if (!stable) a.push("--fit", "off", "--kv-offload");
  a.push("--flash-attn", "on", "-c", String(p.context), "-ctk", kv, "-ctv", kv);
  if (!stable) a.push("-np", "1");
  a.push("-b", String(p.batch || 512), "-ub", String(p.ubatch || 256), "-t", "4");
  a.push("--host", "127.0.0.1", "--port", String(PORT), "--jinja", "--metrics", "-lv", "2");
  if (!stable) a.push("--cache-ram", "0");
  a.push("--cors-origins", `http://127.0.0.1:${PORT}`);
  a.push("--spec-type", "none", "--no-context-shift");
  if (stable) a.push("--ctx-checkpoints", "0");
  a.push("--chat-template-file", TEMPLATE);
  if (VISION && p.vision && MMPROJ) a.push("--mmproj", MMPROJ, "--mmproj-offload", "--mmproj-device", "CUDA0", "--image-max-tokens", "512");
  a.push("--reasoning-budget", String(THINK), "--reasoning-format", "deepseek");
  return a;
}

let currentPreset = null;
let currentProc = null;

async function ensureServer(preset) {
  if (currentPreset === preset && currentProc && currentProc.exitCode === null) return true;
  if (currentProc) { try { currentProc.kill("SIGKILL"); } catch { /* ya */ } await sleep(1500); }
  const out = fs.openSync(path.join(PROJECT, "logs", `proj-${preset}.out.log`), "w");
  const err = fs.openSync(path.join(PROJECT, "logs", `proj-${preset}.err.log`), "w");
  currentProc = spawn(BIN, buildArgs(preset), { cwd: PROJECT, stdio: ["ignore", out, err], windowsHide: true });
  currentPreset = preset;
  let exited = false;
  currentProc.on("exit", () => { exited = true; });
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (exited) throw new Error(`el servidor de ${preset} termino al arrancar`);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch { /* cargando */ }
    await sleep(1000);
  }
  throw new Error(`timeout arrancando ${preset}`);
}

async function stopAll() { if (currentProc) { try { currentProc.kill("SIGKILL"); } catch { /* ya */ } } }

async function ask(messages, profile) {
  const body = {
    model: "local", messages,
    temperature: profile.temperature, top_p: profile.top_p, top_k: profile.top_k, min_p: profile.min_p,
    presence_penalty: 0, repeat_penalty: 1, max_tokens: MAX_TOKENS, reasoning_budget: THINK,
  };
  const t0 = Date.now();
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(600000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  const raw = await res.json();
  const msg = raw?.choices?.[0]?.message || {};
  return { content: String(msg.content || ""), reasoning: String(msg.reasoning_content || ""), ms: Date.now() - t0,
           tps: raw?.timings?.predicted_per_second || 0, finish: raw?.choices?.[0]?.finish_reason || "", usage: raw?.usage };
}

const PROJECT_PROMPT = `Vas a crear un proyecto Node.js (ESM) llamado "taskforge" con VARIOS archivos. Escribe codigo real, completo y ejecutable.

Requisitos:
1) package.json con {"type":"module"} y script test.
2) src/priority-queue.mjs: clase PriorityQueue con enqueue(item, priority), dequeue() y size. Min-heap: menor priority sale antes; en empate, el que llego primero (FIFO). dequeue() en vacio lanza Error.
3) src/scheduler.mjs: clase Scheduler con constructor({concurrency}). Metodo add(fn, {priority=0, retries=0}) que registra una tarea async. Metodo run() que ejecuta respetando prioridad y que NUNCA haya mas de "concurrency" tareas a la vez, reintenta hasta "retries" veces si fn lanza (y si sigue fallando, el resultado de esa tarea es {ok:false, error}), y devuelve un array de resultados en orden de finalizacion con la forma {id, ok, value?, error?, attempts}.
4) test/priority-queue.test.mjs y test/scheduler.test.mjs usando SOLO node:test y node:assert/strict. Cubre: orden por prioridad, FIFO en empate, dequeue vacio, limite de concurrencia (mide maximo simultaneo), reintentos (2 fallos y luego exito), fallo definitivo, y orden de finalizacion por duracion.

Responde SOLO con los archivos, cada uno exactamente asi (sin texto antes ni despues, sin cercas de markdown):
===FILE: ruta/relativa===
contenido
===END FILE===`;

function parseFiles(text) {
  const out = [];
  const re = /===FILE:\s*(.+?)===\s*\n([\s\S]*?)===END FILE===/g;
  let m;
  while ((m = re.exec(text))) {
    let rel = m[1].trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!rel || rel.includes("..") || rel.startsWith("/") || /^[a-zA-Z]:/.test(rel)) continue;
    if (!(rel === "package.json" || rel.startsWith("src/") || rel.startsWith("test/"))) continue;
    out.push({ rel, body: m[2].replace(/^\n/, "") });
    if (out.length >= 20) break;
  }
  return out;
}

function runTests(cwd) {
  return new Promise((resolve) => {
    execFile("node", ["--test", "--test-reporter=tap"], { cwd, timeout: 240000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const text = `${stdout}\n${stderr}`;
        const pass = Number((text.match(/^# pass (\d+)/m) || [])[1] || 0);
        const fail = Number((text.match(/^# fail (\d+)/m) || [])[1] || 0);
        const tests = Number((text.match(/^# tests (\d+)/m) || [])[1] || (pass + fail));
        resolve({ code: err ? (err.code ?? 1) : 0, pass, fail, tests, text });
      });
  });
}

function imageData() {
  const p = path.join(PROJECT, "reports", "custom-preset-ide.png");
  if (!fs.existsSync(p)) return "";
  const b = fs.readFileSync(p);
  if (b.length > 6_000_000) return "";
  return `data:image/png;base64,${b.toString("base64")}`;
}

async function visionCheck(profile, imageUrl) {
  if (!VISION || !imageUrl) return null;
  const messages = [
    { role: "system", content: "Eres un asistente preciso." },
    { role: "user", content: [
      { type: "text", text: "Mira esta captura del IDE. Enumera en una sola linea los paneles o zonas que ves." },
      { type: "image_url", image_url: { url: imageUrl } },
    ] },
  ];
  try {
    const r = await ask(messages, profile);
    const c = r.content.toLowerCase();
    const hits = ["chat", "explorador", "editor", "historial", "terminal", "problemas", "esquema"].filter((k) => c.includes(k));
    return { ok: hits.length >= 3, hits, reply: r.content.slice(0, 160), ms: r.ms };
  } catch (err) { return { ok: false, hits: [], reply: `error: ${String(err.message).slice(0, 80)}`, ms: 0 }; }
}

function svgChart(rows) {
  const W = 900, rowH = 46, top = 100, left = 300, chartW = 480;
  const H = top + rows.length * rowH + 70;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, system-ui, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#0d100b"/>`,
    `<text x="24" y="34" fill="#e9eee0" font-size="18" font-weight="600">Complex project benchmark — node:test pass rate</text>`,
    `<text x="24" y="54" fill="#8d9680" font-size="12">Multi-file taskforge project · tests executed for real · higher is better</text>`];
  const maxTests = Math.max(1, ...rows.map((r) => r.total));
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const w = Math.round(chartW * (r.score / 100));
    out.push(`<text x="24" y="${y + 20}" fill="#e9eee0" font-size="11">${r.name}</text>`);
    out.push(`<rect x="${left}" y="${y + 6}" width="${chartW}" height="20" rx="4" fill="#1a2014"/>`);
    out.push(`<rect x="${left}" y="${y + 6}" width="${w}" height="20" rx="4" fill="${r.allPass ? "#cde86e" : "#e8c06a"}"/>`);
    out.push(`<text x="${left + chartW + 10}" y="${y + 21}" fill="#e9eee0" font-size="12" font-weight="700">${r.score.toFixed(0)}%</text>`);
    out.push(`<text x="${left + 6}" y="${y + 21}" fill="#0d100b" font-size="10" font-weight="600">${r.pass}/${r.total} tests</text>`);
  });
  out.push(`</svg>`);
  return out.join("\n");
}

async function main() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const outDir = path.join(PROJECT, "reports", `project-bench-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });
  const imageUrl = imageData();

  console.log(`BIN=${BIN}`);
  console.log(`profiles=${profiles.length} reps=${REPS} think=${THINK} max_tokens=${MAX_TOKENS} vision=${VISION && Boolean(imageUrl)}`);

  const rows = [];
  for (const profile of profiles) {
    console.log(`\n=== ${profile.name} ===`);
    await ensureServer(profile.preset);
    const runs = [];
    for (let rep = 1; rep <= REPS; rep++) {
      const runDir = path.join(outDir, profile.name.replace(/[^\w.-]+/g, "_"), `run${rep}`);
      fs.mkdirSync(runDir, { recursive: true });
      console.log(`  run ${rep}: generando proyecto...`);
      let answer;
      try {
        answer = await ask([
          { role: "system", content: "Eres un ingeniero de software senior. Escribe codigo completo, correcto y ejecutable. Sigue el formato pedido al pie de la letra." },
          { role: "user", content: PROJECT_PROMPT },
        ], profile);
      } catch (err) {
        runs.push({ rep, error: String(err.message).slice(0, 160), pass: 0, fail: 0, tests: 0 });
        console.log(`    ERROR: ${err.message}`);
        continue;
      }
      fs.writeFileSync(path.join(runDir, "response.txt"), answer.content, "utf8");
      fs.writeFileSync(path.join(runDir, "reasoning.txt"), answer.reasoning, "utf8");
      const files = parseFiles(answer.content);
      for (const f of files) {
        const abs = path.join(runDir, f.rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.body, "utf8");
      }
      const test = await runTests(runDir);
      fs.writeFileSync(path.join(runDir, "test-output.txt"), test.text, "utf8");
      console.log(`    files=${files.length} tests=${test.tests} pass=${test.pass} fail=${test.fail} exit=${test.code}`);
      runs.push({ rep, files: files.map((f) => f.rel), tests: test.tests, pass: test.pass, fail: test.fail, code: test.code,
                  ms: answer.ms, tps: answer.tps, finish: answer.finish, genTokens: answer.usage?.completion_tokens || 0 });
    }
    const vision = await visionCheck(profile, imageUrl);
    console.log(`  vision: ${vision ? (vision.ok ? "OK" : "FAIL") + " " + vision.hits.join(",") : "n/a"}`);
    const total = runs.reduce((a, r) => a + (r.tests || 0), 0);
    const pass = runs.reduce((a, r) => a + (r.pass || 0), 0);
    const allPass = runs.length > 0 && runs.every((r) => r.tests > 0 && r.fail === 0 && r.code === 0);
    rows.push({ name: profile.name, profile, runs, vision, total, pass, score: total ? (pass / total) * 100 : 0, allPass });
  }
  await stopAll();

  const summary = rows.map((r) => ({ name: r.name, total: r.total, pass: r.pass, score: r.score, allPass: r.allPass,
    vision: r.vision ? r.vision.ok : null, runs: r.runs }));
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ stamp, think: THINK, maxTokens: MAX_TOKENS, reps: REPS, rows: summary, full: rows }, null, 2), "utf8");

  const md = [`# Complex project benchmark - ${stamp}`,
    `\nProyecto multi-archivo (\`taskforge\`) generado por el modelo y validado ejecutando \`node --test\`.`,
    `Reps: ${REPS} · pensamiento ${THINK} · max_tokens ${MAX_TOKENS} · vision ${VISION ? "on" : "off"}\n`,
    `| Perfil | Files | Tests | Pass | Fail | % | Todo OK | Vision |`,
    `|---|---:|---:|---:|---:|---:|:--:|:--:|`];
  for (const r of rows) {
    const files = r.runs.flatMap((x) => x.files || []).length;
    const fail = r.runs.reduce((a, x) => a + (x.fail || 0), 0);
    md.push(`| ${r.name} | ${files} | ${r.total} | ${r.pass} | ${fail} | ${r.score.toFixed(0)}% | ${r.allPass ? "yes" : "no"} | ${r.vision ? (r.vision.ok ? "OK" : "fail") : "-"} |`);
  }
  md.push(`\n## Detalle\n`);
  for (const r of rows) {
    md.push(`\n### ${r.name}\n`);
    for (const run of r.runs) {
      md.push(`- run ${run.rep}: files=${(run.files || []).length} tests=${run.tests} pass=${run.pass} fail=${run.fail} exit=${run.code} gen_tokens=${run.genTokens || 0} ${run.error ? `error=${run.error}` : ""}`);
    }
    if (r.vision) md.push(`- vision: ${r.vision.ok ? "OK" : "fail"} — ${r.vision.reply}`);
  }
  fs.writeFileSync(path.join(outDir, "results.md"), md.join("\n"), "utf8");

  const chartPath = path.join(PROJECT, "docs", "graficos", "bench-project.svg");
  fs.mkdirSync(path.dirname(chartPath), { recursive: true });
  fs.writeFileSync(chartPath, svgChart(rows.map((r) => ({ name: r.name, score: r.score, pass: r.pass, total: r.total, allPass: r.allPass }))), "utf8");

  console.log(`\nListo:\n  ${path.join(outDir, "results.md")}\n  ${chartPath}`);
  console.log("\n" + rows.map((r) => `${r.name}: ${r.pass}/${r.total} tests (${r.score.toFixed(0)}%) all=${r.allPass}`).join("\n"));
}

main().catch(async (err) => { console.error(err); await stopAll(); process.exitCode = 1; });
