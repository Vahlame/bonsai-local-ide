# Bonsai Local IDE 1.8.0 — catálogo ampliado y descubrimiento online

**Fecha:** 31-oct-2026

## Lo nuevo

### Catálogo online (Descubrir)
Nueva pestaña **Descubrir** en el Model Hub: consulta en vivo la API pública de
Hugging Face (`filter=gguf&sort=trendingScore`) y muestra los modelos con más
tracción en este momento. Se puede abrir cada repo, ver cuantizaciones y
proyectores, y descargar; no hay una lista estática que envejezca. También está
en CLI:

```powershell
node scripts/hub.mjs discover --limit 30
```

### Catálogo ampliado: 25 modelos curados instalados

Todos descargados y arrancados en la RTX 4060 Laptop de 8 GB. **26 modelos
utilizables** contando Ornith (14 con visión):

- **Texto/código moderno:** Qwen3.5 4B, Qwen3.5 9B, Qwen3.8 4B Distill,
  Granite 4.0 H Tiny, Phi-4 Mini, Spark X2.6 4B, SmolLM3 3B, LFM3 1.7B,
  Qwen3 4B, Qwen2.5 Coder 7B (+ draft 0.5B), Llama 3.2 3B, DeepSeek R1 7B,
  Qwen3-VL 2B/4B/8B, etc.
- **Visión:** Gemma 3 4B, Gemma 4 E4B, Qwen3.5 4B/9B, Qwen3-VL 2B/4B/8B,
  Qwen2.5-VL 3B, MiniCPM-V 4.7 1B, LFM3-VL 2B, LFM3 Omni 2B, SmolVLM2 2.2B,
  Nemotron 3.5 Bolt E4B.

Resultados destacados (5 de las 18 tareas de calidad):

| Modelo | Plan | VRAM pico | Calidad | Nota |
|---|---:|---:|---:|---|
| Nemotron 3.5 Bolt E4B | 36.864 / q8_0 · visión CPU | 2.709 MiB | **5/5** | el mejor del lote nuevo |
| Qwen3.5 4B | 131.072 / f16 · visión CPU | 7.117 MiB | 4/5 | 131k y visión en 8 GB |
| Qwen3.5 9B | 131.072 / q8_0 · visión CPU | 7.121 MiB | 4/5 | 9B moderno con visión |
| Qwen3-VL 4B | 57.344 / q8_0 · visión CPU | 7.069 MiB | 4/5 | visión de calidad |
| Qwen3-VL 8B | 26.624 / q8_0 · visión CPU | 6.747 MiB | — | 8B de visión en 8 GB |
| Gemma 4 E4B | 22.528 / q8_0 · visión CPU | 3.367 MiB | 4/5 | tool calls nativas |
| Granite 4.0 H Tiny | 131.072 / f16 | 5.597 MiB | 4/5 | 147 tok/s de generación |
| Qwen3.8 4B Distill | 131.072 / f16 | 7.087 MiB | 4/5 | texto moderno |
| MiniCPM-V 4.7 1B | 131.072 / f16 · visión CPU | 2.305 MiB | — | 180+ tok/s, visión |
| LFM3-VL 2B | 128.000 / f16 · visión CPU | 2.753 MiB | — | visión en 3,6 s |
| LFM3 Omni 2B | 128.000 / f16 · visión CPU | 2.857 MiB | — | visión y audio |
| Gemma 3 4B | 131.072 / f16 · visión CPU | 5.769 MiB | 3/5 | ventana deslizante |
| Qwen2.5 Coder 7B + draft | 32.768 / f16 + draft | 7.065 MiB | 3/5 | 47→69–72 tok/s |

### Pruebas CON y SIN visión

Cada modelo multimodal se arrancó dos veces: con `--mmproj` y sin él. En los
proyectores grandes el plan los manda a CPU, así que el contexto y la VRAM son
los mismos; sin visión no se pueden mandar imágenes y el arranque es más rápido.
El coste medido de una imagen va de **3,6 s** (LFM3-VL 2B) a **28 s** (Gemma 3
4B / MiniCPM con captura completa). Los informes están en
[reports/MODEL-CATALOG-2026-10-31.md](../reports/MODEL-CATALOG-2026-10-31.md).

### Correcciones

- **Proyectores homónimos**: los `mmproj-BF16.gguf` de Gemma 3/4 y Qwen3.5 se
  pisaban. Las descargas nuevas usan un prefijo por modelo
  (`gemma4-e4b-mmproj-BF16.gguf`).
- **Detección de visión falsa**: Spark 4B recibió el proyector de Qwen3-VL por
  coincidir solo en «4b»; ahora se exige coincidencia de familia.
- **Registro concurrente**: descargas, Model Lab y tuning ya no se borran
  entradas entre sí.
- **Ornith ubatch 512**: no cabe a 110k; se vuelve a 256.
- **Model Lab**: espera a que la VRAM se libere de verdad entre modelos.

## Verificación

- `npm test` — **42/42**.
- `npm run test:navegador` — **5/5**.
- `node scripts/hub.mjs list` — 25 curados + K2, 27 registros (2 borradores).
- `node scripts/model-tune.mjs --all --quick` — ubatch/hilos por modelo.
- Catálogo y evidencia: [MODEL-CATALOG-2026-10-31](../reports/MODEL-CATALOG-2026-10-31.md).

## Limitaciones

- No se ha encontrado un modelo >9B que quepa **entero** en 8 GB con contexto
  útil; 27B/35B requieren CPU/SSD y quedan fuera de esta ronda.
- K2-Horizon y los LFM3 no funcionan con `llama-bench` de esta build, aunque
  arrancan y responden con llama-server.
- La calidad es una pasada de 5 tareas; no es un ranking estadístico.
