/**
 * Edición en línea (Ctrl+K): recorta la selección, arma el mensaje para el modelo y
 * aplica el reemplazo. Sin DOM, sin red y sin GPU: todo se prueba en Node
 * (`node chat/editar.mjs`).
 *
 * El servidor no escribe nada: devuelve el texto propuesto y la interfaz decide
 * (Aceptar / Rechazar) antes de guardar.
 */

import { estimateTokens, takeHeadByTokens, takeTailByTokens } from "./context.mjs";

/** Tope de la selección que se le enseña al modelo. */
export const MAX_SELECCION_TOKENS = 700;
/** Cuánto contexto de alrededor se manda (arriba y abajo de la selección). */
export const CONTEXTO_TOKENS = 500;

export const EDIT_RULES =
  "Eres un editor de código dentro de un IDE. Recibes el contexto de un archivo, la selección " +
  "exacta que hay que cambiar y la instrucción del usuario. Devuelve SOLO el texto nuevo que " +
  "reemplaza la selección: sin explicaciones, sin comentarios sobre lo que haces, sin markdown y " +
  "sin repetir el resto del archivo. Conserva la indentación y el estilo del archivo. Si la " +
  "instrucción pide borrar la selección, devuelve la palabra BORRAR y nada más.";

/**
 * Corta un texto por líneas (1-based, inclusive). Fuera de rango se ajusta al
 * texto real en vez de fallar: el editor manda lo que tiene seleccionado.
 * @param {string} texto
 * @param {number} start
 * @param {number} end
 * @returns {string}
 */
export function recorteLineas(texto, start, end) {
  const lineas = String(texto ?? "").split("\n");
  const desde = Math.max(1, Math.min(Math.floor(start) || 1, lineas.length));
  const hasta = Math.max(desde, Math.min(Math.floor(end) || desde, lineas.length));
  return lineas.slice(desde - 1, hasta).join("\n");
}

/**
 * Cuántas líneas tiene un texto.
 * @param {string} texto
 * @returns {number}
 */
export function contarLineas(texto) {
  return String(texto ?? "").split("\n").length;
}

/**
 * Reemplaza las líneas `start..end` (1-based) por `reemplazo`. Un reemplazo vacío
 * borra esa selección. `BORRAR` (la respuesta que se le pide al modelo) también borra.
 * @param {string} texto
 * @param {number} start
 * @param {number} end
 * @param {string} reemplazo
 * @returns {string}
 */
export function aplicarReemplazo(texto, start, end, reemplazo) {
  const original = String(texto ?? "");
  const lineas = original.split("\n");
  const desde = Math.max(1, Math.min(Math.floor(start) || 1, lineas.length));
  const hasta = Math.max(desde, Math.min(Math.floor(end) || desde, lineas.length));
  const bruto = String(reemplazo ?? "");
  const nuevo = /^\s*BORRAR\s*$/i.test(bruto) ? "" : bruto.replace(/\r\n/g, "\n");
  const piezas = nuevo === "" ? [] : nuevo.split("\n");
  const salida = [...lineas.slice(0, desde - 1), ...piezas, ...lineas.slice(hasta)];
  return salida.join("\n");
}

/**
 * Quita las cercas de markdown y los preámbulos típicos ("Aquí está el código:").
 * El modelo pequeño suele envolver la respuesta aunque se le pida que no.
 * NO toca los espacios de dentro: la sangría de la primera línea es código.
 * @param {string} bruto
 * @returns {string}
 */
