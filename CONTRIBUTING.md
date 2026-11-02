# Contribuir a Bonsai Local IDE

Gracias por querer mejorar el proyecto. Bonsai es un IDE local para Windows,
llama.cpp y GPU modesta; la prioridad es que el agente sea honesto, verificable
y rápido en hardware real.

## Requisitos

- Windows 10/11.
- Node.js 22 o superior.
- `npm ci --prefix chat` para las dependencias de la UI y las pruebas.
- Python 3.12+ para los scripts de benchmark (opcional).
- Edge o Chrome para `scripts/check-ui.cjs` (o `BONSAI_BROWSER`).
- Un `llama-server` y un GGUF solo si vas a probar inferencia real.

Los pesos, binarios y vendors locales no se versionan.

## Desarrollo

```powershell
git clone https://github.com/Vahlame/bonsai-local-ide.git
cd bonsai-local-ide
npm ci --prefix chat
node scripts/run-tests.mjs
```

Para abrir la UI sin navegador automático:

```powershell
.\scripts\launch-ide.ps1 -NoBrowser
# UI: http://127.0.0.1:8787
```

## Comprobaciones antes de un PR

```powershell
node scripts/check-doc-links.mjs
node scripts/run-tests.mjs
node scripts/check-ui.cjs        # con IDE y modelo cargados
```

La suite aislada no necesita GPU. Las pruebas `test:gpu` requieren un modelo
real y no forman parte de CI.

## Estilo

- Node ESM, 2 espacios, comillas dobles, punto y coma.
- Mantén los mensajes de usuario en español y los identificadores técnicos en
  inglés cuando ya existan.
- No añadas dependencias si una solución local de Node/PowerShell basta.
- No hardcodees rutas de usuario; usa `__dirname`, `$PSScriptRoot`,
  `%USERPROFILE%` o variables de entorno.
- No inventes resultados: si no lo comprobaste, dilo.

## Modelos y benchmarks

- Los perfiles viven en `config/model-catalog.json`; el Hub calcula el plan.
- Para descargar: `node scripts/hub.mjs download <clave>` o
  `node scripts/fast-download.mjs --models <claves>`.
- La matriz de tareas está en `scripts/bench-tasks.py` y sus prompts en
  `docs/qwen38/prompts/`.
- Los resultados y capturas se guardan en `docs/qwen38/`.

## Commits y releases

- Mensajes claros en imperativo (`fix:`, `feat:`, `docs:`, `release:`).
- Un PR debe incluir pruebas o explicar por qué no aplican.
- Actualiza `CHANGELOG.md` y `docs/RELEASE-*.md` para cambios de versión.
- No muevas un tag publicado; crea una versión nueva.

## Seguridad

- No subas `.env`, claves, tokens, GGUF ni binarios.
- Los reportes históricos pueden contener rutas de la máquina; no los uses
  como plantilla de configuración.
- Para vulnerabilidades, sigue [SECURITY.md](SECURITY.md).
