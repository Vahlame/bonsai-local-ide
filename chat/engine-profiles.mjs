import fs from "node:fs";
import path from "node:path";

/**
 * Presets de motor: se combinan el fichero historico y el optimizado para RTX 4060.
 * El optimizado manda si hay colision de nombres. Asi la interfaz conoce tanto los
 * perfiles antiguos como los nuevos (8GB-VISION-DEFAULT-F16, -ULTRA-F16, ...).
 * @param {URL} url
 * @returns {Record<string, unknown>}
 */
function leerPresets(url) {
  try {
    if (fs.existsSync(url)) return JSON.parse(fs.readFileSync(url, "utf8"));
  } catch {
    /* fichero ilegible: se ignora */
  }
  return {};
}

const frozen = new URL("./engine-presets.json", import.meta.url);
const historico = new URL("../config/local-engine-presets.json", import.meta.url);
const optimizado = new URL("../config/local-engine-presets-rtx4060-optimized.json", import.meta.url);

const base = fs.existsSync(frozen) ? leerPresets(frozen) : leerPresets(historico);
const extra = leerPresets(optimizado);
export const ENGINE_PROFILES = Object.freeze({ ...base, ...extra });

const MODELO_FILE = new URL("../chat/modelo.json", import.meta.url);
let MODELO_CACHE = null;
function cargarModelo() {
  if (!MODELO_CACHE) {
    MODELO_CACHE = JSON.parse(fs.readFileSync(MODELO_FILE, "utf8"));
  }
  return MODELO_CACHE;
}

/**
 * Catálogo de modelos simplificado para validación de techo.
 * @returns {Array<{clave: string, ctxNativo: number, nombre: string}>}
 */
function catalogoModelosValidacion() {
  const modelo = cargarModelo();
  const cat = modelo.catalogo || {};
  const out = [];
  for (const clave of Object.keys(cat)) {
    if (clave.startsWith("_")) continue;
    const row = cat[clave];
    if (!row || typeof row.archivo !== "string") continue;
    out.push({
      clave,
      ctxNativo: Number(row.ctxNativo) || 262144,
      nombre: typeof row.nombre === "string" && row.nombre ? row.nombre : clave,
    });
  }
  return out;
}

/**
 * Valida que el contexto solicitado quepa en el techo del modelo.
 * Para modelos con visión, el techo es 43008 (manual) o 39936 (auto).
 * Para modelos sin visión, el techo es 53248 (texto) o 262144 (nativo).
 * @param {string} clave
 * @param {number} contexto
 * @param {boolean} vision
 * @returns {{ok: boolean, techo: number, motivo?: string}}
 */
export function validarTechoModelo(clave, contexto, vision) {
  const item = catalogoModelosValidacion().find((m) => m.clave === clave);
  if (!item) return { ok: true, techo: 65536 }; // desconocido: no bloquear
  const nativo = item.ctxNativo;
  const techo = vision
    ? Math.min(43008, nativo) // visión: tope manual validado 43008
    : Math.min(53248, nativo); // texto: tope histórico 53248
  if (contexto > techo) {
    return { ok: false, techo, motivo: `El contexto ${contexto} supera el techo ${techo} del modelo ${item.nombre} (${vision ? "con" : "sin"} visión)` };
  }
  return { ok: true, techo };
}

export const CUSTOM_ENGINE = "CUSTOM";
// KV soportados: los historicos + los cuantizados de la build optimizada.
// GGML_CUDA_FA_ALL_QUANTS=ON en la build sm89 permite estas combinaciones con FlashAttention.
const KV = new Set(["f16", "q8_0", "q4_0", "IQ4_XS", "IQ2_XS", "IQ1_S"]);

export function isNamedEnginePreset(name) {
  return typeof name === "string" && Object.hasOwn(ENGINE_PROFILES, name);
}

export function engineProfile(name) {
  if (!isNamedEnginePreset(name)) throw new Error("Perfil de motor desconocido");
  return ENGINE_PROFILES[name];
}

/** Recorta el historial pedido para que quepa en la ventana. */
export function historialDentro(valor, contexto) {
  const ventana = Number(contexto);
  const n = Number(valor);
  if (!Number.isInteger(ventana) || ventana < 4096) return Number.isInteger(n) && n >= 512 ? n : 8192;
  if (!Number.isInteger(n) || n < 512) return ventana;
  return Math.min(n, ventana);
}

export function matchEnginePreset({ context, kv, vision, historial } = {}) {
  for (const [name, p] of Object.entries(ENGINE_PROFILES)) {
    if (Number(p.context) !== Number(context) || String(p.kv) !== String(kv) || Boolean(p.vision) !== Boolean(vision)) continue;
    if (historial !== undefined && Number(historial) !== Number(p.context)) continue;
    return name;
  }
  return CUSTOM_ENGINE;
}

/**
 * @param {Record<string, unknown>} raw
 * @param {Record<string, unknown>} [ajustes]
 * @param {Record<string, unknown> | null} [anterior]
 */
export function configMotor(raw = {}, ajustes = {}, anterior = null) {
  const nombre = typeof raw.enginePreset === "string" ? raw.enginePreset : "";
  if (nombre && nombre !== CUSTOM_ENGINE && !isNamedEnginePreset(nombre)) throw new Error("Perfil de motor desconocido");
  const nombrado = isNamedEnginePreset(nombre) ? engineProfile(nombre) : null;
  const contexto = Number(nombrado ? (raw.contexto ?? nombrado.context) : (raw.contexto ?? ajustes.coderContextTokens ?? anterior?.contexto ?? 16384));
  if (!Number.isInteger(contexto) || contexto < 4096 || contexto > 65536) throw new Error("Ventana de contexto inválida");
  const kv = String(nombrado ? nombrado.kv : (raw.kv || ajustes.engineKv || anterior?.kv || "f16"));
  if (!KV.has(kv)) throw new Error("Tipo de KV inválido");
  const vision = nombrado ? Boolean(nombrado.vision) : raw.vision !== undefined ? Boolean(raw.vision) : ajustes.engineVision !== undefined ? Boolean(ajustes.engineVision) : anterior?.vision !== undefined ? Boolean(anterior.vision) : true;
  const historial = historialDentro(
    raw.historial ?? (nombrado && raw.historial === undefined && raw.enginePreset ? nombrado.context : (ajustes.historial ?? anterior?.historial)),
    contexto
  );
  const salida = historial >= contexto ? Math.min(18000, Math.max(256, Math.floor(contexto / 2) - 128)) : Math.max(256, contexto - historial);
  const enginePreset = (nombrado && (raw.historial === undefined || Number(raw.historial) === contexto) && Number(contexto) === Number(nombrado.context))
    ? nombre
    : matchEnginePreset({ context: contexto, kv, vision, historial });
  return {
    enginePreset,
    contexto,
    kv,
    vision,
    historial,
    dormir: 0,
    hostIP: "127.0.0.1",
    coderOutputTokens: enginePreset !== CUSTOM_ENGINE && nombrado?.coderOutputTokens ? nombrado.coderOutputTokens : salida,
    thinkingTokens: nombrado?.thinkingTokens,
  };
}