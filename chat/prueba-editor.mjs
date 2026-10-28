/**
 * Regresiones de la edición en línea (Ctrl+K), sin navegador, sin GPU y sin servidor:
 *   node chat/prueba-editor.mjs
 *
 * Cubre los hallazgos 9, 10 y 11 del reporte de Codex:
 *   · 9: la selección recortada por tokens no puede pisar el sufijo no enviado de una
 *        línea gigante (ni en el caso de una sola línea, ni con corte dentro de la
 *        última línea de varias, ni justo en un salto);
 *   · 10: una respuesta vacía o solo con espacios NO borra; el borrado exige BORRAR;
 *   · 11: CRLF/LF, archivos de finales mixtos y salto final se conservan.
 *
 * Además comprueba el contrato que consume /api/edit: `seleccion` es exactamente lo que
 * se envió al modelo, `start`/`end` son el rango real aplicado y los metadatos cuadran.
 */

import assert from "node:assert/strict";
import { estimateTokens, takeHeadByTokens } from "./context.mjs";
import {
  ErrorEdicion,
  MAX_SELECCION_TOKENS,
  RESPUESTA_VACIA,
  aplicarReemplazo,
  aplicarRespuesta,
  construirMensajes,
  contarLineas,
  limpiarRespuesta,
  rangoLineas,
  selfTest,
  seleccionEnviada,
} from "./editar.mjs";

/** @type {string[]} */
const failures = [];
/**
 * @param {string} name
 * @param {() => void} fn
 */
function test(name, fn) {
  try {
    fn();
    process.stdout.write(`ok ${name}\n`);
  } catch (err) {
    failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    process.stderr.write(`FALLO ${name}\n`);
  }
}

/** @param {{texto: string, start: number, end: number, respuesta: string}} args */
const aplicar = (args) => aplicarRespuesta(args);
const enviadaDe = (texto) => takeHeadByTokens(texto, MAX_SELECCION_TOKENS, estimateTokens);

test("el selfTest del módulo sigue verde", () => {
  assert.deepEqual(selfTest(), []);
});

test("limpiarRespuesta deja de verdad una respuesta vacía", () => {
  assert.equal(limpiarRespuesta(""), "");
  assert.equal(limpiarRespuesta("   \n \t\n"), "");
  assert.equal(limpiarRespuesta("```\n\n```"), "");
});

test("hallazgo 9: línea única mayor al límite con sufijo invisible", () => {
  const linea = `${"A".repeat(10_000)}FIN`;
  const enviada = enviadaDe(linea);
  assert.ok(enviada.length < linea.length, "el caso debe recortar de verdad");
  const r = aplicar({ texto: linea, start: 1, end: 1, respuesta: "CAMBIO" });
  assert.equal(r.seleccion, enviada, "seleccion devuelta = texto exacto enviado");
  assert.equal(r.texto, `CAMBIO${linea.slice(enviada.length)}`);
  assert.ok(r.texto.endsWith("FIN"), "el sufijo no enviado se conserva");
  assert.equal(r.recortada, true);
  assert.equal(r.start, 1);
  assert.equal(r.end, 1);
  assert.equal(r.lineasAplicadas, 1);
  assert.equal(r.caracteresConservados, linea.length - enviada.length);
  assert.equal(r.cambia, true);
  const prompt = construirMensajes({ rel: "g.txt", texto: linea, start: 1, end: 1, instruccion: "cambia" })[1].content;
  assert.ok(!prompt.includes("FIN"), "el prompt no puede enseñar el sufijo (si no, podría pisarlo)");
  assert.ok(prompt.includes("solo ves su principio"), "el prompt avisa de que la selección va recortada");
});

