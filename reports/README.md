# Informes

Este directorio guarda resultados de benchmarks y auditorías. Para que el
repositorio no crezca sin límite, **solo se versionan los resúmenes curados de
esta raíz**. Los directorios con ejecuciones crudas, logs, capturas y perfiles
(`bench-*`, `coding-bench-*`, `coder-*`, `agent-ui-*`, `archive/`, etc.) se
quedan en local y están excluidos por `.gitignore`.

## Resúmenes versionados

- [Coding models for eight GB](<Coding models for eight GB.md>)
- [CODING-2026-10-31](CODING-2026-10-31.md)
- [CODER-PIPELINE-2026-10-31](CODER-PIPELINE-2026-10-31.md)
- [ENGINE-2026-10-31](ENGINE-2026-10-31.md)
- [GPTOSS-2026-10-31](GPTOSS-2026-10-31.md)
- [MODEL-CATALOG-2026-10-31](MODEL-CATALOG-2026-10-31.md)
- [MODEL-HUB-2026-10-31](MODEL-HUB-2026-10-31.md)
- [MOE-2026-10-31](MOE-2026-10-31.md)
- [WEBAPP-2026-10-31](WEBAPP-2026-10-31.md)

## Ejecuciones locales

Los scripts de `bench/` siguen escribiendo aquí sus resultados. Para publicar una
nueva conclusión, crea un resumen `.md` en esta raíz y enlaza los datos crudos
solo si están en un release, LFS o un repositorio aparte. No hace falta añadir
los directorios de ejecución al control de versiones.
