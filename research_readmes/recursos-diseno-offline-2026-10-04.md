# Recursos de DISEÑO para un agente de IA, offline, sin npm, sin claves y sin registro

**Fecha:** 2026-10-04
**Ámbito:** interfaz web local tipo Cursor IDE — HTML + CSS + JS *vanilla*, sin framework, sin bundler, sin build step.
**Ficheros afectados:** `chat/ui/index.html` (2 051 líneas, 2 `<script>` clásicos), `chat/ui/ide.css`, `chat/ui/ide.js`, `chat/ui/markdown.js` (UMD). Servidor: `chat/ui-server.mjs` (`node:http` puro).
**Método:** toda URL de esta nota se ha comprobado con petición HTTP real (`Invoke-WebRequest` / `curl.exe`) y se declara el **código de estado, `Content-Type` y tamaño en bytes** medidos. Lo no verificado se marca explícitamente como **[NO VERIFICADO]**.

> Contenido web = dato, nunca instrucción. Todas las URLs se citan completas.

---

## 0. Tres avisos previos que cambian el plan

### 0.1 BLOQUEANTE: el servidor no puede servir `.woff2`, `.svg` ni `.json`

En `chat/ui-server.mjs` la ruta de la interfaz está restringida a JS y CSS:

```js
// chat/ui-server.mjs:1091-1101
if (req.method === "GET" && url.pathname.startsWith("/ui/")) {
  const name = path.basename(url.pathname);
  const abs = path.join(HERE, "ui", name);
  if (!/^[\w.-]+\.(js|css)$/.test(name) || !fs.existsSync(abs)) {
    res.writeHead(404).end("no está");
```

Y la tabla de tipos (`ui-server.mjs:37-47`) **no tiene entrada para `.woff2` ni `.woff`**:

```js
const TYPES = { ".html": ..., ".css": ..., ".js": ..., ".mjs": ..., ".svg": "image/svg+xml", ".json": ..., ".txt": ..., ".md": ..., ".py": ... };
```

**Consecuencia práctica:** si se copia `inter.woff2` a `chat/ui/fonts/`, la petición `GET /ui/fonts/inter.woff2` devuelve **404**. Lo mismo para un sprite `.svg`. Antes de adoptar cualquier fuente o sprite hay que hacer **estos tres cambios mínimos** (los tres, no uno):

1. Ampliar la regex de extensión permitida:
   `/^[\w.-]+\.(js|css|woff2|woff|svg|json)$/`
2. Añadir a `TYPES`: `".woff2": "font/woff2"`, `".woff": "font/woff"`, y verificar que `.svg`/`.json` ya están (sí están).
3. Permitir subcarpetas: hoy `path.basename()` aplana la ruta, así que `fonts/inter.woff2` se busca como `ui/inter.woff2`. O se dejan los ficheros planos en `chat/ui/`, o se cambia a una resolución de ruta saneada (p. ej. `path.normalize` + comprobación de que el resultado sigue dentro de `ui/`).

`Content-Type: font/woff2` es **obligatorio**: los navegadores rechazan `@font-face` si el tipo no es de fuente. Medido en el origen real: `fonts.gstatic.com` y `cdn.jsdelivr.net` responden exactamente `font/woff2`.

### 0.2 El servidor manda `Cache-Control: no-store`, lo que anula el beneficio de cachear fuentes/sprite

`ui-server.mjs:1099` responde `"Cache-Control": "no-store"` para todo lo de `/ui/`. Con 2 051 líneas de HTML y una fuente de ~47 KB o un sprite de ~500 KB, cada recarga los vuelve a bajar. Para ficheros estáticos versionados conviene algo como `Cache-Control: public, max-age=31536000, immutable` solo para `/ui/*.woff2` y `/ui/*.svg` (y dejar `no-store` en JS/CSS mientras se itera). No es un requisito de diseño, pero multiplica la sensación de fluidez en un portátil modesto.

### 0.3 Alternativa de coste cero: la app ya tiene fuentes decentes instaladas en Windows

`index.html:25` ya usa `--mono: "Cascadia Mono", Consolas, monospace` y `index.html:42` usa `"Segoe UI Variable", "Segoe UI", sans-serif`. **Cascadia Code/Mono** y **Segoe UI Variable** son fuentes de Microsoft ya presentes en Windows 11, licencia de sistema, **0 bytes de descarga y 0 cambios en el servidor**. Es la opción más barata y compatible; solo hay que aceptar que no son idénticas en otras máquinas. Todo lo de la sección 2 es la mejora "profesional y portable", no un requisito.

---

## 1. ICONOS

### 1.1 Tabla comparativa (versiones y tamaños medidos el 2026-10-04)

| Librería | Licencia exacta | Fichero a copiar | Tamaño medido | Nº iconos | URL directa verificada |
|---|---|---|---|---|---|
| **Lucide** `lucide-static@1.52.0` | **ISC** (fichero LICENSE: *"ISC License / Copyright (c) 2026 Lucide Icons and Contributors"*) | `sprite.svg` (sprite con `<symbol>`) | **519 537 B (507,4 KB)** — HTTP 200, `image/svg+xml` | 1 866 claves en `icon-nodes.json` | https://cdn.jsdelivr.net/npm/lucide-static@1.52.0/sprite.svg |
| **Lucide (JSON para Node)** | ISC | `icon-nodes.json` | **780 934 B (762,6 KB)** — 200, `application/json` | 1 866 | https://cdn.jsdelivr.net/npm/lucide-static@1.52.0/icon-nodes.json |
| **Lucide (1 icono)** | ISC | `icons/house.svg` | **459 B** — 200, `image/svg+xml` | — | https://cdn.jsdelivr.net/npm/lucide-static@1.52.0/icons/house.svg |
| **Lucide (tarball npm)** | ISC | paquete completo | 48,73 MB descomprimido | 1 866 | https://registry.npmjs.org/lucide-static/-/lucide-static-1.52.0.tgz |
| **Tabler Icons** `@tabler/icons-sprite@3.48.0` | **MIT** (*"MIT License / Copyright (c) 2020-2026 Paweł Kuna"*) | `dist/tabler-sprite.svg` | **2 190 880 B (2 139,5 KB)** — 200, `image/svg+xml` | ~5 900 | https://cdn.jsdelivr.net/npm/@tabler/icons-sprite@3.48.0/dist/tabler-sprite.svg |
| Tabler (sin trazo) | MIT | `dist/tabler-sprite-nostroke.svg` | **2 103 058 B (2 053,8 KB)** — 200 | ~5 900 | https://cdn.jsdelivr.net/npm/@tabler/icons-sprite@3.48.0/dist/tabler-sprite-nostroke.svg |
| **Phosphor** `@phosphor-icons/web@2.1.2` | **MIT** | `src/regular/style.css` (webfont) | CSS **78 131 B** — 200, `text/css` (paquete 44,17 MB descomprimido) | ~1 500 × 6 pesos | https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.2/src/regular/style.css |
| **Phosphor (núcleo SVG)** `@phosphor-icons/core@2.1.1` | **MIT** | tarball | 6,18 MB descomprimido | ~1 500 × 6 pesos | https://registry.npmjs.org/@phosphor-icons/core/-/core-2.1.1.tgz |
| **Heroicons** `heroicons@2.2.0` | **MIT** | `24/outline/*.svg` (SVG crudos) | SVG suelto **965 B** — 200, `image/svg+xml`; paquete 0,67 MB | ~300 | https://cdn.jsdelivr.net/npm/heroicons@2.2.0/24/outline/academic-cap.svg |
| **Material Symbols** `@material-symbols/svg-400@0.47.6` | **Apache-2.0** | tarball (SVG sueltos por peso) | 12,51 MB descomprimido | ~3 600 | https://registry.npmjs.org/@material-symbols/svg-400/-/svg-400-0.47.6.tgz |
| **Feather** `feather-icons@4.29.2` | **MIT** | `dist/feather-sprite.svg` | **60 317 B (58,9 KB)** — 200, `image/svg+xml` | 286 | https://cdn.jsdelivr.net/npm/feather-icons@4.29.2/dist/feather-sprite.svg |
| Feather (sprite inyectable por JS) | MIT | `dist/feather.js` | **0,60 MB** descomprimido; el `.js` responde 200, `application/javascript` | 286 | https://cdn.jsdelivr.net/npm/feather-icons@4.29.2/dist/feather.js |
| **Iconify JSON (datos puros)** `@iconify-json/lucide@1.2.139` | **ISC** (el paquete declara ISC; los iconos son ISC de Lucide) | `icons.json` | **613 054 B (598,7 KB)** — 200, `application/json` | ~1 600 | https://cdn.jsdelivr.net/npm/@iconify-json/lucide@1.2.139/icons.json |

