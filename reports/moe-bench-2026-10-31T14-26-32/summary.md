# MoE en 8 GB VRAM + 16 GB RAM · qwen36-35b-a3b

Equipo: AMD Ryzen 7 7840HS w/ Radeon 780M Graphics      · 15.3 GiB RAM · RTX 4060 Laptop.

| Variante | Reparto | Hilos | Carga | Arranque | VRAM pico | RAM pico | Generación | Chat | Prompt largo |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| baseline | 18/40 GPU | 12 | none | 10.2 s | 6855 MiB | 6552 MiB | 46.4 tok/s | 45.7 tok/s | 819.8 tok/s (6271 tok) |
| ngram-simple | 18/40 GPU | 12 | none | 10.2 s | 6855 MiB | 6666 MiB | 68.8 tok/s | 45.4 tok/s | 817.8 tok/s (6271 tok) |
| ngram-map-k | 18/40 GPU | 12 | none | 10.2 s | 6855 MiB | 6678 MiB | 66.4 tok/s | 44.6 tok/s | 817.2 tok/s (6271 tok) |
| ngram-mod | 18/40 GPU | 12 | none | 10.2 s | 6869 MiB | 6705 MiB | 59.8 tok/s | 44.9 tok/s | 817.1 tok/s (6271 tok) |

## Fallos


## Notas

- La primera pasada de cada modelo lee el GGUF del SSD; las siguientes reutilizan la page cache de Windows.
- `RAM pico` es el working set del proceso: incluye pesos mapeados y KV en host, no la page cache compartida.
- `prompt largo` mide el procesado de ~4k tokens: es donde más se nota el coste de traer expertos del SSD.
