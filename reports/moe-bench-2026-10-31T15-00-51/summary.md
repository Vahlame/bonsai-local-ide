# MoE en 8 GB VRAM + 16 GB RAM · gpt-oss-20b

Equipo: AMD Ryzen 7 7840HS w/ Radeon 780M Graphics      · 15.3 GiB RAM · RTX 4060 Laptop.

| Variante | Reparto | Hilos | Carga | Arranque | VRAM pico | RAM pico | Generación | Chat | Prompt largo |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| baseline | 10/24 GPU | 12 | none | 10.7 s | 6069 MiB | 6927 MiB | 32.5 tok/s | 33.1 tok/s | 971 tok/s (5280 tok) |
| ctx64 | 8/24 GPU | 12 | none | 10.7 s | 5699 MiB | 7732 MiB | 29.2 tok/s | 31 tok/s | 897.4 tok/s (5280 tok) |
| ctx96 | 6/24 GPU | 12 | none | 14.2 s | 5359 MiB | 8607 MiB | 24.1 tok/s | 28.4 tok/s | 766.5 tok/s (5280 tok) |
| ctx128 | 4/24 GPU | 12 | none | 15.2 s | 5053 MiB | 9454 MiB | 22.5 tok/s | 27.1 tok/s | 737.1 tok/s (5280 tok) |
| ctx128q4 | 7/24 GPU | 12 | none | 13.7 s | 5495 MiB | 8242 MiB | 25.6 tok/s | 29.4 tok/s | 771 tok/s (5280 tok) |

## Fallos


## Notas

- La primera pasada de cada modelo lee el GGUF del SSD; las siguientes reutilizan la page cache de Windows.
- `RAM pico` es el working set del proceso: incluye pesos mapeados y KV en host, no la page cache compartida.
- `prompt largo` mide el procesado de ~4k tokens: es donde más se nota el coste de traer expertos del SSD.
