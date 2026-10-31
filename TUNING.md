# Tuning — perfil por perfil

Este documento es la guía práctica para esta máquina. Los números vienen de
`BENCHMARKS.md` y de `config/measured-moe-profiles.json`.

---

## 1. Reglas que no se negocian

1. **8 GB no son 8 GB.** El presupuesto seguro de trabajo es **7,600 MiB**;
   por encima quedan el compositor, el driver y los buffers del contexto.
2. **No uses todos los hilos.** En el Ryzen 7 7840HS, 8 hilos físicos ganan a
   12/16 en MoE. En densos, el número de hilos casi no afecta al decode porque
   todo el cómputo está en GPU.
3. **El KV q8_0 es el defecto.** Es casi lossless y libera VRAM para expertos o
   contexto. q4_0 solo si el contexto es el límite.
4. **Un MoE no es un denso.** El decode de GPT-OSS/Qwen3.6 está limitado por
   CPU/RAM; el de un 7B/9B denso está limitado por ancho de banda de VRAM.
5. **Mide antes de cambiar.** Un +1% dentro de la desviación no es una mejora.

---

## 2. GPT-OSS-20B (el mejor coder de la máquina)

| Perfil | Contexto | KV | n-cpu-moe | Hilos | Decode | Prefill | VRAM |
|---|---:|---|---:|---:|---:|---:|---:|
| `max_speed` | 32k | q8_0 | 11 | 8 | 38.65 | 960 | 7,275 MiB |
| **`balanced`** | **64k** | **q8_0** | **12** | **8** | **36.8** | **908** | **7,309 MiB** |
| `long_context` | 128k | q8_0 | 14 | 8 | 33.65 | 823 | 7,473 MiB |

Comando recomendado:

```powershell
llama-server -m models\gpt-oss-20b-gpt-oss-20b-MXFP4.gguf `
  -ngl 99 -sm none -fa on -c 65536 -ctk q8_0 -ctv q8_0 `
  -b 1024 -ub 512 -t 8 -lm none --n-cpu-moe 12 `
  --host 127.0.0.1 --port 8080 --jinja --metrics --cache-ram 2048
```

La calidad de coding ya estaba verificada al 100% (18/18 + 10/10) y no cambia
con el reparto: los pesos y el sampler son los mismos.

---

## 3. Qwen3.6-35B-A3B (más contexto, algo menos de coding)

| Perfil | Contexto | n-cpu-moe | Hilos | Decode | Prefill | VRAM |
|---|---:|---:|---:|---:|---:|---:|
| **`balanced`** | 32k | 19 | 8 | **44.79** | 856 | 7,409 MiB |
| `max_quality` | 64k | 21 | 8 | 43.92 | 814 | 7,327 MiB |

n-cpu-moe 18 a 32k hace OOM; 19 es el máximo medido. A 64k, 20 no se validó y
21 es el máximo seguro de la tabla.

---

## 4. Qwen3-30B-A3B 2507 (velocidad)

| Perfil | Contexto | n-cpu-moe | Hilos | Decode | Prefill | VRAM |
|---|---:|---:|---:|---:|---:|---:|
| **`balanced`** | 32k | 26 | 8 | **46.61** | 848 | 7,535 MiB |

n-cpu-moe 25 hace OOM. El margen es de ~653 MiB; no ejecutes este perfil con
otra aplicación usando la dGPU. Si necesitas margen, sube a 27 capas CPU
(≈ −2 tok/s).

---

## 5. Densos

### Qwen3-4B 2507 (edición rápida)

| Perfil | Contexto | KV | Decode corto | Decode a 6k ctx | Prefill | VRAM |
|---|---:|---|---:|---:|---:|---:|
| `max_speed` | 8k | f16 | 78.2 | — | 3,892 | ~4.5 GiB |
| **`balanced`** | **16k** | **f16** | **77.0** | 63.0 | **3,996** | **4,885 MiB** |

El 4B es el único denso con margen para “kernel hunting”: está al 84% del
roofline, no al 100%. Aun así, el overhead es atención + sampler + launches; no
hay un hotspot único que justifique un kernel nuevo.

### Qwen2.5-Coder-7B

52.1 tok/s de decode y 2,564 tok/s de prefill a 8k. Es el 100% del roofline; no
hay nada que ganar en GEMV. Úsalo si prefieres un denso predecible; para coding
duro, GPT-OSS-20B tiene mejor calidad.

### Ornith 9B

No se recomienda para coding. Se mantiene en la matriz como referencia de
ancho de banda (43.4 tok/s, 102.6% del roofline), no como perfil de producción.

---

## 6. Palancas y lo que realmente hacen

| Palanca | Efecto medido | Cuándo usarla |
|---|---|---|
| `--n-cpu-moe` | GPT-OSS 64k: 16→12 = **+22.7%** decode | Siempre que la VRAM libre lo permita; es la palanca #1 en MoE |
| `-t` (hilos) | 12→8 = **+7%** decode en GPT-OSS | MoE con expertos en CPU |
| KV q8_0 | −0.35% PPL, ~47% menos KV que f16 | Por defecto |
| KV q4_0 | +2.0% PPL, ~72% menos KV | Solo `max_context` |
| Prompt cache | TTFT 1,003→23 ms (43×) en 4B | Agentes, RAG, system prompts fijos |
| `-ub 512` | +0.8% prefill vs 256 en 9B | Prefill; no cambia decode |
| `-b 1024` | Sin cambio medible vs 512 | Mantener 1024 |
| CUDA Graphs | Ya activo; no se midió A/B todavía | Dejar activo |
| FlashAttention | Activo; ahorra KV y acelera prefill | Dejar `on` |
| Backend sampling | +1.5% decode, −3% prefill | Experimental; no usar por defecto |
| Speculative decoding | No compensa en 8 GB (informes previos) | No usar en chat |
| Q3_K_M | +15.4% PPL, +11% decode vs Q4 | Solo `max_speed`/`max_model` |

---

## 7. Contexto: cómo elegir sin OOM

La tabla de `config/measured-moe-profiles.json` es la fuente de verdad para los
MoE medidos. Para un modelo nuevo:

1. Ejecuta `python runtime/rtxllm.py budget --model <key> --ctx <n> --kv q8_0`.
2. Si dice `NOT SAFE`, baja 4k de contexto o sube 1–2 capas CPU.
3. Arranca con `--n-cpu-moe N` y un prompt de 2048; mide VRAM pico.
4. Deja al menos **650 MiB** libres. Si el pico queda por debajo de 7,300 MiB,
   puedes probar una capa menos de CPU (más GPU) y repetir.

No configures 128k “porque el modelo lo soporta”. En esta máquina, 128k con
GPT-OSS funciona a 33.6 tok/s y deja 715 MiB libres; es útil, pero no es el
perfil de todos los días.
