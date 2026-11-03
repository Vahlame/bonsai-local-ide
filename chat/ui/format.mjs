/** Formateadores puros compartidos por app.js y el Model Hub. */

/**
 * @param {unknown} n
 * @returns {string}
 */
export const formatoTokens = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString("es-ES") : "-");

/** Estimación de tokens de la UI (3 caracteres por token, igual que el servidor). */
export const estimateTokensUi = (texto) => Math.ceil(String(texto || "").length / 3);

/** @param {unknown} n */
export const fmtBytes = (n) => {
  const v = Number(n) || 0;
  if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GiB`;
  if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(0)} MiB`;
  if (v >= 1024) return `${(v / 1024).toFixed(0)} KiB`;
  return `${v} B`;
};

/** @param {unknown} s */
export const fmtEta = (s) => {
  const n = Math.max(0, Math.round(Number(s) || 0));
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m ${n % 60}s`;
  return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
};

/** @param {unknown} kv */
export const kvTexto = (kv) => ({ f16: "f16", q8_0: "q8_0", q4_0: "q4_0" }[kv] || kv);

/** @param {Record<string, any> | null | undefined} plan */
export const planTexto = (plan) => {
  if (!plan) return "plan pendiente";
  if (!plan.ok && plan.ok !== undefined) return "no cabe";
  const moe = plan.moe?.activo ? ` · MoE ${plan.moe.capasGpu}/${plan.moe.capas} GPU · ${plan.moe.loadMode}` : "";
  return `${Number(plan.contexto || 0).toLocaleString("es-ES")} tok · ${kvTexto(plan.kv)}${plan.vision ? (plan.mmprojCPU ? " · visión CPU" : " · visión GPU") : " · sin visión"}${moe}`;
};
