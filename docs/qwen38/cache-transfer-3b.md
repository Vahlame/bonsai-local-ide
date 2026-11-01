# Recurrent cache flag on a pure transformer: Qwen-free regression

Date: 2026-11-01. The flag `--cache-recurrent-prefix` must not break the normal
KV prompt cache of a transformer.

## Setup

- Model: `Llama-3.2-3B-Instruct-Q4_K_M.gguf`.
- Fork binary, GPU full, 16K context, KV q8_0, 16 threads, 4 slots.
- `--cache-ram 512 --cache-recurrent-prefix`.

The log shows `cached n_tokens = 5393` on the second request and no recurrent
checkpoint creation; this is the existing transformer path.

## Requests

| Request | cache_n | prompt_n | prompt_ms | content |
|---|---:|---:|---:|---|
| first (cold) | 0 | 5393 | 1271.6 | OK |
| second (same prefix + tool result + new user) | 5393 | 47 | 26.4 | LIST |

The server stayed healthy. The flag is a no-op for this transformer; the
normal KV cache still reuses the common prefix.

## Decision

Keep. Use the 3B transformer as a regression model for the cache flag. No
source change.

## Limits

- One cold/cached pair, 5.4K prompt, 4 slots.
- The output was limited to one token; this is not a quality test.