export function limpiarRespuesta(bruto) {
  let texto = String(bruto ?? "").replace(/\r\n/g, "\n");
  const cerca = texto.match(/^\s*```[A-Za-z0-9+#.-]*[ \t]*\n([\s\S]*?)\n?```\s*$/);
  if (cerca) texto = cerca[1];
  texto = texto.replace(/^\s*```[A-Za-z0-9+#.-]*[ \t]*\n?/, "").replace(/\n?```\s*$/, "");
  const lineas = texto.split("\n");
  while (lineas.length > 1 && !lineas[0].trim()) lineas.shift();
  const preambulo = /^(aqu[íi] (est[áa]|tienes)( el)?( c[óo]digo| texto)?|el (c[óo]digo|texto)( nuevo| final)?|reemplazo|resultado)\s*:?\s*$/i;
  while (lineas.length > 1 && preambulo.test(lineas[0].trim())) {
    lineas.shift();
    while (lineas.length > 1 && !lineas[0].trim()) lineas.shift();
  }
  while (lineas.length > 1 && !lineas[lineas.length - 1].trim()) lineas.pop();
  return lineas.join("\n").trim() ? lineas.join("\n") : "";
}

/**
 * Contexto de arriba y abajo de la selección, ya recortado.
 * @param {string} texto
 * @param {number} start
 * @param {number} end
 * @returns {{antes: string, despues: string}}
 */
export function contextoAlrededor(texto, start, end) {
  const lineas = String(texto ?? "").split("\n");
  const desde = Math.max(1, Math.min(Math.floor(start) || 1, lineas.length));
  const hasta = Math.max(desde, Math.min(Math.floor(end) || desde, lineas.length));
  const antes = lineas.slice(0, desde - 1).join("\n");
  const despues = lineas.slice(hasta).join("\n");
  return {
    // Las líneas de ARRIBA: lo útil es la COLA (lo inmediatamente anterior a la selección, que
    // es donde están el `def`, el `if` y las llaves). Con takeHeadByTokens se perdía justo eso.
    antes: takeTailByTokens(antes.split("\n").slice(-60).join("\n"), CONTEXTO_TOKENS, estimateTokens),
    despues: takeHeadByTokens(despues.split("\n").slice(0, 60).join("\n"), CONTEXTO_TOKENS, estimateTokens),
  };
}

/**
 * Mensajes para el modelo: sin herramientas (el servidor pone tool_choice "none"),
 * con el archivo recortado y la instrucción al final.
 * @param {{rel: string, texto: string, start: number, end: number, instruccion: string}} args
 * @returns {Array<{role: string, content: string}>}
 */
export function construirMensajes({ rel, texto, start, end, instruccion }) {
  const fuente = String(texto ?? "");
  const seleccion = takeHeadByTokens(recorteLineas(fuente, start, end), MAX_SELECCION_TOKENS, estimateTokens);
  const { antes, despues } = contextoAlrededor(fuente, start, end);
  const partes = [`Archivo: ${rel}`];
  if (antes) partes.push(`Líneas anteriores:\n${antes}`);
  partes.push(`Selección a reemplazar (líneas ${start}-${end}):\n${seleccion}`);
  if (despues) partes.push(`Líneas siguientes:\n${despues}`);
  partes.push(`Instrucción: ${String(instruccion ?? "").trim()}`);
  return [
    { role: "system", content: EDIT_RULES },
    { role: "user", content: partes.join("\n\n") },
  ];
}

/**
 * Aplica la respuesta del modelo y devuelve el texto del archivo completo.
 * @param {{texto: string, start: number, end: number, respuesta: string}} args
 * @returns {{propuesta: string, texto: string, borra: boolean}}
 */
export function aplicarRespuesta({ texto, start, end, respuesta }) {
  const propuesta = limpiarRespuesta(respuesta);
  const borra = /^\s*BORRAR\s*$/i.test(propuesta);
  // El modelo solo ve los primeros MAX_SELECCION_TOKENS de la selección. Si la selección
  // era más larga, el reemplazo NO puede pisar las líneas que nunca vio: con 200 líneas
  // seleccionadas el modelo veía 52 y el archivo quedaba en 2 (148 líneas del usuario
  // desaparecían). Se reemplaza exactamente lo que se le enseñó.
  const original = String(texto ?? "");
  const lineas = original.split("\n");
  const desde = Math.max(1, Math.min(Math.floor(start) || 1, lineas.length));
  const hasta = Math.max(desde, Math.min(Math.floor(end) || desde, lineas.length));
  const enviada = takeHeadByTokens(lineas.slice(desde - 1, hasta).join("\n"), MAX_SELECCION_TOKENS, estimateTokens);
  const hastaReal = Math.min(hasta, desde + Math.max(1, enviada.split("\n").length) - 1);
  return {
    propuesta: borra ? "" : propuesta,
    texto: aplicarReemplazo(original, desde, hastaReal, propuesta),
    borra,
  };
}

