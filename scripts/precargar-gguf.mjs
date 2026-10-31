#!/usr/bin/env node
/**
 * Precalienta la page cache de Windows con los expertos que se quedan en RAM.
 *
 * Leer el GGUF entero gasta cache en los expertos que van a la GPU. Este script
 * usa los rangos por capa del plan MoE y lee solo las capas que llama.cpp va a
 * ejecutar en CPU (las N primeras), que son las que se leen en cada token.
 *
 * No reserva memoria: lee por trozos y los descarta. Windows conserva las
 * páginas en la standby list. Solo tiene sentido si esas capas caben en RAM.
 *
 *   node scripts/precargar-gguf.mjs --model qwen36-35b-a3b --layers 22
 *   node scripts/precargar-gguf.mjs --model qwen36-35b-a3b --all
 *   node scripts/precargar-gguf.mjs --file models/Modelo.gguf
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODELO } from "../chat/modelo.mjs";
import { fusionarCatalogo, leerRegistro } from "../chat/model-hub.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const args = process.argv.slice(2);
const arg = (n, d = "") => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const bandera = (n) => args.includes(`--${n}`);
const clave = arg("model", "");
const todas = bandera("all");
let archivo = arg("file", "");
let capas = Math.max(0, Math.trunc(Number(arg("layers", "0")) || 0));
let rangos = [];
if (!archivo && clave) {
  fusionarCatalogo();
  const e = MODELO.catalogo?.[clave];
  if (!e?.archivo) {
    process.stderr.write(`Modelo desconocido o sin archivo: ${clave}\n`);
    process.exit(2);
  }
  archivo = path.join(PROJECT, "models", e.archivo);
  const moe = leerRegistro().modelos?.[clave]?.servidor?.moe || e.servidor?.moe;
  if (!capas) capas = Number(moe?.nCpuMoe) || 0;
  if (!todas && Array.isArray(moe?.rangosPorCapa) && moe.rangosPorCapa.length) {
    rangos = moe.rangosPorCapa.slice(0, capas).filter((r) => Number(r?.bytes) > 0);
  }
}
if (!archivo || !fs.existsSync(archivo)) {
  process.stderr.write(`No existe el GGUF: ${archivo || "(falta --model/--file)"}\n`);
  process.exit(2);
}
const talla = fs.statSync(archivo).size;
const bufer = Buffer.allocUnsafe(8 * 1024 * 1024);
const fd = fs.openSync(archivo, "r");
const inicio = Date.now();
let leidos = 0;
/**
 * @param {number} desde
 * @param {number} cuantos
 */
function leerRango(desde, cuantos) {
  let pos = Math.max(0, desde);
  const fin = Math.min(talla, desde + cuantos);
  while (pos < fin) {
    const n = fs.readSync(fd, bufer, 0, Math.min(bufer.length, fin - pos), pos);
    if (n <= 0) break;
    pos += n;
    leidos += n;
  }
}
try {
  if (rangos.length) {
    for (const r of rangos) leerRango(Number(r.inicio) || 0, Number(r.bytes) || 0);
  } else {
    // Sin rangos (modelo antiguo o --all): lectura secuencial completa.
    leerRango(0, talla);
  }
} finally {
  fs.closeSync(fd);
}
const s = (Date.now() - inicio) / 1000;
process.stdout.write(JSON.stringify({
  archivo,
  bytes: leidos,
  capas: rangos.length || "todas",
  segundos: Math.round(s * 10) / 10,
  mibPorSegundo: Math.round((leidos / 1048576 / Math.max(0.1, s)) * 10) / 10,
}) + "\n");