test("hallazgo 9: el modelo ve exactamente lo que luego se sustituye (contrato)", () => {
  const texto = `cabecera\n${"x".repeat(9000)}COLA\nultima\n`;
  const rango = rangoLineas(texto, 2, 2);
  const enviada = seleccionEnviada(texto, 2, 2).enviada;
  assert.ok(enviada.length > 0 && enviada.length < rango.cuerpo.length);
  const r = aplicar({ texto, start: 2, end: 2, respuesta: "REEMPLAZO" });
  assert.equal(r.seleccion, enviada);
  // El texto anterior al rango y el sufijo del rango quedan igual; el resto del archivo
  // (la línea siguiente) también.
  assert.equal(r.texto, texto.slice(0, rango.inicio) + "REEMPLAZO" + texto.slice(rango.inicio + enviada.length));
  assert.ok(r.texto.includes("\nultima\n"));
  assert.ok(r.texto.includes("COLA"));
});

test("hallazgo 9: varias líneas con corte dentro de la última", () => {
  const lineas = [];
  for (let i = 1; i <= 40; i += 1) lineas.push(`LINEA_${i}`);
  lineas.push(`${"Z".repeat(5000)}SUFIJO_ULTIMA`);
  lineas.push("LINEA_FINAL_INTACTA");
  const texto = `${lineas.join("\n")}\n`;
  const totalLineas = lineas.length; // 42
  // Se piden TODAS las líneas: el recorte cae dentro de la penúltima (la gigante), así
  // que el rango real termina antes de la última línea pedida.
  const r = aplicar({ texto, start: 1, end: totalLineas, respuesta: "NUEVO" });
  assert.equal(r.recortada, true);
  assert.ok(r.end < totalLineas, `end real (${r.end}) debe ser menor que el pedido (${totalLineas})`);
  assert.ok(r.texto.endsWith("SUFIJO_ULTIMA\nLINEA_FINAL_INTACTA\n"), "el sufijo de la línea cortada y la línea siguiente se conservan");
  assert.equal(r.texto, `NUEVO${texto.slice(r.seleccion.length)}`);
  assert.equal(r.start, 1);
  assert.equal(r.lineasAplicadas, contarLineas(texto.slice(0, r.seleccion.length)));
});

test("hallazgo 9: corte justo en un salto de línea (se conserva el resto tal cual)", () => {
  // Líneas de 90 caracteres: el recorte de 700 tokens (≈2100 caracteres) cae justo
  // antes de un salto y takeHeadByTokens retrocede al salto.
  const lineas = Array.from({ length: 60 }, (_, i) => `L${String(i + 1).padStart(2, "0")}_${"a".repeat(86)}`);
  lineas[30] = "OBJETIVO_QUE_NO_DEBE_DESAPARECER";
  const texto = `${lineas.join("\n")}\n`;
  const enviada = enviadaDe(lineas.join("\n"));
  assert.ok(enviada.length < lineas.join("\n").length, "el caso debe recortar de verdad");
  assert.ok(!enviada.endsWith("\n"), "takeHeadByTokens quita el salto del final del corte");
  assert.ok(texto.slice(enviada.length).startsWith("\n"), "el corte cae justo en un salto");
  const cabeceras = enviada.split("\n").length;
  const r = aplicar({ texto, start: 1, end: lineas.length, respuesta: "CABECERA_NUEVA" });
  assert.equal(r.end, cabeceras, "el rango real termina en la última línea enviada");
  assert.equal(r.texto, `CABECERA_NUEVA${texto.slice(enviada.length)}`);
  assert.ok(r.texto.includes("OBJETIVO_QUE_NO_DEBE_DESAPARECER"), "la línea objetivo sigue intacta");
  assert.equal(r.texto.endsWith("\n"), true, "el salto final del archivo se conserva");
});

