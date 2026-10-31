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
  return { version, tensorCount, metadata, headerBytes: lector.pos, archivo, bytes: talla };
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
export const KV_RATIO = Object.freeze({
  f16: 1,
  bf16: 1,
  q8_0: 1.0625 / 2,
  q4_0: 0.5625 / 2,
});

/**
 * MiB de KV para una ventana y un tipo.
 * @param {number} ctx
 * @param {string} kv
 * @param {{kvF16BytesPorToken: number}} arq
 */
export function kvMiBModelo(ctx, kv, arq) {
  const ratio = KV_RATIO[kv];
  if (!ratio) throw new Error(`KV no admitido: ${kv}`);
  const fijo = Number(arq.kvFijoF16Bytes) || 0;
  return Math.ceil(((ctx * arq.kvF16BytesPorToken) + fijo) * ratio / MIB);
}

/**
 * Plan de motor para un modelo. Prioriza contexto grande con KV casi sin pérdida:
 *   1. si f16 aguanta ≥32k, se queda f16;
 *   2. si no, q8_0 hasta donde llegue (mínimo 16k);
 *   3. si no, q4_0 (mínimo 8k);
 *   4. si ni así, el mayor contexto posible por encima de 4k.
 *
 * `libreMiB` debe ser la VRAM libre real antes de arrancar (no la total).
 * `reservaMiB` cubre contexto CUDA, buffers de cómputo y el grafo; se puede
 * sustituir por el valor MEDIDO de un modelo concreto.
 *
 * @param {{
 *   bytes: number,
 *   kvF16BytesPorToken?: number,
 *   ctxNativo?: number,
 *   vision?: {bytes?: number} | false | null,
 *   draftBytes?: number,
 *   draftCtxNativo?: number,
 *   nombre?: string,
 * }} modelo
 * @param {{libreMiB?: number, vision?: boolean, reservaMiB?: number, margenMiB?: number, ctxMaximo?: number, pesosMiB?: number}} [opciones]
 */
