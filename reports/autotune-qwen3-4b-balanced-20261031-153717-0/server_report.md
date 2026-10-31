# Server benchmark — RTX 4060 8 GB lab

Run `qwen3-4b-balanced-20261031-153717-0` · model `qwen3-4b` · context 16384 · KV f16 · build `build-RTX4060-Opt-sm89` · commit `8642541b255bfb5dc39cd351a178be09013a55d6`
Server binary: `C:\Users\user\.local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-server.exe` · load time **2,095 ms** · VRAM after load **4,877 MiB** · peak **4,885 MiB**

TTFT is measured from the HTTP request write to the first non-empty content chunk. ITL is the time between consecutive content chunks; the decode rate is also reported by llama-server in its final `timings` object. `cache_n` is the number of prompt tokens reused from the slot cache.

| prompt target | actual tokens | TTFT ms | prefill tok/s | decode tok/s | ITL median ms | ITL p95 ms | cache_n | VRAM peak MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 2048 | 1545 | **406.2** | 3,870.5 | 74.2 | 13.40 | 13.74 | 0 | 4,885 |

## Prompt cache

The same prompt is sent twice. The first request uses `cache_prompt=false`; the second uses `cache_prompt=true`. A large `cache_n` and a lower TTFT on the second request are the only evidence accepted as a cache win.

_No cache pair was run._

## Notes

- `prompt_target` is the requested size; `prompt_tokens` is the exact count returned by the server.
- A single request is not a benchmark. The runner repeats each size; the report shows the last measured row per size unless a note says otherwise.
- The server was stopped after the run; no process is left listening.
