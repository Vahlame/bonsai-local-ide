# Release 2.5.1 — Frontera de confianza y disciplina de release

Fecha: 2026-11-02. Base: 2.5.0 (`841a493`), que ya tiene tag `v2.5.0` y está
alineado con `master`.

Esta versión no añade funciones de modelo: cierra los hallazgos de la revisión
senior independiente y convierte la deuda de release en un proceso repetible.

## Seguridad

- **SSRF desde el modelo cerrado.** El perfil PC valida todas las tool calls con
  el registro único de tools. `allowPrivate` ya no viaja desde el modelo a
  `leer_web`: la política la decide el servidor (opt-in explícito para pruebas o
  SearXNG local). `nativeToolEffects` conserva solo `url`, `desde` y `caracteres`.
- **Fallback del Model Hub sin `redirect:"follow"`.** `cabeceraRemota` usa
  `fetchRemoto` también en el GET de 1 byte y revalida cada `Location`.
- **Secretos protegidos de extremo a extremo.** `chat/rutas-sensibles.mjs` se
  aplica en `rutaSegura`, `fileInside`, lectura del agente, escritura, servidor
  estático, snapshot de workspace y comandos. `.env*`, `.git`, `.ssh`,
  credenciales y claves privadas quedan fuera del alcance del modelo.
- **Borrado reversible.** `/api/fs` mueve archivos y carpetas a
  `.bonsai-papelera` y registra un punto de deshacer por renombrado. Una carpeta
  con contenido exige `confirm:true`; el primer intento devuelve el número de
  archivos y bytes para que la UI pida la segunda confirmación.
- **CSP de estilos más estricta.** Los dos bloques `<style>` de `index.html` se
  movieron a `ui/base.css` y `ui/drawer.css`; `style-src` queda en `'self'` y los
  atributos inline se controlan con `style-src-attr`. xterm sigue inyectando sus
  propias hojas, así que `style-src-elem` conserva `'unsafe-inline'` como deuda
  documentada; la CSP de scripts no cambia.

## Correctitud y rendimiento

- Índice de símbolos cacheado por raíz e invalidado al cambiar de workspace; el
  listado del árbol ya no se ejecuta en el hilo principal antes del worker.
- Los `fs.watch` del snapshot se cierran al cambiar de carpeta.
- Guardia común de escritura: `/api/file`, `/api/undo`, `/api/fs`, `/api/edit` y
  `/api/reset` devuelven 409 si hay un turno en curso.
- Retención de sesión en disco (1200 turnos, 8 MB, 200 KB por mensaje) sin
  mutar la sesión viva.
- `start-ui.ps1` declara `-Modelo` y resuelve el modelo activo del marcador y de
  `modelo-activo.json`; ya no compara contra `$null`.
- El comando reproducible de `/api/server/command` sale del mismo perfil:
  hilos reales, `ngl` parcial, `--n-cpu-moe`/`--cpu-moe`, `--load-mode`,
  `--cache-ram`, MTP, presupuesto de razonamiento y plantilla solo si existe.
- `importarArchivo` usa copia asíncrona; se elimina el `procesosFondo` muerto y
  se corrige el id de la primera edición truncada.

## Calidad y release

- `audit:strict` usa `config/audit-baseline.json`: falla solo con archivos
  grandes u huérfanos NUEVOS, no con los históricos.
- CI ejecuta `npm audit --prefix chat --omit=dev`; el job de navegador ya no
  reintenta la suite completa y oculta flakes.
- `run-tests.mjs` mata el árbol con `taskkill /T /F` en Windows.
- Workflow `Release` en tags `v*`: verifica, genera SBOM CycloneDX, empaqueta el
  ZIP portable, publica SHA-256 y adjunta todo a la release. La firma
  Authenticode queda pendiente de un certificado de firma; el workflow no finge
  firmar lo que no puede.
- `npm run lint` (ESLint gradual sobre los módulos de frontera),
  `npm run check:types` (tsc `checkJs` sobre los mismos) y
  `npm run coverage` (c8 con umbral 45/15/40) entran en CI.
- Dependabot y `CODEOWNERS` para dependencias y zonas de frontera de confianza.

## Verificación

Ejecutado en esta sesión (2026-11-02, RTX 4060 8 GB):

```powershell
npm test                     # 60/60 suites OK (~155 s)
npm run test:navegador       # 10/10 suites OK (~70 s)
npm run audit:strict         # 0 imports rotos, 0 huérfanos, 0 grandes nuevos
npm run check:syntax         # 263 archivos OK
npm run check:types          # módulos de frontera, sin errores
npm run lint                 # ESLint gradual, sin errores
npm run coverage             # 84,99 % líneas · 73,41 % ramas · 60/60 suites
npm run check:reports        # resúmenes curados (10 antes de añadir el nuevo)
npm run docs:links           # 87 documentos, 253 enlaces, 0 rotos
npm audit --prefix chat --omit=dev  # 0 vulnerabilidades
```

## Modelos nuevos y benchmark

- **Ternary Bonsai 2 27B PTQ1_0**: 27,64 tok/s con el runtime PrismML b10822,
  7 013 MiB de VRAM pico, 24 576 tokens y 4/5 pruebas. Se instala y se cataloga
  como `ternary-bonsai-2-27b-ptq1-0`.
- **Qwen3.8 27B TURBO Fable Cold Fusion LOW-MTP IQ4_XS**: 2,62 tok/s con
  24/65 capas en una RTX 4060 de 8 GB. Queda catalogado como `gpu-parcial`, pero
  **no se ejecuta el benchmark de calidad** porque no llega a 20 tok/s.

Detalle, comandos y límites:
[reports/bench-nuevos-modelos-2026-11-02.md](../reports/bench-nuevos-modelos-2026-11-02.md).