export function planAuto(modelo, opciones = {}) {
  const libreMiB = Math.max(1024, Math.trunc(Number(opciones.libreMiB) || 7600));
  const margenMiB = Math.max(0, Math.trunc(Number(opciones.margenMiB) || 300));
  const reservaMiB = Math.max(256, Math.trunc(Number(opciones.reservaMiB) || 850));
  const ctxMaximo = Math.max(4096, Math.trunc(Number(opciones.ctxMaximo) || 131072));
  const bytes = Math.max(1, Math.trunc(Number(modelo.bytes) || 0));
  const kvF16 = Math.max(1, Math.trunc(Number(modelo.kvF16BytesPorToken) || 0));
  if (!kvF16) throw new Error("planAuto necesita kvF16BytesPorToken (lee el GGUF primero)");
  const kvFijoF16 = Math.max(0, Math.trunc(Number(modelo.kvFijoF16Bytes) || 0));
  const draftBytes = Math.max(0, Math.trunc(Number(modelo.draftBytes) || 0));
  const draftMiB = Math.ceil(draftBytes / MIB);
  const pesosMiB = Math.max(1, Math.trunc(Number(opciones.pesosMiB) || Math.ceil(bytes / MIB)));
  const ctxNativo = Math.max(4096, Math.trunc(Number(modelo.ctxNativo) || 32768));
  const draftCtx = Number(modelo.draftCtxNativo) > 0 ? Math.max(4096, Math.trunc(Number(modelo.draftCtxNativo))) : Infinity;
  const tope = Math.min(ctxMaximo, ctxNativo, draftCtx);
  const tieneVision = Boolean(modelo.vision && (modelo.vision.bytes || 0) > 0);
  const quiereVision = opciones.vision !== false && tieneVision;
  const visionBytes = quiereVision ? Math.max(0, Math.trunc(Number(modelo.vision.bytes) || 0)) : 0;

  /**
   * @param {boolean} visionEnGpu
   * @param {string} kv
   * @returns {{contexto: number, totalMiB: number, disponibleMiB: number}}
   */
  function calcular(visionEnGpu, kv) {
    const visionMiB = visionEnGpu ? Math.ceil(visionBytes / MIB) : 0;
    const kvFijoMiB = Math.ceil((kvFijoF16 * KV_RATIO[kv]) / MIB);
    const disponible = libreMiB - pesosMiB - reservaMiB - margenMiB - visionMiB - kvFijoMiB - draftMiB;
    const bytesPorToken = kvF16 * KV_RATIO[kv];
    const maxCtx = Math.floor((disponible * MIB) / bytesPorToken);
    const contexto = Math.max(0, Math.min(tope, Math.floor(maxCtx / 2048) * 2048));
    return {
      contexto,
      totalMiB: pesosMiB + kvMiBModelo(Math.max(0, contexto), kv, { kvF16BytesPorToken: kvF16, kvFijoF16Bytes: kvFijoF16 }) + reservaMiB + margenMiB + visionMiB + draftMiB,
      disponibleMiB: Math.max(0, disponible),
      kvFijoMiB,
    };
  }

  /**
   * Elige el plan de un modo de visión.
   * @param {boolean} visionEnGpu
   */
  function elegir(visionEnGpu) {
    const f16 = calcular(visionEnGpu, "f16");
    const q8 = calcular(visionEnGpu, "q8_0");
    const q4 = calcular(visionEnGpu, "q4_0");
    let kv = "q4_0";
    let elegido = q4;
    if (f16.contexto >= tope && q8.contexto >= tope) {
      // La ventana ya está limitada por el contexto nativo: se queda el KV más preciso.
      kv = "f16";
      elegido = f16;
    } else if (q8.contexto >= 16384) {
      // q8_0 es casi sin pérdida y da más ventana que f16. Es el default del proyecto.
      kv = "q8_0";
      elegido = q8;
    } else if (q4.contexto >= 8192) {
      // Solo cuando q8_0 ni siquiera llega a 16k se baja a q4_0.
      kv = "q4_0";
      elegido = q4;
    } else {
      const mayor = [f16, q8, q4].sort((a, b) => b.contexto - a.contexto)[0];
      if (mayor.contexto >= 4096) {
        kv = mayor === f16 ? "f16" : mayor === q8 ? "q8_0" : "q4_0";
        elegido = mayor;
      }
    }
    return {
      ok: elegido.contexto >= 4096,
      contexto: elegido.contexto,
      kv,
      vision: quiereVision,
      mmprojCPU: quiereVision && !visionEnGpu,
      visionEnGpu,
      pesosMiB,
      reservaMiB,
      margenMiB,
      visionMiB: visionEnGpu ? Math.ceil(visionBytes / MIB) : 0,
      draftMiB,
      kvMiB: kvMiBModelo(Math.max(0, elegido.contexto), kv, { kvF16BytesPorToken: kvF16, kvFijoF16Bytes: kvFijoF16 }),
      kvFijoMiB: elegido.kvFijoMiB,
      totalMiB: Math.ceil(elegido.totalMiB),
      libreMiB,
      disponibleMiB: Math.floor(elegido.disponibleMiB),
      ctxNativo,
      alternativas: {
        f16: { contexto: f16.contexto, totalMiB: Math.ceil(f16.totalMiB) },
        q8_0: { contexto: q8.contexto, totalMiB: Math.ceil(q8.totalMiB) },
        q4_0: { contexto: q4.contexto, totalMiB: Math.ceil(q4.totalMiB) },
      },
      motivo: elegido.contexto < 4096
        ? `no cabe ni a 4096 tokens: pesos ${pesosMiB} MiB + reserva ${reservaMiB} MiB + margen ${margenMiB} MiB > ${libreMiB} MiB libres`
        : `${kv} a ${elegido.contexto.toLocaleString("es-ES")} tokens; quedan ${Math.max(0, libreMiB - Math.ceil(elegido.totalMiB))} MiB de margen real`,
      nombre: String(modelo.nombre || ""),
    };
  }

  if (!quiereVision) return elegir(false);
  const gpu = elegir(false);
  const cpu = elegir(true);
  // El proyector en CPU libera su VRAM. Se usa si el proyector es grande y así
  // se gana contexto de verdad (regla medida con Ornith: 879 MiB = +39k tokens);
  // si el proyector es pequeño o no cambia la ventana, se queda en GPU (visión rápida).
  const ganaContexto = cpu.contexto >= gpu.contexto + 8192 && cpu.contexto >= 16384;
  const gpuNoLlega = gpu.contexto < 16384 && cpu.contexto >= 16384;
  return ganaContexto || gpuNoLlega ? cpu : gpu;
}

