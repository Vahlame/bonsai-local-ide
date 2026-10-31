#!/usr/bin/env node
/**
 * Benchmark de WEB APP full-stack real.
 *
 * El modelo debe construir una "Taskboard" Node ESM sin dependencias:
 *   - server.mjs con API CRUD + /api/stats y estáticos;
 *   - public/index.html + app.js + styles.css con UI funcional;
 *   - persistencia en data.json.
 *
 * El evaluador arranca `node server.mjs`, prueba la API con fetch y abre la UI
 * con Playwright (Edge headless), añade una tarea y guarda una captura.
 *
 * Uso:
 *   node scripts/bench-webapp.mjs --models gpt-oss-20b,qwen36-35b-a3b
 *   node scripts/bench-webapp.mjs --models qwen3-30b-a3b-2507 --reps 1
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
const PORT = Number(arg("port", "8095"));
const REPS = Math.max(1, Math.min(3, Number(arg("reps", "1")) || 1));
const SPEC = arg("spec", "none");
const MODELOS = (arg("models", "") || "gpt-oss-20b,qwen36-35b-a3b,qwen3-30b-a3b-2507,qwen3-4b-2507")
  .split(",").map((s) => s.trim()).filter(Boolean);
const BIN = path.join(PROJECT, "bin", "llama-server.exe");
const PLAYWRIGHT = path.join(PROJECT, "chat", "node_modules", "playwright-core", "index.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const API_TOTAL = 8;
const UI_TOTAL = 3;

const SISTEMA = "Eres un ingeniero full-stack senior. Escribes código completo, ejecutable y sin dependencias externas. Sigues el formato pedido al pie de la letra.";

const PROMPT = `Crea una web app full-stack Node.js ESM llamada "taskboard", sin dependencias externas.

Archivos obligatorios:
1) server.mjs
   - Lee process.env.PORT (por defecto 3000) y escucha en 127.0.0.1.
   - Sirve los estáticos de public/ en /.
   - Persiste en data.json (créalo si no existe) con tareas {id, title, status, priority, createdAt}.
   - GET /api/tasks -> array de tareas.
   - POST /api/tasks {title, status?, priority?} -> 201 con la tarea creada.
   - PATCH /api/tasks/:id {title?, status?, priority?} -> tarea actualizada.
   - DELETE /api/tasks/:id -> 204.
   - GET /api/stats -> {todo, doing, done, total}.
   - status válidos: "todo", "doing", "done".
2) public/index.html
   - Un input de texto, un botón para añadir, una lista/columnas de tareas y un bloque de estadísticas.
3) public/app.js
   - Carga las tareas, permite añadir, cambiar estado (todo/doing/done) y borrar; actualiza estadísticas.
4) public/styles.css
   - Estilos legibles, layout de tablero.
5) package.json con {"type":"module"} y script start.

Requisitos:
- Sin Express, sin React, sin dependencias: solo node:http/fs/path y JS del navegador.
- El servidor debe arrancar con "node server.mjs" y respetar PORT.
- No escribas tests.
- Responde SOLO con los archivos, exactamente así, sin markdown:
===FILE: server.mjs===
contenido
===END FILE===
===FILE: public/index.html===
contenido
===END FILE===
===FILE: public/app.js===
contenido
===END FILE===
===FILE: public/styles.css===
contenido
===END FILE===
===FILE: package.json===
contenido
===END FILE===`;

function limpiarCuerpo(body) {
  let b = String(body || "").replace(/\r\n/g, "\n");
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
    if (!(rel === "package.json" || rel === "server.mjs" || rel.startsWith("public/"))) {
      const base = path.basename(rel);
      if (["index.html", "app.js", "styles.css"].includes(base)) rel = `public/${base}`;
      else continue;
    }
    out.push({ rel, body: limpiarCuerpo(m[2]) });
    if (out.length >= 20) break;
  }
  return out;
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
  const a = ["-m", path.join(PROJECT, "models", entrada.archivo), "--gpu-layers", "99", "--flash-attn", "on",
    "-c", String(plan.contexto), "-ctk", plan.kv, "-ctv", plan.kv,
    "-b", String(entrada.servidor?.batch || 512), "-ub", String(entrada.servidor?.ubatch || 256),
    "-t", String(entrada.servidor?.threads || 4), "--host", "127.0.0.1", "--port", String(PORT),
    "--jinja", "--metrics", "-lv", "2", "--cache-ram", "0", "--no-context-shift", "--ctx-checkpoints", "0",
    "--spec-type", SPEC, "--temp", "0.1", "--top-p", "0.9", "--top-k", "20", "--min-p", "0.05",
    "--presence-penalty", "0", "--repeat-penalty", "1",
    "--cors-origins", `http://127.0.0.1:${PORT},http://localhost:${PORT}`];
  if (entrada.chat_template) {
    const tpl = path.join(PROJECT, "logs", `chat_template_webapp_${PORT}.jinja`);
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
  return a;
}

async function arrancar(entrada, plan, think) {
  const out = fs.openSync(path.join(PROJECT, "logs", `webapp-${entrada.clave}-${PORT}.out.log`), "w");
  const err = fs.openSync(path.join(PROJECT, "logs", `webapp-${entrada.clave}-${PORT}.err.log`), "w");
  const hijo = spawn(BIN, argumentos(entrada, plan, think), { cwd: PROJECT, stdio: ["ignore", out, err], windowsHide: true });
  let pico = 0;
  let salio = false;
  hijo.on("exit", () => { salio = true; });
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    if (salio) throw new Error("el servidor del modelo terminó al arrancar");
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) { await sleep(500); return { hijo, vram: Math.max(pico, await vramUsada()) }; }
    } catch { /* cargando */ }
    pico = Math.max(pico, await vramUsada());
    await sleep(700);
  }
  try { hijo.kill("SIGKILL"); } catch { /* ya */ }
  throw new Error("timeout de arranque del modelo");
}

