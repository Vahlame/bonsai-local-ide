# Final managed-IDE read smoke

Date: 2026-11-01, after the official launcher restart and all runtime changes.

## Run 2 (accepted)

- workspace: project root;
- native `leer` on `docs/QWEN38-27B.md`;
- first step: `cache_n = 4551` (stable anchor from the previous chat),
  `prompt_n = 2086`, 11.9 s prefill;
- second step: `cache_n = 6508`, `prompt_n = 2422`, 14.3 s prefill;
- final answer: `--spec-type draft-mtp` with `--spec-draft-n-max 2`;
- `passed = true`, wall 64.7 s;
- workspace and previous chat restored.

## Run 1 (functionally correct, helper criterion too narrow)

The model used `buscar_codigo` instead of `leer`, found the same flag and
answered correctly. The helper only accepted `leer`, so it reported
`passed = false` even though the read-only task and the 6508-token cache hit
were correct. The helper now accepts both read-only tools. This was a test
helper defect, not a model or controller failure.

## Evidence

`final-read-smoke.json` (run 1), `final-read-smoke-2.json` (run 2). The
`cache_n` values are from the llama-server timings.

## Limits

- One read-only task, two LLM steps. It does not validate editing,
  cancellation, long commands or general quality; those have separate
  reports.
- The 4551 anchor hit in run 2 came from a previous chat with the same system
  prompt and tool definitions; it is a valid same-prefix reuse, not a new
  turn guarantee.
