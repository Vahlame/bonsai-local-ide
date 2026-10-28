/**
 * Pruebas de chat/diagnosticos.mjs.
 *
 * Todo el trabajo se hace en un directorio temporal de os.tmpdir() (nunca se escanea
 * el proyecto real) y se borra al final. Los comprobadores externos (node --check y
 * python -m py_compile) se ejecutan de verdad sobre archivos de ejemplo; si `python`
 * no estuviera en el PATH, sus casos se marcan como omitidos (la API devuelve [] en
 * ese caso, que es el comportamiento documentado).
 *
 *   node chat/prueba-diagnosticos.mjs
 *
 * Sale con código 1 si algún caso falla.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buscarDefinicion,
  diagnosticarArchivo,
  diagnosticarTexto,
  indiceSimbolos,
  lenguajeDe,
  simbolos,
} from "./diagnosticos.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-diagnosticos-prueba-"));
/** Escribe un archivo dentro del temporal y devuelve su ruta absoluta. */
const escribir = (rel, contenido) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contenido);
  return abs;
};
/** Lee el texto creado en el temporal (para no depender del archivo en simbolos). */
const leer = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let fallos = 0;
/** Comprueba una condición e informa OK/FALLO. */
const check = (nombre, condicion, detalle = "") => {
  if (condicion) {
    console.log(`ok    ${nombre}`);
  } else {
    fallos += 1;
    console.error(`FALLO ${nombre}${detalle ? `: ${detalle}` : ""}`);
  }
};
/** Comprueba igualdad profunda (JSON) para arrays de objetos. */
const checkIgual = (nombre, obtenido, esperado) => {
  const a = JSON.stringify(obtenido);
  const b = JSON.stringify(esperado);
  check(nombre, a === b, `\n  obtenido: ${a}\n  esperado: ${b}`);
};

/** ¿Está `python` disponible en el PATH? */
const hayPython = (() => {
  try {
    const res = spawnSync("python", ["--version"], { encoding: "utf8", timeout: 15000, windowsHide: true });
    return Boolean(res && res.status === 0);
  } catch {
    return false;
  }
})();

/** Cuenta los temporales del módulo (prefijo bonsai-diag-). */
const temporalesDelModulo = () => {
  try {
    return fs.readdirSync(os.tmpdir()).filter((nombre) => nombre.startsWith("bonsai-diag-"));
  } catch {
    return [];
  }
};

