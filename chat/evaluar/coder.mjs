/** node chat/evaluar/coder.mjs --app PATH --out PATH --profile legacy|small-local-coder
 * One local model, isolated UI/state/workspaces; raw traces retained outside prompts.
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { leerSSE } from "../sse.mjs";
import { CODER_TAREAS, prepararCoder, validarCoder } from "./coder-tareas.mjs";
import { espacioCoder } from "./espacio-coder.mjs";
import { CODER_EXTENDIDAS } from "./coder-extended.mjs";
import { veredictoFinal } from "./veredicto-coder.mjs";

const args = Object.fromEntries(
  Array.from({ length: Math.floor((process.argv.length - 2) / 2) }, (_, i) => [
    process.argv[2 + i * 2].replace(/^--/, ""),
    process.argv[3 + i * 2],
  ]),
);
const out = path.resolve(args.out || `reports/coder-${Date.now()}`);
if (fs.existsSync(path.join(out, "informe.json")))
  throw new Error("Informe existente: usa otra salida.");
fs.mkdirSync(out, { recursive: true });
const app = path.resolve(
  args.app || fileURLToPath(new URL("..", import.meta.url)),
);
const codeHash=crypto.createHash("sha256");
for(const file of ["ui-server.mjs","bonsai-chat.mjs","code-context.mjs","coder-harness.mjs","coder-profile.json","project-verification.mjs","code-intelligence.mjs","context.mjs","actions.mjs"]) if(fs.existsSync(path.join(app,file))) codeHash.update(file).update(fs.readFileSync(path.join(app,file)));
const codeFingerprint=codeHash.digest("hex");
const modelBase = `http://127.0.0.1:${args["llama-port"] || 8080}`;
const props = await (await fetch(`${modelBase}/props`)).json();
const profile = args.profile || "small-local-coder";
const contextTokens = Number(args["context-tokens"] || 8192);
if (
  !Number.isInteger(contextTokens) ||
  contextTokens < 2048 ||
  contextTokens > 65536
)
  throw new Error("Agent context must be 2048-65536");
const seed = Number(args.seed || 42);
const thinking = Number(args.thinking || 0);
if (!Number.isInteger(thinking) || thinking < 0 || thinking > 8192) throw new Error("Invalid thinking budget");
const extraOptions = JSON.parse(args["coder-options"] || "{}");
const fixedWorkspace = args["workspace-root"]
  ? espacioCoder(args["workspace-root"])
  : null;
const ablations = {
  "map-off": { repoMapTokens: 0 },
  "map-large": { repoMapTokens: 1800 },
  direct: { strategy: "direct" },
  plan: { strategy: "plan" },
  "cache-off": { promptCache: false },
  "snippets-off": { snippetTokens: 0 },
  "full-files": { contextMode: "full-files" },
};
if (args.ablation && !ablations[args.ablation])
  throw new Error("Ablation desconocida");
const timeoutMs = Number(args.timeout || 180) * 1000;
const suite = args.suite === "extended" ? CODER_EXTENDIDAS : CODER_TAREAS;
if (args.suite && !["base", "extended"].includes(args.suite))
  throw new Error("Unknown suite");
const tasks = args.tasks
  ? suite.filter((t) => args.tasks.split(",").includes(t.id))
  : suite;
if (!tasks.length) throw new Error("No hay tareas");
const fixtureFingerprint = crypto
  .createHash("sha256")
  .update(JSON.stringify(tasks))
  .digest("hex");
let requests = [],
  taskDir = "",
  task = null,
  injected = false;
// Proxy pasivo para métricas y una inyección de fallo reproducible en repair-patch.
// La inyección ocurre justo ANTES de devolver un resultado de edición al modelo.
const proxy = http.createServer(async (req, res) => {
  const controller=new AbortController();res.on("close",()=>controller.abort());
  try {
    let raw = "";
    for await (const b of req) raw += b;
    const body = raw ? JSON.parse(raw) : null;
    let requestRow = null;
    if (req.url === "/v1/chat/completions") {
      body.seed = seed;
      requestRow = {
        at: Date.now(),
        body,
        response: { toolCalls: [], usage: null, timings: null, reasoningCharacters:0 },
      };
      requests.push(requestRow);
      if (
        task?.injectFault &&
        !injected &&
        fs.readFileSync(path.join(taskDir, "src/clamp.mjs"), "utf8") !==
          task.files["src/clamp.mjs"]
      ) {
        fs.appendFileSync(
          path.join(taskDir, "src/clamp.mjs"),
          "\nconst = ; // BENCHMARK_INJECTED_SYNTAX_ERROR\n",
        );
        injected = true;
        const last = body.messages.at(-1);
        if (last && typeof last.content === "string")
          last.content +=
            "\nVerificación adicional: src/clamp.mjs contiene un error de sintaxis introducido después del patch. Lee y repara ese archivo.";
      }
    }
    const upstream = await fetch(`${modelBase}${req.url}`, {
      method: req.method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs)]),
    });
    res.writeHead(upstream.status, {
      "Content-Type":
        upstream.headers.get("content-type") || "application/json",
    });
    let responseText = "";
    const decoder = new TextDecoder();
    for await (const b of upstream.body) {
      if (res.destroyed) break;
      if (requestRow) responseText += decoder.decode(b, { stream: true });
      res.write(b);
    }
    if (requestRow) {
      responseText += decoder.decode();
      const calls = new Map();
      for (const line of responseText.split(/\r?\n/)) {
        const raw = line.startsWith("data: ") ? line.slice(6) : line;
        let e;
        try {
          e = JSON.parse(raw);
        } catch {
          continue;
        }
        if (e.usage) requestRow.response.usage = e.usage;
        if (e.timings) requestRow.response.timings = e.timings;
        requestRow.response.reasoningCharacters += e.choices?.[0]?.delta?.reasoning_content?.length || 0;
        for (const c of e.choices?.[0]?.delta?.tool_calls || []) {
          const old = calls.get(c.index) || { id: "", name: "", arguments: "" };
          if (c.id) old.id = c.id;
          old.name += c.function?.name || "";
          old.arguments += c.function?.arguments || "";
          calls.set(c.index, old);
        }
      }
      requestRow.response.toolCalls = [...calls.values()];
    }
    res.end();
  } catch (e) {
    if (!res.headersSent) res.writeHead(502);
    res.end(JSON.stringify({ error: { message: e.message } }));
  }
});
await new Promise((r) => proxy.listen(0, "127.0.0.1", r));
const getPort = async () => {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const p = s.address().port;
  await new Promise((r) => s.close(r));
  return p;
};
const port = await getPort(),
  base = `http://127.0.0.1:${port}`,
  state = path.join(out, "state");
fs.mkdirSync(state, { recursive: true });
const log = fs.openSync(path.join(out, "ui.log"), "w");
const ui = spawn(
  process.execPath,
  [
    path.join(app, "ui-server.mjs"),
    "--port",
    String(port),
    "--llama-port",
    String(proxy.address().port),
    "--prompt-cap",
    String(contextTokens),
  ],
  {
    env: {
      ...process.env,
      BONSAI_CODER_OPTIONS: JSON.stringify({
        contextTokens,
        ...extraOptions,
        ...(ablations[args.ablation] || {}),
      }),
      BONSAI_TREE_SITTER_MODULE: createRequire(import.meta.url).resolve(
        "@vscode/tree-sitter-wasm",
      ),
      BONSAI_TYPESCRIPT_MODULE: createRequire(import.meta.url).resolve(
        "typescript",
      ),
      BONSAI_TS_LSP_CLI: createRequire(import.meta.url).resolve(
        "typescript-language-server/lib/cli.mjs",
      ),
      BONSAI_AGENT_PROFILE: profile,
      BONSAI_STATE: state,
      BONSAI_SALIDA: path.join(out, "outputs"),
    },
    stdio: ["ignore", log, log],
    windowsHide: true,
  },
);
const post = async (url, body) => {
  const r = await fetch(`${base}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`);
  return r;
};
const report = [];
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${base}/api/stats`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready)
    throw new Error(
      `UI no disponible: ${fs.readFileSync(path.join(out, "ui.log"), "utf8")}`,
    );
  await post("/api/permit", { mode: "all" });
  await post("/api/settings", { pensar:thinking });
  for (const t of tasks) {
    task = t;
    injected = false;
    requests = [];
    taskDir = fixedWorkspace
      ? fixedWorkspace.prepare(t.id)
      : path.join(out, "ws", t.id);
    prepararCoder(t, taskDir);
    await post("/api/workspace", { path: taskDir });
    await post("/api/reset", {});
    const events = [],
      vram = [];
    let sampling = false;
    const timer = setInterval(() => {
      if (sampling) return;
      sampling = true;
      execFile(
        "nvidia-smi",
        [
          "--query-gpu=memory.used,memory.free",
          "--format=csv,noheader,nounits",
        ],
        { windowsHide: true, timeout: 2000 },
        (e, s) => {
          sampling = false;
          if (!e) vram.push(s.trim().split(",").map(Number));
        },
      );
    }, 500);
    const start = Date.now();
    let error = null;
    try {
      const r = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: t.prompt }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) throw new Error(`chat HTTP ${r.status}`);
      await leerSSE(r.body, {
        exigirFin: false,
        guardarEventos: false,
        alEvento: (e) => events.push({ ...e, at: Date.now() - start }),
      });
    } catch (e) {
      error = e.message;
      await post("/api/stop", {}).catch(() => {});
    }
    clearInterval(timer);
    let idle=false;
    for(let attempt=0;attempt<100;attempt++){
      const status=await (await fetch(base+'/api/state')).json();
      if(!status.busy){idle=true;break;}
      await new Promise(r=>setTimeout(r,100));
    }
    if(!idle)throw new Error('Isolated agent did not stop after cancellation');
    const elapsed = Date.now() - start,
      verdict = veredictoFinal(validarCoder(t, taskDir),events,error,profile);
    if (fixedWorkspace)
      fixedWorkspace.archive(t.id, path.join(out, "ws", t.id));
    const actions = [
      ...new Map(
        events.filter((e) => e.type === "action").map((e) => [e.id, e]),
      ).values(),
    ];
    const speed = events.filter((e) => e.type === "speed");
    const sum = (k) => speed.reduce((n, e) => n + (e[k] || 0), 0);
    const files = new Set(
      requests
        .flatMap((r) => r.body.messages || [])
        .flatMap((m) =>
          typeof m.content === "string"
            ? [...m.content.matchAll(/(?:src|test)\/[\w/.-]+/g)].map(
                (x) => x[0],
              )
            : [],
        ),
    );
    const usageSum = (k) =>
      requests.reduce((n, r) => n + (r.response?.usage?.[k] || 0), 0);
    const timingRows = requests.map((r) => r.response?.timings).filter(Boolean);
    const timingSum = (k) => timingRows.reduce((n, t) => n + (t[k] || 0), 0);
    const actualCalls = requests.flatMap((r) => r.response?.toolCalls || []);
    const parseFailures = actualCalls.filter((c) => {
      try {
        JSON.parse(c.arguments);
        return false;
      } catch {
        return true;
      }
    }).length;
    const metrics = {
      llmCalls: requests.length,
      promptTokens: usageSum("prompt_tokens") || sum("prompt_tokens"),
      generatedTokens: usageSum("completion_tokens") || sum("predicted_n"),
      reasoningCharacters: requests.reduce((n,r)=>n+(r.response?.reasoningCharacters||0),0),
      cachedTokens: timingRows.length ? timingSum("cache_n") : sum("cache_n"),
      evaluatedTokens: timingRows.length
        ? timingSum("prompt_n")
        : sum("prompt_n"),
      promptEvaluationMs:
        (timingRows.length
          ? timingSum("prompt_ms")
          : speed.reduce((n, e) => n + (e.prompt_ms || 0), 0)) || null,
      generationTokensPerSecond: speed.length
        ? speed.reduce((n, e) => n + (e.predicted_ps || 0), 0) / speed.length
        : null,
      filesSent: files.size,
      toolCalls: actualCalls.length,
      actions: actions.length,
      parseFailures,
      schemaFailures: events.filter(
        (e) => e.type === "agent_trace" && e.event === "invalid_tool",
      ).length,
      patchFailures: actions.filter(
        (a) =>
          a.state === "denied" &&
          /reemplazar|texto|anchor/i.test(a.title + " " + a.detail),
      ).length,
      repairAttempts: events.filter(
        (e) => e.type === "agent_trace" && e.event === "repair",
      ).length,
      timeToFirstUsefulActionMs:
        actions.find(
          (a) =>
            a.state === "done" &&
            ["read", "write", "index", "cmd"].includes(a.kind),
        )?.at ?? null,
      completionMs: elapsed,
      peakVramMiB: vram.length ? Math.max(...vram.map((x) => x[0])) : null,
      minFreeVramMiB: vram.length ? Math.min(...vram.map((x) => x[1])) : null,
      contextSize: props.default_generation_settings?.n_ctx ?? props.n_ctx,
      faultInjected: injected,
    };
    const row = {
      id: t.id,
      ...verdict,
      metrics,
      error,
      stop: events.findLast((e) => e.type === "done"),
    };
    report.push(row);
    fs.writeFileSync(
      path.join(out, `${t.id}.trace.json`),
      JSON.stringify(
        { row, events: events.filter((e) => !["token","reasoning"].includes(e.type)), requests },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(out, "informe.json"),
      JSON.stringify(
        {
          profile,
          suite: args.suite || "base",
          validationVersion: 4,
          expectedTotal: tasks.length,
          complete: report.length===tasks.length,
          fixtureFingerprint,
          codeFingerprint,
          requestedContextTokens: contextTokens,
          thinkingTokens: thinking,
          coderOptions: extraOptions,
          seed,
          ablation: args.ablation || null,
          workspaceRoot: fixedWorkspace?.root ?? null,
          props,
          app,
          createdAt: new Date().toISOString(),
          success: report.filter((r) => r.ok).length,
          total: report.length,
          results: report,
        },
        null,
        2,
      ),
    );
    console.log(
      `${t.id}: ${verdict.ok ? "PASS" : "FAIL"} ${elapsed}ms ${metrics.llmCalls} calls ${metrics.promptTokens} prompt tokens`,
    );
  }
} finally {
  ui.kill();
  await new Promise((r) => (ui.exitCode !== null ? r() : ui.once("exit", r)));
  await new Promise((r) => proxy.close(r));
  fs.closeSync(log);
}
console.log(`${report.filter((r) => r.ok).length}/${report.length}: ${out}`);
process.exitCode = report.every((r) => r.ok) ? 0 : 1;
