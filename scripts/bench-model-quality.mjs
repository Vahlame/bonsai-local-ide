/**
 * Benchmark de CALIDAD por preset (tareas complejas, con verificacion automatica).
 *
 * Arranca el llama-server optimizado para cada preset, lanza un conjunto de tareas
 * de coding, matematicas, logica, datos/SQL, instrucciones, transformacion de texto,
 * retrieval de contexto largo, extraccion en espanol y tool-calling, y comprueba el
 * resultado de forma determinista (sin jurado humano).
 *
 * Uso:
 *   node scripts/bench-model-quality.mjs                       # 5 presets por defecto
 *   node scripts/bench-model-quality.mjs --presets A,B,C
 *   node scripts/bench-model-quality.mjs --model qwen3-4b-2507            # plan AUTO del modelo
 *   node scripts/bench-model-quality.mjs --model qwen3-4b-2507 --presets 8GB-VISION-HIGH
 *   node scripts/bench-model-quality.mjs --tasks coding_impl_js,reasoning_math
 *   node scripts/bench-model-quality.mjs --port 8092 --think 1024 --max-tokens 1200
 *   node scripts/bench-model-quality.mjs --sampling --preset 8GB-CODE-BALANCED --repeat 2
 *
 * Escribe reports/bench-quality-<stamp>/{results.json,results.md} y
 * docs/graficos/bench-quality.svg (o bench-sampling.svg en modo --sampling).
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { planParaModelo, leerRegistro, guardarRegistro } from "../chat/model-hub.mjs";
import { dialectoDe, llamadasCrudas } from "../chat/adaptadores.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
};

const PORT = Number(arg("port", "8093"));
const THINK = Number(arg("think", "1024"));
const MAX_TOKENS = Number(arg("max-tokens", "1200"));
const TEMP = Number(arg("temp", "0.2"));
const TOPP = Number(arg("top-p", "0.9"));
const TOPK = Number(arg("top-k", "20"));
const MINP = Number(arg("min-p", "0"));
const PP = Number(arg("presence-penalty", "0"));
const RP = Number(arg("repeat-penalty", "1"));
const REPS = Math.max(1, Number(arg("repeat", "1")));
const REQ_TIMEOUT_MS = Number(arg("timeout", "240000"));

const BASE_SAMPLING = { temperature: TEMP, top_p: TOPP, top_k: TOPK, min_p: MINP, presence_penalty: PP, repeat_penalty: RP, reasoning_budget: THINK };
let ACTIVE_SAMPLING = BASE_SAMPLING;

// Matriz de muestreo (--sampling). Nombres cortos para la grafica.
const SAMPLING_CONFIGS = [
  { name: "T0 greedy", temperature: 0, top_p: 1, top_k: 0, min_p: 0 },
  { name: "T0.2 p.95 k20", temperature: 0.2, top_p: 0.95, top_k: 20, min_p: 0 },
  { name: "T0.4 p.90 k40", temperature: 0.4, top_p: 0.9, top_k: 40, min_p: 0 },
  { name: "T0.6 p.95 k20 code", temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0 },
  { name: "T0.6 p.90 k20 m.05", temperature: 0.6, top_p: 0.9, top_k: 20, min_p: 0.05 },
  { name: "T0.7 p.80 k20 chat", temperature: 0.7, top_p: 0.8, top_k: 20, min_p: 0 },
  { name: "T0.8 p.95 k20 m.05", temperature: 0.8, top_p: 0.95, top_k: 20, min_p: 0.05 },
  { name: "T0.6 p.95 k20 pres1.5", temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0, presence_penalty: 1.5 },
  { name: "T0.6 p.95 k20 rep1.1", temperature: 0.6, top_p: 0.95, top_k: 20, min_p: 0, repeat_penalty: 1.1 },
  { name: "T1.0 p.95 k20 m.05 reason", temperature: 1.0, top_p: 0.95, top_k: 20, min_p: 0.05 },
];
const samplingMode = process.argv.includes("--sampling");
const configFilter = (arg("configs", "") || "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
const ACTIVE_CONFIGS = configFilter.length
  ? SAMPLING_CONFIGS.filter((_, i) => configFilter.includes(i + 1))
  : SAMPLING_CONFIGS;

const DEFAULT_PRESETS = [
  "8GB-VISION-MAX-F16",
  "8GB-VISION-HIGH",
  "8GB-CODE-BALANCED",
  "8GB-VISION-BALANCED",
  "8GB-RESEARCH",
];
const presets = (arg("presets", "") || DEFAULT_PRESETS.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const onlyTasks = (arg("tasks", "") || "").split(",").map((s) => s.trim()).filter(Boolean);

const presetsFile = path.join(PROJECT, "config", "local-engine-presets-rtx4060-optimized.json");
const PRESETS = JSON.parse(fs.readFileSync(presetsFile, "utf8"));
const MODELO = JSON.parse(fs.readFileSync(path.join(PROJECT, "chat", "modelo.json"), "utf8"));
// Model Hub: modelos descargados viven en models/hub-catalog.json.
try {
  const hub = JSON.parse(fs.readFileSync(path.join(PROJECT, "models", "hub-catalog.json"), "utf8"));
  for (const [clave, entrada] of Object.entries(hub.modelos || {})) {
    if (!clave.startsWith("_") && entrada && typeof entrada === "object" && !MODELO.catalogo[clave]) MODELO.catalogo[clave] = entrada;
  }
} catch { /* solo catálogo curado */ }
const MODEL_KEY = arg("model", "ornith9b");
const ITEM = MODELO.catalogo[MODEL_KEY];
if (!ITEM) throw new Error(`modelo desconocido: ${MODEL_KEY}`);
let PLAN_AUTO = null;
try {
  PLAN_AUTO = (await planParaModelo(MODEL_KEY, { vision: true })).plan;
} catch {
  // Un GGUF que no se puede planificar aún se prueba con el techo del catálogo.
}
const ITEM_PLAN = PLAN_AUTO || ITEM.plan || { contexto: ITEM.servidor?.contexto || 16384, kv: "q8_0", vision: Boolean(ITEM.vision?.archivo), mmprojCPU: ITEM.vision?.offload === false };
if (!PRESETS.AUTO) {
  PRESETS.AUTO = {
    label: `AUTO · ${ITEM.nombre || MODEL_KEY}`,
    context: Number(ITEM_PLAN.contexto) || 16384,
    kv: String(ITEM_PLAN.kv || "q8_0"),
    batch: Number(ITEM.servidor?.batch) || 512,
    ubatch: Number(ITEM.servidor?.ubatch) || 256,
    vision: ITEM_PLAN.vision !== false && Boolean(ITEM.vision?.archivo),
    mmprojCPU: ITEM_PLAN.mmprojCPU === true,
    coderOutputTokens: 4096,
    thinkingTokens: 2048,
  };
}
if (arg("presets", "") === "") {
  // Con --model se mide el plan AUTO de ESE modelo; el default histórico sigue
  // siendo la lista de 5 presets para Ornith.
  if (process.argv.includes("--model")) presets.length = 0, presets.push("AUTO");
}

