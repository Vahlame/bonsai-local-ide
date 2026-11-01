# Controlled 512 MiB browser pressure

Date: 2026-11-01. Headless Chromium/Edge with one retained 512 MiB typed
array, GPU disabled, separate profile; no user tab is touched. The delivery
server flags were used (`LLAMA_MMAP_TRIM_GPU=1`,
`LLAMA_ARG_CACHE_RECURRENT_PREFIX=1`).

## Benchmark

Same fixed 256-token prompt, 96 generated tokens, 3 measured repetitions.

| State | decode samples tok/s | median | prefill samples tok/s |
|---|---|---:|---:|
| no browser (`mem-faults-delivery`) | 9.368, 9.252, 9.341 | 9.341 | 192.9, 186.1, 184.6 |
| 512 MiB browser (`browser-512-1`) | 9.212, 9.239, 9.275 | 9.239 | 189.5, 187.1, 198.7 |

The decode median is 1.1% lower, inside run-to-run drift. The short benchmark
does not show a meaningful decode loss under 512 MiB of browser pressure.

## Memory

| State | working set median | physical available median | physical available min |
|---|---:|---:|---:|
| no browser | 9.60 GB | 2.26 GB | 2.22 GB |
| 512 MiB browser | 9.61 GB | 1.49 GB | 1.44 GB |

The browser consumes about 770 MB of the headroom. The server working set is
unchanged and the model remains resident. This is not a paging-free proof:
no ETW capture was taken in this run.

## Tooling

The prepared script expected Playwright's downloaded headless shell, which is
not installed on this machine. It now falls back to the system Edge/Chrome
executable and still runs headless with a separate context. The metadata
records the browser version and the allocated bytes.

## Limits

- One 512 MiB page, one short benchmark. No long browser session, no 25K
  context, no user tabs.
- No ETW hard-fault attribution in this run; use `memory-faults.md` for the
  file-level fault evidence.
- The browser was headless; a visible browser with more GPU/compositor memory
  is a different case.
