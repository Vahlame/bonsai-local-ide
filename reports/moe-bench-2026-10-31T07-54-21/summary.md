# MoE en 8 GB VRAM + 16 GB RAM · nemotron3-nano-30b

Equipo: AMD Ryzen 7 7840HS w/ Radeon 780M Graphics      · 15.3 GiB RAM · RTX 4060 Laptop.

| Variante | Reparto | Hilos | Carga | Arranque | VRAM pico | RAM pico | Generación | Chat | Prompt largo |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| baseline | 15/52 GPU | 12 | mmap | 9.2 s | 6961 MiB | 10759 MiB | 29.9 tok/s | 25.7 tok/s | 401.8 tok/s (6273 tok) |
| cpu | todo CPU | 8 | mmap | 6.7 s | 2167 MiB | 11786 MiB | 18.3 tok/s | 8.2 tok/s | 41.9 tok/s (6273 tok) |
| mmap | 15/52 GPU | 12 | mmap | 9.7 s | 6961 MiB | 11618 MiB | 29.3 tok/s | 24.9 tok/s | 411.4 tok/s (6273 tok) |
| none | 15/52 GPU | 12 | none | 18.8 s | 6961 MiB | 11458 MiB | 40 tok/s | 39.7 tok/s | 523.7 tok/s (6273 tok) |

## Fallos


## Notas

- La primera pasada de cada modelo lee el GGUF del SSD; las siguientes reutilizan la page cache de Windows.
- `RAM pico` es el working set del proceso: incluye pesos mapeados y KV en host, no la page cache compartida.
- `prompt largo` mide el procesado de ~4k tokens: es donde más se nota el coste de traer expertos del SSD.
