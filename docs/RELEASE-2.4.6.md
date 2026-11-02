# Bonsai Local IDE 2.4.6

**Fecha:** 2 de noviembre de 2026
**Tema:** medidor de contexto honesto y primer turno más directo.

Release de parche sobre 2.4.5. El perfil de código ya compactaba, pero la barra
inferior enseñaba `memoria 0` y `folded 0` porque leía los contadores del perfil
general. Además, el agente podía empezar inspeccionando archivos antes de
atender un pedido que solo pedía un plan o preguntas.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| Medidor en `small-local-coder` | memoria extractiva y grupos plegados reales |
| Estado real observado | 19 grupos descartados · 2.151 tok de extractos |
| Prompt antes/después | ~41.132 → ~24.850 tok |
| Primer turno de plan | responde sin inspección rutinaria |
| Regresión de primer turno | caso 22 de `prueba-agente-limites` |
| Tests aislados | **51/51 OK** |
| Suites de navegador | **9/9 OK** |
| UI real con Qwen3.6 | **0 errores de consola**, 32768, `pensar: -1` |
| Enlaces de documentación | **0 roto(s)** |
| CI | Windows · Node 22 · Python 3.12 · **verde** |

## Correcciones

- **`reportUsage` del perfil de código.** Para `small-local-coder` toma
  `compactionDetails.memoryTokensEstimate` y `discardedGroups`; para el perfil
  general sigue usando `session.memory` y `session.folded`. La barra muestra
  `memoria 2.151 extractiva · grupos plegados 19`.
- **Primer turno.** La regla de `AGENT_WORKFLOW` y `PHASE_PROMPTS.PLAN` pide
  contestar primero cuando el pedido es un plan, propuesta, requisitos o
  preguntas antes de implementar, y no inspeccionar archivos por rutina.
  `pideAclaraciones()` fuerza `tool_choice: none` solo en el primer salto de
  ese pedido, así que la respuesta inicial no empieza con `indice`/`leer`.
- **`SECURITY.md`.** Tabla de versiones soportadas actualizada a 2.4.x.
- **README.** Se retira «el mejor» y se matiza «sin nube»: la inferencia es
  local, pero las búsquedas web y las descargas del Hub son opcionales.
- **Documentación.** `CONTEXTO-Y-DIAGNOSTICO.md` explica la memoria extractiva
  del perfil de código y por qué sus contadores no viven en `session.memory`.

## Compatibilidad

- Windows 10/11, Node ≥ 22, GPU CUDA (RTX 4060 8 GB probada).
- El acceso directo y la cabecera compacta de 2.4.3/2.4.4 siguen igual.
- `v2.4.2` … `v2.4.5` quedan como releases anteriores; no se movieron sus tags.

## Enlaces

- [Release 2.4.5](RELEASE-2.4.5.md)
- [Contexto y diagnóstico](CONTEXTO-Y-DIAGNOSTICO.md)
- [Auditoría completa](AUDIT-2026-11-01.md)
- [Contribuir](../CONTRIBUTING.md)
