# MoE en 8 GB VRAM + 16 GB RAM · gpt-oss-20b

Equipo: AMD Ryzen 7 7840HS w/ Radeon 780M Graphics      · 15.3 GiB RAM · RTX 4060 Laptop.

| Variante | Reparto | Hilos | Carga | Arranque | VRAM pico | RAM pico | Generación | Chat | Prompt largo |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| baseline | 10/24 GPU | 12 | none | 11.3 s | 6069 MiB | 6927 MiB | 32.3 tok/s | 32.5 tok/s | 970.6 tok/s (5280 tok) |
| cpu | todo CPU | 8 | mmap | 7.2 s | 2027 MiB | 10487 MiB | 19.5 tok/s | 24.1 tok/s | 635.7 tok/s (5280 tok) |
| mmap | 10/24 GPU | 12 | mmap | 9.7 s | 6069 MiB | 10459 MiB | 28.5 tok/s | 31.8 tok/s | 872.9 tok/s (5280 tok) |
| none | 10/24 GPU | 12 | none | 11.2 s | 6069 MiB | 6928 MiB | 32.6 tok/s | 32.8 tok/s | 972.2 tok/s (5280 tok) |

## Fallos


## Notas

- La primera pasada de cada modelo lee el GGUF del SSD; las siguientes reutilizan la page cache de Windows.
- `RAM pico` es el working set del proceso: incluye pesos mapeados y KV en host, no la page cache compartida.
- `prompt largo` mide el procesado de ~4k tokens: es donde más se nota el coste de traer expertos del SSD.
