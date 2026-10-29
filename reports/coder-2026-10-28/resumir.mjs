/** Rebuild the compact evidence from retained local reports; no model requests. */
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const dir = new URL("./", import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(new URL(name, dir), "utf8"));
const initial = read("engine-before.json");
const tuning = read("engine-tuning.json");
const reference = tuning.results.find((r) => r.label === "balanced");
const referenceHashes = new Map(
  reference.samples.map((s) => [
    `${s.promptTokens}/${s.generatedTokens}`,
    s.runs[0].outputHash,
  ]),
);
const engine = (r) => ({
  label: r.label,
  configuration: r.configuration,
  peakVramMiB: r.peakVramMiB,
  minFreeVramMiB: r.minFreeVramMiB,
  ram: r.ram ?? null,
  matrix: r.samples.map((s) => ({
    promptTokens: s.promptTokens,
    generatedTokens: s.generatedTokens,
    repetitions: s.runs.length,
    ...s.median,
    generatedExactlyRequested: s.runs.every(
      (x) => x.timings.predicted_n === s.generatedTokens,
    ),
    greedyOutputIdenticalToBalanced: referenceHashes.has(
      `${s.promptTokens}/${s.generatedTokens}`,
    )
      ? s.runs.every(
          (x) =>
            x.outputHash ===
            referenceHashes.get(`${s.promptTokens}/${s.generatedTokens}`),
        )
      : null,
  })),
  cache: {
    coldTtftMs: r.cache.cold.ttftMs,
    warmTtftMs: r.cache.warm.ttftMs,
    coldPromptEvaluated: r.cache.cold.timings.prompt_n,
    warmPromptEvaluated: r.cache.warm.timings.prompt_n,
    warmPromptReused: r.cache.warm.timings.cache_n,
    identicalOutput: r.cache.identicalOutput,
  },
  skipped: r.skipped,
});
const summarizeAgent = (r, ids = null, source = null) => {
  const rows = ids ? r.results.filter((t) => ids.includes(t.id)) : r.results;
  let promptEvaluationMs = 0,
    generationMs = 0;
  const selectedMapTokens = [];
  if (source)
    for (const row of rows) {
      const trace = new URL(
        `${source.slice(0, source.lastIndexOf("/") + 1)}${row.id}.trace.json`,
        dir,
      );
      if (!fs.existsSync(trace)) continue;
      const captured = JSON.parse(fs.readFileSync(trace, "utf8"));
      const start = captured.events?.find(
        (e) => e.type === "agent_trace" && e.event === "start",
      );
      if (start)
        selectedMapTokens.push({ id: row.id, tokens: start.mapTokens });
      for (const request of captured.requests || []) {
        promptEvaluationMs += request.response?.timings?.prompt_ms || 0;
        generationMs += request.response?.timings?.predicted_ms || 0;
      }
    }
  const sum = (key) => rows.reduce((n, t) => n + (t.metrics[key] || 0), 0);
  return {
    profile: r.profile,
    seed: r.seed ?? null,
    ablation: r.ablation ?? null,
    context: r.props.default_generation_settings?.n_ctx ?? r.props.n_ctx,
    success: rows.filter((t) => t.ok).length,
    total: rows.length,
    completionMs: sum("completionMs"),
    promptTokens: sum("promptTokens"),
    generatedTokens: sum("generatedTokens"),
    llmCalls: sum("llmCalls"),
    toolCalls: sum("toolCalls"),
    parseFailures: sum("parseFailures"),
    schemaFailures: sum("schemaFailures"),
    patchFailures: sum("patchFailures"),
    repairAttempts: sum("repairAttempts"),
    cachedTokens: sum("cachedTokens"),
    evaluatedTokens: sum("evaluatedTokens"),
    promptEvaluationMs: promptEvaluationMs || null,
    generationMs: generationMs || null,
    selectedMapTokens,
    peakVramMiB: Math.max(...rows.map((t) => t.metrics.peakVramMiB || 0)),
    tasks: rows.map((t) => ({
      id: t.id,
      ok: t.ok,
      stop: t.stop?.motivo,
      metrics: t.metrics,
    })),
  };
};
const ids = ["discover", "cross-file", "existing-api"];
const stable = read("after-final-stable-balanced/informe.json");
const ablations = [
  {
    source: "after-final-stable-balanced/informe.json",
    ...summarizeAgent(stable, ids, "after-final-stable-balanced/informe.json"),
  },
];
for (const name of [
  "map-off",
  "map-large",
  "cache-off",
  "snippets-off",
  "plan",
]) {
  const source = `after-ablation-${name}/informe.json`;
  if (fs.existsSync(new URL(source, dir)))
    ablations.push({ source, ...summarizeAgent(read(source), null, source) });
}
const report = {
  hardware: read("engine-final-balanced.json").gpu,
  engineVersion: read("engine-final-balanced.json").engineVersion,
  baselineEngine: engine(initial.results[0]),
  tunedEngines: tuning.results.filter((r) => r.samples).map(engine),
  verificationEngine: fs.existsSync(new URL("engine-final-verified.json", dir))
    ? engine(read("engine-final-verified.json").results[0])
    : null,
  ramVerificationEngine: fs.existsSync(new URL("engine-final-ram.json", dir))
    ? engine(read("engine-final-ram.json").results[0])
    : null,
  controlledAgentBefore: summarizeAgent(
    read("after-control-legacy-8k/informe.json"),
    null,
    "after-control-legacy-8k/informe.json",
  ),
  controlledAgentAfter: summarizeAgent(
    stable,
    null,
    "after-final-stable-balanced/informe.json",
  ),
  speculativeAgent: summarizeAgent(
    read("after-final-ngram/informe.json"),
    null,
    "after-final-ngram/informe.json",
  ),
  ablations,
  selection: {
    balanced: "8GB-BALANCED",
    codingBestObserved: "8GB-BALANCED",
    fastestRepeatedCodeOnly: "ngram",
    lowestVramMeasured8k: "q4",
    rejected: {
      ngram:
        "6/7 coding tasks and 136681 ms versus 7/7 and 108057 ms; no preset enables it",
    },
    maxSpeed:
      "1024/512 batch/ubatch: short-prefill candidate, no claimed coding quality gain",
  },
  limitations: [
    "Seven synthetic tasks; one seed per controlled configuration; no statistical generalization.",
    "Microbenchmarks repeat code extensively; throughput and greedy equality do not prove coding quality.",
    "Raw engine tokensCached is resulting slot state; use timings.cache_n for prefix reuse. Summaries use actual timings.",
    "Initial v1 task reports used an overly strict test-byte equality criterion. Validated v2 reports preserve original assertions and allow added tests.",
    "RAM peak measured only for a final BALANCED process, not across all candidates. No alternate same-model weight quantization, CUDA toolkit, Nsight or optimized-build measurements.",
    "map-off overlapped part of the CPU test suite; its latency is diagnostic, not an isolated performance estimate.",
    "The map-large ablation selected the same 49-78 token maps as default on these tiny fixtures; it does not measure small versus large actual maps.",
    "Runs use isolated workspace paths, which appear in environment context; paths and cached execution can affect model trajectories even with a fixed seed.",
  ],
};
const out = new URL("mediciones.json", dir);
fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(fileURLToPath(out));