/**
 * Entrada de catálogo (formato `chat/modelo.json → catalogo.<clave>`) a partir
 * de un GGUF. No escribe nada; el llamador decide si la guarda.
 *
 * @param {{
 *   clave: string, archivo: string, ruta: string, bytes?: number, sha256?: string,
 *   nombre?: string, rol?: string, uso?: string, origen?: string, revision?: string,
 *   licencia?: string, fuente?: string, vision?: {archivo: string, bytes: number, sha256?: string, offload?: boolean},
 *   muestreo?: Record<string, unknown>, pensar?: {compatible: boolean, presupuesto?: number},
 *   agente?: {saltos?: number, avisos?: number}, toolcalls?: string,
 *   oculto?: boolean, draftPara?: string,
 *   draft?: {archivo: string, bytes: number, tokens?: number},
 * }} base
 * @param {{libreMiB?: number, reservaMiB?: number, margenMiB?: number, vision?: boolean}} [opciones]
 */
export function entradaCatalogoDesdeGGUF(base, opciones = {}) {
  const meta = leerMetadatosGGUF(base.ruta);
  const arq = arquitecturaDesdeGGUF(meta.metadata, { archivo: base.ruta });
  const plantilla = String(meta.metadata["tokenizer.chat_template"] || "");
  const bytes = Number(base.bytes) || meta.bytes;
  const vision = base.vision && base.vision.archivo
    ? {
        archivo: base.vision.archivo,
        bytes: Number(base.vision.bytes) || 0,
        ...(base.vision.sha256 ? { sha256: base.vision.sha256 } : {}),
        offload: base.vision.offload !== false,
        imageMaxTokens: 512,
        reservaMiB: Math.ceil((Number(base.vision.bytes) || 0) / MIB),
      }
    : false;
  const plan = planAuto({
    bytes,
    kvF16BytesPorToken: arq.kvF16BytesPorToken,
    kvFijoF16Bytes: arq.kvFijoF16Bytes,
    draftBytes: base.draft?.bytes || 0,
    draftCtxNativo: base.draft?.ctxNativo || 0,
    ctxNativo: arq.ctxNativo,
    vision,
    nombre: base.nombre || arq.nombre,
  }, { libreMiB: opciones.libreMiB, reservaMiB: opciones.reservaMiB, margenMiB: opciones.margenMiB, vision: opciones.vision });
  const nombre = String(base.nombre || arq.nombre || path.basename(base.archivo, ".gguf")).trim();
  const entrada = {
    clave: base.clave,
    archivo: base.archivo,
    nombre,
    bytes,
    ctxNativo: arq.ctxNativo,
    rol: String(base.rol || "modelo importado"),
    uso: String(base.uso || "Modelo local. El plan de motor se calcula con su arquitectura real."),
    toolcalls: String(base.toolcalls || "nativo"),
    agente: {
      saltos: Math.max(8, Math.trunc(Number(base.agente?.saltos) || 32)),
      avisos: Math.max(0, Math.trunc(Number(base.agente?.avisos) || 3)),
    },
    pensar: {
      compatible: base.pensar?.compatible === true,
      presupuesto: base.pensar?.compatible === true ? Math.max(512, Math.trunc(Number(base.pensar.presupuesto) || 2048)) : 0,
    },
    muestreo: base.muestreo || {
      codigo: { temperature: 0.6, top_p: 0.9, top_k: 20, min_p: 0.05, presence_penalty: 0, repeat_penalty: 1 },
      razonar: { temperature: 0.6, top_p: 0.9, top_k: 20, min_p: 0.05, presence_penalty: 0, repeat_penalty: 1 },
    },
    origen: String(base.origen || ""),
    ...(base.revision ? { revision: String(base.revision) } : {}),
    ...(base.sha256 ? { sha256: String(base.sha256) } : {}),
    licencia: String(base.licencia || "ver el repositorio de origen"),
    fuente: String(base.fuente || "hub"),
    ...(base.oculto === true ? { oculto: true } : {}),
    ...(base.draftPara ? { draftPara: String(base.draftPara) } : {}),
    ...(base.draft?.archivo ? { draft: { archivo: String(base.draft.archivo), bytes: Number(base.draft.bytes) || 0, tokens: Math.max(1, Math.trunc(Number(base.draft.tokens) || 4)), ctxNativo: Number(base.draft.ctxNativo) || 0 } } : {}),
    arquitectura: arq.arquitectura,
    capas: arq.capas,
    kvF16BytesPorToken: arq.kvF16BytesPorToken,
    kvFijoF16Bytes: arq.kvFijoF16Bytes,
    ventanaDeslizante: arq.ventanaDeslizante,
    servidor: {
      tipo: "gpu-completa",
      contexto: Math.min(arq.ctxNativo, 131072),
      capasAtencionCompleta: arq.capasAtencionCompleta,
      cabezasKV: arq.cabezasKV,
      dimCabeza: arq.dimCabeza,
      kvF16BytesPorToken: arq.kvF16BytesPorToken,
      kvFijoF16Bytes: arq.kvFijoF16Bytes,
      ...(base.draft?.archivo ? { draftModel: String(base.draft.archivo), draftTokens: Math.max(1, Math.trunc(Number(base.draft.tokens) || 4)), draftBytes: Number(base.draft.bytes) || 0 } : {}),
      reservaMiB: plan.reservaMiB,
      margenObjetivoMiB: Math.max(256, Math.min(6500, Math.ceil(bytes / MIB) + 900)),
      ubatch: 256,
      nota: `Plan automático: ${plan.motivo}. Arquitectura ${arq.arquitectura}, ${arq.capas} capas, KV f16 ${Math.round(arq.kvF16BytesPorToken / 1024)} KiB/token.`,
    },
    plan: {
      contexto: plan.contexto,
      kv: plan.kv,
      vision: plan.vision,
      mmprojCPU: plan.mmprojCPU,
      totalMiB: plan.totalMiB,
      draftMiB: plan.draftMiB,
      libreMiB: plan.libreMiB,
      reservaMiB: plan.reservaMiB,
      margenMiB: plan.margenMiB,
      calculado: new Date().toISOString(),
    },
  };
  if (plantilla) entrada.chat_template = plantilla;
  if (vision) {
    entrada.vision = {
      ...vision,
      contexto: Math.min(arq.ctxNativo, 131072),
      contextoMaximoManual: Math.min(arq.ctxNativo, 131072),
      offload: plan.mmprojCPU ? false : true,
    };
  }
  // El plan puede haber cambiado de visión GPU->CPU al elegir: se refleja.
  entrada.plan.vision = plan.vision;
  entrada.plan.mmprojCPU = plan.mmprojCPU;
  if (entrada.vision) entrada.vision.offload = !plan.mmprojCPU;
  return entrada;
}

