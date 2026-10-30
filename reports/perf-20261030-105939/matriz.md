# RTX 4060 perf matrix - 20261030-105939

Model: C:\Users\user\Documents\prject_local_AI\models\Ornith-1.5-9B-Q4_K_M.gguf
Prompt=2048 Gen=128 Reps=2


## 01-baseline-b512-ub256-t4-mmap-f16

ggml_cuda_init: found 1 CUDA devices (Total VRAM: 8187 MiB):
  Device 0: NVIDIA GeForce RTX 4060 Laptop GPU, compute capability 8.9, VMM: yes, VRAM: 8187 MiB
| model                          |       size |     params | backend    | ngl | threads | n_batch | n_ubatch |     sm |  fa |         lm |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | ------: | ------: | -------: | -----: | --: | ---------: | --------------: | -------------------: |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |       4 |     512 |      256 |   none |   1 |       mmap |          pp2048 |       2199.89 ┬▒ 0.74 |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |       4 |     512 |      256 |   none |   1 |       mmap |           tg128 |         43.34 ┬▒ 0.03 |

build: 8642541 (10743)

## 02-ub128-b512-t4-f16

ggml_cuda_init: found 1 CUDA devices (Total VRAM: 8187 MiB):
  Device 0: NVIDIA GeForce RTX 4060 Laptop GPU, compute capability 8.9, VMM: yes, VRAM: 8187 MiB
| model                          |       size |     params | backend    | ngl | threads | n_batch | n_ubatch |     sm |  fa |         lm |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | ------: | ------: | -------: | -----: | --: | ---------: | --------------: | -------------------: |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |       4 |     512 |      128 |   none |   1 |       mmap |          pp2048 |       2036.56 ┬▒ 2.00 |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |       4 |     512 |      128 |   none |   1 |       mmap |           tg128 |         43.38 ┬▒ 0.02 |

build: 8642541 (10743)

## 03-ub512-b512-t4-f16

ggml_cuda_init: found 1 CUDA devices (Total VRAM: 8187 MiB):
  Device 0: NVIDIA GeForce RTX 4060 Laptop GPU, compute capability 8.9, VMM: yes, VRAM: 8187 MiB
| model                          |       size |     params | backend    | ngl | threads | n_batch |     sm |  fa |         lm |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | ------: | ------: | -----: | --: | ---------: | --------------: | -------------------: |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |       4 |     512 |   none |   1 |       mmap |          pp2048 |       2218.49 ┬▒ 0.03 |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |       4 |     512 |   none |   1 |       mmap |           tg128 |         43.44 ┬▒ 0.01 |

build: 8642541 (10743)

## 04-b1024-ub256-t4-f16

ggml_cuda_init: found 1 CUDA devices (Total VRAM: 8187 MiB):
  Device 0: NVIDIA GeForce RTX 4060 Laptop GPU, compute capability 8.9, VMM: yes, VRAM: 8187 MiB
| model                          |       size |     params | backend    | ngl | threads | n_batch | n_ubatch |     sm |  fa |         lm |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | ------: | ------: | -------: | -----: | --: | ---------: | --------------: | -------------------: |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |       4 |    1024 |      256 |   none |   1 |       mmap |          pp2048 |       2201.24 ┬▒ 3.39 |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |       4 |    1024 |      256 |   none |   1 |       mmap |           tg128 |         43.46 ┬▒ 0.04 |

build: 8642541 (10743)

## 05-b2048-ub256-t4-f16

ggml_cuda_init: found 1 CUDA devices (Total VRAM: 8187 MiB):
  Device 0: NVIDIA GeForce RTX 4060 Laptop GPU, compute capability 8.9, VMM: yes, VRAM: 8187 MiB
| model                          |       size |     params | backend    | ngl | threads | n_ubatch |     sm |  fa |         lm |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | ------: | -------: | -----: | --: | ---------: | --------------: | -------------------: |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |       4 |      256 |   none |   1 |       mmap |          pp2048 |       2202.55 ┬▒ 1.73 |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |       4 |      256 |   none |   1 |       mmap |           tg128 |         43.43 ┬▒ 0.01 |

