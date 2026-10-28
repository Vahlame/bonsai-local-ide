/**
 * Edición en línea (Ctrl+K): recorta la selección, arma el mensaje para el modelo y
 * aplica el reemplazo. Sin DOM, sin red y sin GPU: todo se prueba en Node
 * (`node chat/editar.mjs` y `node chat/prueba-editor.mjs`).
 *
 * El servidor no escribe nada: devuelve el texto propuesto y la interfaz decide
 * (Aceptar / Rechazar) antes de guardar.
 *
 * Reglas de la aplicación del reemplazo (hallazgos 9, 10 y 11 del reporte):
 *   · Se trabaja con OFFSETS de carácter sobre el texto original. La selección que se
 *     le enseña al modelo puede quedar recortada por tokens (a mitad de una línea
 *     gigante); en ese caso SOLO se sustituye lo que el modelo vio y el sufijo no
 *     enviado se conserva byte a byte.
 *   · Los finales de línea originales (CRLF/LF, mixtos incluidos) no se normalizan: se
 *     conserva el terminador que había y el reemplazo multi-línea usa el mismo estilo.
 *   · El salto final del archivo se conserva (editar la última línea no lo quita).
 *   · Una respuesta vacía o solo con espacios NO borra la selección: lanza un
 *     `ErrorEdicion` con `codigo: "respuesta_vacia"` y `status: 422` (el servidor lo
 *     convierte en un 422). Para borrar hay que devolver el centinela `BORRAR`.
 */

import { estimateTokens, takeHeadByTokens, takeTailByTokens } from "./context.mjs";

/** Tope de la selección que se le enseña al modelo. */
export const MAX_SELECCION_TOKENS = 700;
/** Cuánto contexto de alrededor se manda (arriba y abajo de la selección). */
export const CONTEXTO_TOKENS = 500;
/** Centinela que el modelo devuelve para pedir un borrado explícito. */
export const CENTINELA_BORRAR = "BORRAR";

/**
 * Error de edición con un motivo apto para enseñar al usuario. El servidor lo traduce a
 * 422 cuando `status` es 422 (p. ej. una respuesta vacía), en vez de guardar nada.
 */
export class ErrorEdicion extends Error {
  /**
   * @param {string} codigo
   * @param {string} motivo
   */
  constructor(codigo, motivo) {
    super(motivo);
    this.name = "ErrorEdicion";
    /** @type {string} */
    this.codigo = codigo;
    /** @type {string} */
    this.motivo = motivo;
    /** @type {number} */
    this.status = 422;
  }
}

/** Código del error de respuesta vacía. */
export const RESPUESTA_VACIA = "respuesta_vacia";

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
 * Detecta el final de línea dominante de un texto: CRLF si hay más CRLF que LF
 * sueltos; LF en cualquier otro caso.
 * @param {string} texto
 * @returns {"\r\n" | "\n"}
 */
export function eolDe(texto) {
  const s = String(texto ?? "");
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) !== 10) continue;
    if (i > 0 && s.charCodeAt(i - 1) === 13) crlf += 1;
    else lf += 1;
  }
  return crlf > lf ? "\r\n" : "\n";
}

/**
 * Convierte los saltos de un texto al estilo pedido sin tocar el resto.
 * @param {string} texto
 * @param {"\r\n" | "\n"} eol
 * @returns {string}
 */
export function normalizarEol(texto, eol) {
  return String(texto ?? "").replace(/\r\n/g, "\n").split("\n").join(eol);
}

/**
 * Qué terminador usar para un reemplazo multi-línea:
 *   1. si la selección ya contiene saltos, el de su primer salto (así una selección
 *      CRLF no se convierte a LF);
 *   2. si es una sola línea, el terminador que tenía ESA línea (archivos mixtos);
 *   3. en la última línea sin salto, el dominante del archivo.
 * Las líneas no tocadas nunca se normalizan.
 * @param {string} seleccion
 * @param {string} original
 * @param {{finCuerpo?: number}} [rango]
 * @returns {"\r\n" | "\n"}
 */
function eolParaReemplazo(seleccion, original, rango) {
  const salto = String(seleccion ?? "").match(/\r\n|\n/);
  if (salto) return salto[0] === "\r\n" ? "\r\n" : "\n";
  const fuente = String(original ?? "");
  const finCuerpo = rango && Number.isInteger(rango.finCuerpo) ? rango.finCuerpo : -1;
  if (finCuerpo >= 0 && finCuerpo < fuente.length && fuente.charCodeAt(finCuerpo) === 10) {
    return finCuerpo > 0 && fuente.charCodeAt(finCuerpo - 1) === 13 ? "\r\n" : "\n";
  }
  return eolDe(fuente);
}

