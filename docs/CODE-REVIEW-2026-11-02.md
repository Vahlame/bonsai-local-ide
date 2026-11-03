# Revisión de ingeniería — Bonsai Local IDE

Fecha: 2026-11-02
Alcance: código Node.js, servidor local, agente, UI, pruebas, CI, seguridad y operación.
Criterio: revisión senior de plataforma (evidencia, riesgo, impacto, coste y plan).

## 1. Veredicto

**Nota global: 7,5/10.** Es un producto local muy por encima de la media de
proyectos de IA local: tiene pruebas reales, escrituras atómicas, undo, rutas
confinadas, defensa anti-CSRF/DNS-rebinding y una separación de módulos que ya
no es un monolito. No encontré ningún fallo **P0** ni vulnerabilidades npm.

Pero **todavía no está para exponerse a una LAN no confiable ni a Internet**, y
quedan tres áreas que impiden llamarlo "excelente" sin matices:

1. **SSRF por DNS y por redirecciones** en `buscar`/`leer_web`, Model Hub y MCP.
2. **Falta de CSP y cabeceras anti-clickjacking** en la página principal.
3. **Trabajo síncrono y polling agresivo** que puede congelar la UI en proyectos
   grandes.

Además, el repositorio arrastra **1.977 archivos de informes** de 2.609
versionados, y el CI no ejecuta auditoría estructural, lint, typecheck ni
cobertura.

> **Actualización posterior:** P1-01, P1-02 y la parte de mayor impacto de
> P1-03/P1-05 están corregidos y verificados. El estado real, lo que queda y las
> pruebas añadidas están en la sección 9. Las cifras de las secciones 2–6 son la
> foto del momento de la revisión, no el estado actual.

## 2. Evidencia objetiva

| Comprobación | Resultado |
|---|---|
| `npm test` | 57/57 suites aisladas OK (~132 s) |
| `npm run test:navegador` | 9/9 suites OK (~64 s) |
| `npm audit --prefix chat --omit=dev` | 0 vulnerabilidades |
| `npm run audit` | 0 imports rotos, 0 módulos huérfanos |
| `npm run docs:links` | 83 documentos, 249 enlaces, 0 rotos |
| Ciclos de importación | 0 ciclos en 246 módulos |
| Archivos versionados | 2.609; 1.977 en `reports/` |
| `reports/` en disco | ~1,14 GB; 6 archivos > 1 MB |
| Módulos de producción | 66; 122 `catch`, 5 silenciosos, 18 `stderr.write` |
| Endpoints HTTP | 43, sin OpenAPI ni validación central |
| Dependencias | 252 (175 prod, 27 dev, 77 opcionales), versiones fijadas |
| CI | tests aislados + docs + 1 smoke de UI; sin audit/lint/typecheck/cobertura |

## 3. Lo que está muy bien

- **Modelo de seguridad local serio**: `guardia.mjs` corta CSRF, DNS rebinding,
  `Origin` ajeno y `Content-Type` simple; token con comparación timing-safe;
  cookie `HttpOnly`/`SameSite=Strict`; artefactos HTML/SVG con CSP `sandbox`.
- **Integridad de datos**: escrituras atómicas con fsync y `.bak`; recuperación
  de JSON corrupto; undo acotado a 400 puntos; memoria global acotada a 300 notas.
- **Rutas confinadas**: `fileInside`/`rutaSegura` rechazan enlaces y junctions;
  `resolveInside` normaliza mayúsculas, puntos finales y binarios.
- **Pruebas de verdad**: servidores falsos, SSE real, copia de evaluación que
  arranca sin `node_modules`, navegador headless, pruebas de seguridad y de
  cancelación. No son tests de humo decorativos.
- **Separación lograda**: `ui-server` 414 líneas, `agent-loop` 455, `actions` 219,
  `context` 330, `diagnostics` y `model-hub` como fachadas. Sin ciclos.
