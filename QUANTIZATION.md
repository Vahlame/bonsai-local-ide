# Cuantización — calidad, VRAM y velocidad reales

La pregunta correcta en 8 GB no es “¿Q4 es más rápido que Q5?”. Es:

> ¿cuánta calidad pierdo por GiB liberado y cuántos tokens/s gano?

Este documento usa el mismo modelo (Qwen3-4B-Instruct-2507), el mismo corpus y
el mismo binario. Los números de PPL no son comparables con otros corpus; solo
sirven para comparar filas de esta tabla.

---

## 1. Matriz de pesos

| Formato | Tamaño | Decode tok/s | Prefill 2048 tok/s | PPL | Δ PPL | VRAM pico |
|---|---:|---:|---:|---:|---:|---:|
| Q8_0 | 3.99 GiB | 52.95 | 4,197 | 11.9276 | — | 5,665 MiB |
| Q6_K | 3.08 GiB | 65.54 | 3,651 | 11.9654 | **+0.32%** | 4,735 MiB |
| Q5_K_M | 2.69 GiB | 71.53 | 3,840 | 12.1321 | +1.71% | 4,337 MiB |
| Q4_K_M | 2.33 GiB | **81.90** | 3,951 | 12.2553 | +2.75% | 3,963 MiB |
| Q3_K_M | 1.93 GiB | **90.83** | 3,622 | 13.7688 | **+15.44%** | 3,561 MiB |

### Lo que muestran los números

1. **Q6_K es casi gratis en calidad.** +0.32% de PPL es ruido de corpus; el
   coste es 20% menos decode que Q4. Si la calidad manda y el modelo cabe, Q6
   es la mejor relación calidad/velocidad.
2. **Q4_K_M es el punto dulce.** +2.75% de PPL y 81.9 tok/s; 3.96 GiB de VRAM
   permiten contexto largo en 8 GB.
3. **Q3_K_M no es una recomendación de calidad.** +15.4% de PPL por 11% más de
   decode que Q4. Solo tiene sentido si el modelo no cabe de otra forma.
4. **Q8_0 no compensa en decode.** Es el 35% más lento que Q6 y el 55% más
   lento que Q4, para una mejora de calidad que Q6 ya captura.
5. **El prefill no sigue el mismo orden.** Q8_0 gana (4,197 tok/s); Q4_K_M
   queda segundo (3,951). Los kernels MMQ y el reparto de tiles importan más
   que el tamaño bruto. No se debe elegir quant solo por decode.

### Recomendación por perfil

| Perfil | Peso | KV | Por qué |
|---|---|---|---|
| `max_quality` | Q6_K | f16 o q8_0 | +0.32% PPL; cabe en 8 GB con 8k–16k |
| `balanced` | Q4_K_M | q8_0 | +2.75% PPL; 82 tok/s; contexto largo |
| `max_speed` | Q4_K_M o Q3_K_M | q8_0/q4_0 | Q4 si la calidad importa; Q3 solo si el tamaño es el límite |
| `max_model` | Q2_K_XL / Q3_K_M | q8_0 | modelos 20B–35B MoE con expertos en RAM |

---

## 2. KV cache

Mismo Q4_K_M, contexto 1024, 12 chunks:

| KV | PPL | Δ vs f16 | VRAM relativa |
|---|---:|---:|---:|
| f16 | 9.0320 | — | 1.00× |
| q8_0 | 9.0004 | **−0.35%** | ~0.53× |
| q4_0 | 9.2128 | **+2.00%** | ~0.28× |

**q8_0 KV es casi lossless en esta prueba** (la diferencia es menor que el
ruido). Es la elección por defecto del proyecto para contexto largo.
**q4_0 KV** cuesta ~2% de PPL a 1k; el coste crece con contexto. Solo se usa
para `max_context` cuando el usuario acepta explícitamente la degradación.

---

## 3. Cuantización mixta (capas sensibles)

La idea es dejar en mayor precisión las partes que más impactan la calidad:
`output.weight`, embeddings de tokens y algunas proyecciones de atención.

`llama-quantize` permite:

```powershell
llama-quantize --allow-requantize `
  models\Qwen3-4B-Instruct-2507-Q8_0.gguf `
  models\Qwen3-4B-Instruct-2507-Q4_K_M-embQ8-outQ8.gguf `
  Q4_K_M 8 --output-tensor-type q8_0 --token-embedding-type q8_0
```

Hipótesis: +~100–200 MiB de peso, +0.2–0.5% de PPL recuperado, coste de decode
de ~2–4%. Se mide con `quality_suite.py` y `bench_suite.py`; el resultado está
en `reports/bench-mixed-quant-*` (ver `OPTIMIZATIONS.md`). Si no supera a Q6_K
en calidad por GiB, no se adopta.

### Resultado medido (negativo)

Se generó `Q4_K_M` con `token_embd` y `output.weight` en Q8_0:

| Modelo | Peso | PPL (512 ctx) | Decode 128 | Prefill 2048 |
|---|---:|---:|---:|---:|
| Q4_K_M oficial | 2.33 GiB | 12.2553 | 81.9 | 3,951 |
| Q4_K_M mixto emb/out Q8 | 2.33 GiB | **12.3478** | 82.1 | 4,013 |
| Q6_K | 3.08 GiB | 11.9654 | 65.5 | 3,651 |

El mixto **empeora** el PPL en +0.75% respecto a Q4, no gana velocidad y pesa
lo mismo. La causa probable es que el cuerpo se cuantizó desde Q8_0 (no desde
F16) y el ruido de la requantización domina cualquier recuperación de las capas
sensibles. **No se adopta.** Para una prueba justa haría falta partir de F16 y
calibrar con imatrix; queda como siguiente experimento, no como recomendación.

### Política de asignación automática (propuesta conservadora)

El planificador de `runtime/rtxllm.py` parte de una tabla medida, no de una
heurística de “Q4 para todo”:

1. Fijar el presupuesto seguro de VRAM (7,600 MiB).
2. Elegir el mayor contexto que quepa con KV q8_0.
3. Elegir el peso más pequeño cuyo Δ PPL medido sea < 1% (Q6_K) si el contexto
   lo permite; si no, bajar a Q5/Q4.
4. Mantener `output.weight` y `token_embd` en Q8_0 solo si el Δ PPL medido
   justifica el coste de bytes.
5. Nunca elegir Q3 si Q4 cabe: el +15% de PPL no se compensa con 11% de decode.

El objetivo es calidad por GiB, no el número más grande de tokens/s.

---

## 4. Qué no se probó (y por qué)

- **GPTQ / AWQ / EXL2**: no hay modelos en esos formatos en el equipo y los
  runtimes (ExLlamaV2, vLLM, TensorRT-LLM) no son viables en Windows 10 nativo
  con este Python/GPU. Se documenta la exclusión en `BENCHMARKS.md`.
- **FP8**: Ada consume FP8 en Tensor Cores, pero llama.cpp no oferece un path
  FP8 de pesos estable para este GGUF; no se fuerza.
- **Calibración con imatrix**: requeriría un corpus grande y un proceso de
  calibración; no se hizo en esta fase. Es la siguiente mejora de calidad por
  GiB si se dispone de tiempo.
