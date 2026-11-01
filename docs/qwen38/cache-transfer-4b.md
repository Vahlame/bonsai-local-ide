# Recurrent prefix cache transfer to Qwen3.8 4B

Date: 2026-11-01. Transfer check, not a speed claim. The 27B remains the
delivery model.

## Setup

- Model: `Qwen3.8-4B-Q4_K_M.gguf`.
- Fork binary, GPU full (`-ngl 99`), 16K context, KV q8_0, 16 threads.
- `--cache-ram 512 --cache-recurrent-prefix`.
- Default 4 slots (the 27B delivery profile uses 1 because of MTP).

The startup log shows a hybrid recurrent state: 32 recurrent layers, 201 MiB
RS buffer. The checkpoint path is active.

## Two requests

| Request | cache_n | prompt_n | prompt_ms |
|---|---:|---:|---:|
| first (cold) | 0 | 3926 | 1167.2 |
| second (same prefix + tool result + new user) | 3908 | 76 | 111.8 |

The server stayed healthy. The log shows checkpoints of 50.251 MiB at 3584,
3908 and 3925 tokens; the second request restored the 3908 checkpoint. With
4 slots the per-slot budget is 128 MiB, so two 50.251 MiB checkpoints fit and
the oldest is evicted. The 27B profile uses one slot and three checkpoints
(448.878 MiB of 512).

## Decision

The recurrent prefix path transfers to a smaller hybrid model without a
crash or a parser/controller change. Keep the 27B profile; use the 4B as a
regression model for the cache. The 50.251 MiB checkpoint size and the
4-slot budget are specific to this model.

## Limits

- One cold/cached pair, 4K prompt, no long context.
- The 4B server used the default 4 slots, not the 27B's single slot.
- No quality/PPL check; this is a cache plumbing test.