test("hallazgo 10: respuesta vacía o solo espacios no borra (422 claro)", () => {
  const fuente = "uno\ndos\ntres\n";
  for (const respuesta of ["", " ", "\n\n", "  \t \n ", "```\n```"]) {
    assert.throws(
      () => aplicar({ texto: fuente, start: 2, end: 2, respuesta }),
      (err) => {
        assert.ok(err instanceof ErrorEdicion, "debe ser ErrorEdicion");
        assert.equal(err.codigo, RESPUESTA_VACIA);
        assert.equal(err.status, 422);
        assert.ok(err.motivo && err.motivo.length > 10, "el motivo debe explicar qué pasó");
        assert.ok(/vac[ií]a|espacios/i.test(err.motivo), "motivo claro");
        return true;
      },
      `respuesta ${JSON.stringify(respuesta)}`,
    );
  }
  // El helper de bajo nivel tampoco puede borrar con vacío.
  assert.throws(() => aplicarReemplazo(fuente, 2, 3, ""), (err) => err instanceof ErrorEdicion);
  assert.throws(() => aplicarReemplazo(fuente, 2, 3, "   "), (err) => err instanceof ErrorEdicion);
});

test("hallazgo 10: BORRAR solo con el centinela explícito", () => {
  const fuente = "uno\ndos\ntres\n";
  const r = aplicar({ texto: fuente, start: 2, end: 2, respuesta: "BORRAR" });
  assert.equal(r.borra, true);
  assert.equal(r.texto, "uno\ntres\n", "no queda una línea vacía");
  assert.equal(r.propuesta, "");
  assert.equal(r.start, 2);
  assert.equal(r.end, 2);
  const minusculas = aplicar({ texto: fuente, start: 2, end: 2, respuesta: "  borrar  " });
  assert.equal(minusculas.borra, true);
  const noCentinela = aplicar({ texto: fuente, start: 2, end: 2, respuesta: "BORRAR esto luego" });
  assert.equal(noCentinela.borra, false, "el texto que no es el centinela no borra");
  assert.equal(noCentinela.texto, "uno\nBORRAR esto luego\ntres\n");
});

test("hallazgo 10: BORRAR no toca lo que el modelo no vio", () => {
  const linea = `${"Q".repeat(4000)}COLA_QUE_NO_SE_VIO`;
  const r = aplicar({ texto: linea, start: 1, end: 1, respuesta: "BORRAR" });
  assert.equal(r.recortada, true);
  assert.ok(r.texto.endsWith("COLA_QUE_NO_SE_VIO"), "el sufijo no se borra");
  assert.ok(r.texto.length < linea.length);
});

test("hallazgo 11: LF, CRLF y salto final se conservan al reemplazar", () => {
  const reemplazo = "DOS\nTRES";
  assert.equal(aplicar({ texto: "uno\ndos\ntres\n", start: 2, end: 3, respuesta: reemplazo }).texto, "uno\nDOS\nTRES\n");
  assert.equal(aplicar({ texto: "uno\r\ndos\r\ntres\r\n", start: 2, end: 3, respuesta: reemplazo }).texto, "uno\r\nDOS\r\nTRES\r\n");
  // Editar la última línea no añade ni quita el salto final.
  assert.equal(aplicar({ texto: "uno\ndos\n", start: 2, end: 2, respuesta: "DOS" }).texto, "uno\nDOS\n");
  assert.equal(aplicar({ texto: "uno\ndos", start: 2, end: 2, respuesta: "DOS" }).texto, "uno\nDOS");
  // Un reemplazo de una línea en un archivo CRLF no introduce LF sueltos.
  const r = aplicar({ texto: "uno\r\ndos\r\ntres\r\n", start: 2, end: 2, respuesta: "DOS" });
  assert.equal(r.texto.split("\n").filter((l) => l.endsWith("\r")).length, 3, "las tres líneas conservan CRLF");
  assert.ok(!r.texto.replace(/\r\n/g, "").includes("\n"), "no queda ningún LF suelto");
});

