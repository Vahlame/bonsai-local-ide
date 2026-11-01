# Recurrent prefix cache at 6K/12K/25K with the final mixed GGUF

Date: 2026-11-01. Candidate `qwen38-27b-perf-iq4_xs-floor4.gguf`, delivery
flags (`LLAMA_MMAP_TRIM_GPU=1`, `LLAMA_ARG_CACHE_RECURRENT_PREFIX=1`),
`--cache-ram 512`, 32K context, 16 threads, MTP 2. Each scenario sends the
same prefix twice: one cold prefill and then the cached request.

| Prefix | Cold TTFT | Cached TTFT | Tokens reused | Prompt processed |
|---:|---:|---:|---:|---:|
| 6,000 | 29,691.9 ms | 361-422 ms | 5,997 | 3 |
| 12,000 | 58,099.3 ms | 404-443 ms | 11,997 | 3 |
| 25,000 | 122,254.5 ms | 423-446 ms | 24,997 | 3 |

The cold prefill runs at 202-207 tokens/s. The cached requests reuse all but
three tokens and return in about 0.4 s. This is the final mixed GGUF, not the
original UD model used in the earlier 550-744 ms table.

## Scope

This is a **repeated resident prefix** test. It does not prove the same TTFT
for a real agent turn with a changed tool result, removed reasoning, a new
user message or a different slot. The agent-step and multi-turn tests cover
those cases separately (`cache-agent-prefix.md`, `cache-anchor.md`,
`ide-multiturn.md`).

## Evidence

`cache-mixed-final/cache-6000.json`, `cache-12000.json`,
`cache-25000.json`, `manifest.json`. The manifest records the command, env,
binary SHA and source diff. Raw server logs are not required for this table.

## Limits

- Two requests per prefix, three measured repetitions of the cached request.
- No browser pressure and no concurrent user in this capture.
- The cold prefill numbers depend on the current thermal state; the cached
  reuse counts are the meaningful result.
