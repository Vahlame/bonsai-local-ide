# MTP draft p-min 0.1: rejected

Date: 2026-11-01. Fixed harness: candidate GGUF, ngl 27, 16 threads, batch
512, ubatch 256, KV q8_0, MTP 2, temperature 0, seed 42, 96 generated tokens,
three measured repetitions after warmup.

## Hypothesis

The profile uses `--spec-draft-p-min 0.0`, so every draft is verified. A
threshold of 0.1 could skip low-probability drafts and save verification work
on prose, where draft acceptance is lower.

## Results

| Workload | p-min | decode samples tok/s | median | draft accepted |
|---|---:|---|---:|---:|
| code | 0.0 | 8.992, 8.956, 8.473 | 8.956 | 62 / 66 |
| code | 0.1 | 9.024, 8.956, 8.979 | 8.979 | 62 / 66 |
| prose | 0.0 | 6.034, 6.051, 6.066 | 6.051 | 47 / 95 |
| prose | 0.1 | 6.037, 6.053, 6.013 | 6.037 | 47 / 95 |

The draft counts are identical at both thresholds: no draft was below 0.1 in
these workloads. The decode medians differ by +0.25% (code) and -0.23%
(prose), both inside noise. The knob is inert at 0.1 here.

## Decision

Reject. Keep `--spec-draft-p-min 0.0`. Do not retry 0.1 without evidence that
draft probabilities fall below it. A higher threshold is a different design
and would need a separate quality/speed test.

## Limits

- Two fixed workloads, 96 tokens, one process per threshold.
- The IDE's real prompts and sampling temperature 0.7 are not covered.
- No quality test is needed for this rejection because no draft was filtered.
