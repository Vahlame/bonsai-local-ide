/**
 * Fachada de acciones: reexporta rutas, efectos, edición, texto y diff, y conserva
 * el self-test histórico.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { resolveInside, commandKey, partirLectura, commandAllowed, writeOutputs, writeNewOutput } from "./actions/files.mjs";
import { nativeToolEffects } from "./actions/effects.mjs";
import { trozoParecido, aplicarReemplazo } from "./actions/edit.mjs";
import { esCharla, pideAclaraciones, inventedToolResult, stripToolCallMarkup, stripFakeToolText, stripCommands, stripReads, stripFileBlocks } from "./actions/text.mjs";
import { unifiedDiff } from "./actions/diff.mjs";
import { PC_TOOLS, claveLectura } from "./tool-registry.mjs";
import { BINARY_EXTENSIONS, cleanRelative, extractCommands, extractReads, extractSearches, extractWrites, guessName, impliedAction, indexScope, stripIndex, stripSearches } from "./legacy-tool-parser.mjs";

export * from "./actions/files.mjs";
export * from "./actions/effects.mjs";
export * from "./actions/edit.mjs";
export * from "./actions/text.mjs";
export * from "./actions/diff.mjs";
export { PC_TOOLS, claveLectura } from "./tool-registry.mjs";
export { BINARY_EXTENSIONS, cleanRelative, extractCommands, extractReads, extractSearches, extractWrites, guessName, impliedAction, indexScope, stripIndex, stripSearches } from "./legacy-tool-parser.mjs";

export function selfTest() {
  /** @type {string[]} */
  const failures = [];
  /**
   * @param {string} name
   * @param {boolean} cond
   */
  const check = (name, cond) => {
    if (!cond) failures.push(name);
  };
  const sample = "Listo.\n```archivo juegos/serpiente.html\n<!DOCTYPE html><html></html>\n```\n";
  const got = extractWrites(sample, "haz la serpiente");
  check("lee el bloque archivo", got.length === 1 && got[0].rel === "juegos/serpiente.html" && got[0].content.includes("<html>"));
  const namedFile = extractWrites("```nota-prueba.txt\nping\n```", "crea");
  check("acepta el nombre en la cerca", namedFile[0]?.rel === "nota-prueba.txt" && namedFile[0]?.content === "ping");
  check("nombre serpiente", guessName("hazme el juego de la serpiente en html", "html") === "serpiente.html");
  check("con tool calls nativas, enseñar un resultado en una cerca no escribe nada", extractWrites("Resultado:\n```json\n{\"total\": 241, \"por_producto\": {\"manzana\": 90}}\n```", "Lee ventas.json", { soloExplicitas: true }).length === 0);
  check("con tool calls nativas, un ```archivo explícito sí cuenta", extractWrites(sample, "x", { soloExplicitas: true }).length === 1);
  const fallback = extractWrites("```html\n<!DOCTYPE html><html><body>hola</body></html>\n```", "un juego");
  check("cae a html", fallback.length === 1 && fallback[0].rel.endsWith(".html"));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-salida-"));
  try {
    const saved = writeOutputs(root, got);
    check("escribe dentro del proyecto", fs.existsSync(path.join(root, "juegos", "serpiente.html")) && saved[0].url === "/p/juegos/serpiente.html");
    let rejected = false;
    try {
      resolveInside(root, "../secreto.html");
    } catch {
      rejected = true;
    }
    check("rechaza salir de la carpeta", rejected);
    let rejectedExt = false;
    try {
      resolveInside(root, "malware.exe");
    } catch {
      rejectedExt = true;
    }
    check("rechaza ejecutables", rejectedExt);
  const reads = extractReads("voy ```leer test_math.py``` y ```leer ../x.py```");
  check("lee rutas pedidas", reads[0] === "test_math.py" && reads.length === 2);
  check("quita el pedido de lectura", !stripReads("antes ```leer a.py``` después").includes("leer"));
  check("pide el índice entero", indexScope("mira ```indice```") === "");
  check("pide una carpeta", indexScope("```indice scripts```") === "scripts");
  check("sin índice", indexScope("nada") === null);
  check("quita el índice", !stripIndex("antes ```indice``` después").includes("indice"));
  check("bin pertenece al proyecto seleccionado", resolveInside(root, "bin/x.py") === path.join(root, "bin", "x.py"));
  check("lee un comando", extractCommands("```ejecutar\r\nnode -e \"console.log(1)\"\r\n```")[0]?.startsWith("node"));
  const loose = "ahora\n```\nejecutar\ndel main.py README.md\n```\n";
  const diffCambio = unifiedDiff("a.txt", "a\nb", "a\nc");
  check("diff marca el cambio", diffCambio.includes("-b") && diffCambio.includes("+c"));
  check("diff conserva el contexto", diffCambio.includes(" a"));
  check("diff sin cambios", unifiedDiff("a.txt", "a\nb", "a\nb").endsWith(" sin cambios"));
  const diffCreado = unifiedDiff("n.txt", "", "uno\ndos");
  check("diff de archivo nuevo", diffCreado.startsWith("--- /dev/null") && diffCreado.includes("+uno") && diffCreado.includes("+dos"));
  const largo = Array.from({ length: 4000 }, (_, i) => `linea ${i}`).join("\n");
  const largoEditado = largo.replace("linea 2000", "linea 2000 CAMBIADA").replace("linea 3950", "linea 3950 AL_FINAL");
  const t0 = Date.now();
  const diffLargo = unifiedDiff("l.txt", largo, largoEditado);
  const msDiff = Date.now() - t0;
  check(
    "diff grande sin matriz y con contexto",
    msDiff < 800 &&
      diffLargo.includes("-linea 2000") &&
      diffLargo.includes("+linea 2000 CAMBIADA") &&
      diffLargo.includes(" linea 1999") &&
      diffLargo.includes("+linea 3950 AL_FINAL"),
  );
  const base30 = Array.from({ length: 30 }, (_, i) => `L${i}`).join("\n");
  const dosCambios = base30.replace("L2", "L2X").replace("L25", "L25X");
  const diffDos = unifiedDiff("d.txt", base30, dosCambios);
  check("diff separa grupos con @@", diffDos.includes("@@") && diffDos.includes(" L1") && diffDos.includes(" L3"));
  const reproA = ["x", "x", "y", "x", "x"].join("\n");
  const reproB = ["x", "x", "y2", "x", "x"].join("\n");
  const diffRepro = unifiedDiff("r.txt", reproA, reproB);
  check("diff con líneas repetidas usa un ancla", diffRepro.includes("-y") && diffRepro.includes("+y2") && diffRepro.includes(" x"));
  const antesRen = Array.from({ length: 200 }, (_, i) => `const foo${i} = foo(${i});`).join("\n");
  const despuesRen = antesRen.replaceAll("foo", "bar");
  const t1 = Date.now();
  const diffRen = unifiedDiff("r.txt", antesRen, despuesRen);
  const msRen = Date.now() - t1;
  check("diff masivo termina rápido", msRen < 800);
  check("diff masivo enseña quitar y poner", diffRen.includes("-const foo0 = foo(0);") && diffRen.includes("+const bar0 = bar(0);"));
  check("lee ejecutar dentro de la cerca", extractCommands(loose)[0] === "del main.py README.md");
  check("quita esa cerca", !stripCommands(loose).includes("ejecutar") && stripCommands(loose).includes("ahora"));
  check("leer vacío lista la carpeta", indexScope("```\nleer\n```") === "");
  const looseWrite = "Perfecto.\n```\narchivo\nserpiente.html\n<!DOCTYPE html><html></html>\n```\n";
  const looseGot = extractWrites(looseWrite, "serpiente");
  check("archivo en dos líneas", looseGot[0]?.rel === "serpiente.html" && looseGot[0]?.content.includes("<html>"));
  check("quita ese bloque del texto", !stripFileBlocks(looseWrite).includes("DOCTYPE") && stripFileBlocks(looseWrite).includes("Perfecto"));
  const splitTag = "```archivo\nserpiente.html\n<!DOCTYPE html><html></html>\n```";
  check("ruta bajo la etiqueta", extractWrites(splitTag, "x")[0]?.rel === "serpiente.html");
  const namedLoose = "Listo.\n```\nserpiente.html\nserpiente.html\n<!DOCTYPE html><html></html>\n```\n";
  const namedGot = extractWrites(namedLoose, "x");
  check("el nombre va en la primera línea", namedGot[0]?.rel === "serpiente.html" && namedGot[0]?.content.startsWith("<!DOCTYPE"));
  check("ese bloque sale del texto", !stripFileBlocks(namedLoose).includes("DOCTYPE") && stripFileBlocks(namedLoose).includes("Listo"));
  check("leer con ruta suelta", extractReads("```\nleer\nmain.py\n```")[0] === "main.py");
  check("bloquea salir del disco", !commandAllowed("type C:\\Windows\\win.ini"));
  check("permite node", commandAllowed("node -e \"console.log(1)\""));
  check("permite comandos con URL (probar una API)", commandAllowed("curl http://127.0.0.1:8099/tareas") && commandAllowed("python -c \"import urllib.request; print(urllib.request.urlopen('http://localhost:8099/tareas').read())\""));
  check("permite puntos suspensivos en un texto", commandAllowed("python -c \"print('cargando...')\""));
  check("sigue bloqueando rutas absolutas y subir de carpeta", !commandAllowed("type \"C:/Users/x.txt\"") && !commandAllowed("python ..\\fuera.py") && !commandAllowed("copy a.txt ../b.txt") && !commandAllowed("cd .. && dir") && !commandAllowed("node -e \"require('fs').writeFileSync('../x','y')\""));
  const spoken = "Voy a instalar.\n\nejecutar: pip install reportlab\npip install reportlab\npip install reportlab\n";
  check("lee ejecutar suelto", extractCommands(spoken)[0] === "pip install reportlab" && extractCommands(spoken).length === 1);
  check("quita el comando repetido", stripCommands(spoken) === "Voy a instalar.");
  const look = "mira\n```\nbuscar\nclima en mexico\n```\n";
  check("lee una búsqueda", extractSearches(look)[0] === "clima en mexico");
  check("quita la búsqueda", !stripSearches(look).includes("buscar") && stripSearches(look).includes("mira"));
  check("busca en la etiqueta", extractSearches("```buscar hora actual```")[0] === "hora actual");
  const copied = "Voy a intentar.\n\ncódigo 1\n'python' is not recognized as an internal or external command,\noperable program or batch file.";
  check("detecta la salida inventada", inventedToolResult(copied));
  check("quita la salida inventada", stripFakeToolText(copied) === "Voy a intentar.");
  const xmlCall = "Voy a lanzarlo.\n<tool_call>\n<function=ejecutar>\n<parameter=comando>\npython lru.py\n</parameter>\n</function>\n</tool_call>";
  check("quita la llamada escrita en XML", stripFakeToolText(xmlCall) === "Voy a lanzarlo.");
  check("quita una llamada XML cortada a medias", stripToolCallMarkup("Listo.\n<tool_call>\n<function=ejecutar>") === "Listo.");
  check("el XML pegado a texto no se come el texto", stripToolCallMarkup("antes <tool_call><function=leer></function></tool_call> después") === "antes  después");
  check("sin XML no toca nada", stripToolCallMarkup("hola\nmundo") === "hola\nmundo");
  const blocked = "Busco.\n\nbloqueado: python --version\n'python' is not recognized as an internal or external command,";
  check("lee el comando bajo bloqueado", extractCommands(blocked)[0] === "python --version");
  check("lee buscar en una línea", extractSearches("Voy.\nbuscar: python pdf windows")[0] === "python pdf windows");
  check("una frase de búsqueda sí busca", impliedAction("Voy a buscar cómo ejecutar Python en este entorno.")?.query === "cómo ejecutar Python en este entorno");
  check("una frase de python sí ejecuta", impliedAction("Voy a intentar ejecutar Python directamente.")?.command === "python --version");
  const native = nativeToolEffects([{ name: "ejecutar", arguments: "{\"comando\":\"python --version\"}" }]);
  check("lee la tool call nativa", native.commands[0] === "python --version" && native.searches.length === 0);
  const sinRuta = nativeToolEffects([{ name: "leer", arguments: {} }, { name: "leer", arguments: "{\"ruta\":\".\"}" }]);
  check("leer sin ruta o con . lista la carpeta (no es un error)", sinRuta.scope === "" && sinRuta.reads.length === 0 && sinRuta.notes.length === 0);
  check("una explicación que dice buscar no lanza una búsqueda", impliedAction("La función `buscar` implementa una búsqueda binaria sobre una lista ordenada.").query === "");
  check("una explicación que habla de Python no lanza un comando", impliedAction("Python es un lenguaje interpretado y de tipado dinámico.").command === "");
  check("un anuncio largo no cuenta", impliedAction(`Voy a buscar ${"algo ".repeat(100)}`).query === "");
  check("el python del venv es el mismo comando", commandKey(".venv\\Scripts\\python audit/hola.py") === commandKey("python audit/hola.py"));
  const many = nativeToolEffects([
    { name: "leer", arguments: { ruta: "audit/uno.txt" } },
    { name: "leer", arguments: { ruta: "audit/hola.py" } },
    { name: "ejecutar", arguments: {} },
  ]);
  check("varias lecturas y avisa el comando vacío", many.reads.length === 2 && many.notes.some((note) => note.includes("sin `comando`")));
  const conIds = nativeToolEffects([
    { id: "c1", name: "ejecutar", arguments: { comando: "python a.py" } },
    { id: "c2", name: "leer", arguments: { ruta: "big.html", desde: 100, hasta: 180 } },
    { id: "c3", name: "archivo", arguments: { contenido: "x" } },
    { name: "archivo", arguments: { ruta: "b.txt", contenido: "y" } },
  ]);
  check("cada efecto sabe qué llamada lo pidió", conIds.ids.get("cmd:python a.py") === "c1" && conIds.ids.get("read:big.html:100-180") === "c2" && conIds.ids.get("write:b.txt") === "call_3");
  check("las notas van con el id de su llamada", conIds.notesIds[conIds.notes.findIndex((n) => /sin `ruta`/.test(n))] === "c3");
  check("leer con desde/hasta lleva el rango en la clave", conIds.reads[0] === "big.html:100-180" && partirLectura("big.html:100-180").desde === 100 && partirLectura("big.html:100-180").hasta === 180);
  check("leer sin rango es la ruta sola", partirLectura("a.py").rel === "a.py" && partirLectura("a.py").desde === 0 && claveLectura("a.py") === "a.py");
  check("leer solo con desde llega hasta donde quepa", claveLectura("a.py", 50) === "a.py:50-" && partirLectura("a.py:50-").hasta === 0);
  check("una pregunta conceptual es charla", esCharla("Explica qué es una closure en JavaScript y dame un ejemplo corto.") && esCharla("¿Qué es un decorador en Python?") && esCharla("¿Cuál es la diferencia entre let y var?"));
  check("si nombra un archivo no es charla", !esCharla("Explícame en 3 frases qué hace la función de algoritmo.py y cuál es su complejidad."));
  check("si hay algo que hacer no es charla", !esCharla("¿En qué archivo está definida la función conectar_db?") && !esCharla("Explica el error y arréglalo") && !esCharla("Crea un ejemplo de closure") && !esCharla("¿Qué es lo que falla en mis tests?"));
  check("un pedido normal no es charla", !esCharla("necesito que me hagas un modelo 3d en un archivo html") && esCharla("hola"));
  check("un pedido de plan/preguntas pide aclaraciones primero", pideAclaraciones("Diseña e implementa el proyecto; dame un plan detallado y 5 preguntas bloqueantes antes de empezar.") && pideAclaraciones("Hazme 3 preguntas antes de tocar archivos.") && !pideAclaraciones("Implementa el plan y crea los archivos."));
  check("saludos breves no activan tareas", esCharla("hi") && esCharla("Hello!") && !esCharla("hi, crea un archivo"));
  const conEdit = nativeToolEffects([{ id: "e1", name: "reemplazar", arguments: { ruta: "a.py", buscar: "x = 1", poner: "x = 2" } }, { id: "e2", name: "reemplazar", arguments: { ruta: "a.py" } }]);
  check("reemplazar llega como edición con su id", conEdit.edits.length === 1 && conEdit.edits[0].poner === "x = 2" && conEdit.ids.get("edit:0") === "e1");
  check("reemplazar sin buscar/poner avisa", conEdit.notes.some((n) => /reemplazar necesita/.test(n)) && conEdit.notesIds[0] === "e2");
  const conFs = nativeToolEffects([
    { id: "b1", name: "borrar", arguments: { ruta: "viejo.txt" } },
    { id: "m1", name: "mover", arguments: { origen: "a.py", destino: "src/a.py" } },
    { id: "p1", name: "plan", arguments: { pasos: ["crear modulo", "testear", "borrar temporal"], hechos: [1] } },
    { id: "b2", name: "borrar", arguments: {} },
  ]);
  check("borrar llega como borrado con su id", conFs.borrados.includes("viejo.txt") && conFs.ids.get("del:viejo.txt") === "b1");
  check("mover llega con origen y destino", conFs.movidos.length === 1 && conFs.movidos[0].origen === "a.py" && conFs.movidos[0].destino === "src/a.py" && conFs.ids.get("move:a.py") === "m1");
  check("plan llega con pasos y hechos", conFs.plan?.pasos.length === 3 && conFs.plan?.hechos[0] === 1 && conFs.ids.get("plan") === "p1");
  check("borrar sin ruta avisa", conFs.notes.some((n) => /borrar llegó sin/.test(n)) && conFs.notesIds[conFs.notes.findIndex((n) => /borrar llegó sin/.test(n))] === "b2");
  const planTexto = nativeToolEffects([{ name: "plan", arguments: { plan: "uno\ndos" } }]);
  check("plan acepta texto con líneas como respaldo", planTexto.plan?.pasos.length === 2);
  const conProc = nativeToolEffects([
    { id: "pr1", name: "proceso", arguments: { accion: "listar" } },
    { id: "pr2", name: "proceso", arguments: { accion: "detener", id: "bg123" } },
    { id: "pr3", name: "proceso", arguments: { accion: "detener" } },
  ]);
  check("proceso lista y detiene con su id", conProc.procesos[0].accion === "listar" && conProc.procesos[1].id === "bg123" && conProc.ids.get("proc:listar") === "pr1");
  check("proceso sin id avisa", conProc.notes.some((n) => /proceso necesita/.test(n)) && conProc.notesIds[0] === "pr3");
  const r1 = aplicarReemplazo("a\nb\nc\n", "b", "B");
  check("reemplazo único", r1.ok && r1.texto === "a\nB\nc\n" && r1.linea === 2);
  check("reemplazo ambiguo o ausente no toca nada", !aplicarReemplazo("b b", "b", "x").ok && aplicarReemplazo("b b", "b", "x").veces === 2 && aplicarReemplazo("abc", "z", "x").veces === 0);
  const crlf = aplicarReemplazo("uno\r\ndos\r\ntres\r\n", "dos\ntres", "DOS\nTRES");
  check("reemplazo con CRLF en el archivo y LF en la llamada", crlf.ok && crlf.texto === "uno\r\nDOS\r\nTRES\r\n");
  const parecido = trozoParecido("function a() {\n  controls.enableDamping = true;\n  return 1;\n}\n", "  controls.enableDamping=true;");
  check("si no está, enseña el trozo real más parecido", /línea 2/.test(parecido) && parecido.includes("  controls.enableDamping = true;"), parecido);
  check("sin nada parecido no inventa", trozoParecido("abc\ndef\n", "zzz qqq") === "");
  check("poner vacío borra el trozo", aplicarReemplazo("a\nquitar\nb", "quitar\n", "").ok && aplicarReemplazo("a\nquitar\nb", "quitar\n", "").texto === "a\nb");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  return failures;
}

if (process.argv[1] && process.argv[1].endsWith("actions.mjs")) {
  const failures = selfTest();
  if (failures.length) {
    process.stderr.write(`${failures.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("actions ok\n");
  }
}
