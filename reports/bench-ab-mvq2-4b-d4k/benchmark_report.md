# Benchmark report — RTX 4060 8 GB lab

Run: `ab-mvq2-4b-d4k`  
Suite: `core`  
Started: `2026-10-31T21:16:24+00:00`  
Binary: `C:\Users\user\Documents\prject_local_AI\bin\builds\lab-mvq2\bin\llama-bench.exe`  
Build: `lab-mvq2` · commit `8642541`  
GPU: NVIDIA GeForce RTX 4060 Laptop GPU · driver 617.14  
Measured VRAM read ceiling: **244.21 GB/s**  

Warm-up policy: llama-bench performs its own warm-up, then the runner discards the first of the measured samples. This is deliberately conservative: the first sample is the cold-clock sample. `tok_s` is the median of the remaining samples. No result is hand-edited.

## Qwen3 (`qwen3-4b`)

Quant **Q4_K_M** · 2.33 GiB · CPU MoE layers **0** · KV **f16-f16** · threads **8** · b/ub **1024/512**

| phase | test | tok/s (median) | ± std | min | max | eff. read GB/s | % roofline | VRAM peak MiB | GPU util % | power avg/max W | temp max °C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| prefill | pp512 | **4,216.12** | 7.88 | 4,203.53 | 4,327.10 | — | — | 2,875 | 98 | 75.0/80.2 | 69 |
| prefill | pp512@d4096 | **3,267.61** | 24.99 | 3,219.76 | 3,306.64 | — | — | 3,455 | 100 | 74.6/80.9 | 72 |
| decode | tg128 | **85.54** | 0.02 | 85.48 | 85.58 | 213.6 | 87.5 | 2,875 | 98 | 75.0/80.2 | 69 |
| decode | tg128@d4096 | **70.16** | 0.03 | 70.11 | 70.21 | 175.2 | 71.8 | 3,455 | 100 | 74.6/80.9 | 72 |

Telemetry: 15 samples; wall time 7,847 ms; load estimate 1,372 ms.

## Notes and limits

- `tok/s` for prefill is prompt-processing throughput; `tok/s` for decode is generation throughput.
- `eff. read GB/s` = decode tok/s × model file size. It is a lower bound: attention and KV reads add traffic. The denominator is the measured 244.2 GB/s device read bandwidth from `hardware_report.md`.
- `load_ms_est` is wall time minus measured test time; it includes CUDA init, model load, context creation and graph capture. Server-side load time is measured independently in `server_bench`.
- Rows with `n_cpu_moe > 0` include CPU compute for the offloaded MoE layers; their GPU utilization is not directly comparable to dense models.
- No A/B claim is made from a single run. The suite stores raw samples and the standard deviation; the report only presents measured values.
