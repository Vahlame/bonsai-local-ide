import fs from "node:fs";

const frozen = new URL("./engine-presets.json", import.meta.url);
export const ENGINE_PROFILES = Object.freeze(JSON.parse(fs.readFileSync(
  fs.existsSync(frozen) ? frozen : new URL("../config/local-engine-presets.json", import.meta.url), "utf8")));

export const CUSTOM_ENGINE = "CUSTOM";
const KV = new Set(["f16", "q8_0", "q4_0"]);

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