async function parar(hijo) {
  if (!hijo) return;
  try { await execFileAsync("taskkill", ["/pid", String(hijo.pid), "/T", "/F"], { timeout: 15000 }); } catch { /* ya */ }
  await sleep(1000);
}

async function preguntar(messages, maxTokens, think) {
  const t0 = Date.now();
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "local", messages, temperature: 0.1, top_p: 0.9, top_k: 20, min_p: 0.05, max_tokens: maxTokens, reasoning_budget: think }),
    signal: AbortSignal.timeout(1200000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const raw = await res.json();
  const msg = raw?.choices?.[0]?.message || {};
  return { content: String(msg.content || ""), ms: Date.now() - t0, tps: Number(raw?.timings?.predicted_per_second) || 0, finish: raw?.choices?.[0]?.finish_reason || "", usage: raw?.usage || {} };
}

async function preguntarRobusto(messages, maxTokens, think) {
  let r = await preguntar(messages, maxTokens, think);
  if (r.finish === "length") {
    const c = await preguntar([...messages, { role: "assistant", content: r.content.slice(-16000) }, { role: "user", content: "Continúa exactamente donde se cortó y termina todos los archivos con ===END FILE===. Sin explicaciones." }], Math.min(20000, Math.round(maxTokens * 1.4)), Math.min(1024, think));
    r = { ...c, content: `${r.content}\n${c.content}`, ms: r.ms + c.ms, retryLength: true, finish: c.finish };
  }
  return r;
}

