/**
 * Lectura de metadatos GGUF y planificación de motor POR MODELO.
 *
 * Todo lo que decide si un modelo cabe (contexto, tipo de KV, proyector de visión
 * en GPU o CPU, reserva de VRAM) sale de aquí. No carga tensores ni usa la GPU:
 * lee la cabecera del GGUF y hace las cuentas con la VRAM libre real.
 *
 * Se usa desde:
 *   · chat/model-hub.mjs          al registrar un modelo descargado o importado;
 *   · chat/ui-server.mjs          al arrancar/cambiar de modelo en modo automático;
 *   · scripts/model-lab.mjs       al probar y optimizar cada modelo;
 *   · chat/modelo.mjs             para dimensionar el KV con la arquitectura real.
 *
 * `node chat/model-plan.mjs` corre las pruebas unitarias.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MIB = 1024 * 1024;
const GGUF_MAGIC = "GGUF";
const MAX_HEADER_BYTES = 64 * MIB;

/** Tipos de valor del bloque de metadatos de GGUF (spec v3). */
const TIPOS = {
  0: ["uint8", 1],
  1: ["int8", 1],
  2: ["uint16", 2],
  3: ["int16", 2],
  4: ["uint32", 4],
  5: ["int32", 4],
  6: ["float32", 4],
  7: ["bool", 1],
  8: ["string", 0],
  9: ["array", 0],
  10: ["uint64", 8],
  11: ["int64", 8],
  12: ["float64", 8],
};

/**
 * Lector secuencial sobre un Buffer con límites. Lanza un error legible si el
 * archivo está truncado (una descarga incompleta no debe parecer un GGUF válido).
 */
class LectorGGUF {
  /**
   * @param {Buffer} datos
   * @param {string} archivo
   */
  constructor(datos, archivo) {
    this.datos = datos;
    this.pos = 0;
    this.archivo = archivo;
  }

