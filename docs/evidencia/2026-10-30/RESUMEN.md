# Evidencia de pruebas · 30 de octubre de 2026 (UTC)

Esta carpeta conserva las mediciones publicables de la verificación de la versión
**1.2.0**. Los JSON son los originales de las pruebas, con una única modificación:
la ruta local del GGUF se sustituyó por el nombre del archivo. No se han retocado
tiempos, respuestas ni cifras de VRAM.

## Equipo y configuración

| Dato | Valor |
| --- | --- |
| Sistema | Windows 11, PowerShell 5.1 |
| GPU | NVIDIA RTX 4060 Laptop, 8 GB |
| RAM | 16 GB (15.676 MiB visibles) |
| Node.js | 26.0.0 |
| Modelo | `Ornith-1.5-9B-Q4_K_M.gguf`, 5.780.090.816 bytes |
| SHA-256 del GGUF | `70c112196e0b7023803c9762752e46d29e612a92c83f995bc3ba1ceb07e8fab6` |
| Ventana | 43.008 tokens |
| KV | F16 |
| Visión | activada (`mmproj` del modelo) |
| Pensamiento | hasta 4.096 tokens |

El servidor se comprobó con `/props`: `n_ctx: 43008`, `vision: true` y el GGUF
esperado. La configuración de 43.008 es una **selección manual** para este equipo;
no es el techo automático conservador ni una garantía de estabilidad.

## Suites

| Grupo | Resultado | Tiempo |
| --- | ---: | ---: |
| `npm test` (40 suites aisladas) | **40/40** | 125,3 s |
| `npm run test:navegador` (5 suites) | **5/5** | 16,4 s |
| `npm run test:gpu` (4 suites, servidor cargado) | **4/4** | 95,4 s |
| `npm run test:gpu-exclusiva` (calidad KV) | **1/1** | 89,6 s |

Las suites aisladas y de navegador usan proyectos, estado y puertos temporales. Las
de GPU se ejecutaron con el modelo real. Son pasadas únicas: acreditan que la
verificación terminó en verde, no una medida estadística de calidad.

### GPU y contexto

- 34/34 capas en GPU; pesos y caché KV en `CUDA0`; sin caché KV en CPU.
- `CPU_Mapped`: 545,62 MiB. Es el mmap de apoyo del GGUF, **no** pesos de cálculo.
- Llamada nativa a herramienta correcta y continuación con el resultado `42`.
- Prefill de 30.205 tokens: 18.234,9 ms, **1.656,4 tok/s**.
- Generación de la respuesta corta: 31,2 tok/s.
- VRAM dedicada: pico **7.481 MiB**; mínimo **476 MiB** libres en esta pasada.
  Una pasada anterior de la misma sesión, con más carga externa, midió **62 MiB**.
  El objetivo de aviso de la prueba sigue en 180 MiB y no se rebajó.
- `prompt_n: 30205`; respuesta `VALIDADO_42`.

### Visión

- Dos imágenes de un solo dígito, cada una en una sesión limpia del IDE.
- Lecturas correctas: **4** y **2**, ambas al primer intento.
- VRAM libre mínima durante la prueba: 432 MiB.
- Estrés informativo de cuatro cifras (`5383`): respuesta vacía; **no** se usa como
  criterio de regresión.
- Una sonda separada midió 5/21 lecturas exactas en cadenas de 3–5 caracteres y
  6/6 en un solo dígito a escala 24. Estas pruebas no demuestran OCR general.

### Calidad KV

Pasada única con tres configuraciones, cada una con su propio servidor:

| Configuración | NIAH corto | NIAH largo | Python | JavaScript | Total |
| --- | ---: | ---: | ---: | ---: | ---: |
| A · 32K · q8_0 · visión | 3/3 | 3/3 | sí | sí | **8/8** |
| B · 16K · f16 · visión | 3/3 | no aplica | sí | no | **6/8** |
| C · 32K · f16 · sin visión | 3/3 | 3/3 | no | no | **6/8** |

A es la configuración recomendada y la única que superó las ocho comprobaciones.
B y C quedan registradas con sus fallos; no se presentan como equivalentes.

## Archivos

- `gpu-real-43008.json`: residencia CUDA, tool call, prefill, VRAM y tiempos.
- `vision-43008.json`: lecturas visuales, uso de contexto, VRAM y estrés de cuatro cifras.
- `calidad-kv-2026-10-30.json`: resultados completos A/B/C.

## Reproducir

```powershell
npm test
npm run test:navegador
# Con el servidor real cargado en 8080:
npm run test:gpu
# Detén antes el servidor de 8080; esta prueba arranca los suyos:
.\scripts\stop-managed-server.ps1 -Port 8080
npm run test:gpu-exclusiva
```

Los detalles de diseño y los límites conocidos están en
[CONTEXTO-Y-DIAGNOSTICO.md](../../CONTEXTO-Y-DIAGNOSTICO.md),
[CALIDAD-KV-2026-10-27.md](../../CALIDAD-KV-2026-10-27.md) y
[RELEASE-1.2.0.md](../../RELEASE-1.2.0.md).