/**
 * Nombre de archivo seguro para `models/`: sin rutas, sin caracteres raros y
 * terminado en .gguf. Un nombre inválido NO se corrige en silencio: se rechaza.
 * @param {string} nombre
 * @returns {string}
 */
export function nombreArchivoSeguro(nombre) {
  const crudo = String(nombre || "");
  if (crudo.includes("/") || crudo.includes("\\")) throw new Error(`nombre de archivo no válido: ${nombre}`);
  const base = path.basename(crudo);
  if (!base || base === "." || base === "..") {
    throw new Error(`nombre de archivo no válido: ${nombre}`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._()+@-]*\.gguf$/i.test(base)) {
    throw new Error(`nombre de archivo no permitido: ${nombre}`);
  }
  if (base.length > 180) throw new Error("nombre de archivo demasiado largo");
  return base;
}

/** @returns {string[]} */
export function selfTest() {
  /** @type {string[]} */
  const fallos = [];
  /** @param {string} nombre @param {boolean} cond */
  const check = (nombre, cond) => { if (!cond) fallos.push(nombre); };

  // Arquitectura tipo Qwen2.5/Qwen3: 32 capas, 8 cabezas KV, 128 de dimensión.
  const arq = arquitecturaDesdeGGUF({
    "general.architecture": "qwen3",
    "qwen3.block_count": 32,
    "qwen3.embedding_length": 4096,
    "qwen3.attention.head_count": 32,
    "qwen3.attention.head_count_kv": 8,
    "qwen3.attention.key_length": 128,
    "qwen3.attention.value_length": 128,
    "qwen3.context_length": 262144,
  });
  check("arquitectura: 32 capas de atención", arq.capasAtencionCompleta === 32);
  check("arquitectura: 8 cabezas KV", arq.cabezasKV === 8);
  check("arquitectura: 128 de dimensión", arq.dimCabeza === 128);
  check("KV f16 = 128 KiB/token", arq.kvF16BytesPorToken === 131072);
  check("KV q8 = 68 KiB/token", kvMiBModelo(16384, "q8_0", arq) === 1088);
  check("KV f16 a 32k = 4096 MiB", kvMiBModelo(32768, "f16", arq) === 4096);

  const plan = planAuto({
    bytes: Math.round(4.683 * 1024 * MIB),
    kvF16BytesPorToken: arq.kvF16BytesPorToken,
    ctxNativo: arq.ctxNativo,
    nombre: "prueba",
  }, { libreMiB: 7956 });
  check("plan para 7B Q4: elige q8_0", plan.kv === "q8_0");
  check("plan para 7B Q4: contexto entre 24k y 40k", plan.contexto >= 24576 && plan.contexto <= 40960);
  check("plan: no promete más VRAM que la libre", plan.totalMiB <= 7956);
  check("plan: el contexto es múltiplo de 2048", plan.contexto % 2048 === 0);

  const planCorto = planAuto({
    bytes: Math.round(2.5 * 1024 * MIB),
    kvF16BytesPorToken: 131072,
    ctxNativo: 262144,
  }, { libreMiB: 7956 });
  check("plan para 4B: consigue ≥60k con q8_0", planCorto.kv === "q8_0" && planCorto.contexto >= 61440);

  const planVision = planAuto({
    bytes: Math.round(3.15 * 1024 * MIB),
    kvF16BytesPorToken: 139264,
    ctxNativo: 131072,
    vision: { bytes: 851251104 },
  }, { libreMiB: 7956, vision: true });
  check("plan con visión: decide GPU o CPU sin pasarse", planVision.totalMiB <= 7956);
  check("plan con visión: conserva visión", planVision.vision === true);

  const planNoCabe = planAuto({
    bytes: 8 * 1024 * MIB,
    kvF16BytesPorToken: 131072,
    ctxNativo: 32768,
  }, { libreMiB: 7956 });
  check("un modelo de 8 GiB no cabe en 8 GiB", planNoCabe.ok === false);

  let rechazo = false;
  try { nombreArchivoSeguro("..\\..\\evil.gguf"); } catch { rechazo = true; }
  check("rechaza path traversal", rechazo);
  rechazo = false;
  try { nombreArchivoSeguro("modelo.exe"); } catch { rechazo = true; }
  check("rechaza extensiones que no son GGUF", rechazo);
  check("acepta un nombre normal", nombreArchivoSeguro("Qwen3-4B-Instruct-2507-Q4_K_M.gguf") === "Qwen3-4B-Instruct-2507-Q4_K_M.gguf");

  // Array por capa (modelo híbrido): solo las capas con cabezas KV cuentan.
  const hibrido = arquitecturaDesdeGGUF({
    "general.architecture": "qwen35",
    "qwen35.block_count": 4,
    "qwen35.embedding_length": 2048,
    "qwen35.attention.head_count": 16,
    "qwen35.attention.head_count_kv": [4, 0, 0, 4],
    "qwen35.attention.key_length": 128,
    "qwen35.attention.value_length": 128,
    "qwen35.context_length": 131072,
  });
  check("híbrido: solo 2 capas de atención completa", hibrido.capasAtencionCompleta === 2);
  check("híbrido: KV f16 = 4 KiB/token", hibrido.kvF16BytesPorToken === 4096);

  const conIntervalo = arquitecturaDesdeGGUF({
    "general.architecture": "qwen35",
    "qwen35.block_count": 33,
    "qwen35.embedding_length": 4096,
    "qwen35.attention.head_count": 16,
    "qwen35.attention.head_count_kv": 4,
    "qwen35.attention.key_length": 256,
    "qwen35.attention.value_length": 256,
    "qwen35.full_attention_interval": 4,
    "qwen35.context_length": 262144,
  });
  check("atención cada 4 capas: 8 capas completas", conIntervalo.capasAtencionCompleta === 8);
  check("atención cada 4 capas: KV f16 = 32 KiB/token", conIntervalo.kvF16BytesPorToken === 32768);

  const gemma = arquitecturaDesdeGGUF({
    "general.architecture": "gemma3",
    "gemma3.block_count": 34,
    "gemma3.embedding_length": 2560,
    "gemma3.attention.head_count": 8,
    "gemma3.attention.head_count_kv": 4,
    "gemma3.attention.key_length": 256,
    "gemma3.attention.value_length": 256,
    "gemma3.attention.sliding_window": 1024,
    "gemma3.context_length": 131072,
  });
  check("Gemma 3: 5 capas globales de 34", gemma.capasAtencionCompleta === 5);
  check("Gemma 3: KV f16 = 20 KiB/token", gemma.kvF16BytesPorToken === 20480);
  check("Gemma 3: KV fijo de ventana deslizante", gemma.kvFijoF16Bytes === 29 * 4096 * 1024);
  const planGemma = planAuto({
    bytes: Math.round(2.49 * 1024 * MIB),
    kvF16BytesPorToken: gemma.kvF16BytesPorToken,
    kvFijoF16Bytes: gemma.kvFijoF16Bytes,
    ctxNativo: 131072,
    vision: { bytes: 851251328 },
  }, { libreMiB: 7956, vision: true });
  check("Gemma 3: el plan aprovecha la ventana deslizante (≥100k)", planGemma.contexto >= 102400);
  check("Gemma 3: el plan no se pasa de VRAM", planGemma.totalMiB <= 7956);

  const planDraft = planAuto({
    bytes: Math.round(4.683 * 1024 * MIB),
    kvF16BytesPorToken: 57344,
    ctxNativo: 32768,
    draftBytes: 491400032,
    draftCtxNativo: 32768,
  }, { libreMiB: 7956 });
  check("draft: no supera el contexto del borrador", planDraft.contexto <= 32768);
  check("draft: suma su VRAM al total", planDraft.draftMiB === 469 && planDraft.totalMiB > 7000);
  check("draft: sigue cabiendo", planDraft.totalMiB <= 7956);

  return fallos;
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (entry === import.meta.url) {
  const fallos = selfTest();
  if (fallos.length) {
    process.stderr.write(`${fallos.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("model-plan ok\n");
  }
}
