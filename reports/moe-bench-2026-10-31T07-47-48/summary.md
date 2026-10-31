# MoE en 8 GB VRAM + 16 GB RAM · qwen3-30b-a3b-2507

Equipo: AMD Ryzen 7 7840HS w/ Radeon 780M Graphics      · 15.3 GiB RAM · RTX 4060 Laptop.

| Variante | Reparto | Hilos | Carga | Arranque | VRAM pico | RAM pico | Generación | Chat | Prompt largo |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| baseline | 19/48 GPU | 12 | none | 10.3 s | 6889 MiB | 6987 MiB | 41 tok/s | 41.8 tok/s | 1008.5 tok/s (6272 tok) |
| cpu | todo CPU | 8 | mmap | 5.7 s | 2771 MiB | 9519 MiB | 15.3 tok/s | 31.2 tok/s | 511.8 tok/s (6272 tok) |
| mmap | 19/48 GPU | 12 | mmap | 8.2 s | 6889 MiB | 10019 MiB | 24.6 tok/s | 38.3 tok/s | 772 tok/s (6272 tok) |
| none | 19/48 GPU | 12 | none | 10.2 s | 6889 MiB | 6985 MiB | 44.2 tok/s | 44.9 tok/s | 1008.9 tok/s (6272 tok) |

## Fallos


## Notas

- La primera pasada de cada modelo lee el GGUF del SSD; las siguientes reutilizan la page cache de Windows.
- `RAM pico` es el working set del proceso: incluye pesos mapeados y KV en host, no la page cache compartida.
- `prompt largo` mide el procesado de ~4k tokens: es donde más se nota el coste de traer expertos del SSD.
