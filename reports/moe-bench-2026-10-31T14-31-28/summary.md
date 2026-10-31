# MoE en 8 GB VRAM + 16 GB RAM · qwen3-30b-a3b-2507

Equipo: AMD Ryzen 7 7840HS w/ Radeon 780M Graphics      · 15.3 GiB RAM · RTX 4060 Laptop.

| Variante | Reparto | Hilos | Carga | Arranque | VRAM pico | RAM pico | Generación | Chat | Prompt largo |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|

## Fallos

- **gpu-4** (4 capas más de expertos en GPU): llama-server terminó al arrancar: 0.00.311.582 I cmn  common_param: common_params_print_info: verbosity = 3 (adjust with the `-lv N` CLI arg) 0.00.318.999 I srv    load_model: loading model 'C:\Users\user\Documents\prject_local_AI\models\qwen3-30b-a3b-2507-Qwen3-30B-A3B-Instruct-2507-UD-Q2_K_XL.gguf' 0.01.257.582 W common_fit_params: failed to fit params to free device memory: n_gpu_layers already set by user to 99, abort
- **gpu-5** (5 capas más de expertos en GPU): llama-server terminó al arrancar: 0.00.329.619 I cmn  common_param: common_params_print_info: verbosity = 3 (adjust with the `-lv N` CLI arg) 0.00.337.566 I srv    load_model: loading model 'C:\Users\user\Documents\prject_local_AI\models\qwen3-30b-a3b-2507-Qwen3-30B-A3B-Instruct-2507-UD-Q2_K_XL.gguf' 0.01.293.223 W common_fit_params: failed to fit params to free device memory: n_gpu_layers already set by user to 99, abort

## Notas

- La primera pasada de cada modelo lee el GGUF del SSD; las siguientes reutilizan la page cache de Windows.
- `RAM pico` es el working set del proceso: incluye pesos mapeados y KV en host, no la page cache compartida.
- `prompt largo` mide el procesado de ~4k tokens: es donde más se nota el coste de traer expertos del SSD.