- **Planificación de modelos**: perfiles medidos, VRAM/RAM, MoE, KV y contexto;
  el plan no finge que un modelo cabe.
- **Privacidad**: sin telemetría, sin CDN, inferencia local, búsquedas y descargas
  opcionales.
- **CI en Windows** con Node 22 y Python 3.12, dependencias `npm ci`.

## 4. Hallazgos priorizados

### P1-01 · SSRF por DNS y redirecciones

**Dónde:** `chat/investigacion.mjs:61-93`, `chat/model-hub/remote.mjs:153-178`,
`chat/model-hub/downloads.mjs:199-202`, `chat/mcp-playwright.mjs`.

**Qué pasa:** solo se inspeccionan IP literales. Un dominio como
`localtest.me`/`nip.io` que resuelve a `127.0.0.1` pasa el filtro y `fetch`
resuelve DNS después. Además, Model Hub sigue redirecciones con
`redirect:"follow"` sin revalidar el destino; `cabeceraRemota` hace un primer
salto manual y luego sigue el segundo sin comprobar el host. MCP Playwright acepta
cualquier HTTP/HTTPS y solo bloquea los puertos del IDE.

**Impacto:** el modelo o un enlace malicioso puede alcanzar servicios internos,
paneles de administración o metadatos de nube. Contradice la promesa de
`README.md` y `SECURITY.md`.

**Propuesta:**

1. Resolver `dns.lookup(host, {all:true})` y rechazar rangos privados/reservados:
   `10/8`, `127/8`, `169.254/16`, `172.16/12`, `192.168/16`, `100.64/10`,
   `198.18/15`, `0/8`, `224/4`, `fc00::/7`, `fe80::/10`, `::1`, `::ffff:*`.
2. Usar `redirect:"manual"` y revalidar **cada** `Location` con la misma función.
3. Si se puede, fijar la IP resuelta en el agente HTTP para evitar rebinding
   entre la comprobación y la conexión.
4. Mantener `allowPrivate` solo para SearXNG/local, con allowlist de host:puerto.
5. Aplicar la misma política a MCP Playwright, salvo permiso explícito.
6. Añadir tests con DNS simulado y redirecciones a `127.0.0.1`, no solo IPs
   literales.

### P1-02 · Falta de CSP y anti-clickjacking en la UI principal

**Dónde:** `chat/server/routes/static.mjs:18-20` sirve `/` sin CSP;
`chat/ui/index.html:8` y `:771` tienen scripts inline; solo los artefactos
reciben CSP en `static.mjs:78-81`.

**Qué pasa:** la página principal no tiene `Content-Security-Policy`,
`X-Frame-Options`, `Referrer-Policy` ni `Permissions-Policy`. Un sitio externo
puede incrustar el IDE en un iframe y engañar al usuario para que pulse "Permitir
todo", "Detener" o "Cerrar servidor". El token LAN viaja una vez en `/?token=...`
y no hay `Referrer-Policy` global que evite filtrarlo en navegaciones externas.

**Propuesta:**

