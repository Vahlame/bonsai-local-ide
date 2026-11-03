/**
 * Motor de diagnósticos, outline de símbolos e «ir a definición» para Bonsai Local IDE.
 *
 * El IDE no tiene servidores LSP ni dependencias npm: este módulo implementa un motor
 * propio, honesto y rápido, usando solo la biblioteca estándar de Node.
 *
 * API PÚBLICA
 * -----------
 *  - `lenguajeDe(rel) -> "js" | "py" | "json" | "html" | "css" | "md" | ""`
 *      Deduce el lenguaje por extensión (js/mjs/cjs -> js, html/htm -> html, md/markdown -> md).
 *
 *  - `diagnosticarArchivo(abs, texto?) -> Promise<Diagnóstico[]>`
 *      Comprobadores REALES (pueden lanzar procesos, con timeout):
 *        · JS/MJS/CJS -> `node --check` sobre una copia temporal (nunca se ejecuta el código).
 *        · PY        -> `python -m py_compile` sobre una copia temporal (se borra todo).
 *        · JSON      -> `JSON.parse`, calculando línea/columna del error.
 *        · HTML      -> comprobación ligera de etiquetas desbalanceadas.
 *        · CSS       -> comprobación ligera de llaves ()/[]/{} desbalanceadas.
 *        · MD        -> bloques de código ``` sin cerrar.
 *      «Diagnóstico» = `{archivo, linea, columna, severidad: "error" | "aviso", mensaje, fuente}`,
 *      con `linea` y `columna` en base 1. `archivo` es la ruta `abs` tal como se recibió.
 *      `fuente` es "node" (JS), "py_compile" (PY), "json", "html", "css" o "markdown".
 *      Si se pasa `texto`, no se lee el archivo (útil para diagnósticos de un buffer).
 *      NUNCA lanza: si no se puede comprobar (archivo ilegible, binario, sin `python`,
 *      timeout, extensión desconocida...) devuelve `[]`. Un archivo vacío tampoco produce
 *      diagnósticos.
 *
 *  - `diagnosticarTexto(rel, texto) -> Diagnóstico[]` (SINCRÓNICO, sin spawn)
 *      Versión barata para el editor mientras se escribe: JSON (`JSON.parse`), llaves/
 *      paréntesis/corchetes desbalanceados en JS/PY/CSS y etiquetas desbalanceadas en HTML.
 *      `fuente` es "json" | "llaves" | "etiquetas" | "markdown". No detecta errores que solo
 *      ve un parser real (ni type-checking): para eso está `diagnosticarArchivo`.
 *
 *  - `simbolos(rel, texto) -> Símbolo[]`
 *      Outline con `{nombre, tipo, linea, columna}` en base 1:
 *        · JS: "funcion" (declaraciones y const/let/var con función o flecha), "clase",
 *          "variable", "metodo" (métodos dentro de una clase).
 *        · PY: "funcion" (`def`, también métodos) y "clase" (`class`).
 *        · JSON: "clave" (solo claves de primer nivel del objeto raíz).
 *        · HTML: "id" y "name" (atributos).
 *        · CSS: "selector" y "at-regla" (p. ej. `@media ...`).
 *
 *  - `indiceSimbolos(root, archivos?, opciones?) -> Map<string, Entrada[]>`
 *      Recorre (SINCRÓNICO) archivos de texto del proyecto y construye un índice
 *      nombre -> `[{archivo, linea, columna, tipo}]` con `archivo` relativo y separadores
 *      "/". Salta binarios, archivos de más de 2 MB, `node_modules/.git/bin/models/logs`
 *      (y `dist/build/__pycache__/.venv/venv`) y se detiene en `maxArchivos` (4000).
 *      `archivos` permite pasar una lista explícita de rutas (relativas a `root` o
 *      absolutas) y evitar el recorrido. `opciones`: `{maxArchivos, maxBytes, omitir}`.
 *
 *  - `buscarDefinicion(palabra, indice, archivoActual = "") -> {archivo, linea, columna, tipo} | null`
 *      Ignora palabras de menos de 2 caracteres. Prioriza definiciones del archivo actual
 *      y, si hay homónimos, las del mismo directorio y las rutas más cercanas.
 *      `archivoActual` se normaliza (también admite rutas absolutas, comparando por sufijo).
 *
 * TOLERANCIA
 * ----------
 *  - CRLF y BOM: las líneas se cuentan sobre "\n" y la columna sobre el contenido de la
 *    línea (el "\r" final no descuadra nada); el BOM se elimina antes de analizar.
 *  - Nunca se lanza código del proyecto: `node --check` y `py_compile` solo parsean.
 *  - Sin red, sin GPU, sin dependencias npm.
 *
 * LIMITACIONES REALES (a propósito, no se finge lo que no se comprueba)
 * ---------------------------------------------------------------------
 *  - Sin type-checking: TS/TSX/JSX no están soportados (no hay `typescript` ni parser JSX).
 *  - Python solo se comprueba con `py_compile` (sintaxis); nada de lint ni tipos.
 *  - HTML/CSS/MD son comprobaciones ESTRUCTURALES ligeras: no validan semántica, ni
 *    anidamiento correcto según el estándar, ni reglas CSS.
 *  - El chequeo sincrónico de llaves puede dar avisos transitorios mientras se escribe
 *    (p. ej. una llave a medio abrir) y no entiende JSX; las expresiones regulares se
 *    reconocen con una heurística (para no confundir "/" de división).
 *  - El outline es por líneas (regex sobre una versión «limpia» de comentarios/cadenas):
 *    no es un AST. No lista funciones anónimas, propiedades de objetos ni clases anidadas.
 *  - `indiceSimbolos` es sincrónico y puede tardar en proyectos enormes: usa los topes,
 *    o pásale la lista de archivos abiertos/recientes.
 */

export * from "./diagnostics/analysis.mjs";
export * from "./diagnostics/symbols.mjs";
