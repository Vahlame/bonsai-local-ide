# Benchmark report — RTX 4060 8 GB lab

Run: `mixed-q4-clean`  
Suite: `quant`  
Started: `2026-10-31T21:36:12+00:00`  
Binary: `C:\Users\user\.local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-bench.exe`  
Build: `build-RTX4060-Opt-sm89` · commit `8642541`  
GPU: NVIDIA GeForce RTX 4060 Laptop GPU · driver 617.14  
Measured VRAM read ceiling: **244.21 GB/s**  

Warm-up policy: llama-bench performs its own warm-up, then the runner discards the first of the measured samples. This is deliberately conservative: the first sample is the cold-clock sample. `tok_s` is the median of the remaining samples. No result is hand-edited.

## Qwen3 (`qwen3-4b-q4-mixed`)

Quant **Q4_K_M mixed (emb/out Q8)** · 2.33 GiB · CPU MoE layers **0** · KV **f16-f16** · threads **8** · b/ub **1024/512**

| phase | test | tok/s (median) | ± std | min | max | eff. read GB/s | % roofline | VRAM peak MiB | GPU util % | power avg/max W | temp max °C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| prefill | pp2048 | **4,002.02** | 6.28 | 3,990.35 | 4,023.10 | — | — | 3,093 | 100 | 78.3/80.6 | 71 |
| prefill | pp512 | **4,243.78** | 30.70 | 4,194.38 | 4,289.52 | — | — | 3,093 | 100 | 78.3/80.6 | 71 |
| decode | tg128 | **82.08** | 0.04 | 82.03 | 82.11 | 205.0 | 83.9 | 3,093 | 100 | 78.3/80.6 | 71 |
| decode | tg256 | **82.00** | 0.06 | 81.86 | 82.10 | 204.8 | 83.9 | 3,093 | 100 | 78.3/80.6 | 71 |

Telemetry: 44 samples; wall time 23,224 ms; load estimate 1,974 ms.

## Notes and limits

- `tok/s` for prefill is prompt-processing throughput; `tok/s` for decode is generation throughput.
- `eff. read GB/s` = decode tok/s × model file size. It is a lower bound: attention and KV reads add traffic. The denominator is the measured 244.2 GB/s device read bandwidth from `hardware_report.md`.
- `load_ms_est` is wall time minus measured test time; it includes CUDA init, model load, context creation and graph capture. Server-side load time is measured independently in `server_bench`.
- Rows with `n_cpu_moe > 0` include CPU compute for the offloaded MoE layers; their GPU utilization is not directly comparable to dense models.
- No A/B claim is made from a single run. The suite stores raw samples and the standard deviation; the report only presents measured values.