1. Cabeceras globales: `X-Content-Type-Options: nosniff`,
   `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
   `Permissions-Policy: camera=(), microphone=(), geolocation=()`,
   `Cross-Origin-Opener-Policy: same-origin`.
2. CSP: `default-src 'self'; script-src 'self' 'sha256-…'; style-src 'self'
   'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self';
   frame-ancestors 'none'; base-uri 'none'; form-action 'self'`.
3. Mover los scripts inline (`theme-boot`, `stats-boot`) a archivos con hash o
   nonce; así la CSP puede ser estricta.
4. Añadir test de cabeceras en `prueba-ui-humo` o `prueba-api`.
5. Si se sirve por TLS, marcar la cookie `Secure` y documentar el proxy.

### P1-03 · Trabajo síncrono y polling que puede congelar la UI

**Dónde:**

- `chat/server/services/stats.mjs:36`: `listWorkspace` en cada `/api/stats`.
- `chat/ui/index.html:791`: `/api/stats` cada 5 s.
- `chat/server/services/commands.mjs:110-118`: `snapshotFiles` completo antes y
  después de **cada** comando; `workspace.mjs:54-89` recorre y hace `statSync`
  por archivo.
- `chat/server/services/symbol-index.mjs`: `indiceSimbolos` síncrono; el primer
  `/api/definir` recorre hasta 4.000 archivos y bloquea el event loop.
- `chat/ui/app.js:715-760`: descarga el archivo activo entero cada 2,5 s para
  detectar cambios externos.
- `chat/ui/paneles.js:475`: sondeo del terminal cada 700 ms.

**Impacto:** en un repo grande, abrir Ajustes, cambiar de archivo o ejecutar un
comando puede producir tirones; el agente paga dos recorridos completos por
comando; el event loop deja de atender SSE mientras indexa.

**Propuesta:**

1. Cachear el conteo de workspace con TTL e invalidación al escribir/comando.
2. Sustituir `snapshotFiles` por un índice incremental o `git status`/mtime;
   si no, limitar a directorios relevantes y usar `fs.watch`.
3. Mover `indiceSimbolos` a un `worker_threads` con índice incremental y
   cancelación.
4. Cambiar el polling del archivo activo por `ETag`/`If-None-Match` o un endpoint
   de metadatos (mtime/size/hash) en vez de descargar el contenido.
5. Terminal por SSE/WebSocket en lugar de polling 700 ms.
6. Revisar intervalos de git/modelos (15 s) y hacerlos visibles solo cuando la
   pestaña está activa.

### P1-04 · El repositorio está dominado por informes

**Dónde:** `reports/` contiene 1.977 de los 2.609 archivos versionados (~1,14 GB
en disco; 6 archivos > 1 MB).

**Impacto:** clone lento, checkout de CI lento, ruido en búsquedas y revisiones,
riesgo de subir datos personales o trazas con rutas.

**Propuesta:** mover el histórico a un repo/release/LFS; versionar solo informes
curados y un índice; añadir un check de tamaño en CI; excluir `reports/` de la
búsqueda por defecto.

### P1-05 · El CI no protege la arquitectura ni la seguridad

**Dónde:** `.github/workflows/ci.yml` ejecuta tests aislados, docs y un solo
smoke de UI. No ejecuta `npm run audit`, lint, typecheck, cobertura ni las 9
suites de navegador.

**Impacto:** un import roto, un archivo de 3.000 líneas, un `catch` vacío o una
regresión de accesibilidad puede entrar sin que el CI lo note. El smoke de UI ya
tuvo que reintentarse una vez.

**Propuesta:**

1. Añadir `npm run audit` (y un `audit:strict` con baseline de archivos grandes).
2. ESLint + Prettier en modo check; `tsc --noEmit --checkJs` gradual en módulos
   nuevos.
3. Cobertura con `c8` y umbral por área.
4. Ejecutar las 9 suites de navegador en PR o nightly.
5. Asignador determinista de puertos y limpieza de procesos para reducir flakes.

### P2-01 · Contrato HTTP inconsistente

43 endpoints con validación manual, respuestas de texto plano o JSON según la
ruta, y algunos `JSON.parse` que pueden devolver `null` y acabar en 500.
**Propuesta:** esquemas Zod por endpoint, envoltorio `{error:{code,message,details}}`,
middleware único de validación y OpenAPI generado.

### P2-02 · Observabilidad insuficiente

122 `catch` en producción (5 silenciosos), 18 `stderr.write` y 14 `console.*`,
sin request-id, sin niveles, sin métricas ni `/api/health` del IDE.
**Propuesta:** logger estructurado con redacción de rutas/secretos, request-id,
latencia por ruta, contadores de turnos/herramientas, `/api/health` y manejadores
de `uncaughtException`/`unhandledRejection`.

### P2-03 · Crecimiento de estado sin retención

`model-hub/jobs.mjs` mantiene todos los trabajos en memoria; el historial de
chats no tiene límite; `timings.jsonl`, `raw-stream.jsonl` y `logs/` no rotan.
Undo (400) y memoria global (300) sí están acotados.
**Propuesta:** podar trabajos terminados, límite/edad de chats, rotación de
timings/raw-stream/logs y exportación/importación de sesiones.

### P2-04 · MCP Playwright puede alcanzar redes privadas

`mcp-playwright.mjs` acepta cualquier HTTP/HTTPS y solo bloquea los puertos del
IDE. **Propuesta:** misma política SSRF que `investigacion`, allowlist explícita
para URLs no locales y registro de cada navegación.

### P2-05 · Avisos legales incompletos para los bundles

Los bundles se compilan con `--legal-comments=none`; `THIRD-PARTY-NOTICES.md`
resume licencias pero no incluye los textos completos. MIT/Apache/LGPL exigen
avisos y, en LGPL, oferta de fuente.
**Propuesta:** generar un `NOTICE` completo desde dependencias, incluir textos de
CodeMirror/xterm/Playwright y la oferta LGPL de `sharp`/libvips.

### P2-06 · Configuración y estado sin esquema

30 variables `BONSAI_*` dispersas, sin `.env.example` ni validación central; los
JSON de estado no llevan `schemaVersion` (salvo memoria global).
**Propuesta:** `config/env.mjs` con Zod/defaults, `.env.example`, y migraciones
versionadas para sesión, índice, ajustes y workspace.

### P2-07 · Accesibilidad sin verificación automática

Hay foco atrapado en diálogos, `aria-live`, `prefers-reduced-motion` y pruebas a
390 px, pero no hay axe/Lighthouse, contraste automatizado ni recorrido solo con
teclado.
**Propuesta:** axe-core en la suite de navegador, test de teclado, contraste y
skip-link.

### P2-08 · `app.js` sigue siendo el monolito de UI

2.791 líneas con estado global compartido; `chat-core` ya está dividido en 7
scripts, pero `app.js` y `hub.js` (765) siguen concentrando demasiado.

**Avance:** se extrajeron tres dominios con dependencias explícitas:
`ui/app-git.mjs` (chip, menú, selección y cambios), `ui/app-search.mjs`
(Ctrl+Shift+F) y `ui/app-rules.mjs` (visor y chip de reglas). `app.js` baja a
~2.500 líneas. `prueba-ui-humo` cubre ahora el menú de Git, el diálogo de
cambios y la búsqueda.

**Pendiente:** editor/pestañas, ajustes, memoria global y Ctrl+K; `hub.js`
también merece un corte por dominios.

### P3 · Menores

- Prettier/ESLint; `present.mjs` conserva indentación de 12 espacios.
- Duplicados menores: `sesionValida` en `historial.mjs` y `session-store.mjs`;
  `stripLooseCommands` en UI y servidor.
- `chat/package.json` sin `version` ni `engines`.
- `index.html` con scripts inline (además del problema de CSP).
- Assets `.js` con `no-store`; se recargan siempre (local, bajo impacto).
- `git gc` pendiente; hay objetos temporales en `.git`.
- Falta `CODEOWNERS`, Dependabot/Renovate y plantillas de issue/PR.
- `audit:strict` falla por 21 archivos >500 líneas; útil como baseline, no como
  gate inmediato.

## 5. Scorecard

| Dimensión | Nota | Comentario |
|---|---:|---|
| Arquitectura | 7,5 | Gran avance; `app.js` y algunos módulos siguen grandes |
| Corrección | 8,0 | Pruebas amplias; quedan flakes y contratos manuales |
| Seguridad | 7,0 | Base local muy buena; SSRF/CSP son los huecos claros |
| Rendimiento | 6,5 | Escaneos síncronos y polling |
| Pruebas | 8,5 | 57+9 suites reales; falta cobertura/lint/typecheck |
| Mantenibilidad | 7,0 | Módulos claros; UI global y estilos mixtos |
| Documentación | 8,0 | Extensa y enlazada; mucho archivo histórico |
| Release/Ops | 6,5 | CI básico; sin release, SBOM ni firma |
| UX | 7,5 | Rica y accesible; falta auditoría formal |
| **Global** | **7,5** | Muy sólido para uso local; no para LAN no confiable |

## 6. Plan de mejora propuesto

### Sprint 1 — Seguridad y gates (2-3 días)

1. SSRF con DNS + redirecciones + MCP.
2. CSP, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
3. `npm run audit` en CI y asignador determinista de puertos.
4. Tests de regresión para los tres puntos.

### Sprint 2 — Rendimiento y contrato (1 semana)

1. Cache de stats + invalidación.
2. Índice de símbolos en worker + índice incremental.
3. Snapshot de comandos por watcher/git/mtime.
4. ETag para el archivo activo; SSE para terminal.
5. Zod + error envelope + OpenAPI.

### Sprint 3 — Mantenibilidad y operación (1-2 semanas)

1. `app.js` por dominios y `ctx` explícito.
2. Logger estructurado, request-id y `/api/health`.
3. Retención de trabajos/chats/timings/logs.
4. Accesibilidad con axe.
5. Repositorio de informes separado y NOTICE completo.

### Sprint 4 — Release engineering

1. Workflow de release con artefactos firmados.
2. SBOM y verificación de licencias.
3. Dependabot/Renovate y CODEOWNERS.
4. Pruebas de carga/estrés del agente y de la UI.

## 7. Lo que no haría ahora

- **No migrar a Rust todavía.** Las fronteras Node acaban de quedar estables; un
  sidecar ahora duplicaría estado y añadiría latencia. El orden correcto es:
  seguridad/rendimiento Node → primer sidecar de búsqueda/índice con pruebas
  diferenciales.
- **No reescribir `app.js` de golpe.** Hay que hacerlo por dominios y con la
  suite de navegador como red.
- **No exponer la LAN** hasta cerrar P1-01 y P1-02.
- **No añadir más funciones de modelo** antes de resolver rendimiento y
  observabilidad; el coste se paga en cada turno.

## 8. Apéndice: comandos de la revisión

```powershell
npm test
npm run test:navegador
npm run audit
npm audit --prefix chat --omit=dev
npm run docs:links
git ls-files | Measure-Object
git count-objects -vH
```

Los detalles de arquitectura y fases están en `docs/REFACTORING.md`; la
migración futura a Rust, en `docs/RUST-MIGRATION.md`.

## 9. Estado tras las correcciones (misma fecha)

### Verificación actual

| Comprobación | Resultado |
|---|---|
| `npm test` | **58/58** suites aisladas OK (~135 s) |
| `npm run test:navegador` | **10/10** suites OK (~66 s) |
| `npm run audit` | 0 imports rotos, 0 huérfanos, 0 `.bak` |
| `npm run check:syntax` | 258 archivos OK |
| `npm run check:reports` | 10 resúmenes curados, 45 KB |
| `npm run docs:links` | 85 documentos, 249 enlaces, 0 rotos |
| `prueba-copia-evaluacion` | OK (la copia aislada arranca sin `node_modules`) |
| `prueba-accesibilidad` | 0 violaciones graves (axe-core, WCAG 2 A/AA) |

### P1-01 · SSRF — corregido

- Nueva política única `chat/red-segura.mjs`: valida esquema, credenciales,
  puertos protegidos y hosts de metadatos; resuelve **todas** las IPs con
  `dns.lookup(host, {all:true})` y rechaza rangos privados, loopback, link-local,
  CGNAT, documentación, multicast e IPv4 mapeada en IPv6.
- `fetchRemoto` usa `redirect:"manual"` y revalida cada `Location`, así un 302 a
  `127.0.0.1` ya no se sigue.
- Integrado en `investigacion.mjs` (`descargarWeb`), `model-hub/remote.mjs`,
  `model-hub/downloads.mjs` y `mcp-playwright.mjs` (metadatos de nube siempre
  bloqueados; las URLs locales siguen permitidas a propósito para probar apps).
- Prueba nueva `chat/prueba-red-segura.mjs` con DNS simulado, IPs privadas y
  redirección a host interno.

- `fetchFijado` conecta a la **IP ya comprobada**, conserva el `Host` y el SNI
  originales y no vuelve a resolver el nombre. `fetchRemoto` y `descargarWeb`
  lo usan por defecto; `prueba-red-segura` verifica con un host inexistente
  (`falso.test`) que la conexión llega al servidor local.
- La ventana de rebinding entre DNS y TCP queda cerrada. El `fetcher` inyectable
  sigue disponible solo para pruebas con respuestas falsas.

### P1-02 · CSP y cabeceras — corregido

- `chat/server/security-headers.mjs` aplica a **todas** las respuestas:
  CSP estricta (`default-src 'self'`, `script-src 'self'`, `object-src 'none'`,
  `base-uri 'none'`, `form-action 'self'`, `frame-ancestors 'self'`),
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy: no-referrer`, `Permissions-Policy` y COOP.
- `SAMEORIGIN`/`frame-ancestors 'self'` en lugar de `DENY`/`none` porque la vista
  previa de artefactos vive en un iframe del mismo origen; un sitio externo sigue
  sin poder incrustar el IDE.