/**
 * Offset del primer carácter de una línea (1-based).
 * @param {string} texto
 * @param {number} linea
 * @returns {number}
 */
function inicioDeLinea(texto, linea) {
  let i = 0;
  for (let n = 1; n < linea; n += 1) {
    const nl = texto.indexOf("\n", i);
    if (nl < 0) return texto.length;
    i = nl + 1;
  }
  return i;
}

/**
 * Offset del final del CONTENIDO de una línea (sin su terminador CRLF/LF).
 * @param {string} texto
 * @param {number} linea
 * @returns {number}
 */
function finContenidoLinea(texto, linea) {
  const inicio = inicioDeLinea(texto, linea);
  const nl = texto.indexOf("\n", inicio);
  if (nl < 0) return texto.length;
  return nl > inicio && texto.charCodeAt(nl - 1) === 13 ? nl - 1 : nl;
}

/**
 * Offset justo después del terminador de una línea (para borrar la línea entera).
 * @param {string} texto
 * @param {number} linea
 * @returns {number}
 */
function finConTerminador(texto, linea) {
  const inicio = inicioDeLinea(texto, linea);
  const nl = texto.indexOf("\n", inicio);
  return nl < 0 ? texto.length : nl + 1;
}

/**
 * Número de línea (1-based) que contiene el offset `posicion`.
 * @param {string} texto
 * @param {number} posicion
 * @returns {number}
 */
function lineaEn(texto, posicion) {
  let n = 1;
  const tope = Math.max(0, Math.min(posicion, texto.length));
  for (let i = 0; i < tope; i += 1) if (texto.charCodeAt(i) === 10) n += 1;
  return n;
}

/**
 * Rango de carácter de las líneas `start..end` (1-based, inclusive), sin el
 * terminador de la última línea. `cuerpo` conserva los terminadores internos tal
 * cual (CRLF/LF), que es lo que se le enseña al modelo y lo que se sustituye.
 * @param {string} texto
 * @param {number} start
 * @param {number} end
 * @returns {{desde: number, hasta: number, inicio: number, finCuerpo: number, finLineaCompleta: number, cuerpo: string}}
 */
export function rangoLineas(texto, start, end) {
  const fuente = String(texto ?? "");
  const total = contarLineas(fuente);
  const desde = Math.max(1, Math.min(Math.floor(start) || 1, total));
  const hasta = Math.max(desde, Math.min(Math.floor(end) || desde, total));
  const inicio = inicioDeLinea(fuente, desde);
  const finCuerpo = finContenidoLinea(fuente, hasta);
  const finLineaCompleta = finConTerminador(fuente, hasta);
  return { desde, hasta, inicio, finCuerpo, finLineaCompleta, cuerpo: fuente.slice(inicio, finCuerpo) };
}

/**
 * Lo que se manda al modelo: el principio de la selección mientras quepa en
 * `MAX_SELECCION_TOKENS`. `enviada` es SIEMPRE un prefijo exacto de `cuerpo`, así que
 * `inicio + enviada.length` marca en el texto original el final de lo sustituible.
 * @param {string} texto
 * @param {number} start
 * @param {number} end
 * @returns {{desde: number, hasta: number, inicio: number, finCuerpo: number, finLineaCompleta: number, cuerpo: string, enviada: string, recortada: boolean}}
 */
export function seleccionEnviada(texto, start, end) {
  const rango = rangoLineas(texto, start, end);
  const enviada = takeHeadByTokens(rango.cuerpo, MAX_SELECCION_TOKENS, estimateTokens);
  return { ...rango, enviada, recortada: enviada.length < rango.cuerpo.length };
}

/**
 * Reemplaza las líneas `start..end` (1-based) por `reemplazo`, conservando el
 * terminador de la última línea y el salto final del archivo. Un reemplazo vacío NO
 * borra: para borrar hay que usar el centinela `BORRAR` (explícito).
 *
 * Esta función reemplaza líneas completas (sin recorte por tokens); la ruta segura de
 * Ctrl+K, que respeta lo que el modelo no llegó a ver, es `aplicarRespuesta`.
 * @param {string} texto
 * @param {number} start
 * @param {number} end
 * @param {string} reemplazo
 * @returns {string}
 */
