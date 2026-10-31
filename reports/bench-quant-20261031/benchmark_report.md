# Benchmark report — RTX 4060 8 GB lab

Run: `quant-20261031`  
Suite: `quant`  
Started: `2026-10-31T20:23:19+00:00`  
Binary: `C:\Users\user\.local\opt\bonsai-inference\build-RTX4060-Opt-sm89\bin\llama-bench.exe`  
Build: `build-RTX4060-Opt-sm89` · commit `8642541`  
GPU: NVIDIA GeForce RTX 4060 Laptop GPU · driver 617.14  
Measured VRAM read ceiling: **244.21 GB/s**  

Warm-up policy: llama-bench performs its own warm-up, then the runner discards the first of the measured samples. This is deliberately conservative: the first sample is the cold-clock sample. `tok_s` is the median of the remaining samples. No result is hand-edited.

## Qwen3 (`qwen3-4b-q8`)

Quant **Q8_0** · 3.99 GiB · CPU MoE layers **0** · KV **f16-f16** · threads **8** · b/ub **1024/512**

| phase | test | tok/s (median) | ± std | min | max | eff. read GB/s | % roofline | VRAM peak MiB | GPU util % | power avg/max W | temp max °C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| prefill | pp2048 | **4,196.63** | 16.71 | 4,181.76 | 4,222.23 | — | — | 5,665 | 100 | 78.2/81.7 | 69 |
| prefill | pp512 | **4,465.27** | 11.27 | 4,451.06 | 4,478.67 | — | — | 5,665 | 100 | 78.2/81.7 | 69 |
| prefill | pp8192 | **3,401.37** | 2.72 | 3,396.11 | 3,402.29 | — | — | 5,665 | 100 | 78.2/81.7 | 69 |
| decode | tg128 | **52.95** | 0.04 | 52.87 | 52.95 | 226.6 | 92.8 | 5,665 | 100 | 78.2/81.7 | 69 |
| decode | tg256 | **52.97** | 0.01 | 52.94 | 52.98 | 226.7 | 92.8 | 5,665 | 100 | 78.2/81.7 | 69 |
| decode | tg32 | **52.91** | 0.02 | 52.88 | 52.93 | 226.5 | 92.8 | 5,665 | 100 | 78.2/81.7 | 69 |

Telemetry: 90 samples; wall time 48,385 ms; load estimate 4,920 ms.

## Qwen3 (`qwen3-4b-q6`)

Quant **Q6_K** · 3.08 GiB · CPU MoE layers **0** · KV **f16-f16** · threads **8** · b/ub **1024/512**

| phase | test | tok/s (median) | ± std | min | max | eff. read GB/s | % roofline | VRAM peak MiB | GPU util % | power avg/max W | temp max °C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| prefill | pp2048 | **3,650.69** | 7.85 | 3,637.82 | 3,656.63 | — | — | 4,735 | 100 | 78.8/80.3 | 76 |
| prefill | pp512 | **3,838.13** | 32.12 | 3,833.09 | 3,903.60 | — | — | 4,735 | 100 | 78.8/80.3 | 76 |
| prefill | pp8192 | **3,024.96** | 0.77 | 3,023.63 | 3,025.46 | — | — | 4,735 | 100 | 78.8/80.3 | 76 |
| decode | tg128 | **65.54** | 0.17 | 65.22 | 65.60 | 216.7 | 88.7 | 4,735 | 100 | 78.8/80.3 | 76 |
| decode | tg256 | **65.49** | 0.08 | 65.34 | 65.53 | 216.5 | 88.7 | 4,735 | 100 | 78.8/80.3 | 76 |
| decode | tg32 | **65.60** | 0.14 | 65.31 | 65.63 | 216.9 | 88.8 | 4,735 | 100 | 78.8/80.3 | 76 |

Telemetry: 83 samples; wall time 44,605 ms; load estimate 5,572 ms.

## Qwen3 (`qwen3-4b-q5`)

Quant **Q5_K_M** · 2.69 GiB · CPU MoE layers **0** · KV **f16-f16** · threads **8** · b/ub **1024/512**

