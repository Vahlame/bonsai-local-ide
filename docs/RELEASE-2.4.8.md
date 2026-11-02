# Bonsai Local IDE 2.4.8

**Fecha:** 2 de noviembre de 2026
**Tema:** servidor y UI modulares, tool registry único, seguridad LAN y búsqueda web opcional.

Release de arquitectura sobre 2.4.7. No cambia el protocolo del agente ni el
diseño de la interfaz; reduce el monolito, elimina copias de tools y añade una
forma segura de salir de loopback y de usar un buscador propio.

## Servidor

| Módulo | Responsabilidad |
| --- | --- |
| `chat/server/workspace.mjs` | listado, índice, adjuntos, snapshots, rutas canónicas y PDF |
| `chat/server/text.mjs` | títulos, recortes, anuncios, resumen y turnos internos |
| `chat/server/agent-loop.mjs` | bucle de `/api/chat` con contexto explícito |
| `chat/server/routes/*.mjs` | handlers HTTP por grupo: estáticos, archivos, Git, modelos, ajustes y chat |

`ui-server.mjs` queda como composition root: **4.115 → 1.055 líneas**. Las rutas
no leen variables globales del servidor; reciben `routeContext` con getters y
setters para carpeta activa, turno, permisos y ciclo de vida del modelo.

## UI

- `chat/ui/core/dom.mjs`, `api.mjs` y `state.mjs`: contratos pequeños sin
  framework ni dependencias nuevas.
- `chat/ui/editor/text.mjs` y `chat/ui/workspace/paths.mjs`: saltos de línea y
  rutas del explorador.
- `app.js`, `hub.js` y `paneles.js` pasan a módulos ES; `index.html` sigue
  sirviendo la misma interfaz y el diseño no cambia.

## Tool Registry

`chat/tool-registry.mjs` es la única fuente de:

- esquemas OpenAI de `PC_TOOLS` y `CODER_TOOLS`;
- validación de argumentos;
- descripción y permiso por tool;
- despacho de efectos de `nativeToolEffects()`.

`tool-schemas.mjs` deriva Zod del JSON Schema del registro. Se elimina la tool
fantasma `buscar_texto`, que solo existía como copia en un test.

## Parser legacy

El aparato de parseo de texto se mueve a `chat/legacy-tool-parser.mjs`, con:

- flag `BONSAI_LEGACY_TOOL_PARSER=0`;
- métricas en `GET /api/stats` (`legacyToolParser`);
- fecha de retirada planificada: **2027-06-30**.

## Búsqueda web

El agente conserva `buscar` y `leer_web`. Ahora `buscar` puede usar una instancia
propia de [SearXNG](https://github.com/searxng/searxng) antes de los fallbacks
DuckDuckGo/Bing:

```powershell
$env:BONSAI_SEARXNG_URL = "http://127.0.0.1:8888/"
```

SearXNG es un metasearch libre, sin API key y con JSON API. Se usa solo la URL
configurada; no se envían consultas a instancias públicas por defecto. Los
resultados siguen marcados como contenido no confiable y pasan por las mismas
protecciones anti-SSRF y de puertos. Guía: [INVESTIGACION-WEB](INVESTIGACION-WEB.md).

Si el usuario pide información actual o externa y el modelo intenta responder
de memoria sin llamar a `buscar`, el agente envía **un único aviso correctivo**
para que busque y lea la fuente. No repite el empujón en bucle: si no hay
resultado, el cierre lo dice con honestidad.

## Seguridad LAN

- `--host` fuera de loopback se rechaza salvo `--unsafe-lan`.
- `--unsafe-lan` exige un token de al menos 16 caracteres (`--token` o
  `BONSAI_UI_TOKEN`).
- El primer acceso `/?token=...` deja una cookie `HttpOnly` y redirige a `/`.
- La API acepta también `X-Bonsai-Token` y `Authorization: Bearer`.
- `start-ui.ps1` gana `-UnsafeLan` y `-Token`.

## CI y pruebas

- Nuevo job `browser-smoke` en GitHub Actions para `prueba-ui-humo.mjs`.
- `prueba-lanzador.mjs` crea y verifica un acceso directo real en `%TEMP%`, sin
  GPU.
- Nuevas pruebas: `server-workspace`, `server-text`, `tool-registry`,
  `legacy-tool-parser` y `lan-auth`.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| Tests aislados | **56/56 OK** |
| Suites de navegador | **9/9 OK** |
| Enlaces de documentación | **0 roto(s)** |
| UI 2.4.8 | capturas y 0 errores de consola |
| Copia aislada de evaluación | arranca con los módulos nuevos |
| CI | Windows · Node 22 · Python 3.12 · smoke de navegador |

## Compatibilidad

- Windows 10/11, Node ≥ 22, GPU CUDA (RTX 4060 8 GB probada).
- Sin cambios en endpoints ni en el comportamiento del agente.
- `GET /api/stats` añade `legacyToolParser` de forma aditiva.
- El acceso LAN sin token deja de estar permitido a propósito.
- Los tags publicados anteriores no se movieron.

## Enlaces

- [Release 2.4.7](RELEASE-2.4.7.md)
- [Búsqueda web y SearXNG](INVESTIGACION-WEB.md)
- [Servidor modular](../chat/server/README.md)
- [Seguridad](../SECURITY.md)
- [Contribuir](../CONTRIBUTING.md)
