# Qwen3.8 native tool calling through the IDE

Date: 2026-11-01. One isolated task and one follow-up. This validates the
parser/controller path, not general model quality.

## Task

Workspace: `trabajo/qwen38-tooltest`. The initial test fails:

```
AssertionError: 'Hola Ángel' != 'Hola, Ángel'
```

Prompt: read `saludo.py` and `test_saludo.py`, run the test, fix only
`saludo.py`, create `RESULTADO.txt` with `Prueba superada: Ángel`, run the test
again, answer with the real result.

## Observed path

- The first assistant message contained **two native `leer` calls**; both were
  executed and both results were returned.
- `ejecutar` ran `python -m unittest -v test_saludo`; the failure text was
  returned to the model.
- `reemplazar` changed only `saludo.py`:
  `return "Hola " + nombre` -> `return "Hola, " + nombre`.
- The test then passed.
- `archivo` created `RESULTADO.txt`. The file bytes are `50 72 75 65 62 61 20
  73 75 70 65 72 61 64 61 3A 20 C3 81 6E 67 65 6C` (`Ángel` in UTF-8).
- `test_saludo.py` was not modified; its mtime stayed at 11:53:52 and its bytes
  still contain `C3 81`.
- The follow-up tried to overwrite `RESULTADO.txt` without reading it. The
  controller denied that call with a schema/policy message. The model then read
  the file, re-ran the test and answered. This is a controller guardrail, not a
  parser failure.

No `peg-native` rejection, no text fallback and no lost tool call occurred.
The Qwen path used native `delta.tool_calls` throughout.

## Result

The task completed with `motivo = completed`, 6 steps. The test output was
`test_angel ... ok`. The follow-up completed in 5 steps. The final answer was
honest about what changed and what was verified.

## Limits

- One small Python workspace and one follow-up.
- No cancellation, OOM, or long-running command test in this report.
- The follow-up was in agent mode; it added a policy denial and a recovery
  path, which is useful but not a general tool matrix.
