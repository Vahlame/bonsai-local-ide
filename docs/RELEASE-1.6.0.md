# Bonsai Local IDE 1.6.0 — 110k con visión y contexto estilo frontera

Fecha: 30 de octubre de 2026 · RTX 4060 Laptop 8 GB (dedicada al modelo; pantalla en la APU)

## Lo importante

**q8_0 + visión ahora llega a 110.592 tokens.** El proyector de visión (879 MiB) se
saca de la VRAM con `--no-mmproj-offload`: el KV sigue siendo q8_0 (casi sin pérdida)
y la ventana pasa de 71.680 a 110.592. La visión sigue funcionando; cada imagen se
codifica en CPU y tarda ~15,4 s (captura 1200×528 + 120 tokens), frente a ~2 s con el
proyector en GPU. Se verificó con una imagen real: describió correctamente el panel de
ajustes del IDE.

Preset por defecto: **`8GB-VISION-MAX-Q8-100K`** = 110.592 · q8_0 · visión · 4096 de
pensamiento.

## Techos medidos (visión siempre activada)

| KV | Proyector | Contexto | Retrieval real | VRAM pico | Siguiente paso |
|---|---|---:|---:|---:|---:|
| f16 | GPU | 43.008 | PASS 33.373 tok | 7.481 MiB | 45.056 OOM |
| q8_0 | GPU | 71.680 | PASS 56.306 tok | 7.543 MiB | 73.728 OOM |
| q4_0 | GPU | 110.592 | PASS 87.433 tok | 7.497 MiB | 114.688 OOM |
| **q8_0** | **CPU** | **110.592** | **PASS 87.433 tok** | **7.650 MiB** | 114.688 OOM |
| q8_0 | sin visión | 110.592 | — | 7.481 MiB | 114.688 OOM |

Cada valor pasó una prueba de 3 agujas al 10/50/90 % con ese número real de tokens.
114.688 falla al arrancar en todas las combinaciones. Evidencia en `reports/`.

## Reparto de contexto (estilo modelos frontera)

- `historial = ventana − reserva de salida − 128`. La reserva incluye el pensamiento,
  así que razonar no se come la respuesta.
- Con 110.592: **~98.176 historial + 4.096 pensamiento + ~7.936 respuesta/edición**.
- `historial = 0` en Ajustes = automático (antes por defecto 8.192 y se desperdiciaba
  casi toda la ventana).
- Compactación con el modelo en notas estructuradas (`OBJETIVO`, `DECISIONES`,
  `ARCHIVOS`, `COMANDOS Y PRUEBAS`, `ERRORES ABIERTOS`, `PENDIENTE`), tope ~6 % de la
  ventana (1k–8k). El historial original se conserva en la sesión.

## Muestreo por defecto

`temperature 0.6 · top_p 0.90 · top_k 20 · min_p 0.05`, medido sobre 12 tareas
difíciles (73,3 % a 30 muestras, frente a 70,0 % de la tarjeta y 63,3 % a T0.2).
Greedy fue el peor y `repeat_penalty 1.1` rompió la puntuación.

## Benchmark de proyecto complejo (honesto)

Proyecto `taskforge` multi-archivo generado por el modelo y validado ejecutando
`node --test` de verdad (2 repeticiones, pensamiento 2048, visión):

| Preset | Tests | Pasan | % |
|---|---:|---:|---:|
| `8GB-VISION-MAX-F16` | 14 | 8 | 57 % |
| `8GB-VISION-MAX-Q8` | 18 | 6 | 33 % |
| `8GB-VISION-MAX-Q4` | 9 | 2 | 22 % |

Ninguna pasada deja la suite entera en verde y la comprobación de visión con captura
falló en los tres presets. Es el límite del modelo de 9B en tareas multi-archivo, no
del contexto ni del KV.

## Cambios técnicos

- `chat/bonsai-chat.mjs`: `historyCap()` admite `0` (automático); la reserva de salida
  suma el pensamiento (`reservaPensamiento`) sin recursión; el tope de memoria
  compactada es adaptativo (`memoryCapTokens`, 6 % de la ventana, 1k–8k); prompt de
  compactación estructurado.
- `chat/ui-server.mjs`: `--prompt-cap` por defecto `0`; `historial: 0` se traduce a
  automático; `coderContextTokens` valida 4.096–131.072; el lanzador respeta
  `mmprojCPU`; presets por defecto actualizados.
- Lanzadores: `-PromptCap 0` por defecto; `start-ui.ps1` conoce los presets
  optimizados (los dos ficheros) para no romper con un ajuste guardado.
- UI: opción "Automático (ventana − salida)" y presets nuevos en el selector.
- Pruebas: 40/40 en verde; expectativas actualizadas al muestreo y techos nuevos.

## Reproducir

```powershell
# techo por KV y proyector
.\scripts\probe-rtx4060-context.ps1 -ContextList "90112,98304,106496,110592" -KV q8_0 -Vision -CPUProjector
# retrieval real + imagen
.\scripts\probe-longctx.ps1 -KV q8_0 -Context 110592 -Vision -CPUProjector -Image reports\custom-preset-ide.png
# benchmark de proyecto
node scripts\bench-project.mjs --reps 2 --think 2048 --max-tokens 8000
```