- Los dos scripts inline de `index.html` se movieron a `ui/theme-boot.js` y
  `ui/stats-boot.js`; la página ya no tiene ningún `<script>` sin `src`.
- `prueba-ui-humo` comprueba cabeceras y ausencia de scripts inline. El arnés de
  `prueba-navegador` también se movió a un `.js` externo para cumplir la CSP.

**Pendiente menor:** `style-src` conserva `'unsafe-inline'` porque la UI usa
estilos inline; migrarlo a clases/nonce es un trabajo aparte de bajo riesgo.

### P1-03 · Rendimiento — corregido en lo crítico

- `stats.mjs` cachea el conteo de workspace 30 s y expone `invalidate()`;
  `ui-server` lo invalida al cambiar de carpeta y al terminar un comando.
- El índice de símbolos se calcula en `worker_threads`
  (`diagnostics/index-worker.mjs`), con caché de 60 s, invalidación y
  terminación del worker; `/api/definir` ya no bloquea el event loop.
- `/api/file` devuelve `ETag` (tamaño + mtime) y responde `304` a
  `If-None-Match`; el polling del editor reutiliza el ETag y deja de descargar el
  archivo entero cada 2,5 s.
- `snapshotFiles` omite carpetas pesadas/generadas (`bin`, `models`, `logs`,
  `reports`, `salida`, `capturas`, `trabajo`, `dist`, `build`, `target`, `forks`,
  `kernels`) y enlaces simbólicos.
