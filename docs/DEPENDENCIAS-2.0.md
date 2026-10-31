# Dependencias de Bonsai 2.0 — auditoría y criterio

**Fecha:** 31-oct-2026  
**Alcance:** dependencias directas de `chat/package.json`, dependencias
transitivas relevantes y candidatas evaluadas para UI/UX/GUI, agente, visión y
motor llama.cpp.

## Regla de adopción

1. **Local-first:** nada que exija nube, telemetría o CDN en tiempo de ejecución.
2. **Licencia permisiva:** MIT, Apache-2.0, BSD, ISC, MPL-2.0 u OFL. Nada de
   AGPL en el camino crítico.
3. **Valor medible:** debe mejorar latencia, calidad, accesibilidad o
   mantenibilidad sin reescribir el IDE.
4. **Reversible:** si falla, debe existir un *fallback* o una bandera.
5. **Versión exacta + lockfile:** nada de rangos flotantes en producción.

## Actualización 2.1

En 2.1 se adoptaron las dependencias que estaban en la lista de “siguiente
capa”. Todas son locales, con versión exacta y licencia permisiva:

| Paquete | Versión | Origen | Licencia | Función |
|---|---:|---|---|---|
| `codemirror` + lenguajes | 6.x | Comunidad | MIT | Editor opt-in |
| `@xterm/xterm` + addons | 6.0 / 0.11-0.12 | Comunidad | MIT | Terminal web |
| `node-pty` | 1.1.0 | Microsoft | MIT | ConPTY (opcional) |
| `@vscode/ripgrep` | 1.18.0 | Microsoft | MIT | Búsqueda textual |
| `@ast-grep/napi` | 0.51.0 | Comunidad | MIT | Búsqueda estructural |
| `zod` | 4.6.7 | Comunidad | MIT | Schemas de herramientas |
| `esbuild` | 0.28.2 | Comunidad | MIT | Bundles de UI (dev) |

`llguidance` no es npm: es una opción de build (`-DLLAMA_LLGUIDANCE=ON`) que
requiere Rust. Ver [LLGUIDANCE](LLGUIDANCE.md).

## Dependencias directas después de 2.0

| Paquete | Versión | Origen | Licencia | Función |
|---|---:|---|---|---|
| `@modelcontextprotocol/sdk` | 1.32.2 | MCP / Anthropic-origen | MIT | Servidores y cliente MCP |
| `@playwright/mcp` | 0.0.83 | Microsoft | Apache-2.0 | Navegador controlado por el agente |
| `playwright-core` | 1.64.1 | Microsoft | Apache-2.0 | Automatización y pruebas de UI |
| `@vscode/tree-sitter-wasm` | 0.3.1 | Microsoft | MIT | AST y símbolos multi-lenguaje |
| `typescript` | 5.9.3 | Microsoft | Apache-2.0 | TypeScript, LSP y diagnósticos |
| `typescript-language-server` | 5.0.1 | Comunidad | MIT | Language server de TypeScript |
| `sharp` | 0.35.5 | Comunidad / libvips | Apache-2.0 / LGPL-3.0 | Normalización de imágenes |
| `@mozilla/readability` | 0.6.0 | Mozilla | Apache-2.0 | Extracción del artículo principal |
| `turndown` | 7.2.4 | Comunidad | MIT | HTML a Markdown |
| `turndown-plugin-gfm` | 1.0.2 | Comunidad | MIT | Tablas y extensiones GFM |
| `linkedom` | 0.18.14 | Comunidad | ISC | DOM en Node sin navegador |
| `@lobehub/icons-static-svg` | 1.101.0 | LobeHub | MIT | Logos SVG de proveedores |

`npm audit` sobre 137 paquetes: **0 vulnerabilidades**. Las versiones están
fijadas sin `^` y el lockfile se versiona.

## Adoptadas en 2.0 y por qué

### `sharp`

- **Problema:** el adjunto original podía pesar hasta 8 MB y se enviaba entero
  en base64; una captura 4K malgastaba latencia y tokens visuales.
- **Solución:** orientación EXIF, lado mayor ≤1600 px, aplanado de alfa,
  JPEG 4:4:4 y *fallback* al original.
- **Coste:** módulo nativo; `sharp` publica binarios para Windows x64. libvips
  es LGPL-3.0: revisar avisos si se redistribuyen binarios.
- **Verificación:** `chat/prueba-imagenes.mjs`.

### `@mozilla/readability` + `turndown` + `linkedom`

- **Problema:** `extraerPagina` usaba regex; las SPAs y los divs anidados dejaban
  menús, scripts o artículos cortados.
- **Solución:** Readability aísla el artículo, Turndown lo convierte a Markdown
  GFM y linkedom evita abrir un navegador. Si el artículo es corto o falla, se
  usa el extractor regex histórico.
