# Bonsai Local IDE 2.4.3

**Fecha:** 2 de noviembre de 2026
**Tema:** acceso directo del escritorio y razonamiento sin límite.

Release de parche sobre 2.4.2. El acceso directo abría una consola oculta y
moría antes de mostrar la UI porque el lanzador pasaba `--think -1` y
`ui-server.mjs` solo aceptaba valores `>= 0`. La UI nunca llegaba a escuchar en
8787, así que el doble clic parecía no hacer nada.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| Acceso directo real (`Bonsai IDE.lnk`) | **abre Edge en modo app y la UI en 8787** |
| `--think -1` | **aceptado**, razonamiento sin límite |
| Regresión del lanzador | **check 17** en `prueba-servidor-estado.mjs` |
| Tests aislados | **51/51 OK** |
| Suites de navegador | **9/9 OK** |
| UI real con Qwen3.6 | **0 errores de consola**, `IA lista`, 32768 |
| Enlaces de documentación | **0 roto(s)** |
| CI | Windows · Node 22 · Python 3.12 · **verde** |

## Correcciones

- **`--think -1` en `ui-server.mjs`.** El parser acepta `-1` como “sin límite”
  (coherente con `presupuestoPensar`) y sigue rechazando valores menores.
- **Acceso directo.** La cadena `Bonsai IDE.lnk` → `bonsai-rtx4060.ps1` →
  `start-ui-rtx4060-optimized.ps1` → `ui-server.mjs` vuelve a completar el
  arranque. El icono, el directorio de trabajo y el modo app de Edge no cambian.
- **Ventana de Edge.** `openBrowser()` ya no lanza PowerShell con
  `detached: true` + `stdio: "ignore"`: en Windows eso impedía crear la ventana
  y fallaba en silencio. Ahora la UI y la ventana de Edge abren juntas.
- **Regresión.** `chat/prueba-servidor-estado.mjs` arranca la UI con
  `--think -1` y comprueba que `/api/settings` devuelve `pensar: -1` y
  `pensarInfo.efectivo: -1`.

## Compatibilidad

- Windows 10/11, Node ≥ 22, GPU CUDA (RTX 4060 8 GB probada).
- El acceso directo abre la UI; el modelo se inicia desde **Iniciar** o el
  diálogo de primer arranque.
- `v2.4.2` queda como release anterior; no se movió su tag.

## Enlaces

- [Acceso directo y primer arranque](PRIMER-ARRANQUE.md)
- [Release 2.4.2](RELEASE-2.4.2.md)
- [Auditoría completa](AUDIT-2026-11-01.md)
- [Contribuir](../CONTRIBUTING.md)
