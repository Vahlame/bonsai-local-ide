# Server benchmark — RTX 4060 8 GB lab

Run `server-qwen3-4b-20261031` · model `qwen3-4b` · context 16384 · KV f16 · build `build-RTX4060-Opt-sm89` · commit `8642541b255bfb5dc39cd351a178be09013a55d6`
Server binary: `C:\Users\user\.local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-server.exe` · load time **1,627 ms** · VRAM after load **4,877 MiB** · peak **4,885 MiB**

TTFT is measured from the HTTP request write to the first non-empty content chunk. ITL is the time between consecutive content chunks; the decode rate is also reported by llama-server in its final `timings` object. `cache_n` is the number of prompt tokens reused from the slot cache.

| prompt target | actual tokens | TTFT ms | prefill tok/s | decode tok/s | ITL median ms | ITL p95 ms | cache_n | VRAM peak MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 128 | 116 | **50.8** | 2,653.3 | 79.3 | 12.49 | 12.83 | 0 | 4,879 |
| 128 | 116 | **43.8** | 3,189.8 | 79.9 | 12.40 | 12.74 | 0 | 4,879 |
| 512 | 401 | **114.5** | 3,780.0 | 77.9 | 12.73 | 13.37 | 0 | 4,883 |
| 512 | 401 | **122.8** | 3,892.2 | 78.2 | 12.73 | 13.03 | 0 | 4,883 |
| 2048 | 1545 | **434.2** | 3,978.8 | 73.8 | 13.47 | 13.81 | 0 | 4,885 |
| 2048 | 1545 | **461.7** | 4,017.0 | 73.8 | 13.45 | 13.83 | 0 | 4,885 |
| 8192 | 6115 | **1,848.1** | 3,510.1 | 60.9 | 16.33 | 16.81 | 0 | 4,885 |
| 8192 | 6115 | **2,040.4** | 3,507.6 | 61.2 | 16.28 | 16.70 | 0 | 4,885 |

## Prompt cache

The same prompt is sent twice. The first request uses `cache_prompt=false`; the second uses `cache_prompt=true`. A large `cache_n` and a lower TTFT on the second request are the only evidence accepted as a cache win.

| request | TTFT ms | prefill tok/s | cache_n |
|---|---:|---:|---:|
| cold | 1,002.6 | 3,918.5 | 0 |
| warm | 23.3 | 58.4 | 3062 |
| speedup | **42.96×** | | |

## Notes

- `prompt_target` is the requested size; `prompt_tokens` is the exact count returned by the server.
- A single request is not a benchmark. The runner repeats each size; the report shows the last measured row per size unless a note says otherwise.
- The server was stopped after the run; no process is left listening.
