# MoE en 8 GB VRAM + 16 GB RAM · qwen3-30b-a3b-2507

Equipo: AMD Ryzen 7 7840HS w/ Radeon 780M Graphics      · 15.3 GiB RAM · RTX 4060 Laptop.

| Variante | Reparto | Hilos | Carga | Arranque | VRAM pico | RAM pico | Generación | Chat | Prompt largo |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| gpu-3 | 22/48 GPU | 12 | none | 10.3 s | 7537 MiB | 6337 MiB | 46.4 tok/s | 45.5 tok/s | 1056 tok/s (6272 tok) |
| gpu-3-kvq4 | 22/48 GPU | 12 | none | 9.2 s | 6769 MiB | 6337 MiB | 43.6 tok/s | 43.7 tok/s | 985.3 tok/s (6272 tok) |
| gpu-3-16k | 22/48 GPU | 12 | none | 8.7 s | 6705 MiB | 6318 MiB | 42.8 tok/s | 43.7 tok/s | 1051.3 tok/s (6272 tok) |

## Fallos

- **gpu-6** (6 capas más de expertos en GPU): llama-server terminó al arrancar: 0.00.348.148 I cmn  common_param: common_params_print_info: verbosity = 3 (adjust with the `-lv N` CLI arg) 0.00.352.994 I srv    load_model: loading model 'C:\Users\user\Documents\prject_local_AI\models\qwen3-30b-a3b-2507-Qwen3-30B-A3B-Instruct-2507-UD-Q2_K_XL.gguf' 0.01.278.673 W common_fit_params: failed to fit params to free device memory: n_gpu_layers already set by user to 99, abort

## Notas

- La primera pasada de cada modelo lee el GGUF del SSD; las siguientes reutilizan la page cache de Windows.
- `RAM pico` es el working set del proceso: incluye pesos mapeados y KV en host, no la page cache compartida.
- `prompt largo` mide el procesado de ~4k tokens: es donde más se nota el coste de traer expertos del SSD.
