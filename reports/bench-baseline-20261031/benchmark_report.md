# Benchmark report — RTX 4060 8 GB lab

Run: `baseline-20261031`  
Suite: `core`  
Started: `2026-10-31T20:13:11+00:00`  
Binary: `C:\Users\user\.local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-bench.exe`  
Build: `build-RTX4060-Opt-sm89` · commit `8642541`  
GPU: NVIDIA GeForce RTX 4060 Laptop GPU · driver 617.14  
Measured VRAM read ceiling: **244.21 GB/s**  

Warm-up policy: llama-bench performs its own warm-up, then the runner discards the first of the measured samples. This is deliberately conservative: the first sample is the cold-clock sample. `tok_s` is the median of the remaining samples. No result is hand-edited.

## Qwen3 (`qwen3-4b`)

Quant **Q4_K_M** · 2.33 GiB · CPU MoE layers **0** · KV **f16-f16** · threads **8** · b/ub **1024/512**

| phase | test | tok/s (median) | ± std | min | max | eff. read GB/s | % roofline | VRAM peak MiB | GPU util % | power avg/max W | temp max °C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| prefill | pp128 | **3,661.74** | 7.72 | 3,646.20 | 3,663.32 | — | — | 3,963 | 100 | 78.5/81.3 | 69 |
| prefill | pp2048 | **4,017.26** | 17.63 | 4,009.58 | 4,050.22 | — | — | 3,963 | 100 | 78.5/81.3 | 69 |
| prefill | pp512 | **4,265.82** | 14.00 | 4,242.13 | 4,275.46 | — | — | 3,963 | 100 | 78.5/81.3 | 69 |
| prefill | pp8192 | **3,294.06** | 2.93 | 3,288.14 | 3,294.62 | — | — | 3,963 | 100 | 78.5/81.3 | 69 |
| decode | tg128 | **81.86** | 0.06 | 81.85 | 81.98 | 204.4 | 83.7 | 3,963 | 100 | 78.5/81.3 | 69 |
| decode | tg256 | **81.88** | 0.01 | 81.87 | 81.89 | 204.5 | 83.7 | 3,963 | 100 | 78.5/81.3 | 69 |
| decode | tg32 | **82.16** | 0.26 | 81.80 | 82.42 | 205.2 | 84.0 | 3,963 | 100 | 78.5/81.3 | 69 |

Telemetry: 70 samples; wall time 37,600 ms; load estimate 4,684 ms.

## Qwen2.5 Coder (`qwen25-coder-7b`)

Quant **Q4_K_M** · 4.36 GiB · CPU MoE layers **0** · KV **f16-f16** · threads **8** · b/ub **1024/512**

| phase | test | tok/s (median) | ± std | min | max | eff. read GB/s | % roofline | VRAM peak MiB | GPU util % | power avg/max W | temp max °C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| prefill | pp128 | **2,260.19** | 0.46 | 2,259.51 | 2,260.62 | — | — | 5,065 | 100 | 79.2/80.4 | 75 |
| prefill | pp2048 | **2,563.94** | 1.93 | 2,562.67 | 2,567.24 | — | — | 5,065 | 100 | 79.2/80.4 | 75 |
| prefill | pp512 | **2,640.42** | 11.97 | 2,618.86 | 2,646.86 | — | — | 5,065 | 100 | 79.2/80.4 | 75 |
| prefill | pp8192 | **2,301.48** | 1.71 | 2,299.22 | 2,303.40 | — | — | 5,065 | 100 | 79.2/80.4 | 75 |
| decode | tg128 | **52.13** | 0.02 | 52.09 | 52.13 | 244.1 | 100.0 | 5,065 | 100 | 79.2/80.4 | 75 |
| decode | tg256 | **52.22** | 0.01 | 52.20 | 52.23 | 244.6 | 100.1 | 5,065 | 100 | 79.2/80.4 | 75 |
| decode | tg32 | **52.20** | 0.03 | 52.14 | 52.21 | 244.4 | 100.1 | 5,065 | 100 | 79.2/80.4 | 75 |

