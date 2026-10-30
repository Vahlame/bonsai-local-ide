## Bonsai IDE v1.5.0 — 43k f16 default (max context + precision + vision + thinking)

This release raises the default to the **measured maximum** for f16 KV with vision
and thinking always on, and documents the tuning investigation.

### New default preset: `8GB-VISION-MAX-F16`

| | |
|---|---|
| Context | **43,008 tokens** |
| KV cache | **f16** (full precision) |
| Vision | **on** (mmproj on GPU) |
| Thinking | **on** (4096-token budget) |
| Measured VRAM | 7,481 MiB used / ~476 MiB free |

### Measured context ceiling (f16 + vision + thinking)

Realistic ~1k-token prompt + 8 s idle:

| Context | Result | Peak VRAM |
|---:|:--:|---:|
| 32,768 | PASS | 7,157 MiB |
| 36,864 | PASS | 7,287 MiB |
| 39,936 | PASS | 7,383 MiB |
| **43,008** | **PASS** | **7,481 MiB** |
| 45,056 | **OOM** | — |

45k fails with `CUDA error: out of memory` on long prefill. **43,008 is the hard
ceiling** on 8 GB.

### Why the old high-context crash is gone

The previous f16 crash at high context was caused by **context checkpoints**, not
context size. The launcher passes `--ctx-checkpoints 0` for f16; with that, 43k is
stable across multiple reasoning turns and long idle.

### Tuning results (llama-bench, f16)

| Knob | Effect |
|---|---|
| f16 vs q8_0 KV | **f16 is faster** (2,199 vs 2,159 pp) *and* more precise → keep f16 |
| ub512 | +0.85% prefill; capped at 43k with less image headroom → kept ub256 |
| threads 4 vs 8 | no gain (full offload) |
| batch 512 / 1024 / 2048 | noise |
| mmap / no-mmap / mlock | mmap best |

Generation stays ~43 t/s. The remaining big lever is speculative decoding, but the
draft model (~0.7 GB) cannot fit at 43k f16 + vision — only viable at ≤16k context.

### Verification

- `npm test` — **40/40** suites green.
- UI start → 43k → long prompt (1,982 t/s prefill) → 15 s idle alive → stop leaves
  **0** processes.
- Desktop shortcut → UI → preset → **Iniciar** works.

### Reproducible tooling added

- `scripts/benchmark-rtx4060-matrix.ps1` — batch/ubatch/threads/mmap/KV matrix.
- `scripts/probe-rtx4060-context.ps1` — finds the stable context ceiling for a KV
  type with a realistic prompt and idle window.

Full guide: `docs/RTX4060_OPTIMIZATION_GUIDE.md`.
