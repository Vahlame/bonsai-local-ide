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
| CodeMirror 6 y lenguajes | MIT | Editor y diff/merge (único editor) |
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

## Textos completos y oferta de fuente

Los bundles de `chat/ui/vendor/` se generan con `--legal-comments=eof`, así que
conservan los avisos de sus dependencias. Si redistribuyes un binario empaquetado
(ZIP, instalador o imagen), adjunta este archivo y los textos completos de las
licencias que estén en `chat/node_modules/<paquete>/LICENSE*`.

### MIT (resumen del texto aplicable a CodeMirror, xterm, ripgrep, ast-grep, zod y esbuild)

```text
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### LGPL-3.0 y sharp/libvips

`sharp` enlaza libvips bajo LGPL-3.0. Al redistribuir un binario que lo incluya,
debes incluir el aviso de copyright, la licencia LGPL-3.0 completa y una oferta
válida de código fuente. El código fuente de libvips está en
<https://github.com/libvips/libvips> y el de sharp en
<https://github.com/lovell/sharp>. Si empaquetas el binario, publica también los
cambios que hayas hecho en esas bibliotecas o indica dónde obtenerlos.

## Marcas

Los nombres y logos de Qwen, Meta/Llama, Mistral, OpenAI, Google/Gemma, NVIDIA,
IBM, Hugging Face, DeepSeek, Moonshot/Kimi, Zhipu y demás son marcas de sus
respectivos titulares. Se usan de forma nominativa para identificar el modelo;
no implican afiliación ni patrocinio.
