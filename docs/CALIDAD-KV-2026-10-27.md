# Calidad del KV cuantizado: q8_0 frente a f16 (Ornith-1.5-9B, RTX 4060 8 GB)

**Fecha:** 27 de octubre de 2026
**Pregunta:** con visión y ~8 GB de VRAM, 32K de contexto solo caben con KV `q8_0`
(f16 a 32K pide ~8301 MiB y no arranca). ¿Es `q8_0` suficientemente bueno o hay que
renunciar a contexto y usar `f16` a 16K?

**Respuesta corta:** `q8_0` es **prácticamente indistinguible de f16** en las pruebas
hechas aquí; la pérdida de perplejidad es del **+0,41%** y la recuperación en contexto
largo es idéntica. No merece la pena bajar de 32K a 16K para usar f16. `q4_0` también
pasa esta batería (+0,89% de perplejidad), pero se reserva como respaldo cuando la VRAM
no da para q8_0.

## Cómo se midió

Todo en la máquina real, con `Ornith-1.5-9B-Q4_K_M.gguf`, `llama.cpp` del proyecto y
Flash Attention activado, sin servicios en la nube:

1. **Perplejidad** (`bin/llama-perplexity.exe`, `-c 8192`, `-ngl 99 -fa on`) sobre un
   corpus real del proyecto (README + auditorías + arquitectura + handoff, ~43k tokens
   estimados; ventanas de 8192). Mismo corpus, misma semilla de evaluación.
2. **NIAH (needle in a haystack)** con el servidor real: dos datos únicos
   (`AMBAR-7391` al 15% y `CEDRO-8155` al 85%) escondidos en texto real del proyecto de
   ~4.000 y ~12.000 tokens estimados. Tres preguntas por pajar (un dato, el otro, y
   ambos en JSON), `temperature: 0`, sin razonamiento.
3. **Dos tareas de código con verificación objetiva**: una función Python `es_primo(n)` y
   una función JavaScript `contarVocales(s)`, ejecutadas contra asserts fijos. El código
   lo genera el modelo y lo valida un runner externo.

Configuraciones comparadas (las tres arrancan en esta GPU):

| Config | Contexto | KV | Visión | Por qué |
| --- | --- | --- | --- | --- |
| **A** | 32768 | **q8_0** | sí | la configuración recomendada |
| B | 16384 | f16 | sí | alternativa "más precisa" pero con menos contexto |
| C | 32768 | f16 | no | mismo contexto que A: aísla el efecto del KV |

## Resultados

### Perplejidad (menor es mejor)

| KV | Perplejidad | Diferencia vs f16 |
| --- | --- | --- |
| f16 (referencia) | **7,5570** | — |
| **q8_0** | **7,5880** | **+0,41%** |
| q4_0 | 7,6244 | +0,89% |

Una diferencia de perplejidad del 0,4% está dentro del ruido de evaluación de este tipo
de modelos; en la práctica no se nota.

### NIAH + tareas de código (aciertos / pruebas)

| Config | NIAH 4k | NIAH 12k | Código Python | Código JS | Total |
| --- | --- | --- | --- | --- | --- |
| **A · 32K/q8_0/visión** | 3/3 | 3/3 | OK | OK | **8/8** |
| C · 32K/f16/sin visión | 3/3 | 3/3 | OK | OK | 8/8 |
| B · 16K/f16/visión | 3/3 | — (no probado)* | OK | OK | 5/5 |

\* El pajar largo de 12k tokens se probó solo en las configuraciones de 32K. B usa 16K y
su límite duro de contexto es justamente lo que se pierde al elegir f16 con visión.

**Conclusión de la comparación:** A y C puntúan exactamente igual. Añadir la cuantización
`q8_0` al KV no cambió ni la recuperación de datos en contexto largo ni el resultado de
las tareas de código. La ventaja de A sobre B es el doble de contexto (32K frente a 16K),
no una pérdida medible de precisión.

### Arranque medido

Las tres configuraciones arrancan y se detienen limpias (salida verificada: `/health` OK,
`/props.n_ctx` correcto, marcador con el PID real, VRAM liberada, sin procesos huérfanos).
Con ~7.956 MiB libres, A (32K/q8_0/visión) necesita ~7.821 MiB de presupuesto conservador.

## Recomendación

- **Con visión: quédate con 32K/KV q8_0.** Es lo que el arranque automático elige hoy y
  la calidad medida es equivalente a f16 en el mismo contexto.
- **Sin visión: f16 a 32K** (el auto ya lo prefiere cuando cabe, porque `kv.orden` es
  f16 → q8_0 → q4_0 y f16 cabe sin visión a 32K). No hay motivo para bajar a q8_0 ahí.
- **q4_0 solo como último recurso** (equipos con menos VRAM o contextos mayores): en esta
  batería también pasó, con +0,89% de perplejidad.
- Si en tu uso real notas degradación con 32K/q8_0 (respuestas que ignoran datos del
  principio del contexto), la alternativa es bajar a 16K/f16 con visión; pero la medición
  no justifica hacerlo de antemano.

## Reproducir

```powershell
cd C:\ruta\a\bonsai-local-ide
# Detén antes el servidor de 8080: esta prueba arranca los suyos y exige la GPU libre.
.\scripts\stop-managed-server.ps1 -Port 8080
npm run test:gpu-exclusiva   # chat/prueba-calidad-kv.mjs --real (~90 s)
# o solo la prueba, sin el runner:
node chat/prueba-calidad-kv.mjs --real
```

Los resultados crudos de esta pasada quedaron en
`salida/calidad-kv-2026-10-28/resultados.json` y los registros de perplejidad en
`salida/calidad-kv/perplexity-{f16,q8_0,q4_0}.log`.

## Límites de esta medición

- Una sola pasada, `temperature: 0`, dos datos escondidos y dos tareas de código: sirve
  para descartar una degradación grande, no para certificar diferencias menores del 0,5%.
- El corpus de perplejidad es documentación/código del proyecto, no un benchmark estándar
  (WikiText, etc.), así que los valores absolutos no son comparables con la literatura;
  lo relevante es la diferencia entre tipos de KV con el mismo corpus.
- La calidad en tareas muy largas o de razonamiento complejo puede variar; si aparece un
  problema real con q8_0, se puede repetir esta batería con textos y tareas del caso.