- Los trabajos del Model Hub se podan (máximo 50 terminados); `timings.jsonl` y
  `raw-stream.jsonl` rotan a 5 MB.
- `snapshotFiles` acepta caché con `fs.watch` y TTL de respaldo. El snapshot
  anterior a un comando se reutiliza; el posterior se fuerza para no perder
  cambios. Si el watcher no está disponible, cae a un TTL corto.
- El terminal usa **SSE** (`/api/terminal/stream`) con `Last-Event-ID` y
  heartbeat; la UI deja de pedir la salida cada 700 ms. Los procesos en segundo
  plano se consultan como máximo cada 2 s.

**Pendiente:** el snapshot posterior al comando sigue recorriendo el árbol (no es
incremental), y git/modelos conservan sondeos de 15 s. Son los siguientes
recortes, ya sin riesgo de congelar el event loop por el índice.

### P1-04 · Informes — corregido en Git

- Se sacaron del índice los **1.977** archivos de `reports/` con
  `git rm -r --cached` (no se borró nada del disco). Quedan versionados **10**:
  los resúmenes curados de la raíz y `reports/README.md`.
- `.gitignore` ignora las ejecuciones crudas (`reports/*`) y deja pasar solo
  `reports/*.md`; el índice explica dónde viven los datos locales.
