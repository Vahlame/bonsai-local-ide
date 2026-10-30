## Bonsai IDE v1.5.1 — KV preset fix + quality benchmark

### Fixed: four presets could not start

`IQ4_XS`, `IQ2_XS` and `IQ1_S` are **weight** quantizations, not valid KV cache
types. `llama-server` accepts only `f32/f16/bf16/q8_0/q4_0/q4_1/iq4_nl/q5_0/q5_1`,
so every preset using `IQ*` for the KV cache exited at startup.

| Preset | Before (broken) | Now |
|---|---|---|
| `8GB-VISION-HIGH` | IQ4_XS | **q8_0 · 32k · vision** |
| `8GB-VISION-ULTRA` | IQ4_XS | **q4_0 · 36k · vision** |
| `8GB-CODE-MAX` | IQ2_XS | **q4_0 · 48k** |
| `8GB-RESEARCH` | IQ1_S | **q4_0 · 64k** |

All four now start and answer. The valid set is enforced in the launcher, engine
profiles and the UI server, so broken combinations cannot be selected again.

### Added: deterministic quality benchmark

`scripts/bench-model-quality.mjs` (`npm run benchmark:quality`) starts each preset,
runs **18 tasks across 8 fields** and grades them automatically:

- coding: `chunk`, `isBalanced`, **expression parser**, **LRU cache**, binary-search
  debug, output prediction (code executed in a timeout-guarded `vm` sandbox)
- reasoning: train catch-up, probability, **three-rate work problem**, logic
- data: SQL aggregation → JSON
- instruction: strict and **nested** JSON
- text: punctuation-preserving word reversal
- retrieval: one and **two needles** in ~6–8k tokens
- spanish: entity JSON
- tools: native `tool_call` arguments

### Measured result (one pass per preset)

| Preset | KV | Ctx | Points | % | Gen t/s |
|---|---|---:|---:|---:|---:|
| `8GB-VISION-HIGH` | q8_0 | 32,768 | 17/18 | 94.4% | 42.1 |
| `8GB-VISION-MAX-F16` | f16 | 43,008 | 16/18 | 88.9% | 42.3 |
| `8GB-CODE-BALANCED` | q8_0 | 32,768 | 16/18 | 88.9% | 42.1 |
| `8GB-RESEARCH` | q4_0 | 65,536 | 16/18 | 88.9% | 42.1 |
| `8GB-VISION-BALANCED` | q4_0 | 28,672 | 15/18 | 83.3% | 42.1 |

**Honest interpretation:** with n=18 and a single pass, a 1–2 task spread is **not
significant**. There is no evidence that q8_0/f16/q4_0 change quality here — choose
KV by VRAM/context. Consistent model weakness across **all** presets: the LRU cache
(it deletes the key and then reads it) and an intermittent expression parser. Those
are 9B-model limits, not KV precision.

### Verification

- `npm test` — **40/40** green.
- All previously-dead presets now start and answer.
- Benchmark artifact: `reports/bench-quality-20261030175028/results.md`.

Full guide: `docs/RTX4060_OPTIMIZATION_GUIDE.md`.
