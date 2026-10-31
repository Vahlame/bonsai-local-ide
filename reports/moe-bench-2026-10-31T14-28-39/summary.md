# MoE en 8 GB VRAM + 16 GB RAM · qwen3-30b-a3b-2507

Equipo: AMD Ryzen 7 7840HS w/ Radeon 780M Graphics      · 15.3 GiB RAM · RTX 4060 Laptop.

| Variante | Reparto | Hilos | Carga | Arranque | VRAM pico | RAM pico | Generación | Chat | Prompt largo |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| draft-qwen3-16k | 19/48 GPU | 12 | none | 10.8 s | 7273 MiB | 7262 MiB | 37.9 tok/s | 24.5 tok/s | 935.1 tok/s (6272 tok) |
| draft-qwen3-cpu | 19/48 GPU | 12 | none | 12.2 s | 7169 MiB | 10251 MiB | 19.7 tok/s | 19.1 tok/s | 524.4 tok/s (6272 tok) |

## Fallos


## Notas

- La primera pasada de cada modelo lee el GGUF del SSD; las siguientes reutilizan la page cache de Windows.
- `RAM pico` es el working set del proceso: incluye pesos mapeados y KV en host, no la page cache compartida.
- `prompt largo` mide el procesado de ~4k tokens: es donde más se nota el coste de traer expertos del SSD.