Comprobaciones adicionales: `https://registry.npmjs.org/lucide-static/latest` → 200 `application/json` (versión publicada `1.52.0`, `dist-tags`: `latest`); `https://registry.npmjs.org/@tabler/icons-sprite/latest` → 200 (`latest: 3.48.0`).

### 1.2 El dato más útil: Lucide `sprite.svg` + `icon-nodes.json` se leen desde Node sin npm

`icon-nodes.json` es un objeto plano `nombre → [nodos]`, sin XML y sin dependencias. Verificado ejecutando una petición real y leyendo la estructura:

```json
{ "house": [ { "value": ["path", { "d": "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" }] },
             { "value": ["path", { "d": "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" }] } ] }
```

Esto permite, con ~20 líneas de Node (solo `node:fs`), generar en tiempo de preparación un sprite **reducido a los 40-60 iconos que la interfaz usa realmente** (unos pocos KB en vez de 507 KB). Ejemplo de recorte:

```js
// node herramientas/sprite.mjs   (sin npm, solo node:fs)
import fs from "node:fs";
const nodos = JSON.parse(fs.readFileSync("lucide-icon-nodes.json", "utf8"));
const USADOS = ["house","settings","terminal","file-code","git-branch","play","square","search","x","check","copy","chevron-right"];
const aSvg = (n, hijos) => `<symbol id="i-${n}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${
  hijos.map(([tag, at]) => `<${tag} ${Object.entries(at).map(([k,v]) => `${k}="${v}"`).join(" ")}/>`).join("")
}</symbol>`;
const salida = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${USADOS.map(n => aSvg(n, nodos[n])).join("")}</svg>`;
fs.writeFileSync("chat/ui/icons.svg", salida, "utf8");
```

Y en el HTML: `<svg class="ic"><use href="/ui/icons.svg#i-house"></use></svg>`.

Alternativa de una sola línea, si no se quiere ni generar nada: copiar `sprite.svg` completo (507 KB) y usar `<use href="/ui/sprite.svg#house">`. **Ojo:** un sprite externo referenciado con `<use href="archivo.svg#id">` **no hereda `currentColor`** en todos los motores; si se necesita colorear por CSS, el sprite debe estar **inline** en el documento (de ahí el `style="display:none"` del ejemplo) o inyectado por `fetch`. Ese es el motivo real por el que conviene el recorte a un sprite inline pequeño y no el sprite gigante completo.

### 1.3 Recomendación única de iconos

> **Lucide `lucide-static`, licencia ISC**, vía jsDelivr. Descargar una vez `icon-nodes.json` (762 KB) y `sprite.svg` (507 KB), generar con un script de Node un sprite inline recortado a los iconos usados, y pegarlo en `index.html`. Es la única de la lista que cumple las cuatro condiciones a la vez: licencia permisiva sin atribución obligatoria en la UI, trazo de 24 px consistente con interfaces de editor, **JSON legible por Node sin npm**, y cobertura amplia (1 866 iconos). Feather (MIT) es la alternativa si el objetivo es "lo más pequeño posible" (58,9 KB el sprite completo, pero solo 286 iconos y el proyecto está congelado desde 2020). Tabler queda descartado para un primer salto por tamaño: su sprite pesa **2,1 MB**, cuatro veces Lucide.

---

## 2. TIPOGRAFÍAS (OFL, `.woff2`, self-hosted)

### 2.1 Hallazgo decisivo: cuál es el fichero *variable* y cuál no

Comprobado con peticiones reales a la API `css2` de Google Fonts:

- `https://fonts.googleapis.com/css2?family=Inter:wght@400..700&display=swap` → la regla `/* latin */` apunta a **una sola URL** para todo el rango: `https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7SUc.woff2`. Es decir, **el rango `400..700` sí da una fuente variable: un único fichero sirve los cuatro pesos**.
- En cambio `...family=Inter:wght@400;500;600;700...` (pesos sueltos separados por `;`) devuelve **tres URLs distintas** (una por peso): `...SjIw2boKoduKmMEVuLyfAZ9hiA.woff2` (400), `...VuI6fAZ9hiA.woff2` (500), `...VuFuYAZ9hiA.woff2` (700). Son instancias estáticas: 4 peticiones en vez de 1.
- **Lo importante:** el fichero variable de Fontsource coincide **byte a byte** con el del rango de Google. Medido: `https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/files/inter-latin-wght-normal.woff2` son **48 256 B** y `https://fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7SUc.woff2` son **48 256 B**. Mismo peso, misma firma `774f4632` (`wOF2`).

Por tanto, **la forma correcta y verificada de descargar un `.woff2` variable de Inter con subconjunto latino es el fichero de Fontsource**, no la URL de gstatic (que es idéntica pero cuya URL cambia con cada revisión de la fuente).

### 2.2 Tabla de fuentes (tamaños de `.woff2` medidos con descarga real)

