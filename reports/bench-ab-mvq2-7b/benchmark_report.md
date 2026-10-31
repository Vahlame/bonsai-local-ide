# Benchmark report — RTX 4060 8 GB lab

Run: `ab-mvq2-7b`  
Suite: `core`  
Started: `2026-10-31T21:14:37+00:00`  
Binary: `C:\Users\user\Documents\prject_local_AI\bin\builds\lab-mvq2\bin\llama-bench.exe`  
Build: `lab-mvq2` · commit `8642541`  
GPU: NVIDIA GeForce RTX 4060 Laptop GPU · driver 617.14  
Measured VRAM read ceiling: **244.21 GB/s**  

Warm-up policy: llama-bench performs its own warm-up, then the runner discards the first of the measured samples. This is deliberately conservative: the first sample is the cold-clock sample. `tok_s` is the median of the remaining samples. No result is hand-edited.

## Qwen2.5 Coder (`qwen25-coder-7b`)

Quant **Q4_K_M** · 4.36 GiB · CPU MoE layers **0** · KV **f16-f16** · threads **8** · b/ub **1024/512**

| phase | test | tok/s (median) | ± std | min | max | eff. read GB/s | % roofline | VRAM peak MiB | GPU util % | power avg/max W | temp max °C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| prefill | pp512 | **2,635.16** | 3.68 | 2,625.87 | 2,640.29 | — | — | 4,637 | 100 | 77.8/80.3 | 71 |
| decode | tg128 | **51.99** | 0.01 | 51.97 | 52.02 | 243.5 | 99.7 | 4,637 | 100 | 77.8/80.3 | 71 |

Telemetry: 24 samples; wall time 12,450 ms; load estimate 1,822 ms.

## Notes and limits

- `tok/s` for prefill is prompt-processing throughput; `tok/s` for decode is generation throughput.
- `eff. read GB/s` = decode tok/s × model file size. It is a lower bound: attention and KV reads add traffic. The denominator is the measured 244.2 GB/s device read bandwidth from `hardware_report.md`.
- `load_ms_est` is wall time minus measured test time; it includes CUDA init, model load, context creation and graph capture. Server-side load time is measured independently in `server_bench`.
- Rows with `n_cpu_moe > 0` include CPU compute for the offloaded MoE layers; their GPU utilization is not directly comparable to dense models.
- No A/B claim is made from a single run. The suite stores raw samples and the standard deviation; the report only presents measured values.