- README, BENCHMARKS y `bench/README.md` ya no prometen que los crudos viajen en
  el repositorio.

**Pendiente:** los ~1,12 GB siguen en el disco local. Si se quieren conservar
fuera del equipo, hay que moverlos a un release/LFS/repositorio aparte.

### P1-05 · CI — corregido en lo esencial

- `npm run audit` y `npm run check:syntax` corren en el job de tests.
- El job de navegador ejecuta las **10** suites (`run-tests.mjs navegador`) con
  un reintento por timing, en vez de un solo smoke.

**Pendiente:** ESLint/Prettier, `tsc --checkJs` gradual y cobertura con umbral.
La puerta de sintaxis cubre el parseo, no tipos ni estilo.

### P2-01 · Contrato HTTP — corregido en los endpoints críticos

- `chat/server/contracts.mjs` valida con Zod los cuerpos de `POST /api/workspace`,
  `POST /api/file`, `POST /api/undo` y `POST /api/definir`; un cuerpo inválido
  devuelve 400 con texto claro en vez de acabar en 500.
- `GET /api/openapi.json` publica el contrato OpenAPI 3.1 generado desde los
  mismos esquemas. La copia de evaluación sin `node_modules` usa un validador de
  respaldo equivalente y un OpenAPI genérico.
