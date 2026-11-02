# Stable prefix anchor for new user turns

Date: 2026-11-01. Scope: managed IDE, same model/profile, one read task plus
one follow-up. This is a directed cache test, not a throughput benchmark.

## Problem

The recurrent prefix cache kept only the most recent checkpoints. A new user
turn starts a new coder task, so its prompt shares the system prompt and tool
definitions with the previous turn but not the previous user message. The
recent checkpoints were after that common prefix and were rejected; the first
step of the follow-up reprocessed the whole prompt (`cache_n = 0`).

## Change

- Mark the checkpoint at the first user-message start (end of the system
  prompt) as a stable anchor.
- Budget eviction and the checkpoint-count eviction skip the anchor.
- The anchor is still invalidated normally if a later prompt does not share
  its tokens.
- `common/chat.h` exposes `first_user_message_pos()`.

With `--cache-ram 512` the slot keeps the anchor plus two recent checkpoints
(3 x 149.626 MiB = 448.878 MiB).

## Evidence

Managed IDE read task, then a follow-up user turn:

| Turn | cache_n | prompt_n | prompt_tokens | wall |
|---|---:|---:|---:|---:|
| first step | 0 | 6625 | 6625 | 49.3 s |
| first task, second step | 6496 | 2422 | 8918 | 80.5 s |
| follow-up, first step | 4551 | 1967 | 6518 | 41.0 s |

Before the anchor, the equivalent follow-up first step was `cache_n = 0`,
`prompt_n = 4637`, wall 114.7 s (tooltest-1). The anchor removes about 73.7 s
from that step in this test.

## Tool-calling check

Separate isolated workspace, native Qwen tool calls:

- two `leer` calls in one assistant message were both executed;
- `python -m unittest -v test_saludo` failed and the error was returned;
- `reemplazar` fixed only `saludo.py`;
- `archivo` wrote `RESULTADO.txt` with UTF-8 `Ángel` (bytes `C3 81`);
- `test_saludo.py` was not modified (mtime unchanged);
- the follow-up tried to overwrite `RESULTADO.txt`; the controller denied it
  with a schema/policy message, the model read the file, re-ran the test and
  answered. No parser failure.

## Decision

Keep. Rollback: revert the anchor fields and eviction changes, or disable
`--cache-recurrent-prefix`.

## Limits

- One task and one follow-up; not a general agent benchmark.
- The anchor helps new user turns and the first step after a task change. It
  does not remove the cold prefill of the first turn.
- The anchor is resident only; a server restart loses it.