Telemetry: 108 samples; wall time 57,840 ms; load estimate 7,504 ms.

## Ornith 1.5 (`ornith9b`)

Quant **Q4_K_M** · 5.38 GiB · CPU MoE layers **0** · KV **f16-f16** · threads **8** · b/ub **1024/512**

| phase | test | tok/s (median) | ± std | min | max | eff. read GB/s | % roofline | VRAM peak MiB | GPU util % | power avg/max W | temp max °C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| prefill | pp128 | **1,921.71** | 41.62 | 1,914.77 | 2,006.32 | — | — | 5,763 | 100 | 79.5/81.2 | 77 |
| prefill | pp2048 | **2,212.90** | 2.59 | 2,208.33 | 2,214.43 | — | — | 5,763 | 100 | 79.5/81.2 | 77 |
| prefill | pp512 | **2,231.34** | 21.75 | 2,186.53 | 2,233.89 | — | — | 5,763 | 100 | 79.5/81.2 | 77 |
| prefill | pp8192 | **2,150.38** | 0.52 | 2,149.76 | 2,151.04 | — | — | 5,763 | 100 | 79.5/81.2 | 77 |
| decode | tg128 | **43.36** | 0.01 | 43.34 | 43.36 | 250.6 | 102.6 | 5,763 | 100 | 79.5/81.2 | 77 |
| decode | tg256 | **43.40** | 0.01 | 43.39 | 43.41 | 250.8 | 102.7 | 5,763 | 100 | 79.5/81.2 | 77 |
| decode | tg32 | **42.91** | 0.02 | 42.88 | 42.94 | 248.0 | 101.6 | 5,763 | 100 | 79.5/81.2 | 77 |

Telemetry: 126 samples; wall time 67,490 ms; load estimate 8,977 ms.

## GPT-OSS (`gpt-oss-20b`)

Quant **MXFP4** · 11.28 GiB · CPU MoE layers **16** · KV **q8_0-q8_0** · threads **12** · b/ub **1024/512**

| phase | test | tok/s (median) | ± std | min | max | eff. read GB/s | % roofline | VRAM peak MiB | GPU util % | power avg/max W | temp max °C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| prefill | pp128 | **278.88** | 10.88 | 270.30 | 296.44 | — | — | 5,145 | 99 | 48.6/52.1 | 71 |
| prefill | pp2048 | **911.85** | 3.27 | 910.97 | 918.29 | — | — | 5,145 | 99 | 48.6/52.1 | 71 |
| prefill | pp512 | **883.35** | 16.41 | 856.03 | 895.23 | — | — | 5,145 | 99 | 48.6/52.1 | 71 |
| prefill | pp8192 | **902.29** | 1.84 | 901.88 | 905.97 | — | — | 5,145 | 99 | 48.6/52.1 | 71 |
| decode | tg128 | **26.20** | 0.05 | 26.15 | 26.27 | 317.2 | 129.9 | 5,145 | 99 | 48.6/52.1 | 71 |
| decode | tg256 | **25.89** | 0.11 | 25.82 | 26.07 | 313.5 | 128.4 | 5,145 | 99 | 48.6/52.1 | 71 |
| decode | tg32 | **30.93** | 0.29 | 30.38 | 31.05 | 374.5 | 153.3 | 5,145 | 99 | 48.6/52.1 | 71 |

Telemetry: 248 samples; wall time 135,403 ms; load estimate 23,036 ms.

## Notes and limits

- `tok/s` for prefill is prompt-processing throughput; `tok/s` for decode is generation throughput.
- `eff. read GB/s` = decode tok/s × model file size. It is a lower bound: attention and KV reads add traffic. The denominator is the measured 244.2 GB/s device read bandwidth from `hardware_report.md`.
- `load_ms_est` is wall time minus measured test time; it includes CUDA init, model load, context creation and graph capture. Server-side load time is measured independently in `server_bench`.
- Rows with `n_cpu_moe > 0` include CPU compute for the offloaded MoE layers; their GPU utilization is not directly comparable to dense models.
- No A/B claim is made from a single run. The suite stores raw samples and the standard deviation; the report only presents measured values.
