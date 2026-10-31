# MoE en 8 GB VRAM + 16 GB RAM · qwen36-35b-a3b

Equipo: AMD Ryzen 7 7840HS w/ Radeon 780M Graphics      · 15.3 GiB RAM · RTX 4060 Laptop.

| Variante | Reparto | Hilos | Carga | Arranque | VRAM pico | RAM pico | Generación | Prompt largo |
|---|---|---:|---|---:|---:|---:|---:|---:|
| baseline | 18/40 GPU | 8 | none | 12.3 s | 6853 MiB | 6545 MiB | 38.7 tok/s | 816.5 tok/s (6271 tok) |
| cpu | todo CPU | 8 | mmap | 8.2 s | 2351 MiB | 10292 MiB | 9.4 tok/s | 239.4 tok/s (6271 tok) |
| batch12 | 18/40 GPU | 12 | none | 12.2 s | 6853 MiB | 6546 MiB | 42.5 tok/s | 818.1 tok/s (6271 tok) |
| mmap | 18/40 GPU | 12 | mmap | 11.7 s | 6853 MiB | 10254 MiB | 16.9 tok/s | 389.1 tok/s (6271 tok) |
| none | 18/40 GPU | 12 | none | 12.8 s | 6853 MiB | 6546 MiB | 42 tok/s | 816.2 tok/s (6271 tok) |

## Fallos


## Notas

- La primera pasada de cada modelo lee el GGUF del SSD; las siguientes reutilizan la page cache de Windows.
- `RAM pico` es el working set del proceso: incluye pesos mapeados y KV en host, no la page cache compartida.
- `prompt largo` mide el procesado de ~4k tokens: es donde más se nota el coste de traer expertos del SSD.