export function aplicarReemplazo(texto, start, end, reemplazo) {
  const bruto = String(reemplazo ?? "");
  const borra = /^\s*BORRAR\s*$/i.test(bruto);
  if (!borra && !bruto.trim()) {
    throw new ErrorEdicion(
      RESPUESTA_VACIA,
      "El reemplazo está vacío o solo tiene espacios: no se borra la selección. Para borrar hace falta el centinela BORRAR y confirmarlo.",
    );
  }
  const original = String(texto ?? "");
  const rango = rangoLineas(original, start, end);
  const nuevo = borra ? "" : normalizarEol(bruto, eolParaReemplazo(rango.cuerpo, original, rango));
  const fin = borra ? rango.finLineaCompleta : rango.finCuerpo;
  return original.slice(0, rango.inicio) + nuevo + original.slice(fin);
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
  const { desde, hasta, enviada, recortada } = seleccionEnviada(fuente, start, end);
  const { antes, despues } = contextoAlrededor(fuente, start, end);
  const partes = [`Archivo: ${rel}`];
  if (antes) partes.push(`Líneas anteriores:\n${antes}`);
  partes.push(`Selección a reemplazar (líneas ${desde}-${hasta}):\n${enviada}`);
  if (recortada) {
    partes.push(
      "(La selección es más larga que el límite de tokens: solo ves su principio. Devuelve únicamente " +
        "el reemplazo de lo que ves; el resto de la selección no se va a tocar.)",
    );
  }
  if (despues) partes.push(`Líneas siguientes:\n${despues}`);
  partes.push(`Instrucción: ${String(instruccion ?? "").trim()}`);
  return [
    { role: "system", content: EDIT_RULES },
    { role: "user", content: partes.join("\n\n") },
  ];
}

/**
 * Aplica la respuesta del modelo al texto completo y devuelve el resultado con el
 * rango real que se sustituyó. Falla (en vez de borrar) si la respuesta viene vacía.
 *
 * @param {{texto: string, start: number, end: number, respuesta: string}} args
 * @returns {{propuesta: string, texto: string, borra: boolean, cambia: boolean, start: number, end: number, seleccion: string, lineasAplicadas: number, lineasNuevas: number, recortada: boolean, caracteresConservados: number}}
 */
