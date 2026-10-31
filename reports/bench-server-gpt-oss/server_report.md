# Server benchmark — RTX 4060 8 GB lab

Run `server-gpt-oss-20261031` · model `gpt-oss-20b` · context 65536 · KV q8_0 · build `build-RTX4060-Opt-sm89` · commit `8642541b255bfb5dc39cd351a178be09013a55d6`
Server binary: `C:\Users\user\.local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-server.exe` · load time **8,415 ms** · VRAM after load **5,671 MiB** · peak **5,709 MiB**

TTFT is measured from the HTTP request write to the first non-empty content chunk. ITL is the time between consecutive content chunks; the decode rate is also reported by llama-server in its final `timings` object. `cache_n` is the number of prompt tokens reused from the slot cache.

| prompt target | actual tokens | TTFT ms | prefill tok/s | decode tok/s | ITL median ms | ITL p95 ms | cache_n | VRAM peak MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 512 | 395 | **745.8** | 533.5 | 30.6 | 32.61 | 35.40 | 0 | 5,689 |
| 512 | 395 | **780.9** | 510.9 | 30.6 | 32.45 | 35.33 | 0 | 5,707 |
| 2048 | 1529 | **2,052.4** | 752.0 | 30.3 | 32.80 | 34.89 | 0 | 5,709 |
| 2048 | 1529 | **2,045.1** | 755.2 | 30.4 | 32.81 | 34.69 | 0 | 5,709 |
| 8192 | 6056 | **7,409.2** | 823.7 | 30.1 | 33.07 | 34.60 | 0 | 5,709 |
| 8192 | 6056 | **7,411.8** | 824.3 | 30.0 | 33.28 | 34.78 | 0 | 5,709 |

## Prompt cache

The same prompt is sent twice. The first request uses `cache_prompt=false`; the second uses `cache_prompt=true`. A large `cache_n` and a lower TTFT on the second request are the only evidence accepted as a cache win.

| request | TTFT ms | prefill tok/s | cache_n |
|---|---:|---:|---:|
| cold | 3,814.3 | 804.9 | 0 |
| warm | 72.2 | 21.8 | 3033 |
| speedup | **52.84×** | | |

## Notes

- `prompt_target` is the requested size; `prompt_tokens` is the exact count returned by the server.
- A single request is not a benchmark. The runner repeats each size; the report shows the last measured row per size unless a note says otherwise.
- The server was stopped after the run; no process is left listening.
