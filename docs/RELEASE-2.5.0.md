# Bonsai Local IDE 2.5.0

**Fecha:** 2 de noviembre de 2026
**Tema:** red saliente blindada, UI modular y contrato HTTP.

Release de consolidación sobre 2.4.13. No cambia el modelo ni el flujo normal de
trabajo: endurece la red, reduce bloqueos del servidor y deja la UI y la API más
fáciles de mantener.

## Seguridad

- **SSRF con IP fijada.** `chat/red-segura.mjs` resuelve todas las IPs, rechaza
  rangos privados/reservados y metadatos de nube, revalida cada redirección y
  conecta a la IP ya comprobada conservando `Host` y SNI. El DNS rebinding entre
  la comprobación y la conexión queda cerrado.
- **CSP estricta y cabeceras globales:** `script-src 'self'`, `nosniff`,
  `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`,
  `Permissions-Policy` y COOP. Los scripts inline se movieron a
  `ui/theme-boot.js` y `ui/stats-boot.js`.
- **Observabilidad acotada:** `/api/health`, `X-Request-Id` y log JSON de
  peticiones lentas/5xx, con redacción de secretos y rutas absolutas.

## Rendimiento

- Caché de stats con TTL e invalidación al cambiar de carpeta o ejecutar un
  comando.
- Índice de símbolos en `worker_threads`, con caché e invalidación.
- `ETag`/`304` en `/api/file` y en el polling del editor.
- Snapshot de comandos con caché `fs.watch` para el estado previo; el posterior
  se fuerza para no perder cambios.
- Terminal por SSE (`/api/terminal/stream`) con `Last-Event-ID` y heartbeat.
- Poda de trabajos del Model Hub y de registros de agente; rotación de
  `timings`/`raw-stream` a 5 MB.

## Arquitectura y UI

- `app.js` empieza a dividirse por dominios: `ui/app-git.mjs`,
  `ui/app-search.mjs` y `ui/app-rules.mjs`, con dependencias explícitas.
- Contrato Zod para `workspace`, `file`, `undo` y `definir`; un cuerpo inválido
  devuelve 400 en vez de 500. `GET /api/openapi.json` publica OpenAPI 3.1.
- `reports/` deja de viajar en Git: solo quedan los resúmenes curados y un
  índice; las ejecuciones crudas siguen en local y están ignoradas.

## Calidad

- **58/58** suites aisladas y **10/10** suites de navegador.
- **0 violaciones graves** de accesibilidad (axe-core, WCAG 2 A/AA).
- `npm run check:syntax`, `npm run check:reports`, `npm run audit` y
  `npm run docs:links` en CI.
- `prueba-ui-humo` cubre el panel de Git y la búsqueda extraídos.

## Compatibilidad

- Sin cambios de endpoints ni del comportamiento normal en loopback.
- La copia aislada de evaluación sigue arrancando sin `node_modules`: Zod es
  opcional y hay un validador de respaldo.
- `reports/` no se borra del disco; solo sale del índice de Git.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| Tests aislados | **58/58 OK** |
| Suites de navegador | **10/10 OK** |
| Accesibilidad axe | **0 graves, 23 reglas OK** |
| Sintaxis | **258 archivos OK** |
| Informes curados | **10 archivos, 45 KB** |
| Auditoría estructural | **0 imports rotos, 0 huérfanos** |
| Enlaces de documentación | **85 documentos, 255 enlaces, 0 rotos** |

## Enlaces

- [Release 2.4.13](RELEASE-2.4.13.md)
- [Seguridad](../SECURITY.md)
- [Refactoring](REFACTORING.md)
- [Revisión de ingeniería](CODE-REVIEW-2026-11-02.md)
- [Servidor modular](../chat/server/README.md)