  /** @param {number} n */
  bytes(n) {
    if (this.pos + n > this.datos.length) {
      throw new Error(`GGUF truncado en ${this.archivo}: faltan ${this.pos + n - this.datos.length} bytes de cabecera`);
    }
    const out = this.datos.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  /** @param {string} fmt @param {number} n */
  numero(fmt, n) {
    const b = this.bytes(n);
    switch (fmt) {
      case "uint8": return b.readUInt8(0);
      case "int8": return b.readInt8(0);
      case "uint16": return b.readUInt16LE(0);
      case "int16": return b.readInt16LE(0);
      case "uint32": return b.readUInt32LE(0);
      case "int32": return b.readInt32LE(0);
      case "float32": return b.readFloatLE(0);
      case "bool": return b.readUInt8(0) !== 0;
      case "uint64": return Number(b.readBigUInt64LE(0));
      case "int64": return Number(b.readBigInt64LE(0));
      case "float64": return b.readDoubleLE(0);
      default: throw new Error(`tipo GGUF desconocido: ${fmt}`);
    }
  }

  string() {
    const n = this.numero("uint64", 8);
    if (n > 32 * MIB) throw new Error(`cadena GGUF absurda (${n} bytes) en ${this.archivo}`);
    return this.bytes(n).toString("utf8");
  }

  /**
   * @param {number} tipo
   * @param {number} [profundidad]
   * @returns {unknown}
   */
  valor(tipo, profundidad = 0) {
    const def = TIPOS[tipo];
    if (!def) throw new Error(`tipo GGUF ${tipo} desconocido en ${this.archivo}`);
    if (tipo === 8) return this.string();
    if (tipo === 9) {
      if (profundidad > 0) {
        // Un array dentro de un array no existe en GGUF v3; se rechaza para no
        // quedarse leyendo basura si el archivo está corrupto.
        throw new Error(`array anidado en ${this.archivo}`);
      }
      const elemento = this.numero("uint32", 4);
      const count = this.numero("uint64", 8);
      if (count > 8_000_000) throw new Error(`array GGUF absurdo (${count} elementos) en ${this.archivo}`);
      const defElem = TIPOS[elemento];
      if (!defElem) throw new Error(`array GGUF con tipo ${elemento} desconocido en ${this.archivo}`);
      // Los arrays de cadenas (tokens, merges) son los más grandes. Se leen para
      // avanzar, pero no se materializan si no son de interés.
      if (elemento === 8) {
        for (let i = 0; i < count; i += 1) this.string();
        return { array_length: count, tipo: "string" };
      }
      if (elemento === 9) throw new Error(`array de arrays en ${this.archivo}`);
      const tam = defElem[1];
      const out = [];
      const guardar = count <= 4096;
      for (let i = 0; i < count; i += 1) {
        const v = this.numero(defElem[0], tam);
        if (guardar) out.push(v);
      }
      return guardar ? out : { array_length: count, tipo: defElem[0] };
    }
    return this.numero(def[0], def[1]);
  }
}

/**
 * Lee la cabecera de un GGUF. Solo metadatos; no toca los tensores.
 * @param {string} archivo ruta al .gguf
 * @param {{maxBytes?: number}} [opciones]
 * @returns {{version: number, tensorCount: number, metadata: Record<string, unknown>, headerBytes: number, archivo: string, bytes: number}}
 */
export function leerMetadatosGGUF(archivo, opciones = {}) {
  const talla = fs.statSync(archivo).size;
  const limite = Math.min(talla, Math.max(1024, opciones.maxBytes || MAX_HEADER_BYTES));
  const fd = fs.openSync(archivo, "r");
  let datos;
  try {
    datos = Buffer.alloc(limite);
    fs.readSync(fd, datos, 0, limite, 0);
  } finally {
    fs.closeSync(fd);
  }
  const lector = new LectorGGUF(datos, archivo);
  const magia = lector.bytes(4).toString("ascii");
  if (magia !== GGUF_MAGIC) throw new Error(`no es un GGUF: ${archivo}`);
  const version = lector.numero("uint32", 4);
  if (version < 2 || version > 3) throw new Error(`versión GGUF no soportada (${version}): ${archivo}`);
  const tensorCount = Number(lector.numero("uint64", 8));
  const pares = Number(lector.numero("uint64", 8));
  if (pares > 200_000) throw new Error(`cabecera GGUF absurda (${pares} metadatos): ${archivo}`);
  /** @type {Record<string, unknown>} */
  const metadata = {};
  for (let i = 0; i < pares; i += 1) {
    const clave = lector.string();
    const tipo = lector.numero("uint32", 4);
    const valor = lector.valor(tipo);
    // Las plantillas de chat pueden ser enormes; se conservan. El resto de arrays
    // de tokenizer se reduce a su longitud para no inflar el registro local.
    metadata[clave] = valor;
  }

  // Tabla de tensores: hace falta para saber CUÁNTO pesa cada experto MoE y
  // decidir qué capas dejan de caber en la VRAM. Solo se leen nombres, formas y
  // offsets; no se toca ni un byte de los datos.
  /** @type {{nombre: string, dims: number[], tipo: number, offset: number, bytes: number}[]} */
  const tensores = [];
  for (let i = 0; i < tensorCount; i += 1) {
    const nombre = lector.string();
    const nDim = lector.numero("uint32", 4);
    if (nDim > 8) throw new Error(`tensor GGUF con ${nDim} dimensiones: ${archivo}`);
    /** @type {number[]} */
    const dims = [];
    for (let d = 0; d < nDim; d += 1) dims.push(Number(lector.numero("uint64", 8)));
    const tipo = lector.numero("uint32", 4);
    const offset = Number(lector.numero("uint64", 8));
    tensores.push({ nombre, dims, tipo, offset, bytes: 0 });
  }
  const alineacion = Math.max(1, Math.trunc(Number(metadata["general.alignment"]) || 32));
  const dataStart = Math.ceil(lector.pos / alineacion) * alineacion;
  // El tamaño exacto de cada tensor sale del offset del siguiente: no hay que
  // conocer los bloques de cada cuantización.
  const porOffset = [...tensores].sort((a, b) => a.offset - b.offset);
  for (let i = 0; i < porOffset.length; i += 1) {
    const t = porOffset[i];
    const fin = i + 1 < porOffset.length ? porOffset[i + 1].offset : talla - dataStart;
    t.bytes = Math.max(0, fin - t.offset);
  }
  return { version, tensorCount, metadata, tensores, dataStart, headerBytes: lector.pos, archivo, bytes: talla };
}

/**
 * Separa los pesos MoE de los densos. Los expertos son los tensores
 * `blk.N.ffn_{gate,up,down}_exps.weight`; todo lo demás (atención, embeddings,
 * router, expertos compartidos) se queda en la GPU. Devuelve null si el GGUF no
 * es MoE.
 * @param {{metadata: Record<string, unknown>, tensores?: {nombre: string, bytes: number}[]}} meta
 * @returns {{expertos: number, capas: number, bytes: number, porCapa: number[]} | null}
 */
export function analizarMoE(meta) {
  const arq = String(meta.metadata?.["general.architecture"] || "").trim();
  if (!arq) return null;
  const capas = Math.max(0, Math.trunc(Number(meta.metadata?.[`${arq}.block_count`]) || 0));
  const expertos = Math.max(0, Math.trunc(Number(meta.metadata?.[`${arq}.expert_count`]) || 0));
  if (capas < 1 || expertos < 2) return null;
  /** @type {number[]} */
  const porCapa = Array.from({ length: capas }, () => 0);
  /** @type {{inicio: number, bytes: number}[]} */
  const rangosPorCapa = Array.from({ length: capas }, () => ({ inicio: 0, bytes: 0 }));
  const dataStart = Math.max(0, Math.trunc(Number(meta.dataStart) || 0));
  let bytes = 0;
  for (const t of meta.tensores || []) {
    const m = /^blk\.(\d+)\.ffn_.*_exps\.weight$/.exec(t.nombre);
    if (!m) continue;
    const capa = Number(m[1]);
    if (capa < 0 || capa >= capas) continue;
    porCapa[capa] += Number(t.bytes) || 0;
    bytes += Number(t.bytes) || 0;
    const inicio = dataStart + Number(t.offset || 0);
    const fin = inicio + (Number(t.bytes) || 0);
    const r = rangosPorCapa[capa];
    if (!r.inicio || inicio < r.inicio) r.inicio = inicio;
    if (fin - r.inicio > r.bytes) r.bytes = fin - r.inicio;
  }
  if (bytes <= 0) return null;
  return { expertos, capas, bytes, porCapa, rangosPorCapa };
}

/** @param {unknown} v @param {number} porDefecto */
function num(v, porDefecto = 0) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
}

