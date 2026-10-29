/** Sequential local engine profiling. No downloaded models, second LLM or kernel changes.
 * --base-url URL --out FILE : profile existing server without changing it
 * --tune --out FILE : start/stop our own candidate processes sequentially; refuses a busy port
 * --quick : smaller smoke matrix. Default: warmup + 3 runs, pp512/1k/2k/4k/8k, tg32/128/256/512.
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { leerSSE } from "../chat/sse.mjs";
import {
  MODELO,
  kvMiB,
  pesosCatalogoMiB,
  reservaServidorMiB,
} from "../chat/modelo.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2),
  val = (k, d) => {
    const i = argv.indexOf(k);
    return i < 0 ? d : argv[i + 1];
  };
const output = path.resolve(
    val("--out", path.join(root, "reports", `engine-${Date.now()}.json`)),
  ),
  quick = argv.includes("--quick");
const repetitions = Number(val("--repetitions", quick ? "2" : "3"));
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10)
  throw new Error("repetitions must be 1-10");
if (fs.existsSync(output)) throw new Error(`Report already exists: ${output}`);
const binary = path.resolve(
  val("--binary", path.join(root, "bin", "llama-server.exe")),
);
let toolchain = {};
try {
  toolchain = JSON.parse(
    fs.readFileSync(
      path.join(root, "config/inference-toolchain.local.json"),
      "utf8",
    ),
  );
} catch {}
const median = (values) => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
const exec = (file, args) => {
  try {
    const result = spawnSync(file, args, {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return result.status === 0
      ? `${result.stdout || ""}${result.stderr || ""}`.trim()
      : null;
  } catch {
    return null;
  }
};
export function readGpu() {
  const result = exec("nvidia-smi", [
    "--query-gpu=name,driver_version,memory.total,memory.used,memory.free,utilization.gpu,utilization.memory,clocks.sm,power.limit,temperature.gpu",
    "--format=csv,noheader,nounits",
  ]);
  if (!result) return null;
  const r = result
    .split("\n")[0]
    .split(",")
    .map((s) => s.trim());
  const num = (i) => (Number.isFinite(Number(r[i])) ? Number(r[i]) : null);
  return {
    name: r[0],
    driver: r[1],
    totalMiB: num(2),
    usedMiB: num(3),
    freeMiB: num(4),
    gpuUtil: num(5),
    memoryUtil: num(6),
    clockMHz: num(7),
    powerLimitW: num(8),
    temperatureC: num(9),
  };
}
export function memoryBudget(model, preset) {
  const weights = MODELO.catalogo[model].servidor.pesosGpuEstandarMiB || pesosCatalogoMiB(model),
    kv = kvMiB(preset.context, preset.kv, model),
    runtimeAndBuffers = reservaServidorMiB(model),
    vision = preset.vision ? MODELO.catalogo[model].vision.reservaMiB : 0;
  return {
    weightsMiB: weights,
    kvMiB: kv,
    computeAndRuntimeReserveMiB: runtimeAndBuffers,
    safetyMarginMiB: preset.marginMiB,
    visionMiB: vision,
    totalRequiredMiB: weights + kv + runtimeAndBuffers + preset.marginMiB + vision,
    estimated: true,
  };
}
function readServerRam(base) {
  if (process.platform !== "win32") return null;
  const port = Number(new URL(base).port || 80);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  // Read the OS-maintained peak after timing requests, without polling overhead.
  const raw = exec("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$serverProcessId = (Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction Stop | Select-Object -First 1).OwningProcess; $serverProcess = Get-Process -Id $serverProcessId -ErrorAction Stop; [ordered]@{ pid = $serverProcessId; workingSetMiB = $serverProcess.WorkingSet64 / 1MB; peakWorkingSetMiB = $serverProcess.PeakWorkingSet64 / 1MB; privateMiB = $serverProcess.PrivateMemorySize64 / 1MB; source = 'Windows process counters; includes shared/mapped resident pages; peak since process start' } | ConvertTo-Json -Compress`,
  ]);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
const reports = {
  createdAt: new Date().toISOString(),
  binary,
  engineVersion: exec(binary, ["--version"]),
  gpu: readGpu(),
  computeCapability: exec("nvidia-smi", [
    "--query-gpu=compute_cap",
    "--format=csv,noheader,nounits",
  ]),
  toolkit: exec(toolchain.nvcc || "nvcc", ["--version"]),
  profilers: {
    nsys: exec(toolchain.nsys || "nsys", ["--version"]),
    ncu: exec(toolchain.ncu || "ncu", ["--version"]),
  },
  buildFlags: null,
  results: [],
  recommendations: {},
};
const save = () => {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(reports, null, 2));
};

async function measure(base, label, configuration = null) {
  const get = async (p) =>
    (await fetch(`${base}${p}`, { signal: AbortSignal.timeout(5000) })).json();
  const post = async (p, b) => {
    const r = await fetch(`${base}${p}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
      signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) throw new Error(`${p} HTTP ${r.status}: ${await r.text()}`);
    return r;
  };
  const props = await get("/props"),
    ctx = props.default_generation_settings?.n_ctx || props.n_ctx;
  // Exactly reproducible token IDs. No nominal character-to-token conversion.
  const corpus =
    "// local coder benchmark\nexport function sum(values) {\n  return values.reduce((total, value) => total + value, 0);\n}\n".repeat(
      1600,
    );
  const tokens = (
    await (
      await post("/tokenize", { content: corpus, add_special: true })
    ).json()
  ).tokens;
  const sampling = [],
    startGpu = readGpu();
  let timer;
  const samples = [],
    skipped = [];
  const request = async (n, g, cache) => {
    const started = performance.now();
    let first = null,
      last = null,
      text = "";
    const response = await post("/completion", {
      prompt: tokens.slice(0, n),
      n_predict: g,
      temperature: 0,
      seed: 42,
      cache_prompt: cache,
      ignore_eos: true,
      stream: true,
    });
    await leerSSE(response.body, {
      exigirFin: false,
      guardarEventos: false,
      alEvento: (e) => {
        if (e.content) {
          first ??= performance.now();
          text += e.content;
        }
        if (e.timings) last = e;
      },
    });
    if (!last?.timings) throw new Error("El motor no devolvió timings reales");
    if (last.timings.predicted_n !== g)
      throw new Error(
        `Output length ${last.timings.predicted_n}, expected ${g}`,
      );
    return {
      promptRequested: n,
      generationRequested: g,
      cache,
      ttftMs: first === null ? null : first - started,
      latencyMs: performance.now() - started,
      timings: last.timings,
      tokensEvaluated: last.timings.prompt_n,
      tokensCached: last.timings.cache_n,
      // Native tokens_cached is the resulting slot size, not reused prefix tokens.
      nativeTokensEvaluated: last.tokens_evaluated,
      nativeTokensCached: last.tokens_cached,
      draftAccepted: last.timings.draft_n_accepted ?? null,
      outputHash: crypto.createHash("sha256").update(text).digest("hex"),
    };
  };
  try {
    timer = setInterval(() => {
      const g = readGpu();
      if (g) sampling.push(g);
    }, 700);
    await request(128, 16, false); // warmup excluded
    const matrix = quick
      ? [
          [512, 32],
          [2048, 128],
        ]
      : [
          [512, 32],
          [1024, 32],
          [2048, 32],
          [4096, 32],
          [8192, 32],
          [512, 128],
          [512, 256],
          [512, 512],
        ];
    for (const [n, g] of matrix) {
      if (n + g + 16 > ctx) {
        skipped.push({ n, g, reason: "context too small for prompt + output" });
        continue;
      }
      const runs = [];
      for (let i = 0; i < repetitions; i++)
        runs.push(await request(n, g, false));
      samples.push({
        promptTokens: n,
        generatedTokens: g,
        runs,
        median: {
          promptTokensPerSecond: median(
            runs.map((r) => r.timings.prompt_per_second),
          ),
          generationTokensPerSecond: median(
            runs.map((r) => r.timings.predicted_per_second),
          ),
          ttftMs: median(runs.map((r) => r.ttftMs)),
          latencyMs: median(runs.map((r) => r.latencyMs)),
        },
      });
    }
    const cold = await request(1024, 32, false),
      warm = await request(1024, 32, true);
    const endGpu = readGpu();
    if (endGpu) sampling.push(endGpu);
    const result = {
      label,
      configuration,
      props,
      startGpu,
      samples,
      skipped,
      cache: {
        cold,
        warm,
        identicalOutput: cold.outputHash === warm.outputHash,
      },
      peakVramMiB: sampling.length
        ? Math.max(...sampling.map((g) => g.usedMiB))
        : null,
      minFreeVramMiB: sampling.length
        ? Math.min(...sampling.map((g) => g.freeMiB))
        : null,
      gpuSamples: sampling,
      ram: readServerRam(base),
      codingSuccess: null,
      qualityStatus: "not evaluated by throughput benchmark",
    };
    reports.results.push(result);
    save();
    console.log(
      `${label}: peak ${result.peakVramMiB} MiB, min free ${result.minFreeVramMiB} MiB`,
    );
    return result;
  } finally {
    clearInterval(timer);
  }
}

async function tune() {
  const model = val("--model", "ornith9b"),
    port = Number(val("--port", "8080"));
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  await new Promise((r) => server.close(r));
  const presets = JSON.parse(
    fs.readFileSync(
      path.join(root, "config", "local-engine-presets.json"),
      "utf8",
    ),
  );
  const balanced = presets["8GB-BALANCED"];
  let candidates = [
    ["balanced", balanced],
    ["q8", { ...balanced, kv: "q8_0" }],
    ["q4", { ...balanced, kv: "q4_0" }],
    ["ub128", { ...balanced, ubatch: 128, batch: 256 }],
    ["ub512", { ...balanced, ubatch: 512, batch: 1024 }],
    ["flash-off", { ...balanced, flash: "off" }],
    ["ngram", { ...balanced, spec: "ngram-simple" }],
  ];
  if (argv.includes("--runtime-experiments")) candidates.push(
    ["no-graphs", { ...balanced, disableGraphs: true }],
    ["backend-sampling", { ...balanced, backendSampling: true }],
  );
  if (val("--contexts", "")) {
    const contexts = val("--contexts", "").split(",").map(Number);
    const kvs = val("--kvs", "f16,q8_0,q4_0").split(",");
    if (
      contexts.some((n) => !Number.isInteger(n) || n < 1024 || n > 65536) ||
      kvs.some((k) => !["f16", "q8_0", "q4_0"].includes(k))
    )
      throw new Error("Invalid context/KV matrix");
    candidates = contexts.flatMap((context) =>
      kvs.map((kv) => [`${kv}-ctx${context}`, { ...balanced, context, kv }]),
    );
  }
  if (val("--presets", "")) candidates = val("--presets", "").split(",").map(name=>{
    if(!Object.hasOwn(presets,name)) throw new Error(`Unknown preset: ${name}`);
    return [name,presets[name]];
  });
  const thinkingOverride=val("--coding-thinking",null);
  if(thinkingOverride!==null&&(!Number.isInteger(Number(thinkingOverride))||Number(thinkingOverride)<0||Number(thinkingOverride)>8192))throw new Error("Invalid thinking budget");
  candidates=candidates.map(([name,p])=>[name,{...p,thinkingTokens:thinkingOverride===null?(p.thinkingTokens||0):Number(thinkingOverride)}]);
  const chosen = val("--candidates", "").split(",").filter(Boolean);
  for (const label of chosen)
    if (!candidates.some(([name]) => name === label)) throw new Error(`Unknown candidate: ${label}`);
  for (const [label, p] of candidates.filter(
    ([l]) => !chosen.length || chosen.includes(l),
  )) {
    const budget = memoryBudget(model, p),
      gpu = readGpu();
    if (!gpu || budget.totalRequiredMiB > gpu.freeMiB) {
      reports.results.push({
        label,
        skipped: "insufficient free VRAM or unavailable telemetry",
        budget,
        gpu,
      });
      save();
      continue;
    }
    const logPrefix = path.join(path.dirname(output), `engine-${path.basename(output,".json")}-${label}`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const stdout = fs.openSync(logPrefix + ".out.log", "w"),
      stderr = fs.openSync(logPrefix + ".err.log", "w");
    const params = [
      "-m",
      path.join(root, "models", MODELO.catalogo[model].archivo),
      "-c",
      String(p.context),
      "-ctk",
      p.kv,
      "-ctv",
      p.kv,
      "-b",
      String(p.batch),
      "-ub",
      String(p.ubatch),
      "-ngl",
      "all",
      "--fit",
      "off",
      "-np",
      "1",
      "--flash-attn",
      p.flash,
      "--spec-type",
      p.spec,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--jinja",
      "--metrics",
      "-lv",
      "4",
      ...(p.backendSampling ? ["--backend-sampling"] : []),
      ...(p.vision ? ["--mmproj",path.join(root,"models",MODELO.catalogo[model].vision.archivo),"--mmproj-offload","--mmproj-device","CUDA0","--image-max-tokens",String(MODELO.catalogo[model].vision.imageMaxTokens)] : []),
      ...(p.thinkingTokens ? ["--reasoning-budget",String(p.thinkingTokens),"--reasoning-format","deepseek"] : ["--reasoning","off"]),
      "--cache-ram",
      "0",
      "--no-context-shift",
      "-t",
      "4",
    ];
    const bootStarted=performance.now();
    const child = spawn(binary, params, {
      cwd: root,
      env: { ...process.env, ...(p.disableGraphs ? { GGML_CUDA_DISABLE_GRAPHS: "1" } : {}) },
      windowsHide: true,
      stdio: ["ignore", stdout, stderr],
    });
    try {
      let ready = false;
      for (let i = 0; i < 240 && child.exitCode === null; i++) {
        try {
          if (
            (
              await fetch(`http://127.0.0.1:${port}/health`, {
                signal: AbortSignal.timeout(1500),
              })
            ).ok
          ) {
            ready = true;
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 250));
      }
      if (!ready)
        throw new Error(
          `Candidate ${label} failed startup, see ${logPrefix}.err.log`,
        );
      const startupMs=performance.now()-bootStarted;
      const measured = await measure(`http://127.0.0.1:${port}`, label, {
        ...p,
        model,
        budget,
        command: params,
      });
      measured.startupMs=startupMs;
      save();
      if(argv.includes("--vision-checks") && p.vision) {
        const visionReport=path.join(path.dirname(output),"runs",path.basename(output,".json"),label,"vision.json");
        const probe=spawn(process.execPath,[path.join(root,"chat/evaluar/vision-context.mjs"),"--port",String(port),"--context",String(p.context),"--app",path.resolve(val("--coding-app","chat")),"--out",visionReport,"--thinking",String(p.thinkingTokens),"--min-free",String(p.marginMiB),"--coder-options",JSON.stringify({...(p.coderOutputTokens?{outputTokens:p.coderOutputTokens}:{}),thinkingTokens:p.thinkingTokens})],{cwd:root,windowsHide:true,stdio:"inherit"});
        const code=await new Promise((resolve,reject)=>{probe.once("error",reject);probe.once("exit",resolve);});
        measured.visionCheck={exitCode:code,reportFile:visionReport,...(fs.existsSync(visionReport)?JSON.parse(fs.readFileSync(visionReport,"utf8")):{ok:false})};
        save();
        if(!measured.visionCheck.ok) throw new Error(`Vision validation failed: ${visionReport}`);
      }
      if (val("--coding-app", "") && p.context >= 4096) {
        const seeds = val("--coding-seeds", "42").split(",").map(Number);
        if (seeds.some((s) => !Number.isInteger(s) || s < 0))
          throw new Error("Invalid coding seeds");
        const coding = [];
        for (const seed of seeds) {
          const out = path.join(
            path.dirname(output),
            "runs",
            path.basename(output,".json"),
            label,
            `seed-${seed}`,
          );
          const evaluationArgs = [
            path.join(root, "chat/evaluar/coder.mjs"),
            "--app",
            path.resolve(val("--coding-app", "chat")),
            "--out",
            out,
            "--seed",
            String(seed),
            "--llama-port",
            String(port),
            "--workspace-root",
            path.join(path.dirname(output), "runs", "fixed-workspace"),
            "--context-tokens",
            String(Math.min(65536, p.context)),
            "--suite",
            val("--coding-suite", "base"),
            "--thinking",String(p.thinkingTokens),
            "--coder-options",JSON.stringify({...(p.coderOutputTokens?{outputTokens:p.coderOutputTokens}:{}),thinkingTokens:p.thinkingTokens}),
          ];
          if (val("--coding-tasks", ""))
            evaluationArgs.push("--tasks", val("--coding-tasks", ""));
          const evaluation = spawn(process.execPath, evaluationArgs, {
            cwd: root,
            windowsHide: true,
            stdio: "inherit",
          });
          const code = await new Promise((resolve, reject) => {
            evaluation.once("error", reject);
            evaluation.once("exit", resolve);
          });
          const reportFile = path.join(out, "informe.json");
          if (!fs.existsSync(reportFile))
            throw new Error(
              `Coding evaluation exited ${code} without a report`,
            );
          const runReport=JSON.parse(fs.readFileSync(reportFile,"utf8"));
          if(!runReport.complete||runReport.total!==runReport.expectedTotal)throw new Error(`Incomplete coding suite, exit ${code}: ${reportFile}`);
          coding.push({
            seed,
            reportFile,
            ...runReport,
          });
        }
        measured.codingSuccess = {
          success: coding.reduce((n, r) => n + r.success, 0),
          total: coding.reduce((n, r) => n + r.total, 0),
          completionMs: coding.reduce(
            (n, r) =>
              n + r.results.reduce((s, t) => s + t.metrics.completionMs, 0),
            0,
          ),
          promptTokens: coding.reduce(
            (n, r) =>
              n + r.results.reduce((s, t) => s + t.metrics.promptTokens, 0),
            0,
          ),
          seeds,
          reports: coding.map((r) => r.reportFile),
          taskIds: coding[0].results.map((t) => t.id),
        };
        const taskMetrics = coding.flatMap(r => r.results.map(t => t.metrics));
        measured.codingPeakVramMiB = Math.max(...taskMetrics.map(m => m.peakVramMiB).filter(Number.isFinite));
        measured.codingMinFreeVramMiB = Math.min(...taskMetrics.map(m => m.minFreeVramMiB).filter(Number.isFinite));
        measured.codingRam = readServerRam(`http://127.0.0.1:${port}`);
        measured.qualityStatus =
          "Measured with public tests, immutable assertions and hidden oracles";
        save();
      } else if (val("--coding-app", ""))
        measured.qualityStatus =
          "Coding profile needs at least 4096 context; engine-only result";
    } catch (e) {
      const measured=reports.results.findLast(r=>r.label===label&&r.samples?.length);
      if(measured){measured.error=e.message;measured.qualityStatus="Validation incomplete or failed; excluded from recommendations";}
      else reports.results.push({ label, configuration: p, error: e.message });
      save();
    } finally {
      if (child.exitCode === null) {
        child.kill();
        await new Promise((r) => child.once("exit", r));
      }
      fs.closeSync(stdout);
      fs.closeSync(stderr);
    }
  }
  const valid = reports.results.filter(
    (r) =>
      r.samples?.length &&
      !r.error &&
      (!argv.includes("--vision-checks") || !r.configuration?.vision || r.visionCheck?.ok) &&
      r.minFreeVramMiB >= (r.configuration?.marginMiB || 0) &&
      (r.codingMinFreeVramMiB === undefined || r.codingMinFreeVramMiB >= (r.configuration?.marginMiB || 0)),
  );
  if (valid.length) {
    const speed = (r) =>
      median(r.samples.map((s) => s.median.generationTokensPerSecond));
    reports.recommendations.fastestMicrobenchmark = [...valid].sort(
      (a, b) => speed(b) - speed(a),
    )[0].label;
    reports.recommendations.lowestVram = [...valid].sort(
      (a, b) => a.peakVramMiB - b.peakVramMiB,
    )[0].label;
    const coding = valid
      .filter((r) => r.codingSuccess?.total)
      .sort(
        (a, b) =>
          b.codingSuccess.success / b.codingSuccess.total -
            a.codingSuccess.success / a.codingSuccess.total ||
          a.codingSuccess.completionMs / a.codingSuccess.total -
            b.codingSuccess.completionMs / b.codingSuccess.total,
      );
    reports.recommendations.balanced =
      coding[0]?.label || "requires coding benchmark comparison";
    reports.recommendations.codingBest = coding[0]?.label || null;
    reports.recommendations.scope =
      coding.length
        ? "Limited to the recorded fixtures, seeds and hardware. Coding success ranks first, then mean completion time; this is not a general quality guarantee."
        : "Repeated-code throughput only. Require end-to-end coding comparison before enabling a candidate.";
  }
  save();
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (argv.includes("--tune")) await tune();
    else
      await measure(
        val("--base-url", "http://127.0.0.1:8080"),
        val("--label", "existing"),
      );
  } catch (e) {
    reports.error = e.message;
    save();
    console.error(e.message);
    process.exitCode = 1;
  }
}
