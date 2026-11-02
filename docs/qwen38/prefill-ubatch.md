# Prefill ubatch 384 vs 256: rejected

Date: 2026-11-01. `llama-bench` prefill, same model and profile (ngl 27,
16 threads, batch 512, KV q8_0, mmap, repack on).

## Hypothesis

A larger ubatch could improve CPU GEMM arithmetic intensity and reduce
per-batch overhead. 512 was already known to OOM; 384 was not tested.

## Results

| ubatch | samples tok/s | median | mean |
|---:|---|---:|---:|
| 256 (control) | 193.14, 218.20, 222.31 | 218.20 | 211.21 |
| 384 | 204.79, 216.30, 218.23 | 216.30 | 213.11 |

384 loaded without OOM, but the median is 0.9% lower. The means differ by
0.9% in the other direction; both are inside run-to-run drift. No design
clears the noise gate.

## Decision

Reject. Keep ubatch 256. No source or profile change. Do not retry larger
ubatch values without a profile that identifies batch overhead as the
bottleneck.

## Limits

- Prefill only; no decode or IDE turn.
- Two 3-sample processes; the first sample in each is cold.
