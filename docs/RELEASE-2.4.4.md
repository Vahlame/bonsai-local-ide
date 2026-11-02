# Bonsai Local IDE 2.4.4

**Fecha:** 2 de noviembre de 2026
**Tema:** cabecera sin solapes y diálogo de modelo coherente con el benchmark.

Release de parche sobre 2.4.3. Corrige dos problemas visuales que quedaban en la
UI: el grupo de permisos se montaba sobre los paneles y el diálogo de inicio
seguía recomendando GPT-OSS por los benchmarks antiguos de coding/web app.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| Cabecera a 1600 px | Paneles 176–546, Permiso 558–799, **sin solape** |
| Cabecera a 1440/1366 px | **sin desborde** de acciones; modo compacto |
| Chip de contexto | Visible en el `statusbar` a 1440/1366 |
| Diálogo de inicio | **Qwen3.6 primero**, badge `Recomendado` |
| Puntuación mostrada | Qwen3.6 **90/100**, GPT-OSS **41/100** |
| Tests aislados | **51/51 OK** |
| UI real con Qwen3.6 | **0 errores de consola**, 32768, `pensar: -1` |
| Enlaces de documentación | **0 roto(s)** |
| CI | Windows · Node 22 · Python 3.12 · **verde** |

## Correcciones

- **Cabecera.** La columna flexible (`minmax(0, 1fr)`) era más estrecha que el
  grupo `Preguntar / Ejecutar todo`; con `justify-self: end` el grupo se
  desbordaba hacia la izquierda y se montaba sobre `Navegación / Editor`. Ahora
  usa `justify-self: start` y queda a continuación de los paneles. Además, el
  modo compacto empieza en 1500 px (antes 1360): a 1440/1366 se ocultan los
  chips secundarios y el permiso de comandos para que las acciones no se salgan
  por la derecha.
- **Contexto en la barra inferior.** El chip de contexto se mueve de
  `.top-acciones` al `statusbar`: sigue visible a 1440/1366 y deja más ancho
  para las acciones. El test `prueba-ui-humo` lo comprueba.
- **Modelo recomendado.** `chat/modelo.json` declara
  `modeloRecomendado: qwen36-35b-a3b` y el mapa `benchmarkTareas` del
  benchmark 2026-11-01. La API expone `recomendado` y `tareas`; el diálogo
  ordena por ellos y muestra `90/100 tareas`, `% proyecto` y `% web app`.
- **GPT-OSS como alternativa.** Sigue disponible y conserva sus buenos
  resultados de proyecto/web app, pero ya no aparece como recomendado.
- **Regresión.** `chat/modelo.mjs` comprueba que Qwen3.6 es el recomendado y
  que el benchmark de tareas lo pone por delante de GPT-OSS.

## Compatibilidad

- Windows 10/11, Node ≥ 22, GPU CUDA (RTX 4060 8 GB probada).
- El acceso directo del escritorio sigue funcionando desde 2.4.3.
- `v2.4.2` y `v2.4.3` quedan como releases anteriores; no se movieron sus tags.

## Enlaces

- [Release 2.4.3](RELEASE-2.4.3.md)
- [Acceso directo y primer arranque](PRIMER-ARRANQUE.md)
- [Auditoría completa](AUDIT-2026-11-01.md)
- [Contribuir](../CONTRIBUTING.md)
