# ETW memory faults with and without the delivery residency flags

Date: 2026-11-01. Two captures around the fixed 256-token benchmark, 96
generated tokens, 3 measured repetitions. WPR profile: `qwen38-memory.wprp`
(`AllFaults`, `HardFaults`, `FileIO`, `Filename`, `MemoryInfo`). Consumer
built from the memory-only part of `prepared-next-experiments.patch`.

## Captures

| Capture | Env | Model GGUF hard faults | Bytes | Pagefile hard faults | Pagefile bytes |
|---|---|---:|---:|---:|---:|
| `mem-faults-1` | none | 389,429 | 14.83 GB | 3,851 | 29.5 MB |
| `mem-faults-delivery` | `LLAMA_MMAP_TRIM_GPU=1`, `LLAMA_ARG_CACHE_RECURRENT_PREFIX=1` | 357,134 | 11.97 GB | 59 | 0.85 MB |

Both captures read the model file during load, not during decode:

| Capture | GGUF first/last hard fault | Hard faults 0-10 s | 10-30 s | 30-60 s | 60-120 s |
|---|---:|---:|---:|---:|---:|
| `mem-faults-1` | 4.04 / 17.27 s | 167,236 | 223,462 | 51 | 3,498 |
| `mem-faults-delivery` | 3.92 / 12.89 s | 221,105 | 137,095 | 6 | 0 |

The no-trim capture has 3,498 hard faults after 60 s, but they are pagefile and
DLL faults, not the model GGUF. The delivery capture has 6 hard faults in
30-60 s and none after 60 s. This does not prove zero paging; it shows no
model-file hard faults during the measured decode.

## Working set and physical memory

Per-second samples from the harness monitor:

| Capture | Working set median | Working set max | Private median | Physical available median | Physical available min |
|---|---:|---:|---:|---:|---:|
| `mem-faults-1` | 11.79 GB | 11.85 GB | 10.86 GB | 320 MB | 123 MB |
| `mem-faults-delivery` | 9.60 GB | 9.63 GB | 10.86 GB | 2.26 GB | 2.22 GB |

The delivery flags retire GPU-backed pages from the working set and keep about
2.2 GB physically available. The no-trim control ran at 98% memory load with
123-320 MB available. This is the residency benefit; it is not a decode-speed
claim.

## Soft faults

`mem-faults-1` page-fault events: 332,127 demand-zero, 3,445,912 transition,
201 copy-on-write, 146 guard, 394,329 hard. `mem-faults-delivery`: 139,182
demand-zero, 3,183,532 transition, 201 copy-on-write, 145 guard, 373,929 hard.
The hard count includes the cold model load.

## Decision

Keep the delivery profile flags. Use the delivery capture as the memory
baseline: ~9.6 GB working set, ~2.26 GB physical available, model GGUF read
during load, no model-file hard faults after 12.9 s in this run. Do not use
the no-trim 123-320 MB available figure as the delivery state.

## Limits

- One benchmark prompt and one run per capture; no long context, no browser
  pressure, no multi-turn IDE workload.
- `after_ms=0` includes module and model load. Time buckets are trace-relative,
  not server phase labels.
- The model GGUF bytes touched are below the 15.17 GB file size (11.97 GB with
  trim, 14.83 GB without); not every page was read or counted. Do not claim the
  entire file was read or that paging is absent.
- The capture server is started by the experiment harness, not the managed IDE;
  the same binary and profile flags are used.
