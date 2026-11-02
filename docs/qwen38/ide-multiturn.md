# Managed-IDE multi-turn agent task

Date: 2026-11-01. One workspace, two real agent turns with tools, edits and
tests. The workspace is `trabajo/qwen38-multiturn`.

## Turn 1

Prompt: read `calc.py` and `test_calc.py`, run the test, fix only `calc.py`,
do not touch the test.

| Step | cache_n | prompt_n | result |
|---:|---:|---:|---|
| 1 | 0 | 4445 | two native reads + failing test |
| 2 | 4334 | 818 | `reemplazar` fixes `suma` |
| 3 | 4055 | 1344 | test passes |
| 4 | 5116 | 398 | final verification and answer |

The turn completed in 4 steps, wall 131.6 s.

## Turn 2

Prompt: add `resta(a, b)` to `calc.py`, create `test_resta.py`, run the full
test suite, do not touch `test_calc.py`.

| Step | cache_n | prompt_n | result |
|---:|---:|---:|---|
| 1 | 4055 | 653 | edit `calc.py` and create `test_resta.py` |
| 2 | 4055 | 1442 | `test_resta` and `test_calc` pass |
| 3 | 5012 | 598 | full `unittest discover` passes |

The turn completed in 3 steps, wall 111.8 s. The 4055-token stable anchor is
reused on the first step of the new turn.

## External verification

`python -m unittest discover -v` in the workspace:

```
test_negativos ... ok
test_positivos ... ok
test_resta_cero_menos ... ok
test_resta_positivos ... ok
Ran 4 tests in 0.000s
OK
```

`test_calc.py` was not modified: its mtime is 12:51:49, before the task start
at 12:51:57, and its bytes are unchanged. No `peg-native` rejection or text
fallback occurred.

## Limits

- One workspace and two turns; not a long agent session.
- No cancellation, OOM or concurrent user turn in this test.
- The absolute decode rate varies with the machine state; the cache columns
  are the meaningful result.
