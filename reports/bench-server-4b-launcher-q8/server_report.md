# Server benchmark — RTX 4060 8 GB lab

Run `server-4b-launcher-q8` · model `qwen3-4b` · context 16384 · KV q8_0 · build `lab-server-mvq2` · commit `8642541b255bfb5dc39cd351a178be09013a55d6`
Server binary: `C:\Users\user\Documents\prject_local_AI\bin\builds\lab-server-mvq2\bin\llama-server.exe` · load time **1,529 ms** · VRAM after load **3,825 MiB** · peak **3,833 MiB**

TTFT is measured from the HTTP request write to the first non-empty content chunk. ITL is the time between consecutive content chunks; the decode rate is also reported by llama-server in its final `timings` object. `cache_n` is the number of prompt tokens reused from the slot cache.

| prompt target | actual tokens | TTFT ms | prefill tok/s | decode tok/s | ITL median ms | ITL p95 ms | cache_n | VRAM peak MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2048 | 1545 | **420.1** | 3,728.5 | 75.7 | 13.15 | 13.56 | 0 | 3,833 |
| 2048 | 1545 | **440.4** | 3,866.4 | 75.6 | 13.17 | 13.46 | 0 | 3,833 |

## Prompt cache

The same prompt is sent twice. The first request uses `cache_prompt=false`; the second uses `cache_prompt=true`. A large `cache_n` and a lower TTFT on the second request are the only evidence accepted as a cache win.

_No cache pair was run._

## Notes

- `prompt_target` is the requested size; `prompt_tokens` is the exact count returned by the server.
- A single request is not a benchmark. The runner repeats each size; the report shows the last measured row per size unless a note says otherwise.
- The server was stopped after the run; no process is left listening.