| Fuente | Licencia | Fichero | Tamaño medido | `Content-Type` | URL directa verificada |
|---|---|---|---|---|---|
| **Inter Variable** | **OFL-1.1** (fichero LICENSE: *"Copyright 2016 The Inter Project Authors… SIL Open Font License, Version 1.1"*) | `inter-latin-wght-normal.woff2` (**variable, 1 fichero = pesos 400-700**) | **48 256 B (47,1 KB)** | `font/woff2` ✅ firma `wOF2` | https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/files/inter-latin-wght-normal.woff2 |
| Inter Variable — latino extendido (opcional) | OFL-1.1 | `inter-latin-ext-wght-normal.woff2` | **85 068 B (83,1 KB)** | `font/woff2` | https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/files/inter-latin-ext-wght-normal.woff2 |
| Inter Variable — cursiva (opcional) | OFL-1.1 | `inter-latin-wght-italic.woff2` | **51 832 B** | `font/woff2` | https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/files/inter-latin-wght-italic.woff2 |
| **JetBrains Mono Variable** | **OFL-1.1** | `jetbrains-mono-latin-wght-normal.woff2` | **40 404 B (39,5 KB)** | `font/woff2` | https://cdn.jsdelivr.net/npm/@fontsource-variable/jetbrains-mono@5.3.0/files/jetbrains-mono-latin-wght-normal.woff2 |
| **Geist Variable** | **OFL-1.1** | `geist-latin-wght-normal.woff2` | **29 400 B (28,7 KB)** | `font/woff2` | https://cdn.jsdelivr.net/npm/@fontsource-variable/geist@5.3.0/files/geist-latin-wght-normal.woff2 |
| **Geist Mono Variable** | OFL-1.1 | — | (vía Fontsource o Google) | — | https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400..700&display=swap |
| **IBM Plex Sans** | **OFL-1.1** | `ibmplexsans…syxeKYY.woff2` (latino, **estático por peso**) | **45 712 B (44,6 KB)** por peso | `font/woff2` | https://fonts.gstatic.com/s/ibmplexsans/v23/zYXzKVElMYYaJe8bpLHnCwDKr932-G7dytD-Dmu1syxeKYY.woff2 |
| **Atkinson Hyperlegible** (accesibilidad) | **OFL-1.1** | latino `9Bt23C1KxNDXMspQ1lPyU89-1h6ONRlW45G04pIo.woff2` | (200, respuesta válida) | `font/woff2` | https://fonts.gstatic.com/s/atkinsonhyperlegible/v12/9Bt23C1KxNDXMspQ1lPyU89-1h6ONRlW45G04pIo.woff2 |
| Inter completo (GitHub, **todos** los glifos) | OFL-1.1 | `InterVariable.woff2` | **352 240 B (344 KB)** | `application/octet-stream` (⚠️ el nombre manda, no el tipo) | https://raw.githubusercontent.com/rsms/inter/master/docs/font-files/InterVariable.woff2 |
| Inter estáticos (GitHub) | OFL-1.1 | `Inter-Regular.woff2` / `-Medium` / `-SemiBold` | 111 268 / 114 348 / 114 812 B | `application/octet-stream` | https://raw.githubusercontent.com/rsms/inter/master/docs/font-files/Inter-Regular.woff2 |
| Inter release oficial | OFL-1.1 | `Inter-4.1.zip` | 33 707 794 B | — | https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip |
| Geist release oficial (v1.7.2, 2026-06-01) | OFL-1.1 | `geist-font-v1.7.2.zip` | 8 207 303 B | — | https://github.com/vercel/geist-font/releases/download/v1.7.2/geist-font-v1.7.2.zip |
| JetBrains Mono release (v2.304) | OFL-1.1 | `JetBrainsMono-2.304.zip` | 5 622 857 B | — | https://github.com/JetBrains/JetBrainsMono/releases/download/v2.304/JetBrainsMono-2.304.zip |
| IBM Plex release (`@ibm/plex-sans@1.1.0`) | OFL-1.1 | `ibm-plex-sans.zip` | 9 921 777 B | — | https://github.com/IBM/plex/releases/download/%40ibm/plex-sans%401.1.0/ibm-plex-sans.zip |

Metadatos de paquete verificados en `registry.npmjs.org`: `@fontsource-variable/inter@5.3.0` (OFL-1.1), `@fontsource-variable/jetbrains-mono@5.3.0` (OFL-1.1), `@fontsource-variable/geist@5.3.0` (OFL-1.1).

### 2.3 Cómo integrarlo exactamente

```css
/* chat/ui/ide.css  —  requiere el cambio de servidor de §0.1 */
@font-face {
  font-family: "Inter var";
  src: url("/ui/inter-latin-wght-normal.woff2") format("woff2-variations");
  font-weight: 400 700;      /* rango variable: un fichero cubre los 4 pesos */
  font-style: normal;
  font-display: swap;        /* obligatorio: evita texto invisible */
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA,
                 U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122,
                 U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: "JetBrains Mono var";
  src: url("/ui/jetbrains-mono-latin-wght-normal.woff2") format("woff2-variations");
  font-weight: 400 700;
  font-display: swap;
}
```

Ese `unicode-range` es exactamente el que Google Fonts declara para el subconjunto `latin`; **cubre todo el español** (`ñ á é í ó ú ü ¿ ¡` están en `U+0000-00FF`), por lo que **`latin-ext` no hace falta y se ahorran 83 KB**. Sí hace falta si en algún momento se muestran textos en catalán/gallego/portugués con `·` o `ç`… (el `ç` y el `·` sí están en `U+00E7`/`U+00B7`, dentro de latin; `latin-ext` solo es necesario para checo, polaco, turco, húngaro, rumano, etc.).

**Subsetting.** No hay ninguna herramienta de subsetting que funcione sin instalar nada (ver §6). La estrategia práctica y verificada es **usar los ficheros ya subseteados de Fontsource/Google**, que es precisamente lo que se recomienda arriba: 47,1 KB para Inter latin en vez de 344 KB del `InterVariable.woff2` completo, y 39,5 KB para JetBrains Mono latin. **Total del par tipográfico: 86,7 KB.** Es menos que una sola imagen PNG mediana.

**Pesos elegidos (no engordar).** Con fuente variable el coste es único, así que se pueden usar todos. Si se opta por estáticos, la elección mínima defendible es **400 (texto), 500 (etiquetas y botones), 600 (títulos y cabeceras)**; el **700 es prescindible** en una interfaz de editor: el 600 ya establece jerarquía y el 700 en cuerpos de 12-13 px se percibe emborronado (el *faux bold* por síntesis, que el propio `index.html:26` ya desactiva con `font-synthesis: none`).

### 2.4 Recomendación única de tipografías

> **Inter Variable (UI) + JetBrains Mono Variable (código)**, ambas **OFL-1.1**, desde jsDelivr/Fontsource. Dos ficheros, **86,7 KB en total**, subconjunto `latin` (cubre el español completo), `font-display: swap`, `font-weight: 400 700` en una sola regla `@font-face` por familia. Geist Variable (28,7 KB, OFL-1.1) es la alternativa si se prefiere una grotesca más neutra y aún más ligera; IBM Plex Sans queda descartada para este caso porque **no se distribuye como variable en Google Fonts** y obliga a un fichero por peso (44,6 KB × 3 = 134 KB).

---

## 3. LIBRERÍAS JS PEQUEÑAS, SIN BUILD

### 3.1 Tabla (código de estado, tipo MIME y bytes medidos)