- `prueba-api` comprueba el documento y el rechazo de un `path` no textual.

**Pendiente:** extender el contrato a las rutas restantes (settings, fs, edit,
modelos, chat) y decidir un envelope `{error:{code,message}}` común sin romper la
UI actual, que espera texto o `{error}` según la ruta.

### P2-02 · Observabilidad — corregido en lo esencial

- `chat/server/observability.mjs`: `X-Request-Id` en todas las respuestas, log
  JSON de peticiones lentas (>1,5 s) o con 5xx, redacción de secretos y rutas
  absolutas, y solo el `pathname` (sin query) en el registro de peticiones.
- `GET /api/health` devuelve `ok`, versión, uptime, pid, modelo y nombre de la
  carpeta de trabajo; es barato y no toca el modelo ni el disco.
- Los errores no controlados del router se registran con el mismo `request-id`.
- Pruebas en `prueba-servicios-servidor` (redacción, health, request-id) y
  `prueba-api` (endpoint real y cabecera).

**Pendiente:** métricas agregadas (turnos, herramientas, latencia por ruta),
propagación del `request-id` a los logs del agente y manejadores de
`uncaughtException`/`unhandledRejection`.

### P2 atendidos parcialmente

- **P2-03 (crecimiento de estado):** poda de trabajos y rotación de
  `timings`/`raw-stream`. Quedan el límite/edad del historial de chats y la
  rotación de `logs/`.
- **P2-04 (MCP):** ya bloquea metadatos de nube; mantener URLs privadas es una
  decisión deliberada para probar aplicaciones locales, no un olvido.
- **P2-07 (accesibilidad):** `prueba-accesibilidad` ejecuta axe-core sobre la UI
  real con WCAG 2 A/AA y falla con violaciones `critical`/`serious`. Ahora mismo
  hay 0 graves y 23 reglas en verde.

### Lo que sigue pendiente, por orden

1. Mover los ~1,12 GB de informes locales a un release/LFS si se quieren
   conservar fuera del equipo (P1-04 restante).
2. Snapshot posterior a comandos incremental y sondeos de git/modelos bajo
   demanda (P1-03 restante).
3. Extender Zod/OpenAPI a las rutas restantes y unificar el envelope de error
   (P2-01 restante).
4. Métricas agregadas y propagación del request-id al agente (P2-02 restante).
5. Terminar `app.js` por dominios (P2-08; ya extraídos git, búsqueda y reglas);
   axe ya está cubierto (P2-07).
6. ESLint/Prettier, typecheck gradual y cobertura con umbral (P1-05 restante).
