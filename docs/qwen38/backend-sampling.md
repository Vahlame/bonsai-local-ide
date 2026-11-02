# Draft backend sampling: rejected

Date: 2026-11-01. The server help says `--backend-sampling` is experimental
and **disabled by default** (the earlier handoff said it was enabled). This
A/B tests enabling it with the delivery flags.

## Fixed benchmark

Same 256-token prompt, 96 generated tokens, 3 measured repetitions.

| State | decode samples tok/s | median |
|---|---|---:|
| off (`mem-faults-delivery`) | 9.368, 9.252, 9.341 | 9.341 |
| on (`backend-sampling-1`) | 9.282, 9.314, 9.303 | 9.303 |

-0.4%, inside noise.

## Real workloads

Delivery flags (`LLAMA_MMAP_TRIM_GPU=1`,
`LLAMA_ARG_CACHE_RECURRENT_PREFIX=1`).

| Workload | sampling | samples tok/s | median |
|---|---|---|---:|
| code | off | 9.021, 8.926, 8.913 | 8.926 |
| code | on | 8.940, 9.044, 9.006 | 9.006 |
| prose | off | 6.041, 6.066, 6.011 | 6.041 |
| prose | on | 6.019, 6.040, 6.036 | 6.036 |

Code +0.9%, prose -0.1%; neither clears the noise gate. Draft acceptance is
identical (62/66 code, 47/95 prose), so the sampling path is not the
bottleneck on this model.

## Decision

Reject. Keep `--backend-sampling` off (the current profile and the server
default). Do not promote it without a workload that shows sampling overhead.

## Limits

- Two fixed workloads and the fixed benchmark; no long agent turn.
- One process per state; run-to-run drift is several percent.