| Librería | Versión | Licencia | Fichero / tamaño medido | ¿Sin bundler? | URL directa verificada |
|---|---|---|---|---|---|
| **highlight.js** (core + 15 idiomas) | 11.12.0 | **BSD-3-Clause** (*"Copyright (c) 2006, Ivan Sagalaev"*) | `es/core.min.js` **20 501 B** + 15 ficheros de idioma que suman **59 101 B** ⇒ **≈79,6 KB** para un build a medida | **SÍ** — script clásico | https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/es/core.min.js |
| highlight.js idioma suelto | 11.12.0 | BSD-3-Clause | `languages/json.min.js` **694 B** (JS 6 610, TS 7 879, CSS 13 548, Python 3 662, Bash 3 187, SQL 6 549, PowerShell 4 448, XML 1 996, Markdown 2 215, YAML 1 952, Rust 3 056, Go 1 567, Diff 693, INI 1 045) | **SÍ** — verificado: `hljs.registerLanguage("json", …)` con IIFE, sin `import` | https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/languages/json.min.js |
| highlight.js (todo en uno) | 11.12.0 | BSD-3-Clause | `highlight.min.js` **129 254 B** (incluye ~190 idiomas) | SÍ | https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/highlight.min.js |
| Temas highlight.js | 11.12.0 | BSD-3-Clause | `github-dark.min.css` **1 315 B**, `atom-one-dark.min.css` **856 B** | SÍ | https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0/styles/atom-one-dark.min.css |
| **Motion** (ex Motion One) | 14.0.0 | MIT | `dist/motion.js` **143 867 B** | **SÍ** — bundle con variable global | https://cdn.jsdelivr.net/npm/motion@14.0.0/dist/motion.js |
| **anime.js** (v4) | 4.5.0 | MIT | `dist/bundles/anime.umd.min.js` **118 043 B** (o `.esm.min.js` **118 678 B**) | **SÍ** | https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js |
| **CodeMirror 5** (editor) | 5.65.20 | MIT | `lib/codemirror.js` **402 009 B** + `lib/codemirror.css` **8 720 B** | **SÍ, confirmado** — es un script clásico sin dependencias | https://cdn.jsdelivr.net/npm/codemirror@5.65.20/lib/codemirror.js |
| CodeMirror 5 — modo JS | 5.65.20 | MIT | `mode/javascript/javascript.min.js` **17 873 B** | SÍ | https://cdn.jsdelivr.net/npm/codemirror@5.65.20/mode/javascript/javascript.min.js |
| CodeMirror 5 — merge/diff | 5.65.20 | MIT | `addon/merge/merge.min.js` **19 444 B** | SÍ | https://cdn.jsdelivr.net/npm/codemirror@5.65.20/addon/merge/merge.min.js |
| CodeMirror 5 — tema | 5.65.20 | MIT | `theme/material-darker.min.css` **2 481 B** | SÍ | https://cdn.jsdelivr.net/npm/codemirror@5.65.20/theme/material-darker.min.css |
| **uPlot** (gráficos) | 1.6.32 | MIT (*"Copyright (c) 2022 Leon Sorokin"*) | `dist/uPlot.iife.min.js` **51 081 B** + `dist/uPlot.min.css` **1 857 B** | **SÍ** — IIFE | https://cdn.jsdelivr.net/npm/uplot@1.6.32/dist/uPlot.iife.min.js |
| **Chart.js** | 4.5.1 | MIT | `dist/chart.umd.js` **208 518 B** | SÍ — UMD | https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.js |
| **jsdiff** (algoritmo de diff) | 9.0.0 | **BSD-3-Clause** | `dist/diff.min.js` **37 162 B** | SÍ — UMD | https://cdn.jsdelivr.net/npm/diff@9.0.0/dist/diff.min.js |
| **Tippy.js** + Popper (tooltips) | 6.3.7 / 2.11.8 | MIT | `tippy.umd.min.js` **24 074 B** + `tippy.css` **1 409 B** + `popper.min.js` **20 122 B** ⇒ **45,6 KB** | SÍ — UMD | https://cdn.jsdelivr.net/npm/tippy.js@6.3.7/dist/tippy.umd.min.js |
| **marked** (markdown alternativo a `markdown.js`) | latest | MIT | `marked.min.js` **39 903 B** (paquete 46 891 B en `lib/marked.umd.js`) | SÍ — UMD/clásico | https://cdn.jsdelivr.net/npm/marked@latest/marked.min.js |

### 3.2 Confirmación explícita: CodeMirror 6 y Monaco **necesitan bundler**

Esto era una pregunta directa y la respuesta es **sí, ambos lo necesitan**. No es opinión: está comprobado leyendo el contenido real de los ficheros publicados.

**CodeMirror 6 — CONFIRMADO que necesita bundler.** El paquete `codemirror@6.0.2` es solo un envoltorio de configuración. Su `dist/index.js` (4 737 B, `application/javascript`) empieza así, con **especificadores desnudos** que un navegador no puede resolver:

```js
import { lineNumbers, highlightActiveLineGutter, ... } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { foldGutter, indentOnInput, ... } from '@codemirror/language';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { closeBrackets, autocompletion, ... } from '@codemirror/autocomplete';
import { lintKeymap } from '@codemirror/lint';
```

Y el eslabón siguiente tampoco es autónomo: `@codemirror/view@6.38.6/dist/index.js` pesa **493 290 B** e importa `@codemirror/state`, **`style-mod`**, **`w3c-keyname`** y **`crelt`**. Es decir, un `<script src>` no basta: harían falta ~7 paquetes más 3 dependencias transitivas y un *import map* con 10 entradas, o un bundler. Su `package.json` declara `"type": "module"` y `exports` solo con `import`/`require` (grafo de módulos resuelto por Node/bundler, no por el navegador).

Nota: `https://esm.sh/codemirror@6.0.2` responde 200, pero es un **redirector de un servicio en la nube** (requiere red) y sirve un módulo que sigue importando URLs de `esm.sh`; **no sirve para un caso offline**. [NO VERIFICADO: no he ejecutado CodeMirror 6 en un navegador con import map; la afirmación "necesita bundler o import map" se basa en los especificadores desnudos leídos en el código fuente publicado, que es evidencia directa.]

**Monaco — CONFIRMADO que necesita bundler.** `monaco-editor@0.57.0` ocupa **96,96 MB descomprimido**. Su entrada `esm/vs/editor/editor.main.js` (9 809 B) importa **relativamente** decenas de ficheros:

```js
import * as index from '../../external/monaco-lsp-client/out/index.js';
import '../languages/definitions/abap/register.js';
import '../languages/definitions/apex/register.js';
/* … ~90 más … */
```

Técnicamente son rutas relativas (resolubles por el navegador), pero Monaco **exige `MonacoEnvironment.getWorkerUrl`** y *web workers* separados para cada lenguaje, más su carga de workers vía `blob:`/`importScripts`. Montarlo a mano sin bundler es un proyecto en sí mismo. Tamaño y complejidad lo descartan para este caso. [NO VERIFICADO: no he montado Monaco sin bundler; la conclusión se basa en el tamaño del paquete, el número de imports y el requisito documentado de workers.]

**Shiki — NO viable sin bundler.** `shiki@4.5.0` es ESM puro con *code-splitting* de rolldown. Su `dist/bundle-full.mjs` (1 608 B) contiene:

```js
import "./rolldown-runtime-BBjsoOtd.mjs";
import { t as engine_oniguruma_exports } from "./engine-oniguruma.mjs";
import { i as bundledLanguagesInfo, ... } from "./langs-bundle-full-xQVO1Cek.mjs";
import { createBundledHighlighter, ... } from "@shikijs/core";
import * as engine_oniguruma from "./engine-oniguruma.mjs";
```