/**
 * Convierte un array de valores por capa (o un escalar) en un array de `capas`.
 * @param {unknown} v
 * @param {number} capas
 * @param {number} porDefecto
 * @returns {number[]}
 */
function porCapa(v, capas, porDefecto) {
  if (Array.isArray(v) && v.length) {
    const out = [];
    for (let i = 0; i < capas; i += 1) out.push(Math.max(0, Math.trunc(Number(v[i] ?? v[v.length - 1] ?? porDefecto))));
    return out;
  }
  const n = Math.max(0, Math.trunc(Number(v ?? porDefecto)));
  return Array.from({ length: capas }, () => n);
}

/**
 * Arquitectura práctica para dimensionar el KV y explicar el modelo.
 * `kvF16BytesPorToken` es la suma real por capa de K+V en f16; las demás
 * cuantizaciones se obtienen con la proporción de `modelo.json`.
 * @param {Record<string, unknown>} metadata
 * @param {{archivo?: string}} [info]
 */
export function arquitecturaDesdeGGUF(metadata, info = {}) {
  const arq = String(metadata["general.architecture"] || "").trim();
  if (!arq) throw new Error(`GGUF sin general.architecture: ${info.archivo || "?"}`);
  const capas = Math.max(1, Math.trunc(num(metadata[`${arq}.block_count`], 1)));
  const embedding = num(metadata[`${arq}.embedding_length`], 0);
  const cabezas = porCapa(metadata[`${arq}.attention.head_count`], capas, 0);
  const cabezasKV = porCapa(metadata[`${arq}.attention.head_count_kv`], capas, cabezas[0] || 0);
  const keyLength = porCapa(metadata[`${arq}.attention.key_length`], capas, cabezas[0] > 0 ? Math.round(embedding / cabezas[0]) : 0);
  const valueLength = porCapa(metadata[`${arq}.attention.value_length`], capas, keyLength[0] || 0);
  // Modelos híbridos (Qwen3.5/Gated DeltaNet): solo una de cada N capas tiene
  // atención completa; las demás son lineales y NO guardan KV por token. Si el
  // GGUF trae un array de cabezas KV por capa, ese array ya lo refleja.
  const intervalo = Math.max(1, Math.trunc(num(metadata[`${arq}.full_attention_interval`], 1)));
  const arrayKV = Array.isArray(metadata[`${arq}.attention.head_count_kv`]);
  // Gemma 3: 5 capas de ventana deslizante por cada capa global (patrón 6). El KV
  // de las locales no crece con el contexto: se guarda una ventana fija. Sin esto
  // el plan pedía 136 KiB/token y dejaba Gemma en 61k cuando cabe a 131k.
  const ventana = Math.max(0, Math.trunc(num(metadata[`${arq}.attention.sliding_window`], 0)));
  const intervaloGlobalGemma = arq === "gemma3" && ventana > 0 ? 6 : 1;
  let kvF16 = 0;
  let kvFijoF16 = 0;
  let capasAtencion = 0;
  let maxCabezasKV = 0;
  let maxDim = 0;
  for (let i = 0; i < capas; i += 1) {
    if (intervalo > 1 && !arrayKV && (i + 1) % intervalo !== 0) continue;
    if (cabezasKV[i] <= 0 || keyLength[i] <= 0) continue;
    const porCapa = cabezasKV[i] * (keyLength[i] + valueLength[i]) * 2;
    if (intervaloGlobalGemma > 1 && (i + 1) % intervaloGlobalGemma !== 0) {
      // Capa local de Gemma: KV acotado por la ventana (no por el contexto).
      kvFijoF16 += porCapa * ventana;
      continue;
    }
    capasAtencion += 1;
    maxCabezasKV = Math.max(maxCabezasKV, cabezasKV[i]);
    maxDim = Math.max(maxDim, keyLength[i], valueLength[i]);
    // K y V, dos bytes por elemento en f16.
    kvF16 += porCapa;
  }
  const ctxNativo = Math.max(4096, Math.trunc(num(metadata[`${arq}.context_length`], 32768)));
  const nombre = String(metadata["general.name"] || metadata["general.basename"] || "").trim();
  return {
    arquitectura: arq,
    capas,
    embedding,
    cabezas,
    capasAtencionCompleta: Math.max(1, capasAtencion),
    cabezasKV: Math.max(1, maxCabezasKV || cabezas[0] || 1),
    dimCabeza: Math.max(1, maxDim || (embedding ? Math.round(embedding / Math.max(1, cabezas[0])) : 128)),
    kvF16BytesPorToken: Math.max(1, Math.round(kvF16)),
    kvFijoF16Bytes: Math.max(0, Math.round(kvFijoF16)),
    ventanaDeslizante: ventana,
    ctxNativo,
    nombre,
  };
}

/** Proporción de bytes de cada KV respecto a f16 (K y V juntos). */
