# Bonsai Local IDE 2.4.2

**Fecha:** 1 de noviembre de 2026
**Tema:** CI verde y arranque reproducible en un clon limpio.

Release de mantenimiento sobre 2.4.1. El objetivo era que la suite aislada y los
comprobadores del lanzador funcionen **sin GGUF instalados**, para que GitHub
Actions y cualquier clon nuevo tengan una señal real desde el primer minuto.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| Pruebas aisladas en CI | **51/51 OK** |
| Pruebas con Ornith y su proyector ausentes | **51/51 OK** |
| Suites de navegador (Edge/Chrome headless) | **9/9 OK** |
| `start-gpu-model.ps1 -DryRun` sin pesos | **OK** (plan y línea de comandos) |
| Arranque real | sigue exigiendo GGUF y tamaño exactos |
| UI real con Qwen3.6 | **0 errores de consola**, `IA lista`, 32768 |
| Enlaces de documentación | **0 roto(s)** |
| GitHub Actions | Windows, Node 22, Python 3.12 |

## Correcciones

- **`-DryRun` sin GGUF.** `start-gpu-model.ps1` calcula contexto, KV, VRAM y
  argumentos sin comprobar la presencia ni el tamaño de los pesos. Esas
  comprobaciones siguen activas en cualquier arranque real.
- **Catálogo coherente sin modelos.** `chat/prueba-api.mjs` ya no exige que
  todos los GGUF estén instalados: compara `bytes` y `existe` con el disco para
  cada entrada, con modelos presentes o ausentes.
- **Acciones actualizadas.** `actions/checkout@v7`, `actions/setup-node@v7` y
  `actions/setup-python@v7` eliminan el aviso de deprecación de Node 20.
- **Pruebas de perfil y small-coder.** Los `-DryRun` de Ornith con y sin visión
  pasan en un clon limpio y siguen rechazando configuraciones sin margen.
- **Capturas versionadas.** `scripts/check-ui.cjs` nombra las capturas con la
  versión que devuelve `/api/settings`; ya no hay nombres 2.4.0 escritos a mano.

## Compatibilidad

- Windows 10/11, Node ≥ 22, Python 3.12+ (scripts opcionales).
- Los GGUF, binarios de llama.cpp y vendors de demos no se versionan.
- Las pruebas de GPU reales (`test:gpu`) siguen fuera de CI: necesitan el modelo
  cargado y una RTX con CUDA.
- El arranque real mantiene la verificación de VRAM, puerto y pesos.

## Enlaces

- [Auditoría completa](AUDIT-2026-11-01.md)
- [Release 2.4.1](RELEASE-2.4.1.md)
- [Contribuir](../CONTRIBUTING.md)
- [Arquitectura](../ARCHITECTURE.md)