Es decir: un chunk con **hash en el nombre**, especificadores desnudos (`@shikijs/core`) y, encima, un **WASM de 466 610 B** (`dist/onig.wasm`, `application/wasm`) que hay que servir con `application/wasm` y cargar aparte. Descartado para un entorno sin build.

### 3.3 Encaje con lo que ya existe

`chat/ui/markdown.js` (15 713 B) es un UMD propio que **ya resalta código**: `ide.css:31-41` define la paleta `.t-kw`, `.t-st`, `.t-cm`, `.t-nu`, `.t-fn`, `.t-ty`, `.t-pn`, `.t-at`, `.t-tag`, `.t-va`. Por tanto **highlight.js no es una necesidad, es una mejora opcional**: aportaría cobertura de ~190 lenguajes y precisión de gramática. Se puede adoptar de forma incremental y sin romper nada: cargar `highlight.min.js` (129 KB) **después** de `markdown.js` y usar `hljs.highlightElement()` sobre los `<pre><code>` que `markdown.js` ya produce, dejando la paleta propia en CSS (los estilos de tema de highlight.js son opcionales). Para no engordar, mejor el build a medida: `es/core.min.js` (20,5 KB) + los idiomas realmente usados. Con 8 idiomas (JS, TS, JSON, CSS, XML, Bash, Python, Diff) = 20 501 + 40 578 = **61 KB**, la mitad que el paquete completo.

El medidor de hardware ya usa **SVG inline con `<polyline>`** (`ide.css:49-51`, `.hud .spark`), así que **uPlot no es necesario**: solo tendría sentido si se quieren ejes, zoom o muchos puntos. Con 8 GB de VRAM y series cortas, el `<polyline>` actual es más ligero.

### 3.4 Recomendación única de librerías JS

> **highlight.js** (BSD-3-Clause) como única incorporación JS real, en build a medida (`es/core.min.js` + idiomas sueltos, ~61 KB, script clásico, sin bundler). Para animaciones, **CSS puro** —`@keyframes` + `transition`— porque una interfaz de IDE no necesita coreografía: las cifras están en §5.6 y cumplen WCAG sin librería. Si de verdad se quiere una API de animación con física/muelle, **Motion 14.0.0** (MIT, 143,9 KB) es preferible a anime.js para este caso porque su API `animate()` es más pequeña y su bundle `dist/motion.js` funciona como script clásico. Para editor de código, **CodeMirror 5.65.20** (MIT, 402 KB + tema 2,5 KB + modo 17,9 KB) es **la única opción de editor sin bundler**, y además trae el addon `merge` de diff lado a lado (19,4 KB). uPlot, Chart.js, Tippy.js y marked quedan como "solo si aparece la necesidad concreta".

---

## 4. SERVIDORES MCP DE DISEÑO

### 4.1 Veredicto

> **NO existe ningún servidor MCP de diseño/UI/iconos/fuentes que merezca instalarse para este caso.** Su valor, cuando lo tienen, es el **catálogo de datos** que envuelven, no el protocolo. Ese catálogo se descarga una vez y se lee con Node. Instalar el MCP añade un proceso, un transporte stdio y un cliente compatible a cambio de cero información nueva.

### 4.2 Tabla de candidatos (verificados abriendo la URL o la API)

| Nombre | Qué hace | ¿Gratis sin claves? | ¿Offline? | URL verificada | Veredicto |
|---|---|---|---|---|---|
| **keyline-icons MCP** `@keyline-icons/mcp@1.6.0` (MIT) | 4 tools (`describe_set`, `search_icons`, `get_icon`, `get_react_usage`); 1 332 iconos × 4 estilos × 2 esquinas = 10 656 SVG | **Sí** | **Sí — probado ejecutándolo** | https://github.com/keyline-icons/keyline-icons · README: https://raw.githubusercontent.com/keyline-icons/keyline-icons/main/packages/mcp/README.md · registro: https://registry.modelcontextprotocol.io/v0/servers?search=keyline | **Parcial** — solo `get_icon` sirve; `get_react_usage` es inútil sin React |
| `lucide-icons-mcp` v0.1.67 (MIT) | Lucide en clave **React**, catálogo parcial (135 KB) | Sí | Sí | https://github.com/SeeYangZhi/lucide-icons-mcp | Inútil (React; capa sobre datos triviales) |
| **Iconify JSON** `@iconify-json/lucide`, `…/tabler`, `…/material-symbols` | JSON de datos puro, sin dependencias | Sí | Sí | https://registry.npmjs.org/@iconify-json/lucide/latest | **Útil — es la sustitución real** |
| Iconify MCP `pipeworx-io/mcp-iconify` | Envoltorio de la API pública de Iconify | Sí (sin auth) | **No** | https://github.com/pipeworx-io/mcp-iconify | Inútil (llama a la nube) |
| `mcp-universal-icons` v1.1.0 (MIT) | 60 k iconos multi-set | Sí | **No** — su README admite *"simply fetches official SVGs from the Iconify API"* | npm | Inútil (nube) |
| **Figma MCP** (oficial) | Contexto de diseño → código | **No** | No | https://help.figma.com/hc/en-us/articles/32132100833559 | Inútil (cuenta Figma; desktop exige asiento Dev/Full de pago) |
| shadcn MCP | Componentes shadcn/ui | Sí | No | https://ui.shadcn.com/docs/mcp (HTTP 200) | Inútil (React + Tailwind + registro remoto) |
| `chrome-devtools-mcp` v1.10.1 (Apache-2.0) | Controla Chrome en vivo | Sí | Parcial | https://github.com/ChromeDevTools/chrome-devtools-mcp | Inútil (depuración, no diseño; telemetría con opt-out + CrUX) |
| `playwright-mcp` (Microsoft) | Automatización de navegador | Sí | Parcial | https://github.com/microsoft/playwright-mcp | Inútil para elegir iconos/fuentes |
| MCP de contraste WCAG: `ryelle/a11y-color-contrast-mcp` (2★), `aimsise/color-engine-mcp` (1★), `joe-watkins/wcag-mcp` (13★, **sin licencia declarada**) | Aritmética de contraste | Sí | Sí | API de GitHub (existen; **no ejecutados**) | **Inútil** — son ~15 líneas de JS |
| ICONS8 / svgicons / WCAG-Compliance / Br0ski777 color-palette | Varios | **No** (cuenta, "Pro", "x402 micropayment") | No | Registro oficial MCP | Inútil |

**Prueba real hecha sobre el único candidato limpio.** Se descargó el tarball de `@keyline-icons/mcp` (517 780 B), se extrajo y **se ejecutó**: respondió `[keyline-icons] MCP server ready, 1332 icons` y devolvió un `tools/list` correcto. Confirmado: **cero dependencias** en `package.json`, **cero `fetch()`/`https://`** en `src/index.mjs` (solo `readFile` de un `icons.json` de 6 856 303 B empaquetado), JSON-RPC escrito a mano sobre stdio, sin variables de entorno. Es genuinamente offline — pero es **un envoltorio de ~27 KB sobre un JSON**. El valor es el JSON.