const binCands = [
  path.join(PROJECT, ".local", "opt", "bonsai-inference", "build-RTX4060-Opt-sm89", "bin", "llama-server.exe"),
  path.join(process.env.USERPROFILE || "", ".local", "opt", "bonsai-inference", "build-RTX4060-Opt-sm89", "bin", "llama-server.exe"),
];
let BIN = path.join(PROJECT, "bin", "llama-server.exe");
for (const c of binCands) if (fs.existsSync(c)) { BIN = c; break; }

const MODEL = path.join(PROJECT, "models", ITEM.archivo);
const MMPROJ = ITEM.vision?.archivo ? path.join(PROJECT, "models", ITEM.vision.archivo) : "";
const TEMPLATE = path.join(PROJECT, "logs", `chat_template_bench_${PORT}.jinja`);
if (ITEM.chat_template) fs.writeFileSync(TEMPLATE, ITEM.chat_template, "utf8");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------------
// Construccion de servidor por preset (misma logica que el lanzador)
// --------------------------------------------------------------------------
function buildArgs(preset) {
  const p = PRESETS[preset];
  if (!p) throw new Error(`Preset desconocido: ${preset}`);
  const ctx = Number(p.context);
  const kv = String(p.kv);
  const stable = true;
  const a = ["-m", MODEL, "--gpu-layers", "99"];
  if (!stable) a.push("--fit", "off", "--kv-offload");
  a.push("--flash-attn", "on", "-c", String(ctx), "-ctk", kv, "-ctv", kv);
  if (!stable) a.push("-np", "1");
  a.push("-b", String(p.batch || 512), "-ub", String(p.ubatch || 256), "-t", "4");
  a.push("--host", "127.0.0.1", "--port", String(PORT), "--jinja", "--metrics", "-lv", "2");
  if (!stable) a.push("--cache-ram", "0");
  a.push("--cors-origins", `http://127.0.0.1:${PORT},http://localhost:${PORT}`);
  a.push("--temp", "0.6", "--top-p", "0.95", "--top-k", "20", "--min-p", "0", "--presence-penalty", "0", "--repeat-penalty", "1");
  a.push("--spec-type", "none", "--no-context-shift");
  if (stable) a.push("--ctx-checkpoints", "0");
  a.push("--chat-template-file", TEMPLATE);
  if (p.vision && MMPROJ) {
    a.push("--mmproj", MMPROJ);
    if (p.mmprojCPU) a.push("--no-mmproj-offload");
    else a.push("--mmproj-offload", "--mmproj-device", "CUDA0");
    a.push("--image-max-tokens", "512");
  }
  if (THINK > 0 && ITEM.pensar?.compatible !== false) a.push("--reasoning-budget", String(THINK), "--reasoning-format", "deepseek");
  return a;
}

async function startServer(preset) {
  const outFd = fs.openSync(path.join(PROJECT, "logs", `bench-${preset}.out.log`), "w");
  const errFd = fs.openSync(path.join(PROJECT, "logs", `bench-${preset}.err.log`), "w");
  const ci = spawn(BIN, buildArgs(preset), { cwd: PROJECT, stdio: ["ignore", outFd, errFd], windowsHide: true });
  let exited = false;
  ci.on("exit", () => { exited = true; });
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (exited) return { ci, ok: false, reason: "proceso termino al arrancar" };
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        const props = await (await fetch(`http://127.0.0.1:${PORT}/props`, { signal: AbortSignal.timeout(3000) })).json();
        const nCtx = props?.default_generation_settings?.n_ctx || props?.n_ctx || 0;
        return { ci, ok: true, nCtx };
      }
    } catch { /* aun cargando */ }
    await sleep(1000);
  }
  try { ci.kill("SIGKILL"); } catch { /* ya */ }
  return { ci, ok: false, reason: "timeout de arranque" };
}

