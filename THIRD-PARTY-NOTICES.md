# Third-party notices / Avisos de terceros

Bonsai Local IDE se distribuye bajo MIT. Este archivo resume las dependencias
principales y sus licencias. Los textos completos están en cada paquete dentro
de `chat/node_modules/` y en los repositorios enlazados.

## Runtime

| Componente | Licencia | Uso |
|---|---|---|
| llama.cpp / ggml | MIT | Motor de inferencia local (binario aparte) |
| Playwright / Playwright MCP | Apache-2.0 | Navegador controlado y pruebas |
| TypeScript / TypeScript Language Server | Apache-2.0 / MIT | LSP y diagnósticos |
| `@vscode/tree-sitter-wasm` | MIT | AST y símbolos |
| `@modelcontextprotocol/sdk` | MIT | Protocolo MCP |
| `sharp` / libvips | Apache-2.0 / LGPL-3.0 | Normalización de imágenes |
| `@mozilla/readability` | Apache-2.0 | Extracción de artículos |
| `turndown` + `turndown-plugin-gfm` | MIT | HTML a Markdown |
| `linkedom` | ISC | DOM en Node |
| `@lobehub/icons-static-svg` | MIT | Logos de proveedores (marcas de sus titulares) |
| CodeMirror 6 y lenguajes | MIT | Editor opt-in |
| `@xterm/xterm` + addons | MIT | Terminal web |
| `node-pty` | MIT | ConPTY (opcional) |
| `@vscode/ripgrep` / ripgrep | MIT | Búsqueda textual |
| `@ast-grep/napi` / ast-grep | MIT | Búsqueda estructural |
| `zod` | MIT | Schemas de herramientas |
| `esbuild` | MIT | Bundles de UI (solo desarrollo) |

## Binarios y modelos

- Los pesos GGUF y los binarios de `llama.cpp` **no** se incluyen en el
  repositorio; conservan la licencia de cada modelo y del build.
- `node-pty`, `sharp`, `@ast-grep/napi` y `@vscode/ripgrep` incluyen binarios
  nativos o descargan uno en la instalación. Verifica la arquitectura y la
  licencia antes de redistribuirlos.
- `sharp` enlaza libvips (LGPL-3.0). Si redistribuyes el binario, incluye los
  avisos y la oferta de código fuente que exige la LGPL.

## Marcas

Los nombres y logos de Qwen, Meta/Llama, Mistral, OpenAI, Google/Gemma, NVIDIA,
IBM, Hugging Face, DeepSeek, Moonshot/Kimi, Zhipu y demás son marcas de sus
respectivos titulares. Se usan de forma nominativa para identificar el modelo;
no implican afiliación ni patrocinio.
