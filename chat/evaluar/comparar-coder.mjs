/** Compare matching benchmark workloads; never turn mock tests into model quality claims. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function compareCoder(before, after) {
  const summarize = (r) => ({
    profile: r.profile,
    seed: r.seed ?? null,
    context: r.props.default_generation_settings?.n_ctx ?? r.props.n_ctx,
    success: r.success,
    total: r.total,
    promptTokens: r.results.reduce((n, t) => n + t.metrics.promptTokens, 0),
    generatedTokens: r.results.reduce(
      (n, t) => n + t.metrics.generatedTokens,
      0,
    ),
    llmCalls: r.results.reduce((n, t) => n + t.metrics.llmCalls, 0),
    completionMs: r.results.reduce((n, t) => n + t.metrics.completionMs, 0),
    peakVramMiB: Math.max(...r.results.map((t) => t.metrics.peakVramMiB || 0)),
    results: r.results.map((t) => ({
      id: t.id,
      ok: t.ok,
      testsPassing: t.testsPassing,
      syntaxPassing: t.syntaxPassing,
      preservedTests: t.preservedTests,
      metrics: t.metrics,
      error: t.error,
      stop: t.stop?.motivo,
    })),
  });
  const b = summarize(before),
    a = summarize(after);
  return {
    before: b,
    after: a,
    comparableTasks:
      before.results.map((t) => t.id).join() ===
      after.results.map((t) => t.id).join(),
    sameSeed: b.seed === a.seed && b.seed !== null,
    sameContext: b.context === a.context,
    sameWorkspace:
      before.workspaceRoot && after.workspaceRoot
        ? before.workspaceRoot === after.workspaceRoot
        : null,
    sameFixtures:
      before.fixtureFingerprint && after.fixtureFingerprint
        ? before.fixtureFingerprint === after.fixtureFingerprint
        : null,
    limitations: [
      `${before.total}/${after.total} synthetic tasks, one report per configuration. No statistical confidence estimate.`,
      "Task success requires public tests, immutable original assertions, hidden oracle and syntax checks. Adding tests is allowed unless explicitly forbidden.",
      "repair-patch injects a synthetic syntax error after the first edit; injection is recorded.",
      "Initial reports without a seed used the existing stochastic sampling configuration.",
    ],
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [b, a, out] = process.argv.slice(2);
  if (!b || !a || !out)
    throw new Error(
      "Uso: comparar-coder.mjs before/informe.json after/informe.json salida.json",
    );
  const result = compareCoder(
    JSON.parse(fs.readFileSync(b, "utf8")),
    JSON.parse(fs.readFileSync(a, "utf8")),
  );
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify(
      {
        before: {
          success: result.before.success,
          total: result.before.total,
          promptTokens: result.before.promptTokens,
          ms: result.before.completionMs,
        },
        after: {
          success: result.after.success,
          total: result.after.total,
          promptTokens: result.after.promptTokens,
          ms: result.after.completionMs,
        },
        sameSeed: result.sameSeed,
        sameContext: result.sameContext,
      },
      null,
      2,
    ),
  );
}
