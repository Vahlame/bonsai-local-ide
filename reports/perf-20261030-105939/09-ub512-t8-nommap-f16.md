ggml_cuda_init: found 1 CUDA devices (Total VRAM: 8187 MiB):
  Device 0: NVIDIA GeForce RTX 4060 Laptop GPU, compute capability 8.9, VMM: yes, VRAM: 8187 MiB
| model                          |       size |     params | backend    | ngl | n_batch |     sm |  fa |         lm |            test |                  t/s |
| ------------------------------ | ---------: | ---------: | ---------- | --: | ------: | -----: | --: | ---------: | --------------: | -------------------: |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |     512 |   none |   1 |       none |          pp2048 |       2204.11 ┬▒ 4.14 |
| qwen35 9B Q4_K - Medium        |   5.37 GiB |     9.20 B | CUDA       |  99 |     512 |   none |   1 |       none |           tg128 |         43.44 ┬▒ 0.02 |

build: 8642541 (10743)
