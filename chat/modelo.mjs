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
 * @param {string} tipo f16 | q8_0 | q4_0
 * @returns {number} bytes de caché KV por token (solo las capas de atención completa)
 */
export function kvBytesPorToken(tipo) {
  const bytes = MODELO.kv.bytesPorElemento[tipo];
  if (!bytes) throw new Error(`tipo de KV no admitido: ${tipo}`);
  const m = MODELO.modelo;
  return m.capasAtencionCompleta * m.cabezasKV * m.dimCabeza * 2 * bytes;
}

/**
 * @param {number} ctx
 * @param {string} tipo
 * @returns {number}
 */
export function kvMiB(ctx, tipo) {
  return Math.ceil((ctx * kvBytesPorToken(tipo)) / MIB);
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
 * @param {{ctx: number, kv: string, ubatch?: number}} args
 * @returns {number} MiB
 */
export function estimarVramMiB({ ctx, kv, ubatch = 256 }) {
  const v = MODELO.vram;
  return Math.ceil(v.pesosMiB + v.estadoRecurrenteMiB + v.fijoCudaMiB + kvMiB(ctx, kv) + computoMiB(ctx, ubatch));
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
  const fila = clave ? MODELO.catalogo[clave] : null;
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
  const fila = clave ? MODELO.catalogo[clave] : null;
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

  check("perfil codigo", muestreo("codigo").temperature === 0.5 && muestreo("codigo").top_p === 0.85);
  check("perfil razonar", muestreo("razonar").temperature === 1 && muestreo("razonar").min_p === 0.05);
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