try {
  // =====================================================================
  // 1. lenguajeDe
  // =====================================================================
  check("lenguajeDe reconoce JS/MJS/CJS", lenguajeDe("a.js") === "js" && lenguajeDe("a.mjs") === "js" && lenguajeDe("b.CJS") === "js");
  check("lenguajeDe reconoce Python", lenguajeDe("modulo.py") === "py");
  check("lenguajeDe reconoce JSON", lenguajeDe("datos.json") === "json");
  check("lenguajeDe reconoce HTML", lenguajeDe("index.html") === "html" && lenguajeDe("viejo.htm") === "html");
  check("lenguajeDe reconoce CSS", lenguajeDe("estilo.css") === "css");
  check("lenguajeDe reconoce Markdown", lenguajeDe("README.md") === "md" && lenguajeDe("x.markdown") === "md");
  check("lenguajeDe devuelve cadena vacía para lo desconocido", lenguajeDe("notas.txt") === "" && lenguajeDe("a.ts") === "" && lenguajeDe("") === "" && lenguajeDe(null) === "");

  // =====================================================================
  // 2. JS con `node --check`
  // =====================================================================
  const jsMalo = escribir("js/malo.js", "function suma() {\n  return 1 + 1;\n");
  const temporalesAntes = temporalesDelModulo();
  const diagnosticoJsMalo = await diagnosticarArchivo(jsMalo);
  const temporalesDespues = temporalesDelModulo();
  check("JS con una llave sin cerrar produce al menos un diagnóstico", diagnosticoJsMalo.length >= 1, JSON.stringify(diagnosticoJsMalo));
  const primeroJs = diagnosticoJsMalo[0] || {};
  check("el diagnóstico de JS viene de node", primeroJs.fuente === "node", JSON.stringify(primeroJs));
  check("el diagnóstico de JS es severidad error", primeroJs.severidad === "error", JSON.stringify(primeroJs));
  check("el diagnóstico de JS apunta a una línea real (1-based, al final del archivo)", primeroJs.linea >= 2 && primeroJs.linea <= 3, `linea=${primeroJs.linea}`);
  check("el diagnóstico de JS informa del archivo comprobado", primeroJs.archivo === jsMalo, String(primeroJs.archivo));
  check("el mensaje de JS no filtra la ruta del temporal", !String(primeroJs.mensaje).includes("revision.") && !String(primeroJs.mensaje).includes(os.tmpdir()), String(primeroJs.mensaje));
  check("el mensaje de JS contiene SyntaxError", /SyntaxError/.test(String(primeroJs.mensaje)), String(primeroJs.mensaje));
  check(
    "los temporales del comprobador se limpian tras un error",
    temporalesDespues.filter((n) => !temporalesAntes.includes(n)).length === 0,
    `antes=${JSON.stringify(temporalesAntes)} despues=${JSON.stringify(temporalesDespues)}`
  );

  const jsBueno = escribir("js/bueno.mjs", "const x = 1;\nexport function f() {\n  return x;\n}\n");
  check("JS correcto no produce diagnósticos", (await diagnosticarArchivo(jsBueno)).length === 0);
  const jsEsmConExtensionJs = escribir("js/esm.js", "import fs from \"node:fs\";\nexport const version = 1;\n");
  check("un .js con sintaxis ESM no se marca como error (detección de módulo de node)", (await diagnosticarArchivo(jsEsmConExtensionJs)).length === 0);
  const jsCjs = escribir("js/clasico.cjs", "const fs = require(\"node:fs\");\nmodule.exports = { fs };\n");
  check("un .cjs válido no produce diagnósticos", (await diagnosticarArchivo(jsCjs)).length === 0);
  check("texto JS roto pasado a mano se comprueba (sin leer el archivo)", (await diagnosticarArchivo(path.join(root, "js", "no-existe.js"), "const = ;\n")).length >= 1);
  check("diagnosticarArchivo devuelve una Promesa", typeof diagnosticarArchivo(jsBueno).then === "function");

  // =====================================================================
  // 3. Python con `python -m py_compile`
  // =====================================================================
  if (hayPython) {
    const pyMalo = escribir("py/malo.py", "def f(:\n  pass\n");
    const diagnosticoPy = await diagnosticarArchivo(pyMalo);
    check("Python con error de sintaxis produce un diagnóstico", diagnosticoPy.length === 1, JSON.stringify(diagnosticoPy));
    const primeroPy = diagnosticoPy[0] || {};
    check("el diagnóstico de Python viene de py_compile", primeroPy.fuente === "py_compile", JSON.stringify(primeroPy));
    check("el diagnóstico de Python es severidad error y apunta a la línea 1", primeroPy.severidad === "error" && primeroPy.linea === 1, `linea=${primeroPy.linea}`);
    check("el mensaje de Python contiene SyntaxError", /SyntaxError/.test(String(primeroPy.mensaje)), String(primeroPy.mensaje));
    check("el mensaje de Python no filtra la ruta del temporal", !String(primeroPy.mensaje).includes("revision."), String(primeroPy.mensaje));

    const pyBueno = escribir("py/bueno.py", "def f():\n  return 1\n");
    check("Python correcto no produce diagnósticos", (await diagnosticarArchivo(pyBueno)).length === 0);
    const pyIndentado = escribir("py/indentado.py", "if True:\nprint(1)\n");
    const diagnosticoIndentado = await diagnosticarArchivo(pyIndentado);
    check("Python con error de indentación produce un diagnóstico", diagnosticoIndentado.length === 1, JSON.stringify(diagnosticoIndentado));
    check(
      "el error de indentación apunta a la línea 2",
      diagnosticoIndentado[0] && diagnosticoIndentado[0].linea === 2 && /IndentationError/.test(String(diagnosticoIndentado[0].mensaje)),
      JSON.stringify(diagnosticoIndentado[0])
    );
    check(
      "los temporales del comprobador se limpian tras comprobar Python",
      temporalesDelModulo().filter((n) => !temporalesAntes.includes(n)).length === 0,
      JSON.stringify(temporalesDelModulo())
    );
  } else {
    console.log("omitido: `python` no está en el PATH; no se prueban los casos de Python");
  }

  // =====================================================================
  // 4. JSON con línea/columna
  // =====================================================================
  const jsonMalo = escribir("json/malo.json", "{\n  \"a\": 1\n  \"b\": 2\n}\n");
  const diagnosticoJson = await diagnosticarArchivo(jsonMalo);
  check("JSON roto produce un diagnóstico de JSON", diagnosticoJson.length === 1, JSON.stringify(diagnosticoJson));
  const primeroJson = diagnosticoJson[0] || {};
  check("el diagnóstico de JSON viene de json y es error", primeroJson.fuente === "json" && primeroJson.severidad === "error", JSON.stringify(primeroJson));
  check("JSON roto calcula la línea correcta (3)", primeroJson.linea === 3, `linea=${primeroJson.linea}`);
  check("JSON roto calcula la columna correcta (3)", primeroJson.columna === 3, `columna=${primeroJson.columna}`);

  const jsonMaloSinPosicion = escribir("json/malo-sin-posicion.json", "{\n  \"a\": 1,\n  \"b\": }\n");
  const diagnosticoJsonSinPosicion = await diagnosticarArchivo(jsonMaloSinPosicion);
  check(
    "JSON roto sin posición de V8 usa el respaldo y acierta línea/columna",
    diagnosticoJsonSinPosicion.length === 1 && diagnosticoJsonSinPosicion[0].linea === 3 && diagnosticoJsonSinPosicion[0].columna === 8,
    JSON.stringify(diagnosticoJsonSinPosicion)
  );
  const jsonBueno = escribir("json/bueno.json", "{\n  \"a\": [1, 2],\n  \"b\": {\"c\": true}\n}\n");
  check("JSON correcto no produce diagnósticos", (await diagnosticarArchivo(jsonBueno)).length === 0);

  // =====================================================================
  // 5. HTML / CSS / Markdown: comprobación ligera real (sin ejecutar nada)
  // =====================================================================
  const htmlRoto = escribir("html/roto.html", "<html>\n  <body>\n    <div>\n  </body>\n</html>\n");
  const diagnosticoHtml = await diagnosticarArchivo(htmlRoto);
  check("HTML con <div> sin cerrar produce un aviso", diagnosticoHtml.length >= 1 && diagnosticoHtml[0].severidad === "aviso", JSON.stringify(diagnosticoHtml));
  check(
    "el aviso de HTML nombra la etiqueta y la línea de apertura",
    /div/i.test(String((diagnosticoHtml[0] || {}).mensaje)) && diagnosticoHtml[0].linea === 3 && diagnosticoHtml[0].fuente === "html",
    JSON.stringify(diagnosticoHtml[0])
  );
  const htmlBueno = escribir(
    "html/bueno.html",
    "<!DOCTYPE html>\n<html>\n  <head><title>Hola</title></head>\n  <body>\n    <div id=\"a\">hola</div>\n    <br>\n    <input name=\"x\">\n    <script>var s = \"<div>\";</script>\n  </body>\n</html>\n"
  );
  check("HTML correcto no produce diagnósticos", (await diagnosticarArchivo(htmlBueno)).length === 0);

  const cssRoto = escribir("css/roto.css", ".a {\n  color: red;\n");
  const diagnosticoCss = await diagnosticarArchivo(cssRoto);
  check("CSS con una llave sin cerrar produce un aviso", diagnosticoCss.length === 1 && diagnosticoCss[0].severidad === "aviso", JSON.stringify(diagnosticoCss));
  check("el diagnóstico de CSS viene de css", diagnosticoCss[0] && diagnosticoCss[0].fuente === "css", JSON.stringify(diagnosticoCss[0]));
  const cssBueno = escribir("css/bueno.css", ".a, .b {\n  color: red;\n}\n@media (max-width: 600px) {\n  .c { color: blue; }\n}\n");
  check("CSS correcto no produce diagnósticos", (await diagnosticarArchivo(cssBueno)).length === 0);

  const mdRoto = escribir("md/roto.md", "# Título\n\n```js\nconst a = 1;\n");
  const diagnosticoMd = await diagnosticarArchivo(mdRoto);
  check("Markdown con un bloque ``` sin cerrar produce un aviso", diagnosticoMd.length === 1 && diagnosticoMd[0].severidad === "aviso", JSON.stringify(diagnosticoMd));
  check("el diagnóstico de Markdown viene de markdown", diagnosticoMd[0] && diagnosticoMd[0].fuente === "markdown", JSON.stringify(diagnosticoMd[0]));
  const mdBueno = escribir("md/bueno.md", "# Título\n\n```js\nconst a = 1;\n```\n");
  check("Markdown correcto no produce diagnósticos", (await diagnosticarArchivo(mdBueno)).length === 0);

  // =====================================================================
  // 6. diagnosticarTexto: sincrónico y sin spawn
  // =====================================================================
  const textoJsonRoto = diagnosticarTexto("x.json", "{\n  \"a\": 1,\n  \"b\": }\n");
  check("diagnosticarTexto detecta JSON roto (error)", textoJsonRoto.length === 1 && textoJsonRoto[0].severidad === "error", JSON.stringify(textoJsonRoto));
  check("diagnosticarTexto calcula línea y columna del JSON", textoJsonRoto[0] && textoJsonRoto[0].linea === 3 && textoJsonRoto[0].columna === 8, JSON.stringify(textoJsonRoto[0]));
  check("diagnosticarTexto no lanza procesos y es sincrónico", Array.isArray(diagnosticarTexto("x.json", "{}")));
  check("diagnosticarTexto con JSON correcto no produce diagnósticos", diagnosticarTexto("x.json", "{\"a\": [1, 2]}").length === 0);

  const textoJsRoto = diagnosticarTexto("x.mjs", "function f() {\n  return 1;\n");
  check("diagnosticarTexto detecta la llave sin cerrar en JS", textoJsRoto.length === 1 && /Falta cerrar/.test(textoJsRoto[0].mensaje), JSON.stringify(textoJsRoto));
  check("el aviso de llaves apunta a la línea 1", textoJsRoto[0] && textoJsRoto[0].linea === 1 && textoJsRoto[0].fuente === "llaves", JSON.stringify(textoJsRoto[0]));
  const jsConRuido = "const s = \"}\"; // }\nconst t = `a${{ b: 1 }}`;\nconst re = /[\"'{}]/g;\nfunction ok() {\n  return s;\n}\n";
  check("las cadenas, plantillas, comentarios y regex no generan falsos avisos", diagnosticarTexto("x.mjs", jsConRuido).length === 0, JSON.stringify(diagnosticarTexto("x.mjs", jsConRuido)));
  check("un cierre de más en JS es error", diagnosticarTexto("x.mjs", "function f() {\n}\n}\n").some((d) => d.severidad === "error"));
  check("un paréntesis sin cerrar en JS se avisa", diagnosticarTexto("x.mjs", "const x = (1 + 2;\n").length === 1);

  const textoPyRoto = diagnosticarTexto("x.py", "def f():\n  return (1,\n");
  check("diagnosticarTexto detecta un paréntesis sin cerrar en Python", textoPyRoto.length === 1 && textoPyRoto[0].fuente === "llaves", JSON.stringify(textoPyRoto));
  check("las cadenas y comentarios de Python no generan falsos avisos", diagnosticarTexto("x.py", "s = \"{\"  # } (\nt = '''\n}\n'''\n").length === 0);

  const textoHtmlRoto = diagnosticarTexto("x.html", "<div>\n<p>hola\n");
  check("diagnosticarTexto detecta etiquetas HTML sin cerrar", textoHtmlRoto.length === 2 && textoHtmlRoto.every((d) => d.severidad === "aviso" && d.fuente === "etiquetas"), JSON.stringify(textoHtmlRoto));
  check("diagnosticarTexto no se queja de HTML correcto", diagnosticarTexto("x.html", "<div><p>hola</p></div>").length === 0);

  check("diagnosticarTexto con extensión desconocida devuelve []", diagnosticarTexto("x.txt", "{{{").length === 0);
  check("diagnosticarTexto con texto nulo no lanza", diagnosticarTexto("x.js", null).length === 0);
  check("diagnosticarTexto con basura binaria no lanza", Array.isArray(diagnosticarTexto("x.mjs", "\u0000{{{(([[\"'")));

  // =====================================================================
  // 7. simbolos: outline con nombres, tipos, líneas y columnas exactos
  // =====================================================================
  const jsOutline = [
    'import fs from "node:fs";',
    "",
    "export function alfa(a) {",
    "  return a;",
    "}",
    "",
    "const beta = (x) => x * 2;",
    "let gamma = 3;",
    "class Delta {",
    "  constructor() {}",
    "  metodoUno() {",
    "    return 1;",
    "  }",
    "}",
  ].join("\n");
  checkIgual("outline JS exacto (funciones, variables, clase y métodos)", simbolos("x.mjs", jsOutline), [
    { nombre: "alfa", tipo: "funcion", linea: 3, columna: 17 },
    { nombre: "beta", tipo: "funcion", linea: 7, columna: 7 },
    { nombre: "gamma", tipo: "variable", linea: 8, columna: 5 },
    { nombre: "Delta", tipo: "clase", linea: 9, columna: 7 },
    { nombre: "constructor", tipo: "metodo", linea: 10, columna: 3 },
    { nombre: "metodoUno", tipo: "metodo", linea: 11, columna: 3 },
  ]);
  const jsConTextos = "const s = \"function falsa() {}\";\n// function comentada() {}\n/* class Otra {} */\nconst real = function () {};\n";
  checkIgual("el outline JS ignora funciones/clases dentro de comentarios y cadenas", simbolos("x.js", jsConTextos), [
    { nombre: "s", tipo: "variable", linea: 1, columna: 7 },
    { nombre: "real", tipo: "funcion", linea: 4, columna: 7 },
  ]);

  const pyOutline = ["import os", "", "def cargar(ruta):", "    return ruta", "", "class Motor:", "    def arrancar(self):", "        return 1"].join("\n");
  checkIgual("outline PY exacto (def y class)", simbolos("x.py", pyOutline), [
    { nombre: "cargar", tipo: "funcion", linea: 3, columna: 5 },
    { nombre: "Motor", tipo: "clase", linea: 6, columna: 7 },
    { nombre: "arrancar", tipo: "funcion", linea: 7, columna: 9 },
  ]);
  check("el outline PY ignora defs dentro de cadenas y comentarios", simbolos("x.py", "# def falsa():\ns = '''\ndef tambien_falsa():\n'''\ndef real():\n    pass\n").map((s) => s.nombre).join(",") === "real");

  const jsonOutline = "{\n  \"nombre\": \"x\",\n  \"version\": 1,\n  \"anidado\": {\"interno\": true}\n}\n";
  checkIgual("outline JSON: solo claves de primer nivel", simbolos("x.json", jsonOutline), [
    { nombre: "nombre", tipo: "clave", linea: 2, columna: 3 },
    { nombre: "version", tipo: "clave", linea: 3, columna: 3 },
    { nombre: "anidado", tipo: "clave", linea: 4, columna: 3 },
  ]);
  check("el outline JSON no lista claves anidadas", !simbolos("x.json", jsonOutline).some((s) => s.nombre === "interno"));

  const htmlOutline = '<main id="app">\n  <input name="campo">\n  <!-- <b id="comentado"> -->\n  <script>const falso = "id=\'no\'";</script>\n</main>\n';
  checkIgual("outline HTML: ids y names, ignorando comentarios y scripts", simbolos("x.html", htmlOutline), [
    { nombre: "app", tipo: "id", linea: 1, columna: 7 },
    { nombre: "campo", tipo: "name", linea: 2, columna: 10 },
  ]);

  const cssOutline = ".a, .b {\n  color: red;\n}\n@media (max-width: 600px) {\n  .c { color: blue; }\n}\n";
  checkIgual("outline CSS: selectores y at-reglas", simbolos("x.css", cssOutline), [
    { nombre: ".a, .b", tipo: "selector", linea: 1, columna: 1 },
    { nombre: "@media (max-width: 600px)", tipo: "at-regla", linea: 4, columna: 1 },
    { nombre: ".c", tipo: "selector", linea: 5, columna: 3 },
  ]);
  check("el outline de una extensión desconocida devuelve []", simbolos("x.txt", "function f() {}").length === 0);
  check("el outline de un texto vacío devuelve []", simbolos("x.js", "").length === 0);

  // =====================================================================
  // 8. indiceSimbolos + buscarDefinicion
  // =====================================================================
  const proyecto = path.join(root, "proyecto");
  escribir(
    "proyecto/util.mjs",
    'export function calcularTotal(items) {\n  return items.length;\n}\n\nexport function duplicado() {\n  return "util";\n}\n'
  );
  escribir(
    "proyecto/main.mjs",
    'import { calcularTotal } from "./util.mjs";\n\nfunction duplicado() {\n  return "main";\n}\n\nexport const total = calcularTotal([1, 2, 3]);\n'
  );
  escribir("proyecto/otro/lejano.mjs", "export function calcularTotal() {\n  return 0;\n}\n");
  escribir("proyecto/node_modules/dependencia.mjs", "export function oculto() {\n  return 1;\n}\n");
  escribir("proyecto/logs/ruido.mjs", "export function deLogs() {\n  return 1;\n}\n");
  escribir("proyecto/grande.mjs", `export function enorme() {\n  return 1;\n}\n//${"x".repeat(2_100_000)}\n`);

  const indice = indiceSimbolos(proyecto);
  check("el índice es un Map", indice instanceof Map);
  check("el índice encuentra símbolos de varios archivos", indice.has("calcularTotal") && indice.has("duplicado") && indice.has("total"));
  check("el índice salta node_modules", !indice.has("oculto"));
  check("el índice salta logs", !indice.has("deLogs"));
  check("el índice salta archivos de más de 2 MB", !indice.has("enorme"));
  const definiciones = indice.get("calcularTotal") || [];
  check("el índice guarda todas las definiciones de un homónimo", definiciones.length === 2, JSON.stringify(definiciones));
  check("las rutas del índice son relativas con /", definiciones.some((d) => d.archivo === "util.mjs") && definiciones.some((d) => d.archivo === "otro/lejano.mjs"), JSON.stringify(definiciones.map((d) => d.archivo)));
  check("las entradas del índice llevan línea, columna y tipo", definiciones.every((d) => d.linea === 1 && d.columna > 0 && d.tipo === "funcion"), JSON.stringify(definiciones));

  const definicionCruzada = buscarDefinicion("calcularTotal", indice, "main.mjs");
  check("buscarDefinicion encuentra la definición en otro archivo", definicionCruzada && definicionCruzada.archivo === "util.mjs" && definicionCruzada.linea === 1, JSON.stringify(definicionCruzada));
  check("buscarDefinicion prefiere el mismo directorio frente a un subdirectorio", definicionCruzada && definicionCruzada.archivo === "util.mjs", JSON.stringify(definicionCruzada));
  const definicionPropia = buscarDefinicion("duplicado", indice, "main.mjs");
  check("buscarDefinicion prioriza el archivo actual cuando hay homónimos", definicionPropia && definicionPropia.archivo === "main.mjs" && definicionPropia.linea === 3, JSON.stringify(definicionPropia));
  const definicionPropiaUtil = buscarDefinicion("duplicado", indice, "util.mjs");
  check("buscarDefinicion prioriza el archivo actual (util.mjs)", definicionPropiaUtil && definicionPropiaUtil.archivo === "util.mjs", JSON.stringify(definicionPropiaUtil));
  check(
    "buscarDefinicion acepta el archivo actual como ruta absoluta",
    (buscarDefinicion("duplicado", indice, path.join(proyecto, "main.mjs")) || {}).archivo === "main.mjs"
  );
  check("buscarDefinicion ignora palabras de menos de 2 caracteres", buscarDefinicion("a", indice) === null && buscarDefinicion("", indice) === null);
  check("buscarDefinicion devuelve null si no hay definición", buscarDefinicion("noExiste", indice) === null);
  check("buscarDefinicion devuelve null si no hay índice", buscarDefinicion("calcularTotal", null) === null);
  check("buscarDefinicion acepta un archivo actual vacío", buscarDefinicion("calcularTotal", indice) !== null);

  const indiceParcial = indiceSimbolos(proyecto, ["util.mjs"]);
  checkIgual("indiceSimbolos acepta una lista explícita de archivos", [...indiceParcial.keys()].sort(), ["calcularTotal", "duplicado"]);
  check("buscarDefinicion funciona con un índice parcial", (buscarDefinicion("duplicado", indiceParcial) || {}).archivo === "util.mjs");

  // =====================================================================
  // 9. CRLF y BOM
  // =====================================================================
  const crlfJs = escribir("crlf/ejemplo.mjs", "const uno = 1;\r\nfunction conCrlf(valor) {\r\n  return valor;\r\n}\r\n");
  check("un archivo JS con CRLF no produce diagnósticos", (await diagnosticarArchivo(crlfJs)).length === 0, JSON.stringify(await diagnosticarArchivo(crlfJs)));
  checkIgual("el outline con CRLF conserva las líneas", simbolos("crlf/ejemplo.mjs", leer("crlf/ejemplo.mjs")), [
    { nombre: "uno", tipo: "variable", linea: 1, columna: 7 },
    { nombre: "conCrlf", tipo: "funcion", linea: 2, columna: 10 },
  ]);
  check("diagnosticarTexto tolera CRLF", diagnosticarTexto("x.mjs", "function f() {\r\n  return 1;\r\n").length === 1);
  const crlfJsonRoto = escribir("crlf/roto.json", '{\r\n  "a": 1,\r\n  "b": }\r\n');
  const diagnosticoCrlfJson = await diagnosticarArchivo(crlfJsonRoto);
  check("el JSON con CRLF calcula línea y columna", diagnosticoCrlfJson[0] && diagnosticoCrlfJson[0].linea === 3 && diagnosticoCrlfJson[0].columna === 8, JSON.stringify(diagnosticoCrlfJson));

  const bomJson = escribir("bom/datos.json", "\uFEFF{\n  \"a\": 1\n}\n");
  check("un JSON con BOM no produce diagnósticos", (await diagnosticarArchivo(bomJson)).length === 0);
  checkIgual("el outline JSON con BOM funciona", simbolos("bom/datos.json", leer("bom/datos.json")), [{ nombre: "a", tipo: "clave", linea: 2, columna: 3 }]);
  check("diagnosticarTexto ignora el BOM", diagnosticarTexto("x.json", "\uFEFF{\"a\": 1}").length === 0);

  // =====================================================================
  // 10. Nunca lanza: inexistente, binario, vacío, directorio, desconocido
  // =====================================================================
  check("archivo inexistente devuelve []", (await diagnosticarArchivo(path.join(root, "no-existe.js"))).length === 0);
  const binario = escribir("raro/binario.mjs", Buffer.from([0, 1, 2, 3, 0, 4]));
  check("archivo binario devuelve []", (await diagnosticarArchivo(binario)).length === 0);
  const vacioJs = escribir("raro/vacio.js", "");
  const vacioJson = escribir("raro/vacio.json", "");
  check("archivo vacío devuelve [] (también JSON)", (await diagnosticarArchivo(vacioJs)).length === 0 && (await diagnosticarArchivo(vacioJson)).length === 0);
  check("un directorio devuelve []", (await diagnosticarArchivo(proyecto)).length === 0);
  const textoRaro = escribir("raro/notas.txt", "{{{(((");
  check("extensión desconocida devuelve []", (await diagnosticarArchivo(textoRaro)).length === 0);
  check("texto con extensión desconocida no lanza en diagnosticarTexto", diagnosticarTexto("raro/notas.txt", "{{{(((").length === 0);
  check("abs vacío devuelve []", (await diagnosticarArchivo("")).length === 0 && (await diagnosticarArchivo(null)).length === 0);
  check("texto solo de espacios devuelve []", (await diagnosticarArchivo(path.join(root, "x.py"), "   \n\t\n")).length === 0);
  check("un archivo ilegible (nombre raro) no lanza", Array.isArray(await diagnosticarArchivo(path.join(root, "carpeta/"))));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

if (fallos) {
  console.error(`\nprueba-diagnosticos: ${fallos} fallo(s)`);
  process.exitCode = 1;
} else {
  console.log("\nprueba-diagnosticos: OK");
}
