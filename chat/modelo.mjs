/**
 * Datos del modelo y cuentas de memoria (todo sale de modelo.json).
 * Evita pasarse de VRAM: si se pasa, Windows desborda a la RAM y la velocidad cae
 * de ~30 t/s a ~3 t/s. También fija el muestreo que recomienda el fabricante.
 * `node chat/modelo.mjs` corre las pruebas; `--tabla [MiB libres] [-ub]` imprime la tabla de memoria.
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const MIB = 1024 * 1024;

export const MODELO = JSON.parse(fs.readFileSync(new URL("./modelo.json", import.meta.url), "utf8"));

/**
 * Arquitectura que dimensiona el KV para un modelo del catálogo
 * (`catalogo.<clave>.servidor`) o, sin clave, la histórica de `modelo` (Bonsai).
 * Ornith usa 8 capas de atención completa (no 16): su KV cuesta la mitad.
 * @param {string} [clave] clave del catálogo; vacía = arquitectura global del Bonsai
 * @returns {{capasAtencionCompleta: number, cabezasKV: number, dimCabeza: number}}
 */
export function arquitecturaDe(clave = "") {
  if (clave) {
    const servidor = MODELO.catalogo?.[clave]?.servidor;
    if (!servidor || !(servidor.capasAtencionCompleta > 0) || !(servidor.cabezasKV > 0) || !(servidor.dimCabeza > 0)) {
      throw new Error(`modelo sin arquitectura de servidor en el catálogo: ${clave}`);
    }
    return servidor;
  }
  return MODELO.modelo;
}

/**
 * @param {string} tipo f16 | q8_0 | q4_0
 * @param {string} [clave] clave del catálogo; sin ella se usa la arquitectura del Bonsai global
 * @returns {number} bytes de caché KV por token (solo las capas de atención completa)
 */
export function kvBytesPorToken(tipo, clave = "") {
  const bytes = MODELO.kv.bytesPorElemento?.[tipo];
  if (!bytes) throw new Error(`tipo de KV no admitido: ${tipo}`);
  const m = arquitecturaDe(clave);
  return m.capasAtencionCompleta * m.cabezasKV * m.dimCabeza * 2 * bytes;
}

/**
 * @param {number} ctx
 * @param {string} tipo
 * @param {string} [clave] clave del catálogo
 * @returns {number} MiB, redondeando hacia arriba
 */
export function kvMiB(ctx, tipo, clave = "") {
  return Math.ceil((ctx * kvBytesPorToken(tipo, clave)) / MIB);
}

/**
 * Buffer de cómputo: tiene un suelo y, con contexto largo, crece con la ventana (la atención
 * descuantiza el KV a f16 en un temporal). El efecto de -ub se midió entre 256 y 1024.
 * @param {number} ctx
 * @param {number} [ubatch]
 * @returns {number} MiB
 */
export function computoMiB(ctx, ubatch = 256) {
  const u = MODELO.vram.ubatch;
  const extraUb = (Math.max(u.referencia, ubatch) - u.referencia) * u.extraPorTokenMiB;
  return computoCtxMiB(ctx) + extraUb;
}

/**
 * La parte del buffer de cómputo que depende de la ventana (la que se duplica al arrancar).
 * @param {number} ctx
 * @returns {number} MiB
 */
export function computoCtxMiB(ctx) {
  const c = MODELO.vram.computo;
  return Math.max(c.pisoMiB, c.baseMiB + (c.porMilTokensMiB * ctx) / 1024);
}

/**
 * VRAM en uso una vez cargado el modelo (lo que marca nvidia-smi).
 * Sin clave reproduce la calibración histórica del Bonsai (Bonsai global); con clave usa la
 * cuenta conservadora del catálogo: pesos del GGUF + KV de SU arquitectura + reservas.
 * @param {{ctx: number, kv: string, ubatch?: number, clave?: string, vision?: boolean}} args
 * @returns {number} MiB
 */
export function estimarVramMiB({ ctx, kv, ubatch = 256, clave = "", vision = false }) {
  if (clave) return estimarVramModeloMiB({ clave, ctx, kv, vision });
  const v = MODELO.vram;
  return Math.ceil(v.pesosMiB + v.estadoRecurrenteMiB + v.fijoCudaMiB + kvMiB(ctx, kv) + computoMiB(ctx, ubatch));
}