/**
 * @returns {string[]} nombres de las comprobaciones que fallaron
 */
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
  const fuente = "uno\ndos\ntres\ncuatro\ncinco\n";

  check("recorta la selección", recorteLineas(fuente, 2, 3) === "dos\ntres");
  check("una sola línea", recorteLineas(fuente, 4, 4) === "cuatro");
  check("más allá del final devuelve vacío", recorteLineas(fuente, 9, 12) === "");
  check("start mayor que end se ajusta", recorteLineas(fuente, 4, 2) === "cuatro");

  check("reemplaza la selección", aplicarReemplazo(fuente, 2, 3, "DOS Y TRES") === "uno\nDOS Y TRES\ncuatro\ncinco\n");
  check("varias líneas nuevas", aplicarReemplazo("a\nb\nc", 2, 2, "x\ny") === "a\nx\ny\nc");
  check("vacío borra la selección", aplicarReemplazo("a\nb\nc", 2, 2, "") === "a\nc");
  check("BORRAR borra la selección", aplicarReemplazo("a\nb\nc", 2, 2, "BORRAR") === "a\nc");
  check("respeta el final de archivo", aplicarReemplazo("a\nb\n", 2, 2, "B") === "a\nB\n");

  check("quita la cerca", limpiarRespuesta("```js\nconst x = 1;\n```") === "const x = 1;");
  check("quita el preámbulo", limpiarRespuesta("Aquí está el código:\nconst x = 1;") === "const x = 1;");
  check("no se come la sangría", limpiarRespuesta("  const x = 1;  ") === "  const x = 1;  ");
  check("respuesta vacía se queda vacía", limpiarRespuesta("\n\n  \n") === "");

  const mensajes = construirMensajes({ rel: "src/a.js", texto: fuente, start: 2, end: 3, instruccion: "ponlos en mayúsculas" });
  check("el prompt lleva el archivo", mensajes[1].content.includes("Archivo: src/a.js"));
  check("el prompt lleva la selección", mensajes[1].content.includes("dos\ntres"));
  check("el prompt lleva la instrucción", mensajes[1].content.includes("Instrucción: ponlos en mayúsculas"));
  check("el prompt no lleva herramientas", !("tools" in mensajes[0]) && mensajes.length === 2);

  const aplicado = aplicarRespuesta({ texto: fuente, start: 2, end: 3, respuesta: "```\nDOS\nTRES\n```" });
  check("aplica la respuesta con cerca", aplicado.texto === "uno\nDOS\nTRES\ncuatro\ncinco\n" && aplicado.propuesta === "DOS\nTRES");
  const borrado = aplicarRespuesta({ texto: fuente, start: 2, end: 3, respuesta: "BORRAR" });
  check("aplica el borrado", borrado.borra && borrado.texto === "uno\ncuatro\ncinco\n");

  const grande = `${"linea\n".repeat(400)}OBJETIVO\n${"cola\n".repeat(400)}`;
  const pedido = construirMensajes({ rel: "g.txt", texto: grande, start: 401, end: 401, instruccion: "x" });
  check("la selección se recorta", estimateTokens(pedido[1].content) < 2500);
  check("el contexto se recorta", pedido[1].content.includes("OBJETIVO"));

  return failures;
}

if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("chat/editar.mjs")) {
  const fallos = selfTest();
  if (fallos.length) {
    process.stderr.write(`FALLÓ:\n- ${fallos.join("\n- ")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("editar ok\n");
  }
}