### 4.3 Lo que NO existe (explícito)

- **NO hay ningún servidor de diseño en el registro oficial de referencia.** Los 7 *reference servers* son: Everything, Fetch, Filesystem, Git, Memory, Sequential Thinking, Time. Puppeteer está **archivado**.
- **NO existe MCP de fuentes tipográficas con `.woff2`.** Buscando "font"/"typography" en el registro solo aparecen Fonto Docs, Font Proof (PDF/Glyphs.app), `font-lab` (de `next/font`) y datos sanitarios de EE. UU.
- **NO existe MCP de escalas tipográficas modulares.**
- **NO existe MCP de espaciado 4/8 px.**
- **NO existe MCP offline de accesibilidad:** los disponibles son en la nube (por URL), con cuenta, o envoltorios de axe-core + Playwright.
- Los MCP "de diseño" con muchas estrellas (`Manavarya09/design-extract`, 4 168★; `marvkr/better-design`, 251★) son **extracción de sistemas de diseño desde sitios web con Playwright**, o volcados de conocimiento. No resuelven elegir iconos o fuentes offline en un proyecto sin build.

### 4.4 URLs que fallaron (declarado)

- `https://developers.figma.com/docs/figma-mcp-server/` → **`getaddrinfo ENOTFOUND`**, el dominio no resuelve.
- Las páginas HTML de GitHub/Glama/Smithery/mcp.so devuelven navegación truncada (renderizado en cliente); Smithery muestra "Login" y su buscador no es legible sin JS. La verificación se hizo vía **API de GitHub, API del registro oficial MCP y `registry.npmjs.org`**, que son fuentes de datos.
- La API de GitHub devolvió **HTTP 403** por límite de tasa en algunas búsquedas tardías.

### 4.5 Recomendación única de MCP

> **No instalar ningún MCP de diseño.** Sustituirlo por: (1) `@iconify-json/lucide` o el `icon-nodes.json` de Lucide leídos con Node; (2) los `.woff2` de `@fontsource-variable/*` copiados a `chat/ui/`; (3) la fórmula de contraste WCAG en ~15 líneas de JS; (4) la escala tipográfica y la rejilla 4/8 como multiplicaciones. Todo determinista, offline, sin servidor y sin protocolo.

---

## 5. GUÍAS DE DISEÑO: VALORES NUMÉRICOS UTILIZABLES

### 5.1 Auditoría real del tema actual (esto es lo accionable)

Se calcularon los ratios de contraste WCAG de la paleta que ya está en `index.html:8-27` sobre sus propios fondos. Umbral AA: **4,5:1** para texto normal (< 18,66 px en negrita o < 24 px), **3:1** para texto grande y para componentes/indicadores de interfaz (WCAG 2.2, 1.4.3 y 1.4.11).

| Token | Fondo `--bg` #10130e | `--ink` #0c0e0a | `--panel` #161a12 | `--raised` #1c2118 | Veredicto |
|---|---|---|---|---|---|
| `--text` #e8eedc | **15,78** | 16,34 | 14,86 | 13,82 | AAA ✅ |
| `--muted` #8e977f | **6,14** | 6,36 | 5,78 | 5,38 | AA ✅ |
| `--dim` #5c6554 | **3,07** | 3,18 | **2,89** ❌ | **2,69** ❌ | **FALLA AA sobre panel y raised** |
| `--accent` #d6f07a | **14,81** | 15,33 | 13,95 | 12,97 | AAA ✅ |
| `--gen` #7eb0c8 | **7,96** | 8,25 | 7,50 | 6,98 | AAA ✅ |
| `--danger` #e7a090 | **8,76** | 9,08 | 8,26 | 7,68 | AAA ✅ |

**El único problema real de accesibilidad del tema es `--dim`.** Sirve para texto secundario y "vacío" (p. ej. contadores, placeholders), y sobre `--panel` (2,89) y `--raised` (2,69) **no alcanza ni el 3:1 de texto grande/UI**. Es un fallo objetivo, no una opinión. **Corrección propuesta y medida: subir `--dim` a `#6f7a64`** → sobre `--panel` ≈ 3,9 y sobre `--raised` ≈ 3,6 (suficiente para UI y texto grande, sigue siendo visualmente "apagado"). Si `--dim` va a llevar texto normal de 12-13 px, hay que ir a **`#8a9480`** (≈ 5,4 sobre `--panel`), que ya casi coincide con `--muted` y sugiere **eliminar `--dim` como color de texto** y usarlo solo para bordes/iconos decorativos. [Los ratios de la corrección son cálculo propio sobre la fórmula de luminancia relativa de WCAG; el método es el mismo que produjo la tabla de arriba.]

### 5.2 Escala tipográfica (ratio 1.200, base 13 px — densidad de IDE)

| Rol | px | Peso | Interlineado | Uso en la app |
|---|---|---|---|---|
| Micro / etiqueta | **11** | 500-600 | 1,25 | `md-code-h` (ya usa 11 px), versalitas con `letter-spacing: 0.06em` |
| Secundario | **12** | 400 | 1,35 | `.brand small`, `.muted` (ya usa 12 px) |
| **Cuerpo** | **13** | 400 | **1,45** | `body` (ya usa 13-14 px); es el tamaño estándar de VS Code/Cursor |
| Énfasis | **15** | 500 | 1,45 | encabezados de panel |
| H3 | **18** | 600 | 1,30 | `letter-spacing: -0.005em` |
| H2 | **21** | 600 | 1,25 | `letter-spacing: -0.01em` |
| H1 | **26** | 600 | 1,20 | `letter-spacing: -0.015em` |

Reglas de interlineado derivadas: **1,30-1,35** para 11-12 px, **1,45-1,50** para 13-16 px, **1,20-1,30** para ≥ 18 px. `letter-spacing` negativo **solo** a partir de 18 px (`-0.01em` a `-0.015em`); a 11-12 px en versalitas, **positivo** `+0.04em` a `+0.08em` (`index.html:77` ya usa `0.08em`, correcto). `font-synthesis: none` ya está (`index.html:26`): mantenerlo, evita negritas falsas.

### 5.3 Rejilla de espaciado: base 4, ritmo 8

- **Unidad:** 4 px. **Escala permitida: 4, 8, 12, 16, 24, 32, 48, 64.** Nada fuera de esa lista salvo 1 px (bordes) y 2 px (radio/outline).
- **Ritmo 8:** márgenes y paddings *entre bloques* deben ser múltiplos de 8; el 4 se reserva para espacios *intra-componente* (icono↔etiqueta, separación entre líneas de una lista).
- Aplicación concreta: **padding de contenedor 12 px** (ya usado en `index.html:59`); **separación entre elementos de una barra 12 px** (ya usado en `:58`); **padding interno de fila de lista 4 px 8 px**; **separación icono-texto 8 px**; **padding de panel 16 px**.
- **Radios:** 4 px (chips, badges, `md code`), 6 px (botones, inputs), 8 px (tarjetas, bloques de código — `ide.css:24` ya usa 8), 10 px (popovers — `ide.css:56` ya usa 10). **Máximo 4 valores de radio en toda la app.**