| phase | test | tok/s (median) | ± std | min | max | eff. read GB/s | % roofline | VRAM peak MiB | GPU util % | power avg/max W | temp max °C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| prefill | pp2048 | **3,839.93** | 0.49 | 3,839.12 | 3,840.29 | — | — | 4,337 | 100 | 78.8/80.8 | 77 |
| prefill | pp512 | **4,045.95** | 14.28 | 4,041.27 | 4,073.62 | — | — | 4,337 | 100 | 78.8/80.8 | 77 |
| prefill | pp8192 | **3,152.76** | 1.16 | 3,151.86 | 3,154.64 | — | — | 4,337 | 100 | 78.8/80.8 | 77 |
| decode | tg128 | **71.53** | 0.02 | 71.52 | 71.56 | 206.7 | 84.6 | 4,337 | 100 | 78.8/80.8 | 77 |
| decode | tg256 | **71.59** | 0.01 | 71.58 | 71.59 | 206.8 | 84.7 | 4,337 | 100 | 78.8/80.8 | 77 |
| decode | tg32 | **71.56** | 0.13 | 71.36 | 71.68 | 206.8 | 84.7 | 4,337 | 100 | 78.8/80.8 | 77 |

Telemetry: 78 samples; wall time 41,600 ms; load estimate 5,312 ms.

## Qwen3 (`qwen3-4b-q4`)

Quant **Q4_K_M** · 2.33 GiB · CPU MoE layers **0** · KV **f16-f16** · threads **8** · b/ub **1024/512**

| phase | test | tok/s (median) | ± std | min | max | eff. read GB/s | % roofline | VRAM peak MiB | GPU util % | power avg/max W | temp max °C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| prefill | pp2048 | **3,950.60** | 4.14 | 3,950.48 | 3,959.33 | — | — | 3,963 | 100 | 78.7/80.6 | 78 |
| prefill | pp512 | **4,186.78** | 32.50 | 4,169.69 | 4,245.57 | — | — | 3,963 | 100 | 78.7/80.6 | 78 |
| prefill | pp8192 | **3,233.70** | 1.28 | 3,232.72 | 3,235.79 | — | — | 3,963 | 100 | 78.7/80.6 | 78 |
| decode | tg128 | **81.90** | 0.01 | 81.88 | 81.91 | 204.5 | 83.8 | 3,963 | 100 | 78.7/80.6 | 78 |
| decode | tg256 | **81.91** | 0.03 | 81.86 | 81.93 | 204.6 | 83.8 | 3,963 | 100 | 78.7/80.6 | 78 |
| decode | tg32 | **81.96** | 0.13 | 81.76 | 82.06 | 204.7 | 83.8 | 3,963 | 100 | 78.7/80.6 | 78 |

Telemetry: 72 samples; wall time 38,223 ms; load estimate 5,209 ms.

## Qwen3 (`qwen3-4b-q3`)

Quant **Q3_K_M** · 1.93 GiB · CPU MoE layers **0** · KV **f16-f16** · threads **8** · b/ub **1024/512**

| phase | test | tok/s (median) | ± std | min | max | eff. read GB/s | % roofline | VRAM peak MiB | GPU util % | power avg/max W | temp max °C |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| prefill | pp2048 | **3,621.90** | 11.57 | 3,597.84 | 3,622.83 | — | — | 3,561 | 100 | 79.1/80.4 | 79 |
| prefill | pp512 | **3,813.79** | 31.75 | 3,757.32 | 3,831.85 | — | — | 3,561 | 100 | 79.1/80.4 | 79 |
| prefill | pp8192 | **3,002.02** | 0.94 | 3,000.43 | 3,002.66 | — | — | 3,561 | 100 | 79.1/80.4 | 79 |
| decode | tg128 | **90.83** | 0.07 | 90.78 | 90.94 | 188.5 | 77.2 | 3,561 | 100 | 79.1/80.4 | 79 |
| decode | tg256 | **90.72** | 0.08 | 90.69 | 90.87 | 188.3 | 77.1 | 3,561 | 100 | 79.1/80.4 | 79 |
| decode | tg32 | **90.78** | 0.32 | 90.69 | 91.41 | 188.4 | 77.2 | 3,561 | 100 | 79.1/80.4 | 79 |

Telemetry: 70 samples; wall time 37,230 ms; load estimate 5,179 ms.

## Notes and limits

- `tok/s` for prefill is prompt-processing throughput; `tok/s` for decode is generation throughput.
- `eff. read GB/s` = decode tok/s × model file size. It is a lower bound: attention and KV reads add traffic. The denominator is the measured 244.2 GB/s device read bandwidth from `hardware_report.md`.
- `load_ms_est` is wall time minus measured test time; it includes CUDA init, model load, context creation and graph capture. Server-side load time is measured independently in `server_bench`.
- Rows with `n_cpu_moe > 0` include CPU compute for the offloaded MoE layers; their GPU utilization is not directly comparable to dense models.
- No A/B claim is made from a single run. The suite stores raw samples and the standard deviation; the report only presents measured values.