async function stopServer(ci) {
  if (!ci) return;
  try { ci.kill("SIGKILL"); } catch { /* ya */ }
  await sleep(1500);
}

// --------------------------------------------------------------------------
// Tareas + comprobadores
// --------------------------------------------------------------------------
function extractCode(text) {
  const m = String(text || "").match(/```(?:js|javascript)?\s*\n([\s\S]*?)```/i);
  return (m ? m[1] : String(text || "")).trim();
}
function extractJson(text) {
  const s = String(text || "");
  const start = s.search(/[\[{]/);
  if (start < 0) return null;
  for (let end = s.length; end > start; end--) {
    const frag = s.slice(start, end);
    try { return JSON.parse(frag); } catch { /* sigue */ }
  }
  return null;
}
function runJs(code) {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(`${code}\n;this.__out = {
    chunk: typeof chunk!=="undefined"?chunk:undefined,
    isBalanced: typeof isBalanced!=="undefined"?isBalanced:undefined,
    fixed: typeof fixed!=="undefined"?fixed:undefined,
    search: typeof search!=="undefined"?search:undefined,
    evaluate: typeof evaluate!=="undefined"?evaluate:undefined,
    LRUCache: typeof LRUCache!=="undefined"?LRUCache:undefined,
    mergeSorted: typeof mergeSorted!=="undefined"?mergeSorted:undefined,
    merge: typeof merge!=="undefined"?merge:undefined
  };`, sandbox, { timeout: 1500 });
  return sandbox.__out || {};
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const RETRIEVAL_NEEDLE = "QX-7419";
function retrievalPrompt() {
  // ~5-6k tokens of deterministic filler with one needle in the middle.
  const base = "La gestion documental exige orden, trazabilidad y revisiones periodicas de cada expediente. ";
  const parts = [];
  for (let i = 0; i < 260; i++) parts.push(base);
  const mid = Math.floor(parts.length / 2);
  parts.splice(mid, 0, `Nota interna critica: el codigo de acceso del almacen es ${RETRIEVAL_NEEDLE}. `);
  return `Lee el siguiente texto y responde SOLO con el codigo de acceso del almacen.\n\n${parts.join("")}\n\nCodigo de acceso:`;
}
const NEEDLE_A = "QX-7419";
const NEEDLE_B = "ZK-2288";
function retrievalTwoPrompt() {
  const base = "El archivo historico conserva cada acta, sello y anexo con su fecha de registro. ";
  const parts = [];
  for (let i = 0; i < 300; i++) parts.push(base);
  parts.splice(Math.floor(parts.length / 3), 0, `Primer codigo de seguridad: ${NEEDLE_A}. `);
  parts.splice(Math.floor((parts.length * 2) / 3), 0, `Segundo codigo de seguridad: ${NEEDLE_B}. `);
  return `Lee el texto y responde SOLO los dos codigos de seguridad, separados por una coma, en el orden en que aparecen.\n\n${parts.join("")}\n\nCodigos:`;
}

const TASKS = [
  {
    id: "coding_impl_chunk", category: "coding", weight: 1,
    prompt: "Escribe SOLO un bloque ```js con la funcion `chunk(arr, n)` que divida el array en subarrays de longitud n (el ultimo puede ser menor). No escribas ejemplos, pruebas ni explicaciones fuera del bloque.",
    check: async (content) => {
      const out = runJs(extractCode(content));
      if (typeof out.chunk !== "function") return { ok: false, detail: "no se encontro chunk()" };
      const t = [
        [eq(out.chunk([1,2,3,4,5],2), [[1,2],[3,4],[5]]), "chunk([1..5],2)"],
        [eq(out.chunk([],3), []), "chunk([],3)"],
        [eq(out.chunk([1],2), [[1]]), "chunk([1],2)"],
      ];
      const bad = t.find(([ok]) => !ok);
      return { ok: !bad, detail: bad ? bad[1] : "3/3 tests" };
    },
  },
  {
    id: "coding_impl_balanced", category: "coding", weight: 1,
    prompt: "Escribe SOLO un bloque ```js con la funcion `isBalanced(s)` que devuelve true si los parentesis, corchetes y llaves de la cadena estan correctamente balanceados, y false si no. No incluyas ejemplos ni explicaciones.",
    check: async (content) => {
      const out = runJs(extractCode(content));
      if (typeof out.isBalanced !== "function") return { ok: false, detail: "no se encontro isBalanced()" };
      const cases = [["([]{})", true], ["([)]", false], ["(((", false], ["", true], ["a(b[c]{d})", true], [")(", false]];
      const bad = cases.find(([s, exp]) => out.isBalanced(s) !== exp);
      return { ok: !bad, detail: bad ? `fallo con ${JSON.stringify(bad[0])}` : "6/6 tests" };
    },
  },
  {
    id: "coding_debug_bsearch", category: "coding", weight: 1,
    prompt: `Corrige el bug de esta funcion y devuelve SOLO un bloque \`\`\`js con la funcion corregida llamada search(arr, target) (indice o -1). El array esta ordenado.\n\nfunction search(arr, target) {\n  let lo = 0, hi = arr.length;\n  while (lo < hi) {\n    const mid = (lo + hi) >> 1;\n    if (arr[mid] === target) return mid;\n    if (arr[mid] < target) lo = mid; else hi = mid;\n  }\n  return -1;\n}\n`,
    check: async (content) => {
      const out = runJs(extractCode(content));
      if (typeof out.search !== "function") return { ok: false, detail: "no se encontro search()" };
      const arr = [1,3,5,7,9,11,13];
      const bad = [[3,1],[13,6],[1,0],[8,-1],[0,-1]].find(([t,e]) => out.search(arr,t) !== e);
      return { ok: !bad, detail: bad ? `fallo target=${bad[0]}` : "5/5 tests" };
    },
  },
  {
    id: "coding_trace", category: "coding", weight: 1,
    prompt: "Que imprime este codigo JavaScript? Responde SOLO el resultado exacto, sin comillas ni explicacion.\n\nconst a = [1,2,3];\nconst b = a.map((x,i)=> x*i).filter(Boolean);\nconsole.log(b.join('-'));",
    check: async (content) => {
      const c = String(content).replace(/[`"']/g, "").trim();
      return { ok: /\b2-6\b/.test(c), detail: `respuesta=${c.slice(0,40)}` };
    },
  },
  {
    id: "reasoning_math_train", category: "reasoning", weight: 1,
    prompt: "Un tren sale a las 09:00 a 60 km/h. Otro sale a las 10:00 del mismo punto a 90 km/h en la misma direccion. A que hora alcanza el segundo al primero? Responde SOLO con la hora en formato HH:MM.",
    check: async (content) => ({ ok: /\b12:00\b/.test(String(content)), detail: String(content).slice(0,40) }),
  },
  {
    id: "reasoning_math_prob", category: "reasoning", weight: 1,
    prompt: "En una bolsa hay 3 bolas rojas y 2 azules. Se sacan 2 sin reemplazo. Cual es la probabilidad de que ambas sean rojas? Responde SOLO como fraccion irreducible, por ejemplo 3/10.",
    check: async (content) => ({ ok: /\b3\/10\b/.test(String(content)), detail: String(content).slice(0,40) }),
  },
  {
    id: "logic_boxes", category: "reasoning", weight: 1,
    prompt: "Tres cajas estan mal etiquetadas: una dice 'Manzanas', otra 'Naranjas', otra 'Mezcla'. Todas las etiquetas son incorrectas. Sacas UNA fruta de la caja etiquetada 'Mezcla' y resulta ser una manzana. De que caja puedes deducir el contenido con certeza, y que contiene esa caja? Responde SOLO en el formato: <etiqueta>=<contenido>",
    check: async (content) => {
      const c = String(content).toLowerCase();
      return { ok: /<?\s*mezcla\s*>?\s*=?\s*manzanas/.test(c), detail: String(content).slice(0,60) };
    },
  },
  {
    id: "data_sql_result", category: "data", weight: 1,
    prompt: "Tabla ventas (ciudad TEXT, importe INTEGER): ('Madrid',100),('Barcelona',250),('Madrid',50),('Valencia',300),('Barcelona',25). Cual es el importe total por ciudad, solo ciudades con total > 150, ordenado de mayor a menor? Responde SOLO un array JSON de objetos [{\"ciudad\":...,\"total\":...}].",
    check: async (content) => {
      const j = extractJson(content);
      const exp = [{ ciudad: "Valencia", total: 300 }, { ciudad: "Barcelona", total: 275 }];
      return { ok: Array.isArray(j) && eq(j, exp), detail: JSON.stringify(j).slice(0,80) };
    },
  },
  {
    id: "instruction_json", category: "instruction", weight: 1,
    prompt: "Extrae los datos y responde SOLO JSON valido con las claves exactas name (string), age (number), skills (array de strings): 'Ana Ruiz tiene 34 anos y domina Python, Kubernetes y SQL.'",
    check: async (content) => {
      const j = extractJson(content);
      const ok = j && j.name === "Ana Ruiz" && Number(j.age) === 34 && Array.isArray(j.skills) && j.skills.length === 3 &&
        ["python", "kubernetes", "sql"].every((s) => j.skills.map((x) => String(x).toLowerCase()).includes(s));
      return { ok: Boolean(ok), detail: JSON.stringify(j).slice(0,100) };
    },
  },
  {
    id: "text_transform_reverse", category: "text", weight: 1,
    prompt: "Invierte el orden de las palabras de esta frase y conserva la puntuacion exactamente: 'El gato duerme, pero el perro ladra.' Responde SOLO la frase transformada.",
    check: async (content) => {
      const c = String(content).replace(/[`"']/g, "").replace(/\s+/g, " ").trim();
      const expected = "ladra. perro el pero duerme, gato El";
      const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
      return { ok: norm(c) === norm(expected), detail: c.slice(0, 80) };
    },
  },
  {
    id: "retrieval_needle", category: "retrieval", weight: 1,
    prompt: retrievalPrompt(),
    check: async (content) => ({ ok: String(content).includes(RETRIEVAL_NEEDLE), detail: String(content).slice(0,40) }),
  },
  {
    id: "spanish_entities", category: "spanish", weight: 1,
    prompt: "Del texto: 'Marta Lopez, directora de Acme Iberia en Sevilla, confirmo el acuerdo con el proveedor Nexo SL de Valencia.' Responde SOLO JSON con {persona, empresa, ciudad}.",
    check: async (content) => {
      const j = extractJson(content);
      const ok = j && /marta lopez/i.test(String(j.persona)) && /acme/i.test(String(j.empresa)) && /sevilla/i.test(String(j.ciudad));
      return { ok: Boolean(ok), detail: JSON.stringify(j).slice(0,100) };
    },
  },
  {
    id: "coding_hard_calc", category: "coding", weight: 1,
    prompt: "Escribe SOLO un bloque ```js con la funcion evaluate(expr) que evalue una expresion aritmetica con + - * / y parentesis respetando precedencia. NO uses eval ni new Function. Debe cumplir evaluate('2+3*4') === 14.",
    check: async (content) => {
      const out = runJs(extractCode(content));
      if (typeof out.evaluate !== "function") return { ok: false, detail: "no se encontro evaluate()" };
      const cases = [["2+3*4", 14], ["(2+3)*4", 20], ["10/2-3", 2], ["2*(3+(4-1))", 12], ["8/2/2", 2]];
      const bad = cases.find(([e, exp]) => Math.abs(Number(out.evaluate(e)) - exp) > 1e-9);
      return { ok: !bad, detail: bad ? `fallo ${bad[0]}` : "5/5 tests" };
    },
  },
  {
    id: "coding_hard_lru", category: "coding", weight: 1,
    prompt: "Escribe SOLO un bloque ```js con la clase LRUCache: constructor(capacity), get(key) y put(key, value). get devuelve -1 si no existe. Expulsa el menos usado al superar la capacidad.",
    check: async (content) => {
      const out = runJs(extractCode(content));
      if (typeof out.LRUCache !== "function") return { ok: false, detail: "no se encontro LRUCache" };
      try {
        const c = new out.LRUCache(2);
        c.put(1, 1); c.put(2, 2);
        const g1 = c.get(1);
        c.put(3, 3);
        const g2 = c.get(2);
        c.put(4, 4);
        const g1b = c.get(1);
        const g3 = c.get(3);
        const g4 = c.get(4);
        const ok = g1 === 1 && g2 === -1 && g1b === -1 && g3 === 3 && g4 === 4;
        return { ok, detail: `g1=${g1} g2=${g2} g1b=${g1b} g3=${g3} g4=${g4}` };
      } catch (err) { return { ok: false, detail: String(err.message).slice(0, 60) }; }
    },
  },
  {
    id: "reasoning_multi_rates", category: "reasoning", weight: 1,
    prompt: "Un deposito se llena con la bomba A en 6 horas y con la bomba B en 4 horas. Un desague lo vacia en 12 horas. Si se abren A, B y el desague a la vez, cuanto tarda en llenarse? Responde SOLO el numero de horas.",
    check: async (content) => ({ ok: /(^|\D)3(\D|$)/.test(String(content)), detail: String(content).slice(0, 40) }),
  },
  {
    id: "retrieval_two_needles", category: "retrieval", weight: 1,
    prompt: retrievalTwoPrompt(),
    check: async (content) => {
      const c = String(content);
      const a = c.indexOf(NEEDLE_A), b = c.indexOf(NEEDLE_B);
      return { ok: a >= 0 && b >= 0 && a < b, detail: c.slice(0, 60) };
    },
  },
  {
    id: "instruction_nested", category: "instruction", weight: 1,
    prompt: "Del texto: 'El pedido 778 de Ana contiene 2 unidades de Teclado a 25 EUR y 1 de Raton a 10 EUR.' Devuelve SOLO JSON con {pedido:number, cliente:string, items:[{producto:string,cantidad:number,precio:number}], total:number}.",
    check: async (content) => {
      const j = extractJson(content);
      const items = Array.isArray(j?.items) ? j.items : [];
      const teclado = items.find((it) => /teclado/i.test(String(it.producto)));
      const raton = items.find((it) => /raton|ratón/i.test(String(it.producto)));
      const ok = j && Number(j.pedido) === 778 && /ana/i.test(String(j.cliente)) &&
        items.length === 2 && teclado && Number(teclado.cantidad) === 2 && Number(teclado.precio) === 25 &&
        raton && Number(raton.cantidad) === 1 && Number(raton.precio) === 10 && Number(j.total) === 60;
      return { ok: Boolean(ok), detail: JSON.stringify(j).slice(0, 120) };
    },
  },
  {
    id: "tool_call_convert", category: "tools", weight: 1,
    prompt: "Convierte 250 USD a EUR usando la herramienta. Responde llamando a la funcion.",
    tools: [{
      type: "function",
      function: {
        name: "convertir_moneda",
        description: "Convierte un monto entre monedas",
        parameters: { type: "object", properties: { monto: { type: "number" }, de: { type: "string" }, a: { type: "string" } }, required: ["monto", "de", "a"] },
      },
    }],
    check: async (content, raw) => {
      const msg = raw?.choices?.[0]?.message;
      const calls = msg?.tool_calls || [];
      let call = calls.find((c) => c?.function?.name === "convertir_moneda");
      let formato = "nativo";
      if (!call) {
        // Modelos como Qwen2.5 Coder escriben la llamada en texto.
        const dialecto = dialectoDe(MODEL_KEY, MODELO.catalogo);
        const crudas = llamadasCrudas(content, dialecto);
        const texto = crudas.find((c) => /convertir_moneda/i.test(c.name));
        if (texto) {
          call = { function: { name: texto.name, arguments: JSON.stringify(texto.arguments) } };
          formato = "texto";
        }
      }
      if (!call) return { ok: false, detail: "sin tool_call" };
      let argsObj = {};
      try { argsObj = JSON.parse(call.function.arguments || "{}"); } catch { /* invalido */ }
      const ok = Number(argsObj.monto) === 250 && /usd/i.test(String(argsObj.de)) && /eur/i.test(String(argsObj.a));
      return { ok, detail: `${formato}: ${JSON.stringify(argsObj).slice(0, 100)}` };
    },
  },
];

// --------------------------------------------------------------------------
// Ejecucion
// --------------------------------------------------------------------------
const ACTIVE_TASKS = onlyTasks.length ? TASKS.filter((t) => onlyTasks.includes(t.id)) : TASKS;

async function ask(task, sampling = ACTIVE_SAMPLING) {
  const body = {
    model: "local",
    messages: [
      { role: "system", content: "Eres un asistente tecnico preciso. Sigue exactamente el formato pedido y no anadas texto extra." },
      { role: "user", content: task.prompt },
    ],
    temperature: sampling.temperature,
    top_p: sampling.top_p,
    top_k: sampling.top_k,
    min_p: sampling.min_p,
    presence_penalty: sampling.presence_penalty ?? 0,
    repeat_penalty: sampling.repeat_penalty ?? 1,
    max_tokens: MAX_TOKENS,
    reasoning_budget: sampling.reasoning_budget ?? THINK,
  };
  if (task.tools) { body.tools = task.tools; body.tool_choice = "auto"; }
  const t0 = Date.now();
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
  });
  const ms = Date.now() - t0;
  if (!res.ok) return { ok: false, detail: `HTTP ${res.status}`, ms, raw: null, content: "" };
  const raw = await res.json();
  const msg = raw?.choices?.[0]?.message || {};
  const content = String(msg.content || "");
  const tps = raw?.timings?.predicted_per_second || 0;
  return { raw, content, ms, tps, reasoning: String(msg.reasoning_content || "") };
}

async function runTaskOnce(label, task, rep) {
  let r;
  try {
    const base = await ask(task);
    if (!base.raw) {
      r = { id: task.id, category: task.category, ok: false, detail: base.detail, ms: base.ms, tps: 0, rep };
    } else {
      const verdict = await task.check(base.content, base.raw);
      r = { id: task.id, category: task.category, ok: Boolean(verdict.ok), detail: verdict.detail, ms: base.ms, tps: base.tps,
            empty: base.content.trim().length === 0, rep,
            finish: base.raw?.choices?.[0]?.finish_reason || "",
            preview: base.content.slice(0, 160) };
      if (!verdict.ok && process.env.BENCH_DEBUG) {
        process.stdout.write(`\n--- DEBUG ${task.id} content ---\n${base.content}\n--- END ---\n`);
      }
    }
  } catch (err) {
    r = { id: task.id, category: task.category, ok: false, detail: String(err?.message || err).slice(0, 80), ms: 0, tps: 0, rep };
  }
  const tag = REPS > 1 ? ` [${rep}/${REPS}]` : "";
  process.stdout.write(`  ${label} ${task.id}${tag}: ${r.ok ? "OK" : "FAIL"} (${r.detail})\n`);
  return r;
}

async function runPreset(preset) {
  const started = Date.now();
  const srv = await startServer(preset);
  if (!srv.ok) {
    return { preset, started: false, reason: srv.reason, nCtx: 0, tasks: [], ms: Date.now() - started };
  }
  const results = [];
  for (const task of ACTIVE_TASKS) {
    for (let rep = 1; rep <= REPS; rep++) results.push(await runTaskOnce(preset, task, rep));
  }
  await stopServer(srv.ci);
  return { preset, started: true, nCtx: srv.nCtx, kv: PRESETS[preset].kv, ctx: PRESETS[preset].context, tasks: results, ms: Date.now() - started };
}

/**
 * Modo --sampling: un solo servidor, una fila por configuracion de muestreo.
 * Las tareas y el comprobador son los mismos; solo cambia el muestreo por peticion.
 */
async function runSamplingMatrix(preset) {
  const started = Date.now();
  const srv = await startServer(preset);
  if (!srv.ok) return [{ preset: `${preset} (no arranco)`, started: false, reason: srv.reason, nCtx: 0, tasks: [], ms: Date.now() - started }];
  const rows = [];
  const base = { reasoning_budget: THINK, presence_penalty: PP, repeat_penalty: RP };
  for (const cfg of ACTIVE_CONFIGS) {
    ACTIVE_SAMPLING = { ...base, ...cfg };
    const t0 = Date.now();
    const results = [];
    console.log(`\n-- muestreo: ${cfg.name} (temp=${cfg.temperature} top_p=${cfg.top_p} top_k=${cfg.top_k} min_p=${cfg.min_p})`);
    for (const task of ACTIVE_TASKS) {
      for (let rep = 1; rep <= REPS; rep++) results.push(await runTaskOnce(cfg.name, task, rep));
    }
    rows.push({ preset: cfg.name, started: true, nCtx: srv.nCtx, kv: PRESETS[preset].kv, ctx: PRESETS[preset].context,
                tasks: results, ms: Date.now() - t0, sampling: { ...cfg } });
  }
  ACTIVE_SAMPLING = BASE_SAMPLING;
  await stopServer(srv.ci);
  return rows;
}

// --------------------------------------------------------------------------
// Graficos SVG
// --------------------------------------------------------------------------
const PALETTE = ["#cde86e", "#82b8d0", "#e8c06a", "#ea9a89", "#a9c4dc", "#b9cfa5"];
function svgBar(presetRows, categories) {
  const W = 860, rowH = 34, top = 96, left = 230, chartW = 540;
  const H = top + presetRows.length * rowH + 60;
  const lines = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, system-ui, sans-serif">`);
  lines.push(`<rect width="${W}" height="${H}" fill="#0d100b"/>`);
  lines.push(`<text x="24" y="34" fill="#e9eee0" font-size="18" font-weight="600">Model quality by preset — complex multi-field benchmark</text>`);
  lines.push(`<text x="24" y="54" fill="#8d9680" font-size="12">Bonsai IDE · Ornith 1.5 9B · deterministic checks · higher is better</text>`);
  // labels
  presetRows.forEach((row, i) => {
    const y = top + i * rowH;
    const score = row.score;
    lines.push(`<text x="24" y="${y + 18}" fill="#e9eee0" font-size="11">${row.preset}</text>`);
    lines.push(`<rect x="${left}" y="${y + 4}" width="${chartW}" height="18" rx="4" fill="#1a2014"/>`);
    const w = Math.max(0, Math.round(chartW * (score / 100)));
    lines.push(`<rect x="${left}" y="${y + 4}" width="${w}" height="18" rx="4" fill="${PALETTE[i % PALETTE.length]}"/>`);
    lines.push(`<text x="${left + chartW + 10}" y="${y + 18}" fill="#e9eee0" font-size="12" font-weight="700">${score.toFixed(1)}%</text>`);
    lines.push(`<text x="${left + 6}" y="${y + 18}" fill="#0d100b" font-size="10" font-weight="600">${row.passed}/${row.total}</text>`);
  });
  const cy = top + presetRows.length * rowH + 18;
  lines.push(`<text x="24" y="${cy}" fill="#8d9680" font-size="10">Categorias: ${categories.join(" · ")}</text>`);
  lines.push(`</svg>`);
  return lines.join("\n");
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------
async function main() {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const outDir = path.join(PROJECT, "reports", `${samplingMode ? "bench-sampling" : "bench-quality"}-${stamp}`);
  fs.mkdirSync(outDir, { recursive: true });
  const chartOut = arg("chart-out", "");
  const chartPath = chartOut
    ? (path.isAbsolute(chartOut) ? chartOut : path.join(PROJECT, chartOut))
    : path.join(PROJECT, "docs", "graficos", samplingMode ? "bench-sampling.svg" : "bench-quality.svg");

  // Modo solo-grafica: reconstruye el SVG desde un results.json existente sin
  // arrancar el servidor (util tras una pasada parcial de varianza).
  const chartFrom = arg("chart-from", "");
  if (chartFrom) {
    const data = JSON.parse(fs.readFileSync(chartFrom, "utf8"));
    const cats = [...new Set((data.tasks || []).map((t) => t.category))];
    const rows = (data.presets || []).map((p) => ({ preset: p.preset, score: p.score, passed: p.passed, total: p.total }));
    fs.mkdirSync(path.dirname(chartPath), { recursive: true });
    fs.writeFileSync(chartPath, svgBar(rows, cats), "utf8");
    console.log(`Grafica regenerada desde ${chartFrom} -> ${chartPath}`);
    return;
  }

  console.log(`BIN=${BIN}`);
  console.log(`presets=${presets.join(", ")} tasks=${ACTIVE_TASKS.length} think=${THINK} max_tokens=${MAX_TOKENS}${samplingMode ? ` sampling=${ACTIVE_CONFIGS.length} configs` : ""}`);

  let rows = [];
  if (samplingMode) {
    const preset = arg("preset", "8GB-CODE-BALANCED");
    console.log(`\n=== matriz de muestreo sobre ${preset} (${ACTIVE_CONFIGS.length} configuraciones) ===`);
    rows = await runSamplingMatrix(preset);
  } else {
    for (const preset of presets) {
      console.log(`\n=== ${preset} ===`);
      const row = await runPreset(preset);
      rows.push(row);
      const passed = row.tasks.filter((t) => t.ok).length;
      console.log(`  -> ${passed}/${row.tasks.length} (${row.started ? "ok" : row.reason})`);
    }
  }

  const categories = [...new Set(ACTIVE_TASKS.map((t) => t.category))];
  const summary = rows.map((row) => {
    const total = row.tasks.length || ACTIVE_TASKS.length;
    const passed = row.tasks.filter((t) => t.ok).length;
    const byCat = {};
    for (const c of categories) {
      const ts = row.tasks.filter((t) => t.category === c);
      byCat[c] = ts.length ? ts.filter((t) => t.ok).length / ts.length : null;
    }
    const tps = row.tasks.map((t) => t.tps).filter((x) => x > 0);
    const avgTps = tps.length ? tps.reduce((a, b) => a + b, 0) / tps.length : 0;
    return { preset: row.preset, started: row.started, reason: row.reason, nCtx: row.nCtx, kv: row.kv, ctx: row.ctx,
             passed, total, score: total ? (passed / total) * 100 : 0, byCat, avgTps, seconds: Math.round(row.ms / 1000) };
  });

  // JSON
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify({ stamp, model: MODEL_KEY, modelName: ITEM.nombre, think: THINK, maxTokens: MAX_TOKENS, tasks: ACTIVE_TASKS.map((t) => ({ id: t.id, category: t.category })), presets: summary, raw: rows }, null, 2), "utf8");

  // Markdown
  const md = [];
  md.push(`# ${samplingMode ? "Benchmark de muestreo" : "Benchmark de calidad por preset"} - ${stamp}`);
  md.push(`\nTareas: **${ACTIVE_TASKS.length}** · pensamiento ${THINK} · max_tokens ${MAX_TOKENS} · repeticiones ${REPS}${samplingMode ? ` · ${ACTIVE_CONFIGS.length} configuraciones` : ` · temperatura ${TEMP}`}`);
  md.push(`\n## Resultado global\n`);
  md.push(`| ${samplingMode ? "Config" : "Preset"} | KV | Ctx | Puntos | % | Gen t/s | Tiempo |`);
  md.push(`|---|---|---:|---:|---:|---:|---:|`);
  for (const s of summary) {
    md.push(`| ${s.preset} | ${s.kv || "-"} | ${s.ctx || "-"} | ${s.passed}/${s.total} | ${s.score.toFixed(1)}% | ${s.avgTps.toFixed(1)} | ${s.seconds}s |`);
  }
  if (samplingMode) {
    md.push(`\n### Parametros por configuracion\n`);
    md.push(`| Config | temp | top_p | top_k | min_p |`);
    md.push(`|---|---:|---:|---:|---:|`);
    for (const c of ACTIVE_CONFIGS) md.push(`| ${c.name} | ${c.temperature} | ${c.top_p} | ${c.top_k} | ${c.min_p} |`);
  }
  md.push(`\n## Por categoria\n`);
  md.push(`| ${samplingMode ? "Config" : "Preset"} | ${categories.join(" | ")} |`);
  md.push(`|---|${categories.map(() => "---:").join("|")}|`);
  for (const s of summary) {
    md.push(`| ${s.preset} | ${categories.map((c) => s.byCat[c] === null ? "-" : (s.byCat[c] * 100).toFixed(0) + "%").join(" | ")} |`);
  }
  md.push(`\n## Detalle por tarea\n`);
  for (const row of rows) {
    md.push(`\n### ${row.preset}${row.started ? "" : ` (no arranco: ${row.reason})`}\n`);
    md.push(`| Tarea | Categoria | OK | Detalle | ms | t/s |`);
    md.push(`|---|---|:--:|---|---:|---:|`);
    for (const t of row.tasks) md.push(`| ${t.id} | ${t.category} | ${t.ok ? "✅" : "❌"} | ${String(t.detail).replace(/\|/g, "\\|")} | ${t.ms} | ${t.tps ? t.tps.toFixed(1) : "-"} |`);
  }
  fs.writeFileSync(path.join(outDir, "results.md"), md.join("\n"), "utf8");

  // El registro del Hub guarda un resumen para que la UI no tenga que leer
  // reports/. No pisa las pruebas de arranque/vision de model-lab.
  try {
    const registro = leerRegistro();
    const entrada = registro.modelos[MODEL_KEY];
    if (entrada) {
      const total = summary.reduce((n, s) => n + s.total, 0);
      const pasadas = summary.reduce((n, s) => n + s.passed, 0);
      entrada.pruebas = {
        ...(entrada.pruebas || {}),
        calidad: {
          fecha: new Date().toISOString(),
          tareas: ACTIVE_TASKS.length,
          pasadas,
          total,
          porcentaje: total ? Math.round((pasadas / total) * 1000) / 10 : 0,
          detalle: summary.map((s) => `${s.preset}: ${s.passed}/${s.total}`),
          informe: path.join(outDir, "results.md"),
        },
      };
      guardarRegistro(registro);
    }
  } catch (error) {
    console.error(`No se pudo anotar la calidad en el registro: ${error instanceof Error ? error.message : String(error)}`);
  }

  // SVG
  // SVG
  fs.mkdirSync(path.dirname(chartPath), { recursive: true });
  fs.writeFileSync(chartPath, svgBar(summary.map((s) => ({ preset: s.preset, score: s.score, passed: s.passed, total: s.total })), categories), "utf8");

  console.log(`\nListo:\n  ${path.join(outDir, "results.md")}\n  ${path.join(outDir, "results.json")}\n  ${chartPath}`);
  console.log("\n" + summary.map((s) => `${s.preset}: ${s.passed}/${s.total} (${s.score.toFixed(1)}%)`).join("\n"));
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