/**
 * @param {string} clave clave del catálogo
 * @returns {number} MiB de los pesos que van a la GPU (GGUF redondeado hacia arriba)
 */
export function pesosCatalogoMiB(clave) {
  const bytes = Number(MODELO.catalogo?.[clave]?.bytes);
  if (!Number.isFinite(bytes) || bytes <= 0) throw new Error(`modelo sin bytes en el catálogo: ${clave}`);
  return Math.ceil(bytes / MIB);
}

/**
 * @param {string} clave clave del catálogo
 * @returns {number} MiB de reserva del perfil `catalogo.<clave>.servidor`
 */
export function reservaServidorMiB(clave) {
  const perfil = MODELO.catalogo?.[clave]?.servidor;
  if (!perfil || perfil.tipo !== "gpu-completa") throw new Error(`modelo sin perfil de GPU completa: ${clave}`);
  const reserva = Number(perfil.reservaMiB);
  if (!Number.isFinite(reserva) || reserva < 0) throw new Error(`modelo sin reservaMiB en el catálogo: ${clave}`);
  return reserva;
}

/**
 * @param {string} clave clave del catálogo
 * @returns {number} MiB que ocupa el proyector de visión en GPU (0 si no se descarga en GPU)
 */
export function reservaVisionMiB(clave) {
  const vision = MODELO.catalogo?.[clave]?.vision;
  if (!vision || vision.offload !== true) return 0;
  return Math.max(0, Number(vision.reservaMiB) || 0);
}

/**
 * VRAM conservadora para ARRANCAR un modelo del catálogo con GPU completa:
 * pesos del GGUF + KV de su arquitectura + reserva del perfil de servidor + reserva de visión.
 * Es la misma cuenta que hace scripts/start-gpu-model.ps1 y la que decide si se lanza.
 * @param {{clave: string, ctx: number, kv: string, vision?: boolean}} args
 * @returns {number} MiB
 */
export function estimarVramModeloMiB({ clave, ctx, kv, vision = false }) {
  const visionMiB = vision ? reservaVisionMiB(clave) : 0;
  return Math.ceil(pesosCatalogoMiB(clave) + kvMiB(ctx, kv, clave) + reservaServidorMiB(clave) + visionMiB);
}

/**
 * VRAM que hace falta libre para ARRANCAR: al iniciar se reserva a la vez dos veces la parte del
 * buffer de cómputo que depende de la ventana, así que el pico es el uso estable más esa parte.
 * Es lo que decide si el servidor arranca (81920 arranca con 7956 MiB libres; 83968 falla; y
 * -ub 1024 con 64k arrancó con 7947 libres porque su extra de -ub no se duplica).
 * @param {{ctx: number, kv: string, ubatch?: number}} args
 * @returns {number} MiB
 */
export function picoArranqueMiB({ ctx, kv, ubatch = 256 }) {
  return Math.ceil(estimarVramMiB({ ctx, kv, ubatch }) + computoCtxMiB(ctx));
}

/**
 * @param {{ctx: number, kv: string, ubatch?: number, libreMiB: number}} args
 * @returns {boolean}
 */
export function cabe({ ctx, kv, ubatch = 256, libreMiB }) {
  return picoArranqueMiB({ ctx, kv, ubatch }) + MODELO.vram.margenMiB <= libreMiB;
}

/**
 * Mayor ventana (múltiplo de `paso`) que arranca con la VRAM libre.
 * @param {{libreMiB: number, kv?: string, ubatch?: number, paso?: number}} args
 * @returns {number} 0 si ni la mínima cabe
 */
export function maxContexto({ libreMiB, kv = "q4_0", ubatch = 256, paso = 1024 }) {
  const tope = Math.min(MODELO.vram.ctxAutoMax, MODELO.modelo.ctxNativo);
  for (let ctx = Math.floor(tope / paso) * paso; ctx >= paso; ctx -= paso) {
    if (cabe({ ctx, kv, ubatch, libreMiB })) return ctx;
  }
  return 0;
}