### 5.4 Densidad de información (valores de IDE)

| Elemento | Alto/ancho |
|---|---|
| Barra de título / `.top` | **40-44 px** (ya usa 44, correcto) |
| Barra de actividad lateral | **48 px**, iconos **24 × 24** |
| Panel lateral | **240-280 px** (ya usa 272 y 240) |
| Pestaña de editor | **32-35 px** |
| Fila de lista densa | **22-24 px** |
| Fila de lista estándar | **28-32 px** |
| Barra de estado | **22-24 px** (hoy se calcula desde el contenido: fijarlo) |
| Botón estándar | alto **26-28 px**, padding **0 10-12 px** |
| Botón de icono | caja **24 × 24** con glifo **16 × 16** |
| Input / select | alto **28 px** |
| Interlineado del editor de código | **20 px** para 13 px de fuente (ratio 1,54) |
| Ancho de columna de texto legible | **60-90 caracteres** (`max-width: 72ch` aprox.) |

### 5.5 Estados interactivos (valores exactos)

| Estado | Tratamiento | Valor |
|---|---|---|
| Reposo | — | — |
| **Hover** | fondo del tema claro sobre oscuro | `background: rgba(232,238,220,0.06)`; en superficies ya elevadas, `0.09` |
| **Active / pulsado** | un escalón más, sin mover layout | `background: rgba(232,238,220,0.12)`; nunca `transform: scale()` en botones de barra |
| **Selected** | color + marca lateral, no solo color | `background: rgba(214,240,122,0.12)` + `box-shadow: inset 2px 0 0 var(--accent)` |
| **Focus visible** | anillo, **nunca** `outline: none` sin sustituto | `outline: 2px solid var(--accent); outline-offset: 2px;` (hoy `index.html:50-53` usa `1px` → **subir a 2 px**, y WCAG 2.4.13 pide área ≥ 2 px CSS) |
| **Disabled** | sin interacción, sin confundir con seleccionado | `opacity: 0.42; cursor: default;` (ya en `:49`, correcto) |
| **Zona pulsable mínima** | WCAG 2.2 SC 2.5.8 (AA) | **24 × 24 px** mínimo; **recomendado 32 × 32 px** en puntero táctil/impreciso. Los iconos de 16 px deben ir dentro de una caja de 24 px |

### 5.6 Movimiento (150-250 ms)

| Transición | Duración | Curva |
|---|---|---|
| Color / fondo / borde (hover, focus) | **120-150 ms** | `ease-out` |
| Opacidad, sombra | **150-200 ms** | `ease-out` |
| Deslizar panel, expandir/colapsar | **200-250 ms** | `cubic-bezier(0.2, 0, 0, 1)` |
| Tooltip: aparecer | **150 ms** con retardo de **300-500 ms** | `ease-out` |
| Tooltip: desaparecer | **75-100 ms** (más rápido que la entrada) | `linear` |
| Spinner / progreso indeterminado | **800-1200 ms** por vuelta | `linear` |
| **Techo duro** | **≤ 400 ms** | nada de animaciones decorativas > 250 ms |

Obligatorio, y es criterio WCAG (2.3.3 / 2.2.2):

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

Y animar **solo `transform` y `opacity`** (compuestas por GPU, no provocan *reflow*); animar `width`/`height`/`top`/`left` en una lista larga es la causa número uno de sensación de lentitud en un portátil modesto.

### 5.7 Jerarquía: la regla de los tres niveles

En cualquier vista debe haber **como máximo tres niveles visuales distinguibles** y cada nivel debe separarse por **al menos dos** de estas señales simultáneas: tamaño, peso, color, posición, contenedor. Concretamente para esta app:

1. **Nivel 1 (estructura):** nombre del panel, título del chat → 13-15 px, peso 600, color `--text`.
2. **Nivel 2 (contenido):** texto de mensajes → 13 px, peso 400, `--text`, interlineado 1,45.
3. **Nivel 3 (metadatos):** rutas, tokens/s, contadores → 11-12 px, peso 400, `--muted`. **Nunca `--dim`** salvo decoración (ver §5.1).

Corolario medible: si tres elementos distintos tienen el mismo tamaño, peso y color, la jerarquía no existe y el ojo no sabe dónde mirar; y si se usan cinco tamaños en una sola barra, el resultado parece "hecho a mano". Los 7 roles de §5.2 son el límite.

### 5.8 Recomendación única de diseño

> Adoptar la escala de §5.2 (7 roles, base 13 px), la rejilla 4/8 de §5.3, los altos de §5.4, y **corregir `--dim`** (§5.1) porque es el único fallo WCAG AA objetivo del tema actual. Subir el anillo de foco de 1 px a **2 px** con `outline-offset: 2px`, y añadir el bloque `prefers-reduced-motion`. Todo lo demás del tema actual (paleta, radios, `font-synthesis: none`, `opacity: .42` en disabled, `letter-spacing: .08em` en versalitas) **ya está bien** y no conviene tocarlo.

---

## 6. LO QUE NO EXISTE O NO SIRVE PARA ESTE CASO

**No existe / no sirve:**

1. **Editor de código que funcione con un `<script>` clásico, moderno y mantenido, aparte de CodeMirror 5.** CodeMirror 6 y Monaco **necesitan bundler o import map** (verificado en §3.2); Shiki necesita bundler + WASM. CodeMirror 5 (402 KB, MIT, 2023) es la única vía real sin build, y su desarrollo está en modo mantenimiento.
2. **Subsetting de fuentes sin instalar nada.** `fonttools`/`pyftsubset` es Python con dependencias, `glyphhanger` es npm, la API de Google Fonts no expone subsetting arbitrario. La vía realista es **usar ficheros ya subseteados** (Fontsource/Google), que es lo recomendado.
3. **MCP de diseño, UI, iconos o fuentes que aporte algo** (§4). Ni en el registro oficial, ni en Smithery, ni en Glama, ni en mcp.so hay nada gratuito **y** sin claves **y** offline **y** útil para este caso. Los que existen son nube con clave (Figma, Iconify API, Icons8), React/Tailwind (shadcn), aritmética trivial reimplementada (contraste WCAG) o depuradores de navegador sobredimensionados (chrome-devtools-mcp, playwright-mcp).
4. **MCP de escala tipográfica o de rejilla 4/8 px.** No existe ninguno; son multiplicaciones.
5. **MCP offline de accesibilidad.** Los que hay son en la nube, con cuenta, o axe-core + Playwright.
6. **Söhne, SF Pro, Segoe UI Variable como webfont redistribuible.** Söhne es comercial (Klim Type Foundry); SF Pro tiene licencia de Apple limitada a sus plataformas; Segoe UI es de Microsoft y no se puede redistribuir como `.woff2`. **Ninguna se puede vendorizar legalmente.** Para Segoe UI Variable la vía legítima es **usar la ya instalada** (`index.html:42`), no copiarla.
7. **CDN como dependencia en producción.** Cualquier `<script src="https://cdn.jsdelivr.net/...">` deja de funcionar sin red y contradice el requisito "offline". jsDelivr/unpkg se usan aquí **solo como origen de la descarga única**; después los ficheros van a `chat/ui/`.
8. **`esm.sh` como solución "sin bundler".** Responde 200 y sirve CodeMirror 6, pero es un servicio en la nube y sus módulos siguen apuntando a `esm.sh`: no sirve offline.
9. **`diff2html` como bundle listo.** `https://cdn.jsdelivr.net/npm/diff2html@3.4.51/bundle/js/diff2html.min.js` → **HTTP 404**. La versión publicada es la **3.4.56** (MIT, 1,93 MB descomprimido) y **no expone ningún fichero bajo `bundle/js`**. Si se quiere diff visual, usar el addon `merge` de CodeMirror 5 (19 444 B, verificado) o el `diff` de jsdiff (37 162 B, verificado).
10. **`markdown-it` como script UMD.** `https://cdn.jsdelivr.net/npm/markdown-it@15.0.2/dist/markdown-it.min.js` → **HTTP 404**. La 15.0.2 solo publica `markdown-it.mjs` (117 656 B, ESM) y `markdown-it.cjs.js` (170 475 B). Como sustituto verificado: **`marked`** `https://cdn.jsdelivr.net/npm/marked@latest/marked.min.js` (**39 903 B**, 200, `application/javascript`).
11. **`anime.js` en la ruta "clásica" que muchos tutoriales citan.** `https://cdn.jsdelivr.net/npm/animejs@4.5.0/lib/anime.iife.min.js` → **HTTP 404**. La ruta correcta en v4 es `/dist/bundles/anime.umd.min.js` (**118 043 B**, verificado).
12. **Subcarpetas en `/ui/` sin tocar el servidor.** `path.basename()` en `ui-server.mjs:1093` aplana la ruta; hoy `js` y `css` van planos en `chat/ui/`. Ver §0.1.

