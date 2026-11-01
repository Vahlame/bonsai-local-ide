# Recurrent prefix cache for agent steps

Date: 2026-11-01. Scope: one read-only agent task through the managed IDE,
same model, profile and prompt. This is not a general throughput benchmark.

## Problem

`--cache-recurrent-prefix` created one checkpoint near the end of the prompt.
In an agent turn the next request diverges before that point: the model's
assistant/tool-call message is inserted after the previous user message, so the
final checkpoint covers tokens that are no longer shared. The server rejected
the checkpoint and reprocessed the whole prompt (`cache_n = 0`).

## Change

`tools/server/server-context.cpp`:

- allow checkpoints at user-message starts for the recurrent prefix path;
- keep up to 4 checkpoints, evicting the oldest when the per-slot
  `--cache-ram` budget is exceeded;
- keep the existing near-end checkpoint.

With `--cache-ram 512` and a 149.626 MiB checkpoint, three checkpoints remain
resident (448.878 MiB). The oldest is evicted by the budget check.

## Evidence

Same prompt: `Lee docs/QWEN38-27B.md ... responde cuál es el flag que activa MTP`.

| Run | Step 1 cache | Step 2 cache | Step 2 prompt | Wall |
|---|---:|---:|---:|---:|
| before (`diag-cache-1`) | 0 / 6637 | 0 / 7840 | 7840 | 142.5 s |
| after (`diag-cache-2`) | 0 / 6637 | 6508 / 8930 | 2422 | 90.1 s |

The first step is cold in both runs. The second step reuses 6508 tokens and
processes 2422 instead of 7840. TTFT of the second step fell from about 38.5 s
to 12.4 s. The task still passed: native `leer` call, file content returned,
final answer contained `--spec-type draft-mtp`.

Server log excerpt:

```
created context checkpoint 1 of 4 (n_tokens = 4551, size = 149.626 MiB)
created context checkpoint 2 of 4 (n_tokens = 6087, size = 149.626 MiB)
created context checkpoint 3 of 4 (n_tokens = 6508, size = 149.626 MiB)
evicting context checkpoint for budget (n_tokens = 4551)
checking checkpoint with [6633, 6633] against 6509...  (rejected)
checking checkpoint with [6507, 6507] against 6509...
restored context checkpoint (n_tokens = 6508, n_past = 6508)
```

## Decision

Keep. Rollback is the previous server binary or disabling
`--cache-recurrent-prefix`. The change does not affect the non-recurrent path
(`max_checkpoints` and the user-start break still use the existing
`n_ctx_checkpoints` rules when the flag is off).

## Limits

- One read-only task with two LLM steps. Multi-turn user cache, long tool
  results, cancellation and memory pressure are separate tests.
- The first step still pays the full prefill. The gain is per subsequent step.
- The checkpoint is resident only; it is not persisted across a server restart.
