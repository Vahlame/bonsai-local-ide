# Managed-IDE cancellation: generation and command

Date: 2026-11-01. Two directed tests against the running IDE. This is not a
full cancellation matrix.

## Generation cancellation

Prompt: write a long essay in `consulta` mode. `/api/stop` after 40 s.

Observed after the fix:

- partial text preserved in `replace`;
- `done` with `motivo = "cancelled"`, `incompleto = true`;
- `busy` false immediately after the stop;
- the next `consulta` request returned `OK` in 8.8 s;
- no new Python process remained.

The first run, before the UI fix, sent `motivo = "completed"` and
`incompleto = false` even though the turn was cut. `chat/ui-server.mjs` now
marks `motivoParada = "cancelled"` when the AbortSignal is set. Evidence:
`cancel-generation-1.json` (before), `cancel-generation-2.json` (after).

## Command cancellation

Prompt: run `python -c "import time; time.sleep(120)"` with `ejecutar`.
`/api/stop` as soon as the command action is running.

Observed:

- action `state = "done"` with detail `(turno cancelado)`, code 1;
- `done` with `motivo = "cancelled"`, `incompleto = true`;
- `busy` false;
- no new Python process after the stop; the baseline HTTP server and the test
  script are the only Python PIDs;
- the next `consulta` request returned `OK`.

The first command run used an **agent-mode** follow-up. The model re-ran the
120 s command from the previous task context, so that follow-up was not a
valid "next request" test. The corrected helper always uses `consulta` for the
follow-up. This is a test-design issue, not a parser failure. Evidence:
`cancel-command-1.json` (agent follow-up), `cancel-command-2.json` (corrected).

## What this proves

- `/api/stop` aborts generation and a running command.
- The command child tree is killed; no orphan Python from the test.
- The next request is accepted; `busy` is released.
- The final event now tells the truth about cancellation.

## Limits

- One command, one generation. No cancellation during an agent turn that is
  streaming a large tool call, no OOM, no PowerShell child that ignores
  taskkill.
- The command used `python -c`, which the IDE rewrites to a temporary file;
  a grandchild process was not tested.
- The follow-up was a simple consulta, not a new agent task with tools.
