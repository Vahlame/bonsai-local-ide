# IQ4_XS prefill column reuse: rejected

Date: 2026-11-01. Scope: `llama-bench` prefill, same model and profile
(ngl 27, 16 threads, batch 512, ubatch 256, KV q8_0, mmap, repack on).
This is a kernel experiment, not an IDE end-to-end benchmark.

## Hypothesis

The CPU prefill path calls the IQ4_XS dot product once per output column, so
the weight block is decoded again for every column. Reusing the decoded weight
across 3, 4 or 8 columns should cut weight traffic and the LUT/scale work.

## Designs measured

The accepted 3-column VNNI kernel was reused for prefill with a column block
loop. Two new instantiations (4 and 8 columns) were built and gated by
`GGML_CPU_IQ4_PREFILL`. The control has the gate off.

| Design | samples tok/s | median | mean |
|---|---|---:|---:|
| control, no prefill reuse | 209.23, 240.93, 241.07 | 240.93 | 230.41 |
| 3-column block | 231.76, 242.49, 245.67 | 242.49 | 239.97 |
| 4-column block | 225.92, 236.93, 235.70 | 236.32 | 232.85 |
| 8-column block | 214.41, 235.66, 236.32 | 235.99 | 228.80 |

The first sample in each process is cold; the median is the useful number.
The 3-column block is +0.65% over control on the median, inside run-to-run
noise. The 4- and 8-column blocks are slower, consistent with register
pressure or a different bottleneck. No design clears the noise gate.

## Decision

Reject and revert source and binary. The accepted runtime is rebuilt from
`4b612b4`; the env-gated prefill code is not present in the delivery source.

Do not repeat column-only tiling. A next design must first show with a profile
that weight decode is a material share of prefill; otherwise use a 2D tile that
reuses both weights and activations, or a repacked IQ4_XS GEMM. Neither is
promoted by this experiment.

## Limits

- `llama-bench` prefill only; no decode or IDE turn is measured here.
- Run-to-run variance is several percent; a single 3-sample process cannot
  establish a 1% effect.
