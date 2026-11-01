# Continuación Qwen3.8-27B - 2026-11-01

Destinatario: siguiente agente o el usuario. Este documento continúa
`HANDOFF-DEEPSEEK-2026-11-01.md`; no repite la investigación previa.

## Resultado principal

Se corrigió la caché de prefijo recurrente para turnos de agente y para
turnos nuevos de usuario. La tarea de lectura del handoff ya pasa y el
segundo paso deja de reprocesar el prompt completo.

| Caso | Antes | Después |
|---|---:|---:|
| Segundo paso de agente, `cache_n` | 0 / 7840 | 6508 / 8930 |
| Segundo paso, `prompt_n` | 7840 | 2422 |
| Segundo paso, TTFT | ~38.5 s | 12.4 s |
| Tarea de lectura, pared total | 142.5 s | 90.1 s |
| Follow-up nuevo, `cache_n` | 0 / 4637 | 4551 / 6518 |
| Follow-up nuevo, pared | 114.7 s | 41.0 s |

La caché guarda 3 checkpoints de 149.626 MiB (448.878 MiB) dentro de
`--cache-ram 512`: un ancla estable en el primer mensaje de usuario y dos
recientes. El ancla sobrevive a la evicción por presupuesto.

## Commits

| Commit | Contenido |
|---|---|
| `d26e06a` | checkpoints en límites de mensaje de usuario y evicción por presupuesto |
| `4b612b4` | ancla estable del primer mensaje de usuario |
| `fde05b2` | rechazo de reutilización de columnas en prefill IQ4_XS |
| `e209466` | rechazo de ubatch 384 |
| `e94a282` | validación de tool calling nativo Qwen |
| `524097a` | helpers de smoke de lectura y tarea de agente |
| `ce3dd64` | explicación del smoke cortado y de la caché |
| `1e673cc` | rechazo de MTP `p-min 0.1` |

## Tool calling Qwen

Prueba aislada en `trabajo/qwen38-tooltest`, tarea de 6 pasos:

- dos llamadas nativas `leer` en un mismo mensaje, ambas ejecutadas;
- `ejecutar` devolvió el fallo real del test;
- `reemplazar` corrigió solo `saludo.py`;
- `archivo` escribió `RESULTADO.txt` con `Ángel` en UTF-8 (`C3 81`);
- `test_saludo.py` no se modificó;
- el follow-up intentó sobrescribir sin leer; el controlador lo denegó y el
  modelo leyó, volvió a probar y respondió.

No hubo rechazo `peg-native`, ni fallback de texto, ni llamada perdida. El
camino nativo de Qwen funciona en el controlador actual. El caso de chat
simple en modo agente fuerza un resumen final porque el agente espera
verificación; para conversación simple usar el modo charla. No es un fallo
del parser.

## Descartes medidos

| Experimento | Resultado | Decisión |
|---|---|---|
| Prefill IQ4_XS con 3 columnas | mediana +0.65%, dentro del ruido | rechazado |
| Prefill con 4 columnas | mediana -2.4% | rechazado |
| Prefill con 8 columnas | mediana -2.5% | rechazado |
| Ubatch 384 frente a 256 | mediana -0.9%, sin OOM | rechazado |
| MTP `--spec-draft-p-min 0.1` | mismos drafts, ±0.25% | rechazado |

El prefill sigue dominado por la aritmética de activaciones, no por la
decodificación de pesos. No repetir tiling de columnas sin un perfil que
demuestre lo contrario. El siguiente diseño de prefill tendría que reutilizar
pesos y activaciones en 2D o usar un GEMM con layout repackado.

## Estado vivo al cerrar

- IDE: `http://127.0.0.1:8787`, PID 73160, perfil `small-local-coder`.
- Modelo: `qwen38-27b-perf-iq4`, PID 70392, puerto 8080, `n_ctx` 32768,
  `/health` correcto.
- Perfil original `qwen38-27b` conservado para rollback.
- Workspace y chat restaurados a los del usuario:
  `C:\Users\user\Desktop\New folder (2)`, chat `mvxcac6x35f4hu`.
- Binario del servidor: `llama-server-impl.dll`, SHA-256
  `6A8EE62E01D98291001D0CEA87DD79862311B8DDD49B51855C3F3462752D25DC`.
  El `build_info` de `/props` muestra `b29-d26e06a` por un `build-info.cpp`
  viejo; la procedencia autorizada es
  `build-Qwen38-sm89/bin/qwen38-build.json` (commit `4b612b4`) y el SHA.
- No se dejó el volcado de prompts ni el cambio de diagnóstico en el IDE.

## Pendiente

1. Cancelación durante generación y durante comando, y procesos huérfanos.
2. Varios turnos reales con historial cambiado, herramientas y retirada de
   razonamiento; comprobar el ancla en cada turno.
3. Presupuesto de caché insuficiente (64 MiB) y evicción entre conversaciones.
4. Memoria verificable: hard/soft faults con nombres de archivo, prefill vs
   decode, navegador con y sin presión.
5. CUDA: MMQ on/off, selector de atención, FATTN tile 128 y cuatro warps solo
   donde cambie el coste; CUDA graphs y draft backend sampling.
6. Dataflow: cuantificar burbujas tras la mejora de CPU antes de tocar fences.
7. Otros modelos: matriz del apartado 8 del handoff, sin generalizar el 27B.

## Reproducir

```powershell
# Lectura con caché y respuesta
python scripts\qwen38_ide_read_smoke.py --label siguiente-lectura

# Tarea de agente con follow-up
python scripts\qwen38_ide_agent_task.py --label siguiente-agente `
  --workspace 'C:\Users\user\Documents\prject_local_AI\trabajo\qwen38-tooltest' `
  --prompt '...' --followup '...'

# A/B de decodificación con el arnés fijo
python scripts\qwen38_experiment.py --label siguiente-control `
  --model 'C:\Users\user\Documents\prject_local_AI\models\qwen38-27b-perf-iq4_xs-floor4.gguf' `
  --real-workloads
```

No lanzar benchmarks con el servidor administrado ocupando 8080. Guardar
comandos, hashes y memoria en `reports/2026-11-01-qwen38/`. Un experimento,
una variable; tres repeticiones y mediana. Un +1% dentro del ruido no se
promociona.