async function esperarServidorApp(base, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/tasks`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch { /* arrancando */ }
    await sleep(400);
  }
  return false;
}

async function apiTests(base) {
  const filas = [];
  const add = (id, ok, detalle) => filas.push({ id, ok, detalle });
  let r = await fetch(`${base}/api/tasks`, { signal: AbortSignal.timeout(5000) });
  let body = r.ok ? await r.json() : null;
  add("lista-inicial", r.ok && Array.isArray(body) && body.length === 0, `HTTP ${r.status} ${JSON.stringify(body).slice(0, 80)}`);

  r = await fetch(`${base}/api/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Comprar leche", priority: 2 }) });
  body = r.ok ? await r.json() : null;
  const id = body?.id;
  add("crear", r.status === 201 && body && id !== undefined && body.title === "Comprar leche", `HTTP ${r.status} ${JSON.stringify(body).slice(0, 100)}`);

  r = await fetch(`${base}/api/tasks`, { signal: AbortSignal.timeout(5000) });
  body = r.ok ? await r.json() : null;
  add("listar-creada", r.ok && Array.isArray(body) && body.some((t) => String(t.id) === String(id)), `HTTP ${r.status}`);

  r = await fetch(`${base}/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "doing" }) });
  body = r.ok ? await r.json() : null;
  add("cambiar-estado", r.ok && body && body.status === "doing", `HTTP ${r.status} ${JSON.stringify(body).slice(0, 100)}`);

  r = await fetch(`${base}/api/stats`, { signal: AbortSignal.timeout(5000) });
  body = r.ok ? await r.json() : null;
  add("stats", r.ok && body && Number(body.doing) === 1 && Number(body.total) === 1, `HTTP ${r.status} ${JSON.stringify(body).slice(0, 100)}`);

  r = await fetch(`${base}/`, { signal: AbortSignal.timeout(5000) });
  const html = r.ok ? await r.text() : "";
  add("html", r.ok && /<input/i.test(html) && /<button/i.test(html), `HTTP ${r.status} ${html.length} bytes`);

  const js = await fetch(`${base}/app.js`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  const css = await fetch(`${base}/styles.css`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  add("estaticos", Boolean(js?.ok && css?.ok), `app.js=${js?.status} styles.css=${css?.status}`);

  r = await fetch(`${base}/api/tasks/${id}`, { method: "DELETE", signal: AbortSignal.timeout(5000) });
  add("borrar", r.status === 204 || r.ok, `HTTP ${r.status}`);

  return filas;
}

async function uiTests(base, runDir) {
  const filas = [];
  if (!fs.existsSync(PLAYWRIGHT)) return { filas: [{ id: "playwright", ok: false, detalle: "no instalado" }], screenshot: "" };
  let browser;
  try {
    const { chromium } = await import(`file:///${PLAYWRIGHT.replace(/\\/g, "/")}`);
    const edge = ["C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"].find(fs.existsSync);
    browser = await chromium.launch({ executablePath: edge, headless: true, args: ["--disable-gpu"] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(800);
    const input = page.locator('input[type="text"], input:not([type])').first();
    await input.fill("Tarea UI");
    const boton = page.getByRole("button", { name: /añadir|agregar|crear|add|new/i }).first();
    const hayBoton = await boton.count();
    await (hayBoton ? boton : page.locator("button").first()).click();
    await page.waitForTimeout(1000);
    const visible = await page.getByText("Tarea UI", { exact: false }).count();
    filas.push({ id: "input", ok: true, detalle: "input encontrado" });
    filas.push({ id: "añadir", ok: hayBoton > 0, detalle: hayBoton ? "botón encontrado" : "sin botón Añadir" });
    filas.push({ id: "tarea-visible", ok: visible > 0, detalle: `${visible} coincidencias` });
    const shot = path.join(runDir, "screenshot.png");
    await page.screenshot({ path: shot, fullPage: true });
    return { filas, screenshot: shot };
  } catch (error) {
    return { filas: [{ id: "ui", ok: false, detalle: String(error?.message || error).slice(0, 200) }], screenshot: "" };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function svg(rows) {
  const W = 1000, rowH = 54, top = 96, left = 300, chartW = 560;
  const H = top + rows.length * rowH + 70;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, system-ui, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#0d100b"/>`,
    `<text x="24" y="34" fill="#e9eee0" font-size="18" font-weight="600">Web app real: API + UI en navegador</text>`,
    `<text x="24" y="54" fill="#8d9680" font-size="12">Taskboard full-stack · tests ocultos de API y Playwright</text>`,
  ];
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const w = Math.round(chartW * r.score / 100);
    out.push(`<text x="24" y="${y + 22}" fill="#e9eee0" font-size="11">${r.name}</text>`);
    out.push(`<rect x="${left}" y="${y + 8}" width="${chartW}" height="20" rx="4" fill="#1a2014"/>`);
    out.push(`<rect x="${left}" y="${y + 8}" width="${w}" height="20" rx="4" fill="${r.score >= 99 ? "#cde86e" : r.score >= 50 ? "#e8c06a" : "#d97878"}"/>`);
    out.push(`<text x="${left + chartW + 10}" y="${y + 23}" fill="#e9eee0" font-size="12" font-weight="700">${r.score.toFixed(0)}%</text>`);
    out.push(`<text x="${left + 6}" y="${y + 23}" fill="#0d100b" font-size="10" font-weight="600">${r.api}/${API_TOTAL} API · ${r.ui}/${UI_TOTAL} UI</text>`);
  });
  out.push("</svg>");
  return out.join("\n");
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(PROJECT, "reports", `webapp-bench-${stamp}`);
fs.mkdirSync(outDir, { recursive: true });
fusionarCatalogo();

const resultados = [];
for (const clave of MODELOS) {
  const entrada = MODELO.catalogo?.[clave];
  const modelo = path.join(PROJECT, "models", entrada?.archivo || "");
  if (!entrada || !fs.existsSync(modelo)) { process.stderr.write(`\n### ${clave}: no instalado\n`); continue; }
  entrada.clave = clave;
  const { plan } = await planParaModelo(clave, { vision: false });
  if (!plan.ok) { process.stderr.write(`\n### ${clave}: plan no cabe\n`); continue; }
  const think = pensarDe(entrada);
  process.stderr.write(`\n=== ${entrada.nombre || clave} · web app · think ${think} ===\n`);
  const srv = await arrancar(entrada, plan, think);
  try {
    for (let rep = 1; rep <= REPS; rep += 1) {
      const runDir = path.join(outDir, clave, `run${rep}`);
      fs.mkdirSync(runDir, { recursive: true });
      process.stderr.write(`  run ${rep}: generando web app…\n`);
      const t0 = Date.now();
      let respuesta;
      try {
        respuesta = await preguntarRobusto([{ role: "system", content: SISTEMA }, { role: "user", content: PROMPT }], 16000, think);
      } catch (error) {
        resultados.push({ clave, nombre: entrada.nombre, rep, ok: false, error: String(error?.message || error).slice(0, 300), api: [], ui: [], ms: Date.now() - t0 });
        process.stderr.write(`    FALLO generación: ${String(error?.message || error).slice(0, 100)}\n`);
        continue;
      }
      const files = parseFiles(respuesta.content);
      fs.writeFileSync(path.join(runDir, "response.txt"), respuesta.content, "utf8");
      for (const f of files) {
        const abs = path.join(runDir, f.rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.body, "utf8");
      }
      fs.writeFileSync(path.join(runDir, "package.json"), JSON.stringify({ name: "taskboard-bench", private: true, type: "module", scripts: { start: "node server.mjs" } }, null, 2), "utf8");
      const appBase = `http://127.0.0.1:${PORT + 1}`;
      const appPort = PORT + 1;
      const out = fs.openSync(path.join(runDir, "app.out.log"), "w");
      const err = fs.openSync(path.join(runDir, "app.err.log"), "w");
      const app = spawn(process.execPath, ["server.mjs"], { cwd: runDir, stdio: ["ignore", out, err], windowsHide: true, env: { ...process.env, PORT: String(appPort), HOST: "127.0.0.1" } });
      let appOk = false;
      try {
        appOk = await esperarServidorApp(appBase, 30000);
        let api = [];
        let ui = { filas: [], screenshot: "" };
        if (appOk) {
          api = await apiTests(appBase);
          ui = await uiTests(appBase, runDir);
        } else {
          api = [{ id: "arranque", ok: false, detalle: "server.mjs no respondió en 30 s" }];
        }
        const apiPass = api.filter((x) => x.ok).length;
        const uiPass = ui.filas.filter((x) => x.ok).length;
        const score = (apiPass / API_TOTAL) * 70 + (uiPass / UI_TOTAL) * 30;
        const fila = { clave, nombre: entrada.nombre, rep, ok: appOk, files: files.map((f) => f.rel), api, ui: ui.filas, screenshot: ui.screenshot ? path.relative(PROJECT, ui.screenshot) : "", apiPass, uiPass, score, ms: Date.now() - t0, tps: respuesta.tps, genTokens: respuesta.usage?.completion_tokens || 0, finish: respuesta.finish, retryLength: Boolean(respuesta.retryLength) };
        resultados.push(fila);
        fs.writeFileSync(path.join(runDir, "result.json"), JSON.stringify(fila, null, 2), "utf8");
        process.stderr.write(`    ${apiPass}/${API_TOTAL} API · ${uiPass}/${UI_TOTAL} UI · ${score.toFixed(0)}% · ${(fila.ms / 1000).toFixed(1)} s\n`);
      } finally {
        try { await execFileAsync("taskkill", ["/pid", String(app.pid), "/T", "/F"], { timeout: 10000 }); } catch { /* ya */ }
      }
    }
  } finally {
    await parar(srv.hijo);
  }
}

const agregados = [];
for (const clave of [...new Set(resultados.map((r) => r.clave))]) {
  const rs = resultados.filter((r) => r.clave === clave);
  const nombre = rs[0]?.nombre || clave;
  const apiPass = rs.reduce((a, r) => a + (r.apiPass || 0), 0);
  const uiPass = rs.reduce((a, r) => a + (r.uiPass || 0), 0);
  const totalApi = API_TOTAL * rs.length;
  const totalUi = UI_TOTAL * rs.length;
  const score = (apiPass / Math.max(1, totalApi)) * 70 + (uiPass / Math.max(1, totalUi)) * 30;
  agregados.push({ clave, nombre, apiPass, totalApi, uiPass, totalUi, score, runs: rs.length, ms: Math.round(rs.reduce((a, r) => a + (r.ms || 0), 0) / rs.length), tps: Math.round(rs.reduce((a, r) => a + (r.tps || 0), 0) / rs.length), screenshot: rs.find((r) => r.screenshot)?.screenshot || "" });
}
agregados.sort((a, b) => b.score - a.score || b.apiPass - a.apiPass);

fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ stamp, spec: SPEC, agregados, resultados }, null, 2), "utf8");
const md = [
  `# Web app real · ${stamp}`,
  "",
  "Taskboard full-stack (Node ESM, sin dependencias): API CRUD + stats + UI. Tests ocultos de API y Playwright.",
  "",
  "| # | Modelo | Global | API | UI | Reps | tok/s | Tiempo |",
  "|---:|---|---:|---:|---:|---:|---:|---:|",
  ...agregados.map((r, i) => `| ${i + 1} | **${r.nombre}** | **${r.score.toFixed(0)}%** | ${r.apiPass}/${r.totalApi} | ${r.uiPass}/${r.totalUi} | ${r.runs} | ${r.tps} | ${(r.ms / 1000).toFixed(0)} s |`),
  "",
  "![Web app benchmark](../docs/graficos/bench-webapp.svg)",
  "",
  "## Detalle",
  "",
  ...agregados.flatMap((r) => [
    `### ${r.nombre}`,
    "",
    ...resultados.filter((x) => x.clave === r.clave).map((x) => `- run ${x.rep}: API ${x.apiPass}/${API_TOTAL}, UI ${x.uiPass}/${UI_TOTAL}, ${x.score?.toFixed(0)}%, ${(x.ms / 1000).toFixed(1)} s${x.screenshot ? `, captura \`${x.screenshot}\`` : ""}`),
    "",
  ]),
].join("\n");
fs.writeFileSync(path.join(outDir, "results.md"), md, "utf8");
fs.mkdirSync(path.join(PROJECT, "docs", "graficos"), { recursive: true });
fs.writeFileSync(path.join(PROJECT, "docs", "graficos", "bench-webapp.svg"), svg(agregados.map((r) => ({ name: r.nombre, score: r.score, api: r.apiPass, ui: r.uiPass }))), "utf8");

try {
  const reg = leerRegistro();
  for (const r of agregados) {
    const e = reg.modelos?.[r.clave];
    if (!e) continue;
    e.pruebas = e.pruebas || {};
    e.pruebas.webapp = { fecha: new Date().toISOString(), global: Math.round(r.score * 10) / 10, api: r.apiPass, apiTotal: r.totalApi, ui: r.uiPass, uiTotal: r.totalUi, ms: r.ms, tps: r.tps };
  }
  guardarRegistro(reg);
} catch { /* informe guardado */ }

process.stdout.write(`${JSON.stringify({ dir: outDir, agregados }, null, 2)}\n`);