/**
 * El KV más preciso que arranca para esa ventana (f16 > q8_0 > q4_0).
 * @param {{ctx: number, libreMiB: number, ubatch?: number}} args
 * @returns {string | null} null si ni q4_0 cabe
 */
export function mejorKv({ ctx, libreMiB, ubatch = 256 }) {
  for (const tipo of MODELO.kv.orden) {
    if (cabe({ ctx, kv: tipo, ubatch, libreMiB })) return tipo;
  }
  return null;
}

/**
 * @param {string} perfil codigo | chat | razonar
 * @returns {{temperature: number, top_p: number, top_k: number, min_p: number, presence_penalty: number, repeat_penalty: number}}
 */
export function muestreo(perfil, clave = "") {
  const row = MODELO.catalogo?.[clave]?.muestreo?.[perfil] || MODELO.muestreo[perfil];
  if (!row) throw new Error(`perfil de muestreo desconocido: ${perfil}`);
  const { temperature, top_p, top_k, min_p, presence_penalty, repeat_penalty } = row;
  return { temperature, top_p, top_k, min_p, presence_penalty, repeat_penalty };
}

/**
 * Ajustes del bucle del agente PARA UN MODELO concreto (chat\modelo.json →
 * `catalogo.<clave>.agente`). No es lo mismo que el dialecto de las tool calls: los dos
 * modelos del catálogo emiten llamadas NATIVAS (medido: 26 tareas, 0 en XML), pero no se
 * comportan igual cuando algo falla. Medido el 2026-10-06 con chat\medir-agente.mjs
 * (6 tareas largas cada uno, verificación independiente del modelo):
 *   override6  · lru-ttl 8 saltos · arreglar-bugs OK · parser recursivo FALLA
 *   bolding_v1 · lru-ttl 14 saltos · arreglar-bugs lo ABANDONA en 6 saltos
 * Por eso bolding_v1 recibe más saltos y más avisos antes de rendirse.
 * @param {string} clave
 * @returns {{saltos: number, avisos: number}}
 */
export function perfilAgente(clave) {
  const fila = clave ? MODELO.catalogo?.[clave] : null;
  const a = fila && typeof fila.agente === "object" && fila.agente ? fila.agente : {};
  const saltos = Number.isInteger(a.saltos) && a.saltos > 0 ? a.saltos : 24;
  const avisos = Number.isInteger(a.avisos) && a.avisos >= 0 ? a.avisos : 2;
  return { saltos, avisos };
}

/**
 * ¿Puede razonar (thinking) este modelo? Sale de `catalogo.<clave>.pensar`. No todos valen:
 * bolding_v1 deja sin respuesta el 24 % de los prompts con el razonamiento encendido
 * (ficha del autor), Override-6 ninguno. Un modelo sin declararlo NO razona.
 * @param {string} clave
 * @returns {{compatible: boolean, presupuesto: number}}
 */
export function pensarDe(clave) {
  const fila = clave ? MODELO.catalogo?.[clave] : null;
  const p = fila && typeof fila.pensar === "object" && fila.pensar ? fila.pensar : {};
  const compatible = p.compatible === true;
  const presupuesto = compatible && Number.isInteger(p.presupuesto) && p.presupuesto > 0 ? p.presupuesto : 0;
  return { compatible, presupuesto };
}

/**
 * Presupuesto de razonamiento que de verdad se usa: lo que pidió el usuario (`pedido`, en
 * tokens; 0 = apagado) si el modelo lo admite; si no, 0.
 * @param {string} clave
 * @param {number} pedido
 * @returns {number}
 */
export function presupuestoPensar(clave, pedido) {
  const n = Number(pedido);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return pensarDe(clave).compatible ? Math.floor(n) : 0;
}

