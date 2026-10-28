/**
 * Pruebas de chat/lecturas.mjs (hallazgos 4, 19 y 20 del reporte de codex):
 *  - no invitar a recorrer el archivo cuando el rango pedido se entregó entero;
 *  - informar de un recorte por presupuesto con el siguiente rango;
 *  - informar y permitir recuperar el sufijo de una línea gigante;
 *  - leer por streaming archivos enormes y no confundir límites.
 *
 *   node chat/prueba-lecturas.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodificarRecorteUtf8, describirLectura, leerTextoAcotado, parseLectura } from "./lecturas.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-lecturas-"));
const escribir = (rel, texto) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, texto);
  return abs;
};
const leer = (clave) => describirLectura({ root, clave });
let fallos = 0;
const check = (nombre, cond, detalle = "") => {
  if (cond) console.log(`ok    ${nombre}`);
  else {
    fallos += 1;
    console.error(`FALLO ${nombre}${detalle ? `: ${detalle}` : ""}`);
  }
};

try {
  // ---------- 1. archivo pequeño completo ----------
  escribir("corto.txt", "uno\ndos\ntres\n");
  const corto = leer("corto.txt");
  check("archivo pequeño se entrega entero", corto.includes("uno\ndos\ntres") && corto.includes("3 líneas"));
  check("archivo completo no invita a seguir leyendo", !corto.includes("faltan") && !corto.includes("recortado"));

  // ---------- 2. rango de líneas ya satisfecho (hallazgo 19) ----------
  const sesenta = Array.from({ length: 60 }, (_, i) => `LINEA_${i + 1}`).join("\n");
  escribir("sesenta.txt", sesenta);
  const una = leer("sesenta.txt:1-1");
  check("pedir una línea entrega esa línea", una.includes("LINEA_1") && !una.includes("LINEA_2"));
  check("pedir una línea no dice que falte leer el archivo", !/faltan las líneas/.test(una), una.split("\n").at(-1));
  check("pedir una línea informa de que el rango quedó completo", una.includes("rango pedido completo"));
  const rango = leer("sesenta.txt:10-20");
  check("un rango intermedio entrega solo ese rango", rango.includes("LINEA_10") && rango.includes("LINEA_20") && !rango.includes("LINEA_21"));
  check("un rango intermedio no pide recorrer el resto", !rango.includes("Para verlas llama leer"));
  const masAlla = leer("sesenta.txt:100-120");
  check("un rango más allá del final se explica", masAlla.includes("el archivo tiene 60 líneas"), masAlla);

  // ---------- 3. recorte por presupuesto (hallazgo 19) ----------
  const largo = Array.from({ length: 500 }, (_, i) => `F${i + 1}_${"x".repeat(24)}`).join("\n");
  escribir("largo.txt", largo);
  const recortado = leer("largo.txt:1-500");
  const faltan = recortado.match(/faltan las líneas (\d+)-500/);
  check("al recortar por presupuesto dice qué líneas faltan", Boolean(faltan), recortado.split("\n").at(-1));
  check("al recortar indica el siguiente rango", /desde \d+ y hasta 500/.test(recortado));
  if (faltan) {
    const desde = Number(faltan[1]);
    const siguiente = leer(`largo.txt:${desde}-500`);
    // El siguiente rango empieza exactamente donde se cortó; si tampoco cabe entero,
    // debe volver a decirlo (nunca saltarse líneas en silencio).
    check("el siguiente rango continúa sin huecos", siguiente.includes(`F${desde}_`) && (siguiente.includes("F500_") || /faltan las líneas \d+-500/.test(siguiente)), siguiente.split("\n").at(-1));
  }
  check("recortar por presupuesto no presenta la lectura como completa", !/Archivo completo/.test(recortado));

  // ---------- 4. línea gigante (hallazgo 20) ----------
  escribir("gigante.txt", `${"A".repeat(9000)}SUFIJO_NO_VISIBLE`);
  const g = leer("gigante.txt");
  check("una línea gigante se corta sin fingir que está completa", /se cortó a \d+ de 9017 caracteres/.test(g), g.split("\n")[0]);
  check("la primera lectura no incluye el sufijo", !g.includes("SUFIJO_NO_VISIBLE"));
  check("avisa de un recorte dentro de la línea", g.includes("recorte dentro de la línea 1"));
  const m = g.match(/ruta "gigante\.txt:1:c(\d+)-(\d+)"/);
  check("ofrece la sintaxis de columnas para el resto", Boolean(m), g.split("\n").at(-1));
  if (m) {
    const resto = leer(`gigante.txt:1:c${m[1]}-${m[2]}`);
    check("el rango de columnas recupera el sufijo", resto.includes("SUFIJO_NO_VISIBLE"), resto.slice(-120));
    check("el rango de columnas completo se marca como completo", resto.includes("rango pedido completo"));
  }
  const col = leer("gigante.txt:1:c6001-6100");
  check("un rango de columnas corto no incluye el sufijo", !col.includes("SUFIJO") && col.includes("caracteres 6001-6100"));
  check("un rango de columnas corto se marca completo", col.includes("rango pedido completo"));

  // ---------- 5. archivo vacío, binario, directorio, inexistente ----------
  escribir("vacio.txt", "");
  check("archivo vacío se informa", leer("vacio.txt").includes("vacío, 0 bytes"));
  escribir("binario.bin", Buffer.from([0, 1, 2, 3, 4]));
  check("archivo binario no se pega", leer("binario.bin").includes("binario"));
  fs.mkdirSync(path.join(root, "carpeta"));
  fs.writeFileSync(path.join(root, "carpeta", "a.txt"), "a");
  check("una carpeta se informa", leer("carpeta").includes("es una carpeta"));
  check("archivo inexistente se informa", leer("no-existe.txt").includes("no existe"));
  check("ruta fuera del proyecto se rechaza", leer("../secreto.txt").includes("ruta no permitida"));

  // ---------- 6. archivo enorme: streaming, sin cargarlo entero ----------
  const enorme = path.join(root, "enorme.txt");
  const fd = fs.openSync(enorme, "w");
  const bloque = `${"LINEA_ENORME_".repeat(4)}\n`.repeat(1000);
  for (let i = 0; i < 200; i += 1) fs.writeSync(fd, bloque);
  fs.closeSync(fd);
  check("el archivo enorme supera el tope de escaneo", fs.statSync(enorme).size > 8_000_000);
  const ini = Date.now();
  const enormeLeido = leer("enorme.txt:1-10");
  check("archivo enorme se lee por streaming", Date.now() - ini < 5000 && enormeLeido.includes("LINEA_ENORME_"));
  check("archivo enorme no finge conocer el total si no se recorrió", enormeLeido.includes("no se recorrió el resto del archivo"), enormeLeido.split("\n").at(-1));
  const enormeLargo = leer("enorme.txt:1-400");
  check("un rango grande de un archivo enorme se recorta y explica", /faltan las líneas \d+-400/.test(enormeLargo), enormeLargo.split("\n").at(-1));

  // ---------- 7. decodificación de un corte UTF-8 ----------
  const bytes = Buffer.from("café", "utf8");
  const corte = bytes.subarray(0, bytes.length - 1);
  const texto = decodificarRecorteUtf8(corte);
  check("un corte a mitad de carácter UTF-8 no produce carácter de reemplazo", texto === "caf" && !texto.includes("\uFFFD"), JSON.stringify(texto));
  check("decodificarRecorteUtf8 no toca texto completo", decodificarRecorteUtf8(bytes) === "café");

  // ---------- 8. leerTextoAcotado usa stat antes de leer ----------
  const acotado = leerTextoAcotado(path.join(root, "corto.txt"), 4);
  check("leerTextoAcotado marca el truncado", acotado.ok && acotado.truncado && acotado.bytes === 13, JSON.stringify(acotado));

  // ---------- 9. parser de claves ----------
  assert.deepEqual(parseLectura("a.py"), { rel: "a.py", desde: 0, hasta: 0, linea: 0, colDesde: 0, colHasta: 0 });
  assert.equal(parseLectura("a.py:10-20").desde, 10);
  assert.equal(parseLectura("a.py:10-").hasta, 0);
  assert.equal(parseLectura("a.py:7:c5-99").linea, 7);
  check("parser de claves", true);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

if (fallos) {
  console.error(`\nprueba-lecturas: ${fallos} fallo(s)`);
  process.exitCode = 1;
} else {
  console.log("\nprueba-lecturas: OK");
}