test("hallazgo 11: archivo de finales mixtos no se normaliza", () => {
  const texto = "uno\r\ndos\ntres\r\n";
  const r = aplicar({ texto, start: 2, end: 2, respuesta: "DOS" });
  assert.equal(r.texto, "uno\r\nDOS\ntres\r\n", "los terminadores de las líneas no tocadas no se normalizan");
  const multi = aplicar({ texto, start: 2, end: 2, respuesta: "A\nB" });
  assert.equal(multi.texto, "uno\r\nA\nB\ntres\r\n", "el reemplazo usa el estilo de la línea que sustituye (LF aquí)");
});

test("borrado de líneas conserva CRLF y el salto final", () => {
  assert.equal(aplicar({ texto: "uno\r\ndos\r\ntres\r\n", start: 2, end: 3, respuesta: "BORRAR" }).texto, "uno\r\n");
  assert.equal(aplicar({ texto: "uno\ndos\ntres\n", start: 2, end: 3, respuesta: "BORRAR" }).texto, "uno\n");
  assert.equal(aplicar({ texto: "uno\ndos", start: 2, end: 2, respuesta: "BORRAR" }).texto, "uno\n");
});

test("una respuesta idéntica no cambia nada y no lanza", () => {
  const r = aplicar({ texto: "uno\ndos\ntres\n", start: 2, end: 2, respuesta: "dos" });
  assert.equal(r.cambia, false);
  assert.equal(r.texto, "uno\ndos\ntres\n");
});

test("rango fuera de límites se ajusta como el editor espera", () => {
  const r = aplicar({ texto: "uno\ndos\n", start: 99, end: 120, respuesta: "X" });
  assert.equal(r.start, 3);
  assert.equal(r.end, 3);
  assert.equal(r.texto, "uno\ndos\nX", "la línea fantasma final se rellena sin inventar saltos");
});

test("propiedad: ningún byte fuera del rango aplicado cambia (fuzz determinista)", () => {
  let semilla = 20261027;
  const azar = (n) => {
    semilla = (semilla * 1103515245 + 12345) % 2 ** 31;
    return semilla % n;
  };
  const eols = ["\n", "\r\n"];
  for (let caso = 0; caso < 250; caso += 1) {
    const eol = eols[azar(2)];
    const nLineas = 1 + azar(30);
    const lineas = [];
    for (let i = 0; i < nLineas; i += 1) {
      const largo = azar(10) === 0 ? 200 + azar(9000) : azar(120);
      lineas.push(`${"k".repeat(largo)}F${i}`);
    }
    const final = azar(2) === 0 ? eol : "";
    const texto = lineas.join(eol) + final;
    const total = contarLineas(texto);
    const desde = 1 + azar(total);
    const hasta = desde + azar(total - desde + 1);
    const respuesta = azar(4) === 0 ? "BORRAR" : `NUEVO_${caso}`;
    const r = aplicar({ texto, start: desde, end: hasta, respuesta });
    const rango = rangoLineas(texto, desde, hasta);
    const inicio = rango.inicio;
    const finBorrado = r.borra && !r.recortada ? rango.finLineaCompleta : inicio + r.seleccion.length;
    const esperado = texto.slice(0, inicio) + (r.borra ? "" : r.texto.slice(inicio, r.texto.length - (texto.length - finBorrado))) + texto.slice(finBorrado);
    assert.equal(r.texto, esperado, `caso ${caso}: el reemplazo solo toca el rango visto`);
    if (final && finBorrado < texto.length) assert.ok(r.texto.endsWith(eol), `caso ${caso}: el salto final se conserva`);
    else if (!final && !r.borra) assert.ok(!r.texto.endsWith("\n"), `caso ${caso}: no se inventa un salto final`);
    // Solo se pierde el prefijo visto de la selección: el sufijo no enviado sigue ahí.
    if (r.recortada) assert.ok(r.texto.endsWith(texto.slice(inicio + r.seleccion.length)), `caso ${caso}: sufijo intacto`);
  }
});

if (failures.length) {
  process.stderr.write(`\nFALLÓ:\n- ${failures.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("prueba editor ok\n");
}