- **Seguridad:** la guardia SSRF, los puertos bloqueados y el límite de descarga
  no cambian. El contenido sigue siendo dato no confiable.
- **Verificación:** `chat/prueba-investigacion.mjs`.

### `@lobehub/icons-static-svg`

- **Problema:** el Model Hub mostraba nombres, pero no identidad visual de
  proveedor.
- **Solución:** SVG locales para Qwen, Meta/Llama, Mistral, DeepSeek, OpenAI,
  Gemma, NVIDIA, IBM, Hugging Face, Liquid, Zhipu, Kimi y otros. Se sirven desde
  `/ui/iconos/modelos/`; no hay CDN.
- **Marcas:** los logos son marcas de sus titulares; se usan de forma nominativa
  para identificar el modelo. No implican afiliación.

## Adoptadas en 2.1

CodeMirror 6, xterm.js + node-pty, `@ast-grep/napi`, `@vscode/ripgrep`, Zod 4 y
la build opcional de llguidance dejaron de ser candidatas: están integradas con
*fallback* y pruebas. Ver la sección “Actualización 2.1” al principio.

## Pendientes de evaluar

| Candidata | Por qué no entra aún | Cuándo sí |
|---|---|---|
| **sccache** | No cambia el runtime; es velocidad de desarrollo | Cuando se compilen variantes con frecuencia |
| **sqlite-vec** | La recuperación léxica + tree-sitter funciona; añadir embeddings crea índice y modelo extra | Si se mide que falla la recuperación semántica |
| **@playwright/test + axe-core** | La suite actual ya cubre UI; migrar requiere tiempo | Cuando se quiera reporte HTML, traces y auditoría a11y continua |
| **promptfoo / lm-eval** | La suite propia es más específica; no se reemplaza | Capa externa de validación y model cards |

## No recomendadas para este proyecto

| Familia | Motivo |
|---|---|
| React / Vue / Svelte / Tailwind / shadcn | Reescribir una UI vanilla ya coherente; coste y regresión altos |
| Electron / Tauri (hoy) | La ventana Edge en app mode ya da 0 MiB de VRAM y no añade runtime |
| vLLM / SGLang / TensorRT-LLM / MLC-LLM / ExLlamaV2 | Linux/WSL, más VRAM u otro formato; no encajan con Windows 8 GB + GGUF |
| Ollama / LM Studio / Jan / LocalAI | Redundantes; esconden flags y quitan control sobre VRAM/MoE/visión |
| LangChain / LlamaIndex | Abstracción y *churn*; el harness propio es medible y específico |
| FAISS / Chroma / Qdrant | Servidor o nativo pesado; si hiciera falta RAG, `sqlite-vec`/`usearch` |
| tiktoken / gpt-tokenizer | Tokenizers de OpenAI; el modelo local usa el tokenizer del servidor |
| FlashInfer / CUTLASS / Triton / Marlin / DeepGEMM / FlashMLA | No integrados en llama.cpp; varios son Hopper-only |
| Sentry / OpenTelemetry / SDKs cloud | Rompen la promesa local; telemetría solo opt-in y autoalojada |

## Cadena de suministro

- **Versiones exactas** en `chat/package.json`; lockfile versionado; `npm ci` en
  instalaciones limpias.
- **`npm audit`** en cada release; hoy 0 vulnerabilidades.
- **Módulos nativos** (`sharp`, `node-pty`, `@ast-grep/napi`; en el futuro
  `better-sqlite3`) deben probarse en una VM Windows limpia con Node 22/24.
- **`postinstall`:** evitar paquetes que descarguen binarios sin verificación.
  `@vscode/ripgrep` ya está adoptado; vendorizar `rg.exe` para instalaciones
  offline.
- **Licencias:** `sharp` incluye libvips (LGPL-3.0); `jszip` es dual
  MIT/GPL-3.0; `7zip-bin` es LGPL; `dugite` y `aria2` arrastran GPLv2. No
  distribuir binarios GPL sin cumplir sus términos.
- **Logos:** `@lobehub/icons-static-svg` es MIT, pero las marcas siguen siendo de
  sus titulares.

## Siguiente capa con mejor relación impacto/esfuerzo

1. **`tsc --checkJs` + JSDoc** en los módulos críticos: cero runtime, muchos
   errores menos.
2. **`sccache`** para acelerar rebuilds de llama.cpp.
3. **`sqlite-vec`** solo si la recuperación léxica se queda corta.
4. **`@playwright/test` + axe-core** para traces y auditoría a11y continua.
5. **`promptfoo`/`lm-eval`** como capa externa de evaluación y model cards.
6. **Puente LSP ↔ CodeMirror** para diagnósticos y autocompletado en vivo.

Cada una debe pasar `npm test`, `npm run test:navegador` y no subir la VRAM.