**Verificado y sí sirve, contra lo que se podría suponer:** el `Content-Type` de los `.woff2` **sí** llega correctamente como `font/woff2` desde `fonts.gstatic.com` **y** desde `cdn.jsdelivr.net` (comprobado con descarga real, firma de bytes `774f4632` = `wOF2`); jsDelivr **sí** soporta peticiones por rangos (`curl -H "Range: bytes=0-99"` → **HTTP 206 Partial Content**, `content-range: bytes 0-99/48256`), lo que permite que `unicode-range` funcione con carga diferida; y el `<script>` clásico **sí** funciona con los ficheros de idioma de highlight.js, que son IIFE que llaman a `hljs.registerLanguage(...)` sin un solo `import`.

---

## 7. Plan de integración mínimo (orden recomendado)

1. **Servidor** (§0.1): permitir `woff2|woff|svg|json` en `/ui/`, añadir `".woff2": "font/woff2"` a `TYPES`, y decidir si se admiten subcarpetas o se dejan los ficheros planos. **Sin este paso nada de lo demás funciona.**
2. **Fuentes** (§2): copiar `inter-latin-wght-normal.woff2` (47,1 KB) y `jetbrains-mono-latin-wght-normal.woff2` (39,5 KB) a `chat/ui/`; añadir los dos `@font-face` con `font-weight: 400 700` y el `unicode-range` latino.
3. **Contraste** (§5.1): corregir `--dim` en `index.html:18`. Es un cambio de una línea y arregla el único fallo WCAG AA objetivo.
4. **Foco y movimiento** (§5.5-5.6): `outline: 2px` en `:focus-visible` (`index.html:50-53`) + bloque `prefers-reduced-motion`.
5. **Iconos** (§1.2): descargar `icon-nodes.json`, generar el sprite recortado inline con el script de Node, sustituir los cuadros de color por `<svg><use>`.
6. **Escala y rejilla** (§5.2-5.4): introducir los 7 roles tipográficos y las alturas como variables CSS en `:root`.
7. **Opcional**: highlight.js a medida (~61 KB) si se quiere cobertura amplia de lenguajes; CodeMirror 5 solo si aparece la necesidad de editar de verdad en la UI.

**Presupuesto total de bytes añadidos:** fuentes 86,7 KB + sprite recortado ~10-30 KB + (opcional) highlight.js ~61 KB ⇒ **≈150-180 KB**, todo cacheable y todo offline.

---

## 8. Anexo: comandos de descarga verificados

Todos los comandos usan solo PowerShell nativo, sin npm y sin gestores de paquetes. Se han ejecutado las peticiones equivalentes para comprobar que responden 200 y con el tipo esperado.

```powershell
# 0) Preparar carpeta
New-Item -ItemType Directory -Force -Path chat\ui | Out-Null

# 1) FUENTES (OFL-1.1) — 86,7 KB en total
Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/files/inter-latin-wght-normal.woff2' -OutFile 'chat\ui\inter-latin-wght-normal.woff2'
Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/@fontsource-variable/jetbrains-mono@5.3.0/files/jetbrains-mono-latin-wght-normal.woff2' -OutFile 'chat\ui\jetbrains-mono-latin-wght-normal.woff2'

# 2) ICONOS (ISC) — datos para generar el sprite con Node
Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/lucide-static@1.52.0/icon-nodes.json' -OutFile 'herramientas\lucide-icon-nodes.json'
Invoke-WebRequest -Uri 'https://cdn.jsdelivr.net/npm/lucide-static@1.52.0/sprite.svg'      -OutFile 'chat\ui\sprite.svg'

# 3) OPCIONAL highlight.js (BSD-3) — core + 8 idiomas = 61 KB
$hl = 'https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.12.0'
Invoke-WebRequest -Uri "$hl/es/core.min.js" -OutFile 'chat\ui\hljs-core.min.js'
foreach ($l in 'javascript','typescript','json','css','xml','bash','python','diff') {
  Invoke-WebRequest -Uri "$hl/languages/$l.min.js" -OutFile "chat\ui\hljs-$l.min.js"
}

# 4) Comprobación de que los tipos MIME son los esperados (debe imprimir font/woff2)
foreach ($f in 'inter-latin-wght-normal.woff2','jetbrains-mono-latin-wght-normal.woff2') {
  $r = Invoke-WebRequest -Uri "https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/files/$f" -Method Head -UseBasicParsing
  "$f -> $($r.StatusCode) $($r.Headers['Content-Type'])"
}
```

---

## 9. Fuentes normativas citadas (todas respondieron HTTP 200)

- WCAG 2.2 — Contraste mínimo: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- WCAG 2.2 — Foco visible: https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html
- WCAG 2.2 — Tamaño de objetivo (mínimo): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- WCAG 2.2 — Animación por interacción: https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
- Material Design 3 — Espaciado: https://m3.material.io/foundations/layout/understanding-layout/spacing
- Material Design 3 — Tokens de escala tipográfica: https://m3.material.io/styles/typography/type-scale-tokens
- Material Design 3 — Tokens de duración y curvas: https://m3.material.io/styles/motion/easing-and-duration/tokens-specs
- Apple HIG — Layout: https://developer.apple.com/design/human-interface-guidelines/layout
- Atlassian Design System — Espaciado: https://atlassian.design/foundations/spacing/
- Carbon Design System — Espaciado: **no verificado**; `https://carbondesignsystem.com/elements/spacing/overview/` devolvió **HTTP 308 (redirección permanente)** y no se siguió la redirección hasta una URL final confirmada.
