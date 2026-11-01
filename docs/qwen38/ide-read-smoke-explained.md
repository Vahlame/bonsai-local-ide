# IDE read smoke: what happened and what was fixed

Date: 2026-11-01. This closes the pending observation in the handoff. It does
not claim a general IDE acceptance; it explains the two concrete symptoms.

## The corrected smoke was cut, not rejected by the parser

Timeline from `handoff-ide-read-smoke-corrected.json`:

| ms | event |
|---:|---|
| 41933 | first reasoning token |
| 51990 | `tool_progress` `leer`, empty path, 1 arg char |
| 53302 | `tool_progress` `leer`, 18 arg chars |
| 54662 | `tool_progress` `leer`, path `docs/QWEN38-27B.md`, 28 chars |
| 55763 | `turno cortado` |
| 56138 | `done`, `completed` |

The native tool call was still streaming when `/api/stop` arrived. The tool was
never executed, so `read_tool_completed=false` and the final text was empty.
There was no `peg-native` rejection and no text fallback. The later
`diag-cache-2` and `anchor-1` runs completed the same read task with a native
`leer` call, the file content and a final answer.

The earlier wrong-workspace run (`handoff-ide-read-smoke.json`) was a test
preparation error: the workspace was `C:\Users\user\Desktop\New folder (2)`,
where the requested document does not exist. It is not evidence of a model
defect.

## Why `cache_n` was 0

The recurrent prefix cache kept one checkpoint near the end of the prompt. In
the next agent step the new prompt inserted the assistant/tool message before
that checkpoint, so the checkpoint covered tokens that were no longer shared.
The server rejected it and reprocessed the whole prompt.

The fix has two parts:

1. create checkpoints at user-message boundaries and keep up to the
   `--cache-ram` budget (`d26e06a`);
2. keep the first-user checkpoint as a stable anchor across new user turns
   (`4b612b4`).

Evidence after the fix:

- `diag-cache-2`: second agent step `cache_n = 6508`, `prompt_n = 2422`,
  wall 90.1 s (before: `cache_n = 0`, `prompt_n = 7840`, wall 142.5 s).
- `anchor-1`: follow-up first step `cache_n = 4551`, `prompt_n = 1967`,
  wall 41.0 s (before: `cache_n = 0`, `prompt_n = 4637`, wall 114.7 s).

## What is still not proven

- A full edit/read/test turn through the UI after the final restart.
- Cancellation during a long command and orphan-process cleanup.
- Multiple real user turns with changing history and tool results.
- Memory pressure and paging under a browser load.

The tool-calling test in `tool-calling-qwen.md` covers parallel reads, a
command failure, a targeted edit, UTF-8 content and a recovered policy denial.
It does not cover cancellation or long-running commands.
