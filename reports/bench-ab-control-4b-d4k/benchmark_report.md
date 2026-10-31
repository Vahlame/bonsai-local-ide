# Benchmark report — RTX 4060 8 GB lab

Run: `ab-control-4b-d4k`  
Suite: `core`  
Started: `2026-10-31T21:15:30+00:00`  
Binary: `C:\Users\user\Documents\prject_local_AI\bin\builds\lab-control\bin\llama-bench.exe`  
Build: `lab-control` · commit `8642541`  
GPU: NVIDIA GeForce RTX 4060 Laptop GPU · driver 617.14  
Measured VRAM read ceiling: **244.21 GB/s**  

Warm-up policy: llama-bench performs its own warm-up, then the runner discards the first of the measured samples. This is deliberately conservative: the first sample is the cold-clock sample. `tok_s` is the median of the remaining samples. No result is hand-edited.

## Qwen3 (`qwen3-4b`)

Quant **Q4_K_M** · 2.33 GiB · CPU MoE layers **0** · KV **f16-f16** · threads **8** · b/ub **1024/512**

| phase | test | tok/s (median) | ± std | min | max | eff. read GB/s | % roofline | VRAM peak MiB | GPU util % | power avg/max W | temp max °C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| prefill | pp512 | **4,216.94** | 9.76 | 4,208.19 | 4,230.60 | — | — | 2,875 | 98 | 74.1/80.7 | 67 |
| prefill | pp512@d4096 | **3,244.34** | 31.62 | 3,188.06 | 3,265.43 | — | — | 3,455 | 100 | 73.8/81.5 | 70 |
| decode | tg128 | **81.95** | 0.07 | 81.86 | 82.09 | 204.7 | 83.8 | 2,875 | 98 | 74.1/80.7 | 67 |
| decode | tg128@d4096 | **67.79** | 0.02 | 67.75 | 67.90 | 169.3 | 69.3 | 3,455 | 100 | 73.8/81.5 | 70 |

Telemetry: 17 samples; wall time 8,706 ms; load estimate 1,975 ms.

## Notes and limits

- `tok/s` for prefill is prompt-processing throughput; `tok/s` for decode is generation throughput.
- `eff. read GB/s` = decode tok/s × model file size. It is a lower bound: attention and KV reads add traffic. The denominator is the measured 244.2 GB/s device read bandwidth from `hardware_report.md`.
- `load_ms_est` is wall time minus measured test time; it includes CUDA init, model load, context creation and graph capture. Server-side load time is measured independently in `server_bench`.
- Rows with `n_cpu_moe > 0` include CPU compute for the offloaded MoE layers; their GPU utilization is not directly comparable to dense models.
- No A/B claim is made from a single run. The suite stores raw samples and the standard deviation; the report only presents measured values.
