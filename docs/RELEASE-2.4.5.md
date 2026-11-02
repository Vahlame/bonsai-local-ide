# Bonsai Local IDE 2.4.5

**Fecha:** 2 de noviembre de 2026
**Tema:** sin turno de cierre fantasma después de una respuesta útil.

Release de parche sobre 2.4.4. Corrige el caso en el que el agente respondía con
un plan y preguntas, y después se inyectaba un turno interno de cierre que
sustituía esa respuesta por un «Resumen del trabajo realizado». El usuario
perdía la respuesta y no podía contestar a las preguntas.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| Plan con preguntas tras leer | termina `completed`, **sin resumen sustituto** |
| Regresión | caso 21 de `prueba-agente-limites` |
| Tests aislados | **51/51 OK** |
| Suites de navegador | **9/9 OK** |
| UI real con Qwen3.6 | **0 errores de consola**, 32768, `pensar: -1` |
| Enlaces de documentación | **0 roto(s)** |
| CI | Windows · Node 22 · Python 3.12 · **verde** |

## Correcciones

- **Cierre solo si no hay respuesta.** La condición del turno final ya no es
  `motivo !== completed`; ahora exige que el assistant esté vacío o que solo
  anuncie una acción futura. Una respuesta con contenido se conserva.
- **Verificación sin trabajo.** Si el último paso no escribió, no ejecutó ni
  inspeccionó nada y la respuesta pide datos (`?`), no se lanza la verificación
  automática ni se marca `unresolved_verification`.
- **Auto-continuación condicionada.** La interfaz solo encola el siguiente
  turno interno si el assistant no dejó respuesta visible. Así el usuario puede
  responder a las preguntas del plan.
- **Anuncios más estrictos.** Solo se considera anuncio un texto corto que
  empiece por «Voy a…», «Déjame…», «Procedo a…», etc.; «Hecho. Ahora calcula…»
  es una respuesta final y no se toca.

## Compatibilidad

- Windows 10/11, Node ≥ 22, GPU CUDA (RTX 4060 8 GB probada).
- El acceso directo y la cabecera compacta de 2.4.3/2.4.4 siguen igual.
- `v2.4.2`, `v2.4.3` y `v2.4.4` quedan como releases anteriores; no se movieron
  sus tags.

## Enlaces

- [Release 2.4.4](RELEASE-2.4.4.md)
- [Acceso directo y primer arranque](PRIMER-ARRANQUE.md)
- [Auditoría completa](AUDIT-2026-11-01.md)
- [Contribuir](../CONTRIBUTING.md)