/**
 * @returns {string[]} nombres de las pruebas que fallaron
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

  check("KV f16 = 64 KiB por token", kvBytesPorToken("f16") === 64 * 1024);
  check("KV q4_0 = 18 KiB por token", kvBytesPorToken("q4_0") === 18 * 1024);
  check("KV q4_0 con 64k = 1152 MiB", kvMiB(65536, "q4_0") === 1152);
  // BUG-06: el modelo activo (Ornith) dimensiona el KV con `catalogo.<clave>.servidor`
  // (8 capas de atención completa, no las 16 del Bonsai histórico de `modelo`).
  check("KV f16 de Ornith = 32 KiB por token (8 capas)", kvBytesPorToken("f16", "ornith9b") === 32 * 1024);
  check("KV q8_0 de Ornith a 32768 = 544 MiB", kvMiB(32768, "q8_0", "ornith9b") === 544);
  // Presupuesto calibrado: pesos 5513 + KV + 620 de reserva de arranque + 900 de visión.
  const tablaOrnith = [[16384, "f16", 7545], [24576, "f16", 7801], [32768, "f16", 8057], [32768, "q8_0", 7577], [32768, "q4_0", 7321], [39936, "q8_0", 7696], [39936, "q4_0", 7384], [53248, "q8_0", 7917]];
  for (const [ctx, kv, esperado] of tablaOrnith) {
    check(`VRAM de Ornith con visión (${ctx}/${kv} = ${esperado} MiB)`, estimarVramMiB({ clave: "ornith9b", ctx, kv, vision: true }) === esperado);
  }
  check("VRAM de Ornith sin visión (32768/f16 = 7157 MiB)", estimarVramMiB({ clave: "ornith9b", ctx: 32768, kv: "f16" }) === 7157);
  check("la cuenta global del Bonsai no cambia sin clave", estimarVramMiB({ ctx: 65536, kv: "q4_0" }) === 7163);
  let rejectedClave = false;
  try {
    kvBytesPorToken("f16", "no-existe");
  } catch {
    rejectedClave = true;
  }
  check("una clave desconocida no cae en silencio en la arquitectura del Bonsai", rejectedClave);
  // Puntos medidos con el servidor real (nvidia-smi, -ub 256, KV q4_0): el modelo los reproduce
  const medidos = [[65536, 7163], [69632, 7253], [73728, 7343], [77824, 7433], [81920, 7523]];
  for (const [ctx, usada] of medidos) {
    check(`coincide con lo medido (${ctx} tokens = ${usada} MiB)`, Math.abs(estimarVramMiB({ ctx, kv: "q4_0", ubatch: 256 }) - usada) <= 2);
  }
  check("coincide con lo medido (64k, -ub 1024 = 7394 MiB)", Math.abs(estimarVramMiB({ ctx: 65536, kv: "q4_0", ubatch: 1024 }) - 7394) <= 3);
  check("-ub 1024 a 64k arrancó con 7947 libres (pico sin margen)", picoArranqueMiB({ ctx: 65536, kv: "q4_0", ubatch: 1024 }) <= 7947);
  check("-ub por debajo de lo medido no regala memoria", estimarVramMiB({ ctx: 8192, kv: "q4_0", ubatch: 64 }) === estimarVramMiB({ ctx: 8192, kv: "q4_0", ubatch: 256 }));
  // Frontera real de arranque con 7956 MiB libres: 81920 arrancó, 83968 y 86016 fallaron (cudaMalloc)
  check("81920 arranca con 7956 libres (pico sin margen)", picoArranqueMiB({ ctx: 81920, kv: "q4_0" }) <= 7956);
  check("83968 no arranca con 7956 libres", picoArranqueMiB({ ctx: 83968, kv: "q4_0" }) > 7956);
  check("86016 no arranca con 7956 libres", picoArranqueMiB({ ctx: 86016, kv: "q4_0" }) > 7956);
  check("q8_0 con 64k no arranca con 7956 libres", !cabe({ ctx: 65536, kv: "q8_0", libreMiB: 7956 }));
  check("con 7956 libres y 64k elige q4_0", mejorKv({ ctx: 65536, libreMiB: 7956 }) === "q4_0");
  check("con 7956 libres y 32k elige q8_0", mejorKv({ ctx: 32768, libreMiB: 7956 }) === "q8_0");
  check("con 7956 libres y 16k elige f16", mejorKv({ ctx: 16384, libreMiB: 7956 }) === "f16");
  check("con 3000 libres nada cabe", mejorKv({ ctx: 4096, libreMiB: 3000 }) === null);
  const tope = maxContexto({ libreMiB: 7956, kv: "q4_0", paso: 4096 });
  check("el contexto automático con 7956 libres ronda los 76k-80k", tope >= 73728 && tope <= 81920 && tope % 4096 === 0);
  check("el tope cabe y el siguiente no", cabe({ ctx: tope, kv: "q4_0", libreMiB: 7956 }) && !cabe({ ctx: tope + 4096, kv: "q4_0", libreMiB: 7956 }));
  check("sin VRAM no hay ventana", maxContexto({ libreMiB: 5000, kv: "q4_0" }) === 0);
  check("con más VRAM libre, más contexto", maxContexto({ libreMiB: 8100 }) > maxContexto({ libreMiB: 7800 }));
  check("-ub mayor pide más VRAM", estimarVramMiB({ ctx: 8192, kv: "q4_0", ubatch: 1024 }) > estimarVramMiB({ ctx: 8192, kv: "q4_0" }));

  check("perfil codigo", muestreo("codigo").temperature === 0.6 && muestreo("codigo").top_p === 0.9 && muestreo("codigo").min_p === 0.05);
  check("perfil razonar", muestreo("razonar").temperature === 0.6 && muestreo("razonar").min_p === 0.05);
  let rejected = false;
  try {
    muestreo("inventado");
  } catch {
    rejected = true;
  }
  check("rechaza un perfil desconocido", rejected);
  let rejectedKv = false;
  try {
    kvBytesPorToken("q5_0");
  } catch {
    rejectedKv = true;
  }
  check("rechaza q5_0 (lento) y mezclas", rejectedKv);
  check("el razonamiento viene apagado", MODELO.razonamiento.porDefecto === false);
  check("el perfil del agente sale del catálogo, distinto por modelo", perfilAgente("override6").saltos === 24 && perfilAgente("bolding_v1").saltos === 32 && perfilAgente("bolding_v1").avisos > perfilAgente("override6").avisos);
  check("un modelo sin perfil declarado usa los valores por defecto", perfilAgente("no-existe").saltos === 24 && perfilAgente("").avisos === 2);
  check("Override-6 puede razonar y bolding_v1 no", pensarDe("override6").compatible && pensarDe("override6").presupuesto > 0 && !pensarDe("bolding_v1").compatible);
  check("un modelo sin declararlo no razona", !pensarDe("no-existe").compatible && presupuestoPensar("no-existe", 2048) === 0);
  check("el razonamiento pedido solo se aplica si el modelo lo admite", presupuestoPensar("override6", 2048) === 2048 && presupuestoPensar("bolding_v1", 2048) === 0 && presupuestoPensar("override6", 0) === 0);

  return failures;
}

/**
 * @param {number} libreMiB
 * @param {number} ubatch
 */