build: 8642541 (10743)

## 06-t8-b512-ub256-f16

ggml_cuda_init: found 1 CUDA devices (Total VRAM: 8187 MiB):
  Device 0: NVIDIA GeForce RTX 4060 Laptop GPU, compute capability 8.9, VMM: yes, VRAM: 8187 MiB
| model                          |       size |     params | backend    | ngl | n_batch | n_ubatch |     sm |  fa |         lm |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | ------: | -------: | -----: | --: | ---------: | --------------: | -------------------: |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |     512 |      256 |   none |   1 |       mmap |          pp2048 |       2181.65 ┬▒ 0.90 |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |     512 |      256 |   none |   1 |       mmap |           tg128 |         43.43 ┬▒ 0.01 |

build: 8642541 (10743)

## 07-nommap-b512-ub256-t4-f16

ggml_cuda_init: found 1 CUDA devices (Total VRAM: 8187 MiB):
  Device 0: NVIDIA GeForce RTX 4060 Laptop GPU, compute capability 8.9, VMM: yes, VRAM: 8187 MiB
| model                          |       size |     params | backend    | ngl | threads | n_batch | n_ubatch |     sm |  fa |         lm |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | ------: | ------: | -------: | -----: | --: | ---------: | --------------: | -------------------: |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |       4 |     512 |      256 |   none |   1 |       none |          pp2048 |       2178.73 ┬▒ 2.57 |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |       4 |     512 |      256 |   none |   1 |       none |           tg128 |         43.42 ┬▒ 0.04 |

build: 8642541 (10743)

## 08-mlock-b512-ub256-t4-f16

ggml_cuda_init: found 1 CUDA devices (Total VRAM: 8187 MiB):
  Device 0: NVIDIA GeForce RTX 4060 Laptop GPU, compute capability 8.9, VMM: yes, VRAM: 8187 MiB
| model                          |       size |     params | backend    | ngl | threads | n_batch | n_ubatch |     sm |  fa |         lm |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | ------: | ------: | -------: | -----: | --: | ---------: | --------------: | -------------------: |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |       4 |     512 |      256 |   none |   1 |      mlock |          pp2048 |       2174.30 ┬▒ 1.48 |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |       4 |     512 |      256 |   none |   1 |      mlock |           tg128 |         43.44 ┬▒ 0.02 |

build: 8642541 (10743)

## 09-ub512-t8-nommap-f16

ggml_cuda_init: found 1 CUDA devices (Total VRAM: 8187 MiB):
  Device 0: NVIDIA GeForce RTX 4060 Laptop GPU, compute capability 8.9, VMM: yes, VRAM: 8187 MiB
| model                          |       size |     params | backend    | ngl | n_batch |     sm |  fa |         lm |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | ------: | -----: | --: | ---------: | --------------: | -------------------: |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |     512 |   none |   1 |       none |          pp2048 |       2204.11 ┬▒ 4.14 |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |     512 |   none |   1 |       none |           tg128 |         43.44 ┬▒ 0.02 |

build: 8642541 (10743)

## 10-q8kv-b512-ub256-t4

ggml_cuda_init: found 1 CUDA devices (Total VRAM: 8187 MiB):
  Device 0: NVIDIA GeForce RTX 4060 Laptop GPU, compute capability 8.9, VMM: yes, VRAM: 8187 MiB
| model                          |       size |     params | backend    | ngl | threads | n_batch | n_ubatch | type_k | type_v |     sm |  fa |         lm |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | ------: | ------: | -------: | -----: | -----: | -----: | --: | ---------: | --------------: | -------------------: |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |       4 |     512 |      256 |   q8_0 |   q8_0 |   none |   1 |       mmap |          pp2048 |       2159.26 ┬▒ 2.06 |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |       4 |     512 |      256 |   q8_0 |   q8_0 |   none |   1 |       mmap |           tg128 |         43.15 ┬▒ 0.01 |

build: 8642541 (10743)
