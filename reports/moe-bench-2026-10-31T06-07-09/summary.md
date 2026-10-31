# MoE en 8 GB VRAM + 16 GB RAM · qwen36-35b-a3b

Equipo: AMD Ryzen 7 7840HS w/ Radeon 780M Graphics      · 15.3 GiB RAM · RTX 4060 Laptop.

| Variante | Reparto | Hilos | Arranque | VRAM pico | RAM pico | Generación | Prompt largo |
|---|---|---:|---:|---:|---:|---:|---:|
| baseline | 18/40 GPU | 8 | 10.3 s | 6829 MiB | 10429 MiB | 10.8 tok/s | 275.2 tok/s (6271 tok) |
| cpu | todo CPU | 8 | 7.7 s | 2329 MiB | 10475 MiB | 9.2 tok/s | 133.7 tok/s (6271 tok) |
| gpu-menos | 10/40 GPU | 8 | 9.2 s | 4861 MiB | 10581 MiB | 11.3 tok/s | 245.8 tok/s (6271 tok) |
| hilos16 | 18/40 GPU | 16 | 9.7 s | 6829 MiB | 10545 MiB | 23.8 tok/s | 340.6 tok/s (6271 tok) |
| batch1024 | 18/40 GPU | 8 | 9.7 s | 6853 MiB | 10702 MiB | 14.6 tok/s | 435.7 tok/s (6271 tok) |
| precarga | 18/40 GPU | 8 | 7.7 s | 6829 MiB | 10673 MiB | 22.1 tok/s | 326 tok/s (6271 tok) |

## Fallos

- **gpu-mas** (8 capas más de expertos en GPU): llama-server terminó al arrancar: 0.01.231.263 I cmn  common_param: common_params_print_info: verbosity = 3 (adjust with the `-lv N` CLI arg) 0.01.239.050 I srv    load_model: loading model 'C:\Users\user\Documents\prject_local_AI\models\qwen36-35b-a3b-Qwen3.6-35B-A3B-UD-Q2_K_XL.gguf' 0.02.764.811 W common_fit_params: failed to fit params to free device memory: n_gpu_layers already set by user to 99, abort

## Notas

- La primera pasada de cada modelo lee el GGUF del SSD; las siguientes reutilizan la page cache de Windows.
- `RAM pico` es el working set del proceso: incluye pesos mapeados y KV en host, no la page cache compartida.
- `prompt largo` mide el procesado de ~4k tokens: es donde más se nota el coste de traer expertos del SSD.