function tabla(libreMiB, ubatch) {
  const filas = [["ventana", "KV", "KV MiB", `en uso (-ub ${ubatch})`, "pico al arrancar", `arranca con ${libreMiB} libres`]];
  for (const ctx of [8192, 16384, 32768, 49152, 65536, 81920, 98304, 131072]) {
    for (const kv of MODELO.kv.orden) {
      filas.push([String(ctx), kv, String(kvMiB(ctx, kv)), String(estimarVramMiB({ ctx, kv, ubatch })), String(picoArranqueMiB({ ctx, kv, ubatch })), cabe({ ctx, kv, ubatch, libreMiB }) ? "sí" : "no"]);
    }
  }
  const ancho = filas[0].map((_, i) => Math.max(...filas.map((fila) => fila[i].length)));
  return filas.map((fila) => fila.map((celda, i) => celda.padEnd(ancho[i])).join("  ")).join("\n");
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (entry === import.meta.url) {
  const at = process.argv.indexOf("--tabla");
  if (at >= 0) {
    const libre = Number(process.argv[at + 1]) || MODELO.vram.totalMiB - 232;
    const ubatch = Number(process.argv[at + 2]) || 256;
    process.stdout.write(`${tabla(libre, ubatch)}\n`);
  } else {
    const failures = selfTest();
    if (failures.length) {
      process.stderr.write(`${failures.join("\n")}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write("modelo ok\n");
    }
  }
}