export function aplicarRespuesta({ texto, start, end, respuesta }) {
  const propuesta = limpiarRespuesta(respuesta);
  if (!propuesta) {
    throw new ErrorEdicion(
      RESPUESTA_VACIA,
      "El modelo devolvió una respuesta vacía o solo con espacios. No se ha borrado nada; vuelve a intentarlo o pide el borrado de forma explícita (BORRAR) para confirmarlo.",
    );
  }
  const original = String(texto ?? "");
  const rango = seleccionEnviada(original, start, end);
  const borra = /^\s*BORRAR\s*$/i.test(propuesta);
  const eol = eolParaReemplazo(rango.enviada, original, rango);
  const reemplazo = borra ? "" : normalizarEol(propuesta, eol);
  // Si no hubo recorte, el borrado se lleva también el terminador de la última línea
  // (si existe) para no dejar una línea en blanco en su lugar. Con recorte NUNCA se
  // toca nada que el modelo no haya visto: solo los caracteres de `enviada`.
  const fin = borra && !rango.recortada ? rango.finLineaCompleta : rango.inicio + rango.enviada.length;
  const nuevo = original.slice(0, rango.inicio) + reemplazo + original.slice(fin);
  const cambiado = nuevo !== original;
  const finEnviado = rango.inicio + rango.enviada.length;
  const hastaReal = rango.enviada.length ? Math.max(rango.desde, lineaEn(original, finEnviado)) : rango.desde;
  return {
    propuesta: borra ? "" : propuesta,
    texto: nuevo,
    borra,
    cambia: cambiado,
    start: rango.desde,
    end: hastaReal,
    seleccion: rango.enviada,
    lineasAplicadas: rango.enviada.length ? Math.max(1, hastaReal - rango.desde + 1) : cambiado ? 1 : 0,
    lineasNuevas: borra ? 0 : reemplazo.split("\n").length,
    recortada: rango.recortada,
    caracteresConservados: rango.cuerpo.length - rango.enviada.length,
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
  /**
   * @param {() => unknown} fn
   * @returns {boolean} true si lanzó
   */
  const throws = (fn) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };
  const fuente = "uno\ndos\ntres\ncuatro\ncinco\n";

  check("recorta la selección", recorteLineas(fuente, 2, 3) === "dos\ntres");
  check("una sola línea", recorteLineas(fuente, 4, 4) === "cuatro");
  check("más allá del final devuelve vacío", recorteLineas(fuente, 9, 12) === "");
  check("start mayor que end se ajusta", recorteLineas(fuente, 4, 2) === "cuatro");

  check("reemplaza la selección", aplicarReemplazo(fuente, 2, 3, "DOS Y TRES") === "uno\nDOS Y TRES\ncuatro\ncinco\n");
  check("varias líneas nuevas", aplicarReemplazo("a\nb\nc", 2, 2, "x\ny") === "a\nx\ny\nc");
  check("BORRAR borra la selección", aplicarReemplazo("a\nb\nc", 2, 2, "BORRAR") === "a\nc");
  check("respeta el final de archivo", aplicarReemplazo("a\nb\n", 2, 2, "B") === "a\nB\n");
  check("no quita el salto final al no tocar la última línea", aplicarReemplazo(fuente, 1, 1, "UNO") === "UNO\ndos\ntres\ncuatro\ncinco\n");
  check("CRLF: conserva el terminador al reemplazar una línea", aplicarReemplazo("uno\r\ndos\r\ntres\r\n", 2, 2, "DOS") === "uno\r\nDOS\r\ntres\r\n");
  check("CRLF: un reemplazo multilínea usa CRLF", aplicarReemplazo("uno\r\ndos\r\ntres\r\n", 2, 2, "A\nB") === "uno\r\nA\r\nB\r\ntres\r\n");
  check("sin salto final: no inventa uno", aplicarReemplazo("a\nb", 2, 2, "B") === "a\nB");
  check("vacío ya no borra", throws(() => aplicarReemplazo("a\nb\nc", 2, 2, "")));
  check("solo espacios ya no borra", throws(() => aplicarReemplazo("a\nb\nc", 2, 2, "   \n  ")));

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
  check("metadatos del rango aplicado", aplicado.start === 2 && aplicado.end === 3 && aplicado.lineasAplicadas === 2 && aplicado.seleccion === "dos\ntres");
  const borrado = aplicarRespuesta({ texto: fuente, start: 2, end: 3, respuesta: "BORRAR" });
  check("aplica el borrado", borrado.borra && borrado.texto === "uno\ncuatro\ncinco\n");
  check("una respuesta vacía no borra", throws(() => aplicarRespuesta({ texto: fuente, start: 2, end: 3, respuesta: "  \n " })));
  check("el error de respuesta vacía es 422", (() => {
    try {
      aplicarRespuesta({ texto: fuente, start: 2, end: 3, respuesta: "" });
      return false;
    } catch (err) {
      return err instanceof ErrorEdicion && err.codigo === RESPUESTA_VACIA && err.status === 422;
    }
  })());

  const grande = `${"linea\n".repeat(400)}OBJETIVO\n${"cola\n".repeat(400)}`;
  const pedido = construirMensajes({ rel: "g.txt", texto: grande, start: 401, end: 401, instruccion: "x" });
  check("la selección se recorta", estimateTokens(pedido[1].content) < 2500);
  check("el contexto se recorta", pedido[1].content.includes("OBJETIVO"));

  // Hallazgo 9: el sufijo no enviado de una línea gigante no se pisa.
  const gigante = `${"A".repeat(6000)}SUFIJO`;
  const corte = aplicarRespuesta({ texto: gigante, start: 1, end: 1, respuesta: "CAMBIO" });
  const enviadaGigante = takeHeadByTokens(gigante, MAX_SELECCION_TOKENS, estimateTokens);
  check("gigante: conserva el sufijo no enviado", corte.texto === `CAMBIO${gigante.slice(enviadaGigante.length)}`);
  check("gigante: el sufijo sigue presente", corte.texto.endsWith("SUFIJO"));
  check("gigante: marca el recorte", corte.recortada && corte.caracteresConservados === gigante.length - enviadaGigante.length && corte.seleccion === enviadaGigante);
  check("gigante: el prompt no lleva el sufijo", !construirMensajes({ rel: "g.txt", texto: gigante, start: 1, end: 1, instruccion: "x" })[1].content.includes("SUFIJO"));

  // Hallazgo 11: CRLF y salto final.
  const crlf = "uno\r\ndos\r\ntres\r\n";
  const crlfEdit = aplicarRespuesta({ texto: crlf, start: 2, end: 2, respuesta: "DOS" });
  check("CRLF: no mezcla finales", crlfEdit.texto === "uno\r\nDOS\r\ntres\r\n");
  const crlfMulti = aplicarRespuesta({ texto: crlf, start: 2, end: 3, respuesta: "DOS\nTRES" });
  check("CRLF: reemplazo multilínea conserva CRLF", crlfMulti.texto === "uno\r\nDOS\r\nTRES\r\n");
  const sinFinal = aplicarRespuesta({ texto: "uno\ndos", start: 2, end: 2, respuesta: "DOS" });
  check("sin salto final: se conserva", sinFinal.texto === "uno\nDOS");
  const conFinal = aplicarRespuesta({ texto: "uno\ndos\n", start: 2, end: 2, respuesta: "DOS" });
  check("con salto final: se conserva", conFinal.texto === "uno\nDOS\n");
  const crlfBorra = aplicarRespuesta({ texto: crlf, start: 2, end: 3, respuesta: "BORRAR" });
  check("CRLF: borrado sin línea en blanco", crlfBorra.texto === "uno\r\n");

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
