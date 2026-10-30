/** Contract tests with real filesystem/parsers/commands and a small simulated model. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CodeContext, parseCode } from "./code-context.mjs";
import {
  CoderTask,
  CODER_CONFIG,
  CODER_TOOLS,
  validateCall,
  compactFailure,
  runCheck,
} from "./coder-harness.mjs";
import { BonsaiChat, metadatosSesion } from "./bonsai-chat.mjs";
import {
  prepararCoder,
  validarCoder,
  CODER_TAREAS,
} from "./evaluar/coder-tareas.mjs";
import { leerSSE } from "./sse.mjs";
import { estimateTokens } from "./context.mjs";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-small-coder-")),
  root = path.join(temp, "project");
fs.mkdirSync(root);
const write = (rel, text) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
};
let ui, model, sitio;
try {
  write(
    "src/a.mjs",
    "// function ghost() {}\nexport function real(x) {\n return x + 1;\n}\n",
  );
  write(
    "src/b.mjs",
    "import {real} from './a.mjs';\nexport const wrapped = x => real(x);\n",
  );
  write(
    "test/b.test.mjs",
    "import assert from 'node:assert/strict';\nimport {wrapped} from '../src/b.mjs';\nassert.equal(wrapped(1),2);\n",
  );
  write("node_modules/hidden.mjs", "export function secret() {}");
  const ast = await parseCode(
    "src/a.mjs",
    fs.readFileSync(path.join(root, "src/a.mjs"), "utf8"),
  );
  assert.equal(ast.parser, "tree-sitter");
  assert.ok(ast.symbols.some((s) => s.nombre === "real" && s.endLine === 4));
  assert.ok(!ast.symbols.some((s) => s.nombre === "ghost"));
  const arrow = await parseCode(
    "arrow.mjs",
    'export const compact = () => "implementation-must-not-be-in-map";\n',
  );
  assert.ok(
    !arrow.symbols[0].signature.includes("implementation-must-not-be-in-map"),
  );
  const py = await parseCode(
    "a.py",
    "def greet(name: str) -> str:\n    return name\n",
  );
  assert.equal(py.symbols[0].nombre, "greet");
  const ts = await parseCode(
    "a.ts",
    "export interface User { name: string }\nexport function get(u: User): string { return u.name; }",
  );
  assert.equal(ts.parser, "tree-sitter");
  assert.ok(ts.symbols.some((s) => s.nombre === "User"));
  const c = await new CodeContext(root, CODER_CONFIG).refresh();
  assert.ok(!c.entries.has("node_modules/hidden.mjs"));
  assert.deepEqual(c.entries.get("src/b.mjs").dependencies, ["src/a.mjs"]);
  assert.deepEqual(c.affectedTests(["src/a.mjs"]), ["test/b.test.mjs"]);
  assert.ok(c.map("real", {}, 100).length <= 300);
  assert.match(
    c.read({ ruta: "src/a.mjs", simbolo: "real" }),
    /2\| export function real/,
  );
  assert.match(c.search("wrapped", { symbol: true }), /src\/b.mjs:2/);
  write(
    "src/overloads.mjs",
    "class First { repeated() { return 1; } }\nclass Second { repeated() { return 2; } }\n",
  );
  await c.refresh();
  assert.equal(
    c.entries
      .get("src/overloads.mjs")
      .symbols.filter((s) => s.nombre === "repeated").length,
    2,
  );
  assert.match(c.snippets("repeated", {}, 600), /class First/);
  assert.throws(
    () => c.read({ ruta: "src/overloads.mjs", simbolo: "repeated" }),
    /2 definiciones/,
  );
  assert.throws(() => c.read({ ruta: "../outside" }), /fuera/);
  const outside = path.join(temp, "outside");
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "private.mjs"), "PRIVATE");
  fs.symlinkSync(
    outside,
    path.join(root, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => c.read({ ruta: "linked/private.mjs" }), /fuera/);
  await c.refresh();
  assert.ok(![...c.entries.keys()].some((k) => k.includes("private")));
  write("src/a.mjs", "export function renamed() {}\n");
  await c.refresh();
  assert.match(c.search("renamed", { symbol: true }), /renamed/);
  assert.ok(!c.search("real", { symbol: true }).includes("function real"));
  assert.equal(
    validateCall({ name: "leer", arguments: '{"ruta":"a","desde":"1"}' }).ok,
    false,
  );
  assert.equal(
    validateCall({ name: "reemplazar", arguments: '{"ruta":"a","buscar":"a"}' })
      .ok,
    false,
  );
  assert.equal(
    validateCall({ name: "leer", arguments: '{"ruta":"a","unexpected":1}' }).ok,
    false,
  );
  assert.equal(
    validateCall({ name: "leer", arguments: '{"ruta":"a"' }).ok,
    false,
  );
  assert.equal(validateCall({ name: "leer", arguments: '```json\n{"ruta":"a"}\n```' }).ok, true);
  assert.ok(CODER_TOOLS.some(t => t.function.name === "escribir_partes"));
  const cancelled = new AbortController();
  cancelled.abort();
  assert.equal(
    (
      await runCheck(
        process.execPath,
        ["-e", 'throw new Error("must not run")'],
        { cwd: root, signal: cancelled.signal },
      )
    ).code,
    -1,
  );
  assert.equal(
    (
      await runCheck(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        cwd: root,
        timeout: 100,
      })
    ).timedOut,
    true,
  );
  // Parent .gitignore rules must not turn an explicitly selected workspace into
  // an empty index (the evaluation workspaces exercise exactly this case).
  const parentRepo = path.join(temp, "parent-repo");
  fs.mkdirSync(parentRepo);
  spawnSync("git", ["init", "--quiet", parentRepo], { windowsHide: true });
  fs.writeFileSync(path.join(parentRepo, ".gitignore"), "selected/\n");
  const selected = path.join(parentRepo, "selected");
  fs.mkdirSync(selected);
  fs.writeFileSync(
    path.join(selected, "code.mjs"),
    "export const value = 1;\n",
  );
  assert.ok(
    (await new CodeContext(selected, CODER_CONFIG).refresh()).entries.has(
      "code.mjs",
    ),
  );
  if (process.platform === "win32") {
    const script = fileURLToPath(
      new URL("../scripts/start-gpu-model.ps1", import.meta.url),
    );
    for (const [preset, ctx] of [
      ["8GB-SAFE", 4096],
      ["8GB-BALANCED", 8192],
      ["8GB-MAX-SPEED", 8192],
      ["8GB-CONTEXT", 16384],
      ["8GB-VISION", 16384],
      ["8GB-VISION-CONTEXT", 32768],
      ["8GB-VISION-QUALITY", 32768],
    ]) {
      const r = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          script,
          "-Modelo",
          "ornith9b",
          "-EnginePreset",
          preset,
          "-DryRun",
          "-FreeMiBOverride",
          "7956",
          "-Port",
          "8098",
        ],
        { encoding: "utf8", windowsHide: true },
      );
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp(`-c ${ctx} `));
      assert.match(r.stdout, /--no-context-shift/);
      if(preset.startsWith("8GB-VISION")) assert.match(r.stdout,/--mmproj .*--mmproj-offload/);
    }
    const r = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-Modelo",
        "ornith9b",
        "-EnginePreset",
        "8GB-BALANCED",
        "-DryRun",
        "-FreeMiBOverride",
        "6500",
        "-Port",
        "8098",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    assert.notEqual(r.status, 0, "must enforce safety margin");
  }

  const task = await new CoderTask({
    root,
    goal: "Corrige renamed en src/a.mjs",
    traceDir: path.join(temp, "traces"),
  }).start();
  assert.equal(
    task.accept([{ id: "bad", name: "reemplazar", arguments: "{}" }]).valid
      .length,
    0,
  );
  assert.equal(
    task.accept([{ id: "bad2", name: "reemplazar", arguments: "{}" }]).valid
      .length,
    0,
  );
  assert.equal(task.stopped, undefined, "permitir corrección de llamadas inválidas");
  for (let i = 0; i < 3; i++) task.accept([{ id: `bad${i + 3}`, name: "reemplazar", arguments: "{}" }]);
  assert.equal(task.stopped, "invalid_tool_limit");
  // Una repetición exacta se explica y se corta; un cambio real del proyecto la vuelve a permitir.
  const repetida = await new CoderTask({ root, goal: "Revisa src/a.mjs" }).start();
  const lectura = { id: "r", name: "leer", arguments: JSON.stringify({ ruta: "src/a.mjs" }) };
  for (let i = 0; i < 6; i++) assert.equal(repetida.accept([lectura]).valid.length, 1);
  const bloqueada = repetida.accept([lectura]);
  assert.equal(bloqueada.valid.length, 0);
  assert.match(bloqueada.errors[0].error, /Llamada idéntica a leer repetida 7 veces sin cambios en el proyecto.*cambia los argumentos/);
  assert.equal(repetida.steps, 7, "una llamada rechazada no debe ejecutarse pero sí contar como paso");
  write("src/a.mjs", "export function renamed() { return 2; }\n");
  await repetida.context.refresh();
  assert.equal(repetida.accept([lectura]).valid.length, 1, "tras cambiar el proyecto la lectura vuelve a ser válida");
  const task2 = await new CoderTask({
    root,
    goal: "Corrige renamed en src/a.mjs",
    config: { maxRepairs: 2 },
  }).start();
  write("src/a.mjs", "export function renamed( {\n");
  let verification = await task2.verify();
  assert.equal(verification.ok, false);
  assert.equal(task2.state.phase, "REPAIR");
  await task2.verify({ final: true });
  await task2.verify({ final: true });
  assert.equal(task2.state.phase,"REPAIR","exhausted repair attempts must retain the failure phase");
  assert.equal(task2.stopped, "repair_limit");
  // An edit that grows beyond the indexing budget must still be detected and parsed.
  const limited = await new CoderTask({
    root,
    goal: "Repair src/a.mjs",
    config: { maxFileBytes: 16 },
  }).start();
  write("src/a.mjs", "export function broken( {\n");
  assert.ok((await limited.changed()).includes("src/a.mjs"));
  assert.equal((await limited.verify()).ok, false);
  const fixture = path.join(temp, "fixture");
  prepararCoder(CODER_TAREAS[0], fixture);
  assert.equal(validarCoder(CODER_TAREAS[0], fixture).ok, false);
  const automatic = await new CoderTask({
    root: fixture,
    goal: "Corrige price",
  }).start();
  fs.writeFileSync(
    path.join(fixture, "src/price.mjs"),
    "export function discounted(price, percent) { return price * (1-percent/100); }\n",
  );
  verification = await automatic.verify();
  assert.equal(verification.ok, true);
  assert.equal(automatic.state.phase,"VERIFY","successful automatic checks must invite review/completion rather than another edit");
  assert.equal(automatic.state.tests.length, 1);
  assert.equal(automatic.state.tests[0].code, 0);
  assert.equal(validarCoder(CODER_TAREAS[0], fixture).ok, true);
  // Un HTML con JavaScript inline roto no puede pasar la verificación como si solo
  // fuera una cuestión de etiquetas; al corregirlo, la misma comprobación pasa.
  const htmlRoot = path.join(temp, "html-project");
  fs.mkdirSync(htmlRoot, { recursive: true });
  const htmlPath = path.join(htmlRoot, "index.html");
  fs.writeFileSync(htmlPath, "<!DOCTYPE html>\n<html><body>\n<script>function sumar(a, b) { return a + b; }</script>\n</body></html>\n");
  const htmlTask = await new CoderTask({ root: htmlRoot, goal: "Corrige el script de index.html" }).start();
  fs.writeFileSync(htmlPath, "<!DOCTYPE html>\n<html><body>\n<script>function sumar(a, b) { return a + ; }</script>\n</body></html>\n");
  const htmlRoto = await htmlTask.verify();
  assert.equal(htmlRoto.ok, false);
  assert.match(htmlTask.state.errors.join("\n"), /script inline/);
  fs.writeFileSync(htmlPath, "<!DOCTYPE html>\n<html><body>\n<script>function sumar(a, b) { return a + b; }</script>\n</body></html>\n");
  const htmlBueno = await htmlTask.verify();
  assert.equal(htmlBueno.ok, true);
  fs.appendFileSync(
    path.join(fixture, "test/price.test.mjs"),
    "\nassert.equal(discounted(20,50),10);\n",
  );
  assert.equal(
    validarCoder(CODER_TAREAS[0], fixture).ok,
    true,
    "adding correct tests is allowed",
  );
  fs.writeFileSync(
    path.join(fixture, "src/price.mjs"),
    CODER_TAREAS[0].files["src/price.mjs"],
  );
  fs.writeFileSync(
    path.join(fixture, "test/price.test.mjs"),
    "// assertions removed\n",
  );
  assert.equal(
    validarCoder(CODER_TAREAS[0], fixture).ok,
    false,
    "immutable original assertions still run",
  );
  fs.writeFileSync(
    path.join(fixture, "test/price.test.mjs"),
    CODER_TAREAS[0].files["test/price.test.mjs"],
  );
  assert.equal(
    (await automatic.verify()).ok,
    false,
    "reverting to the original bug must fail verification",
  );
  fs.writeFileSync(
    path.join(fixture, "src/price.mjs"),
    "export function discounted(price, percent) { return price * (1-percent/100); }\n",
  );
  fs.writeFileSync(
    path.join(fixture, "test/price.test.mjs"),
    CODER_TAREAS[0].files["test/price.test.mjs"],
  );
  await automatic.verify();
  const packed = new BonsaiChat({
    host: "127.0.0.1",
    port: 1,
    historyCap: 8192,
    agentProfile: "small-local-coder",
    timingsPath: null,
  });
  packed.nCtx = 8192;
  packed.actOnPc = true;
  packed.coderTask = automatic;
  packed.rules = "Keep API stable";
  packed.countPrompt = async (m) => Math.ceil(JSON.stringify(m).length / 3);
  packed.session.turns = [
    { role: "user", content: automatic.state.goal },
    {
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "one", name: "leer", arguments: '{"ruta":"src/price.mjs"}' },
      ],
    },
    { role: "tool", content: "code", toolCallId: "one" },
  ];
  let p = await packed.packHistory();
  assert.match(p.messages[0].content, /Keep API stable/);
  assert.ok(!p.messages[0].content.includes("ESTADO DE TAREA"));
  assert.ok(p.promptTokens + packed.reservaSalida() < 8192);
  assert.equal(p.messages.find((m) => m.role === "tool").tool_call_id, "one");
  const savedTurns = packed.session.turns;
  packed.session.turns = [savedTurns[0], ...Array.from({ length: 7 }, (_, i) => [
    { role: "assistant", content: "", toolCalls: [{ id: `read${i}`, name: "leer", arguments: '{"ruta":"src/price.mjs"}' }] },
    { role: "tool", content: `evidencia ${i}`, toolCallId: `read${i}` },
  ]).flat()];
  const allGroups = await packed.packHistory();
  assert.equal(allGroups.messages.filter(m => m.role === "tool").length, 7, "conservar todos los grupos que caben");
  packed.session.turns = savedTurns;
  const prefix = p.messages[0].content;
  automatic.state.phase = "REPAIR";
  p = await packed.packHistory();
  assert.equal(p.messages[0].content, prefix);
  const fullState = structuredClone(automatic.state);
  assert.equal(automatic.workingState(), JSON.stringify({ phase: fullState.phase, inspected: fullState.inspected.slice(-12), symbols:fullState.symbols, modified: fullState.modified, plan: fullState.plan, tests: fullState.tests, errors: fullState.errors, actions:fullState.actions, repairs: fullState.repairs, previousTask: fullState.previousTask, lastDiff: fullState.lastDiff || undefined }));
  automatic.state.errors = Array.from({ length: 40 }, (_, i) =>
    `UNIQUE_FAILURE_${i}: src/price.mjs:1 expected 10 actual 20\n${"  at fn (node:internal/test_runner:1:2)\n".repeat(80)}`);
  automatic.state.modified = Array.from({ length: 100 }, (_, i) => `src/long-${i}.mjs`);
  automatic.state.inspected = [...automatic.state.modified];
  automatic.state.plan = { pasos: ["pending ".repeat(2000)] };
  automatic.state.tests = Array.from({ length: 30 }, () => ({ command: "node --test test/price.test.mjs", code: 1 }));
  automatic.verificationSummary = automatic.state.errors.join("\n");
  const largeState = JSON.stringify(automatic.state);
  automatic.stateBudget = 300;
  const view = automatic.workingState();
  assert.ok(estimateTokens(view) <= 300, view);
  assert.match(JSON.parse(view).errors[0], /UNIQUE_FAILURE_0/);
  assert.ok(JSON.parse(view).omitted.errors > 0);
  assert.equal(JSON.stringify(automatic.state), largeState, "host state remains complete");
  assert.equal((automatic.dynamic().match(/UNIQUE_FAILURE_0/g) || []).length, 1, "do not duplicate verification log");
  automatic.state = fullState;
  automatic.verificationSummary = "Tests correctos.";
  // An enormous edit argument must not make us truncate the original request or
  // leave a tool result orphaned. It can be recovered by reading a smaller range.
  packed.nCtx = 4096;
  packed.session.turns[1].toolCalls[0].arguments = JSON.stringify({ ruta: "src/price.mjs", buscar: "x".repeat(80000), poner: "y" });
  p = await packed.packHistory();
  assert.ok(p.messages[1].content.startsWith(automatic.state.goal));
  assert.ok(!p.messages.some(m => m.role === "tool" || m.tool_calls?.length));
  assert.deepEqual(automatic.state.inspected, []);
  assert.match(p.messages.at(-1).content, /Vuelve a leer/);
  assert.ok(p.promptTokens <= packed.historyCap());
  packed.nCtx = 8192;
  packed.allowThinkingKw=true; packed.thinkBudget=8192;
  assert.ok(packed.templateFields(true).thinking_budget_tokens > 0 && packed.templateFields(true).thinking_budget_tokens < packed.reservaSalida(), "reasoning must leave room for a structured edit");
  const previousConfig={...automatic.config};
  packed.nCtx=32768;
  automatic.config.outputTokens=3072;automatic.config.thinkingTokens=1024;
  assert.equal(packed.templateFields(true).thinking_budget_tokens,1024);
  automatic.config.outputTokens=1536;
  assert.ok(packed.templateFields(true).thinking_budget_tokens < packed.reservaSalida(),"a large requested thought budget must still leave edit space");
  packed.nCtx=36864;
  automatic.config.outputTokens=6144;automatic.config.thinkingTokens=4096;
  assert.equal(packed.templateFields(true).thinking_budget_tokens,4096,"4k thinking must keep 2k available for the edit");
  assert.ok(packed.reservaSalida()-packed.effectiveThinkingBudget()>=256);
  automatic.config=previousConfig;
  packed.nCtx=8192;
  packed.thinkBudget=0;
  const textCap=packed.historyCap();packed.pendingImageTokens=1152;
  assert.equal(packed.historyCap(),textCap-1152);packed.pendingImageTokens=0;
  automatic.state.goal = "MUST_PRESERVE ".repeat(9000);
  await assert.rejects(
    () => packed.packHistory(),
    /requisitos|pedido original/,
  );
  assert.ok(
    compactFailure("noise\n".repeat(1000) + "ERROR file.mjs:3\nexpected 3\n")
      .length < 2201,
  );

  // Complete UI path: model submits wrong schema, then edit with syntax error, then repairs.
  const ws = path.join(temp, "integration");
  prepararCoder(CODER_TAREAS[0], ws);
  let generated = 0;
  const bodies = [];
  sitio = http.createServer((req,res)=>{res.writeHead(200,{"Content-Type":"text/html"});res.end('<button>CONTROL MCP</button>');});
  await new Promise(r=>sitio.listen(0,"127.0.0.1",r));
  const native = (id, name, args) => ({
    tool_calls: [
      {
        index: 0,
        id,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  });
  model = http.createServer(async (req, res) => {
    let raw = "";
    for await (const b of req) raw += b;
    const b = raw ? JSON.parse(raw) : {};
    const json = (x) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(x));
    };
    if (req.url === "/health") return json({ status: "ok" });
    if (req.url === "/props")
      return json({ default_generation_settings: { n_ctx: 8192 }, modalities:{vision:true} });
    if (req.url === "/v1/models") return json({ data: [{ id: "fake-small" }] });
    if (req.url === "/v1/chat/completions/input_tokens")
      return json({ input_tokens: Math.ceil(JSON.stringify(b).length / 4) });
    if (req.url !== "/v1/chat/completions") {
      res.writeHead(404);
      return res.end("{}");
    }
    bodies.push(b);
    generated++;
    if (b.messages.some(m => typeof m.content === "string" && m.content.includes("PRUEBA_ERROR_GPU"))) {
      res.writeHead(500,{"Content-Type":"application/json"});
      return res.end(JSON.stringify({error:{message:"CUDA out of memory"}}));
    }
    let delta =
      b.messages.some(m => typeof m.content === "string" && m.content.includes("PRUEBA_MCP_REAL"))
      ? (b.messages.some(m=>m.role === "tool" && m.tool_call_id === "mcp1")
        ? {content:"Página verificada."}
        : native("mcp1","mcp_playwright",{accion:"abrir",url:`http://127.0.0.1:${sitio.address().port}/sitio`}))
      :
      generated === 1
        ? native("invalid", "reemplazar", {
            ruta: "src/price.mjs",
            buscar: "return price * percent / 100;",
            poner: 12,
          })
        : generated === 2
          ? native("edit", "reemplazar", {
              ruta: "src/price.mjs",
              buscar: "return price * percent / 100;",
              poner: "return price * (1 - percent / 100); const = ;",
            })
          : generated === 3
            ? native("repair", "reemplazar", {
                ruta: "src/price.mjs",
                buscar: " const = ;",
                poner: "",
              })
            : {
                content:
                  "Hecho. La función ahora calcula el descuento y los tests pasan.\n```archivo unvalidated.txt\nThis must never execute as an edit.\n```",
              };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }], usage: { prompt_tokens: 500, completion_tokens: 10 }, timings: { prompt_n: 500, predicted_n: 10, predicted_per_second: 50 } })}\n\n`,
    );
    res.end("data: [DONE]\n\n");
  });
  await new Promise((r) => model.listen(0, "127.0.0.1", r));
  const server = http.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  const state = path.join(temp, "state");
  fs.mkdirSync(state);
  fs.writeFileSync(
    path.join(state, "ui-workspace.json"),
    JSON.stringify({ path: ws }),
  );
  ui = spawn(
    process.execPath,
    [
      fileURLToPath(new URL("./ui-server.mjs", import.meta.url)),
      "--port",
      String(port),
      "--llama-port",
      String(model.address().port),
    ],
    {
      env: {
        ...process.env,
        BONSAI_AGENT_PROFILE: "small-local-coder",
        BONSAI_STATE: state,
        BONSAI_SALIDA: path.join(temp, "output"),
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  ui.stdout.on("data", (s) => (log += s));
  ui.stderr.on("data", (s) => (log += s));
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + "/api/stats")).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, log);
  const post = (p, x) =>
    fetch(base + p, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(x),
    });
  await post("/api/workspace", { path: ws });
  await post("/api/permit", { mode: "all" });
  const pixel="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG1sAAAAASUVORK5CYII=";
  const attached=await (await post("/api/attach",{nombre:"test.png",datos:pixel})).json();
  assert.ok(attached.archivo);
  const response = await post("/api/chat", { text: CODER_TAREAS[0].prompt, imagenes:[attached.archivo] });
  const events = [];
  await leerSSE(response.body, {
    exigirFin: false,
    alEvento: (e) => events.push(e),
  });
  assert.equal(
    validarCoder(CODER_TAREAS[0], ws).ok,
    true,
    JSON.stringify(events),
  );
  assert.equal(
    fs.existsSync(path.join(ws, "unvalidated.txt")),
    false,
    "prose cannot bypass structured edit validation",
  );
  assert.ok(events.some((e) => e.event === "invalid_tool"));
  assert.ok(events.some((e) => e.event === "repair"));
  assert.equal(events.findLast((e) => e.type === "done").motivo, "completed");
  assert.ok(
    bodies.every(
      (b) => b.tools.some(t => t.function.name === "escribir_partes") && b.parallel_tool_calls === true,
    ),
  );
  assert.ok(bodies.every(b=>Array.isArray(b.messages[1].content)&&b.messages[1].content.some(p=>p.type==="image_url")),"the original image remains on the task goal throughout schema repair, edit and verification");
  assert.ok(!fs.readFileSync(path.join(state,"ui-session.json"),"utf8").includes("data:image/"));
  assert.equal((await post("/api/modelos",{clave:"ornith9b",enginePreset:"unknown"})).status,400);
  assert.equal((await post("/api/settings",{coderContextTokens:4097})).status,400);
  assert.equal((await post("/api/settings",{coderContextTokens:32768})).status,200);
  const antesSaludo = bodies.length;
  const saludo = await post("/api/chat", {text:"hi"});
  const eventosSaludo = [];
  await leerSSE(saludo.body, {exigirFin:false, alEvento:e=>eventosSaludo.push(e)});
  const llamadasSaludo = bodies.slice(antesSaludo).filter(b=>b.stream);
  assert.equal(llamadasSaludo.length, 1, "a greeting should use one model response");
  assert.equal(llamadasSaludo[0].tool_choice, "none");
  assert.equal(llamadasSaludo[0].tools, undefined);
  assert.ok(!llamadasSaludo[0].messages.some(m=>typeof m.content === "string" && m.content.startsWith("ESTADO DE TAREA")));
  assert.ok(!eventosSaludo.some(e=>e.type === "action" || e.event === "start"));
  // Memoria global: el controlador debe inyectar solo lo relevante y dentro del
  // presupuesto, no toda la memoria. Se comprueba en el cuerpo REAL que recibe el modelo.
  assert.equal((await post("/api/memoria",{op:"add",texto:"En este proyecto usamos pnpm y nunca npm.",tags:["paquetes"],fijada:true})).status,200);
  assert.equal((await post("/api/memoria",{op:"add",texto:"La base de datos de producción es PostgreSQL 16.",tags:["db"]})).status,200);
  const antesMemoria = bodies.length;
  const conMemoria = await post("/api/chat",{text:"¿Qué gestor de paquetes usa el proyecto?",modo:"consulta"});
  await leerSSE(conMemoria.body,{exigirFin:false,alEvento:()=>{}});
  const cuerpoMemoria = bodies.slice(antesMemoria).find(b=>b.stream);
  assert.ok(cuerpoMemoria, "el modelo debe recibir una petición");
  const mensajesMemoria = JSON.stringify(cuerpoMemoria.messages);
  assert.match(mensajesMemoria, /MEMORIA GLOBAL/, "la memoria global debe llegar al mensaje de sistema");
  assert.match(mensajesMemoria, /pnpm/, "la nota fijada y relevante debe viajar");
  assert.ok(!mensajesMemoria.includes("PostgreSQL"), "una nota no relacionada no debe inyectarse");
  assert.equal((await post("/api/memoria",{op:"clear",confirm:true})).status,200);
  const query=await post("/api/chat",{text:"Describe la imagen sin cambiar archivos.",imagenes:[attached.archivo],modo:"consulta"});
  await leerSSE(query.body,{exigirFin:false,alEvento:()=>{}});
  assert.equal(bodies.at(-1).tool_choice,"none");
  assert.equal(bodies.at(-1).tools,undefined,"consultation must omit tool definitions");
  assert.ok(!JSON.stringify(bodies.at(-1).messages).includes("<function=simbolo>"));
  assert.ok(bodies.at(-1).messages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==="image_url")),"consultation must still deliver the attached pixels");
  assert.ok(!bodies.at(-1).messages.some(m=>typeof m.content==="string"&&m.content.startsWith("ESTADO DE TAREA")),"a new query must not reuse the preceding task state");
  assert.ok(
    bodies[1].messages.some(
      (m) =>
        m.tool_call_id === "invalid" &&
        m.content.includes("se esperaba string"),
    ),
  );
  assert.ok(
    fs
      .readdirSync(path.join(state, "agent-traces"))
      .some((n) => n.endsWith(".jsonl")),
  );
  const persisted = JSON.parse(
    fs.readFileSync(path.join(state, "ui-session.json"), "utf8"),
  );
  assert.equal(metadatosSesion(persisted).taskState.phase, "DONE");
  const antesMcp = bodies.length;
  const mcp = await post("/api/chat",{text:"PRUEBA_MCP_REAL: comprueba la página de prueba"});
  await leerSSE(mcp.body,{exigirFin:false,alEvento:()=>{}});
  const mcpBodies = bodies.slice(antesMcp);
  assert.ok(mcpBodies[0].tools.some(t=>t.function.name === "mcp_playwright"));
  assert.ok(mcpBodies.some(b=>b.messages.some(m=>m.tool_call_id === "mcp1" && /CONTROL MCP/.test(m.content))),"el resultado del navegador llega al agente");
  sitio.closeAllConnections();
  await new Promise(r=>sitio.close(r));
  sitio = null;
  const failure = await post("/api/chat",{text:"PRUEBA_ERROR_GPU: corrige src/price.mjs"});
  const failureEvents = [];
  await leerSSE(failure.body,{exigirFin:false,alEvento:e=>failureEvents.push(e)});
  assert.ok(failureEvents.some(e=>e.type === "error" && /memoria de GPU/.test(e.text)));
  const savedFailure = JSON.parse(fs.readFileSync(path.join(state,"ui-session.json"),"utf8"));
  assert.match(savedFailure.taskState.goal,/PRUEBA_ERROR_GPU/);
  assert.equal(savedFailure.lastStop.motivo,"error");
  console.log(
    "Small coder: AST, graph, snippets, schemas, context bounds, auto tests and bounded repair verified.",
  );
} finally {
  if (sitio) { sitio.closeAllConnections(); await new Promise(r=>sitio.close(r)); }
  if (ui && ui.exitCode === null) {
    ui.kill();
    await new Promise((r) => ui.once("exit", r));
  }
  if (model) await new Promise((r) => model.close(r));
  const resolved = path.resolve(temp);
  assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
  assert.ok(path.basename(resolved).startsWith("bonsai-small-coder-"));
  fs.rmSync(resolved, { recursive: true, force: true });
}
