# MoE en 8 GB VRAM + 16 GB RAM · qwen3-30b-a3b-2507

Equipo: AMD Ryzen 7 7840HS w/ Radeon 780M Graphics      · 15.3 GiB RAM · RTX 4060 Laptop.

| Variante | Reparto | Hilos | Carga | Arranque | VRAM pico | RAM pico | Generación | Chat | Prompt largo |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| baseline | 19/48 GPU | 12 | none | 8.7 s | 6889 MiB | 6985 MiB | 44.3 tok/s | 44.5 tok/s | 1011.8 tok/s (6272 tok) |
| ngram-simple | 19/48 GPU | 12 | none | 8.7 s | 6891 MiB | 7008 MiB | 71.6 tok/s | 44.5 tok/s | 1011 tok/s (6272 tok) |
| ngram-map-k | 19/48 GPU | 12 | none | 9.2 s | 6891 MiB | 7009 MiB | 52.8 tok/s | 44.5 tok/s | 1011.1 tok/s (6272 tok) |
| ngram-mod | 19/48 GPU | 12 | none | 9.2 s | 6891 MiB | 7031 MiB | 63.8 tok/s | 44.8 tok/s | 1009.8 tok/s (6272 tok) |
| prio2 | 19/48 GPU | 12 | none | 8.7 s | 6889 MiB | 6987 MiB | 41.7 tok/s | 40.5 tok/s | 1011.7 tok/s (6272 tok) |
| poll0 | 19/48 GPU | 12 | none | 8.7 s | 6889 MiB | 6986 MiB | 44.1 tok/s | 44.8 tok/s | 1011.5 tok/s (6272 tok) |
| tb16 | 19/48 GPU | 12 | none | 9.2 s | 6889 MiB | 6988 MiB | 43.7 tok/s | 43.1 tok/s | 1009.2 tok/s (6272 tok) |
| norepack | 19/48 GPU | 12 | none | 9.2 s | 6889 MiB | 6987 MiB | 42 tok/s | 42.5 tok/s | 1005.2 tok/s (6272 tok) |
| kvq4 | 19/48 GPU | 12 | none | 8.7 s | 6121 MiB | 6987 MiB | 44.1 tok/s | 44.5 tok/s | 952.8 tok/s (6272 tok) |
| ctx16k | 19/48 GPU | 12 | none | 9.2 s | 6057 MiB | 6970 MiB | 43.7 tok/s | 44.1 tok/s | 1010.1 tok/s (6272 tok) |
| batch2048 | 19/48 GPU | 12 | none | 9.2 s | 6991 MiB | 7024 MiB | 36.2 tok/s | 41 tok/s | 1343.6 tok/s (6272 tok) |
| mask12 | 19/48 GPU | 12 | none | 8.7 s | 6889 MiB | 6960 MiB | 41.2 tok/s | 42.1 tok/s | 1009.4 tok/s (6272 tok) |

## Fallos

- **draft-qwen3** (draft Qwen3 0.6B (n=4)): llama-server terminó al arrancar: 0.00.318.340 I cmn  common_param: common_params_print_info: verbosity = 3 (adjust with the `-lv N` CLI arg) 0.00.321.303 I srv    load_model: loading model 'C:\Users\user\Documents\prject_local_AI\models\qwen3-30b-a3b-2507-Qwen3-30B-A3B-Instruct-2507-UD-Q2_K_XL.gguf' 0.01.659.368 W common_fit_params: failed to fit params to free device memory: n_gpu_layers already set by user to 99, abort
- **draft-qwen3-8** (draft Qwen3 0.6B (n=8)): llama-server terminó al arrancar: 0.00.319.923 I cmn  common_param: common_params_print_info: verbosity = 3 (adjust with the `-lv N` CLI arg) 0.00.324.152 I srv    load_model: loading model 'C:\Users\user\Documents\prject_local_AI\models\qwen3-30b-a3b-2507-Qwen3-30B-A3B-Instruct-2507-UD-Q2_K_XL.gguf' 0.01.724.876 W common_fit_params: failed to fit params to free device memory: n_gpu_layers already set by user to 99, abort

## Notas

- La primera pasada de cada modelo lee el GGUF del SSD; las siguientes reutilizan la page cache de Windows.
- `RAM pico` es el working set del proceso: incluye pesos mapeados y KV en host, no la page cache compartida.
- `prompt largo` mide el procesado de ~4k tokens: es donde más se nota el coste de traer expertos del SSD.
