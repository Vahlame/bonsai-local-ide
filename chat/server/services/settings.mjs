/**
 * Ajustes de la interfaz: lectura, migración, escritura atómica y traducción al
 * estado del chat. No conoce HTTP ni el ciclo de vida del servidor.
 *
 * El servicio recibe el chat y el catálogo por contexto para que `ui-server.mjs`
 * siga siendo el único que compone el arranque. La versión de la UI se lee del
 * `package.json` real: antes estaba duplicada a mano y podía quedarse atrás.
 */
import fs from "node:fs";
import { escribirJsonAtomico, leerJsonTolerante } from "../../almacen-json.mjs";

/** Versión con la que se hizo la última migración visual que resetea el tema. */
const MIGRACION_VISUAL = "2.3.0";

/** @returns {string} */
function versionDelPaquete() {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL("../../../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Compara dos versiones semver simples (`2.4.13`). Solo se usa para decidir si
 * una instalación es anterior a la migración visual.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function compararVersiones(a, b) {
  const pa = String(a).split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * @param {{
 *   stateFile: string,
 *   args: Record<string, any>,
 *   chat: Record<string, any>,
 *   initialProfile: string,
 *   catalog: Record<string, any>,
 *   catalogoModelos: () => Array<Record<string, any>>,
 *   pensarDe: (clave: string) => {compatible: boolean, presupuesto: number},
 *   presupuestoPensar: (clave: string, pedido: number) => number,
 *   engineProfile: (nombre: string) => Record<string, any>,
 *   isNamedEnginePreset: (nombre: string) => boolean,
 *   coderConfig: Record<string, any>,
 *   coderOptions: (raw?: string) => Record<string, any>,
 *   getModelKey: () => string,
 *   runtime: {saltosTope: number, comandoTimeoutMs: number},
 *   uiVersion?: string,
 * }} ctx
 */
export function createSettingsService(ctx) {
  const UI_VERSION = ctx.uiVersion || versionDelPaquete();
  const AJUSTES_DEFECTO = {
    tema: "slate",
    perfil: "codigo",
    pensar: ctx.args.think,
    verPensamiento: true,
    reglas: true,
    historial: 0,
    continuarAuto: true,
    saltosTope: 192,
    comandoSegundos: 180,
    agentePerfil: ctx.initialProfile,
    memoriaGlobal: true,
    memoriaGlobalAuto: true,
    memoriaGlobalTokens: 480,
    engineEffort: "default",
    preguntarModelo: true,
    editorModerno: true,
    uiVersion: UI_VERSION,
  };
  /** Presupuesto con el que arrancó el llama-server desde esta app. */
  let pensarServidor = null;

  /** @returns {Record<string, any>} */
  function leerAjustes() {
    const { dato, error } = leerJsonTolerante(ctx.stateFile, { ...AJUSTES_DEFECTO });
    const datos = { ...AJUSTES_DEFECTO, ...(dato && typeof dato === "object" ? dato : {}) };
    if (error) process.stderr.write(`[ajustes] ${error}; se usan los valores por defecto\n`);

    // Migración visual: solo para instalaciones anteriores a 2.3.0. Antes se
    // ejecutaba en CADA cambio de versión y devolvía el tema del usuario a
    // "slate" en cada actualización.
    const versionGuardada = typeof datos.uiVersion === "string" ? datos.uiVersion : "";
    if (!versionGuardada || compararVersiones(versionGuardada, MIGRACION_VISUAL) < 0) {
      datos.tema = "slate";
      datos.editorModerno = true;
      // El default viejo (32768) partía la ventana 50/50. Desde 2.3.4 el
      // presupuesto es automático: ventana menos salida y margen.
      if (Number(datos.historial) >= 32768) datos.historial = 0;
    }
    if (datos.uiVersion !== UI_VERSION) {
      datos.uiVersion = UI_VERSION;
      try {
        escribirJsonAtomico(ctx.stateFile, datos, { copia: false });
      } catch (err) {
        // Los ajustes son recuperables: no impiden arrancar el IDE.
        process.stderr.write(`[ajustes] no se pudo guardar la versión: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
    return datos;
  }

  /** @param {Record<string, unknown>} nuevos */
  function guardarAjustes(nuevos) {
    const mezcla = { ...leerAjustes(), ...nuevos };
    escribirJsonAtomico(ctx.stateFile, mezcla, { copia: true });
    return mezcla;
  }

  /**
   * Pasa los ajustes de la interfaz al chat. `perfil`, `historial` y `pensar` se
   * aplican en la siguiente petición: el muestreo y la ventana de razonamiento
   * viajan en cada petición.
   * @param {Record<string, any>} ajustes
   */
  function aplicarAjustesAlChat(ajustes) {
    const agentProfile = ajustes.agentePerfil || process.env.BONSAI_AGENT_PROFILE;
    if (["legacy", "small-local-coder"].includes(agentProfile)) ctx.chat.agentProfile = agentProfile;

    const engine = ajustes.enginePreset && ctx.isNamedEnginePreset(ajustes.enginePreset)
      ? ctx.engineProfile(ajustes.enginePreset)
      : null;
    const ctxTokens = Number(ajustes.coderContextTokens) || engine?.context || ctx.chat.nCtx || 16384;
    // historial 0 (o vacío) = AUTOMÁTICO: ventana menos la reserva de salida.
    const histPedido = Number(ajustes.historial);
    const histAuto = !Number.isFinite(histPedido) || histPedido <= 0;
    const histTokens = histAuto ? ctxTokens : Math.min(histPedido, ctxTokens);
    const salidaTokens = histTokens >= ctxTokens
      ? Math.min(18000, Math.max(256, Math.floor(ctxTokens / 2) - 128))
      : Math.max(256, ctxTokens - histTokens);
    const outTokens = histAuto
      ? Math.min(engine?.coderOutputTokens || 12288, salidaTokens)
      : salidaTokens;
    const pedidoPensar = Number(ajustes.pensar);
    const thinkingTokens = Number.isFinite(pedidoPensar) && pedidoPensar !== 0
      ? pedidoPensar
      : (engine?.thinkingTokens || 2048);
    ctx.chat.coderConfig = {
      ...ctx.coderConfig,
      contextTokens: ctxTokens,
      outputTokens: outTokens,
      toolResultTokens: Math.max(1000, Math.min(6000, Math.floor(ctxTokens / 10))),
      thinkingTokens,
      ...ctx.coderOptions(process.env.BONSAI_CODER_OPTIONS),
      ...(ajustes.coderContextTokens ? { contextTokens: ajustes.coderContextTokens } : {}),
    };

    const clave = ctx.getModelKey();
    const itemRazonamiento = ctx.catalogoModelos().find((m) => m.clave === clave);
    ctx.chat.razonamientoEsfuerzo = itemRazonamiento?.pensar?.nivel || "";
    ctx.chat.imageMaxTokens = Number(ctx.catalog.catalogo?.[clave]?.vision?.imageMaxTokens) || 1024;

    const perfil = typeof ajustes.perfil === "string" ? ajustes.perfil : "";
    if (perfil && Object.hasOwn(ctx.catalog.muestreo, perfil)) ctx.chat.perfil = perfil;

    const tope = Number(ajustes.historial);
    ctx.chat.configuredCap = Number.isFinite(tope) && tope > 0 ? Math.max(512, tope) : 0;

    // Razonamiento: el pedido, pero solo si el modelo cargado lo admite.
    const capacidadPensar = ctx.pensarDe(clave);
    const pedidoEfectivo = Number.isFinite(pedidoPensar) && pedidoPensar !== 0
      ? pedidoPensar
      : capacidadPensar.presupuesto;
    ctx.chat.thinkBudget = ctx.presupuestoPensar(clave, pedidoEfectivo);

    const topePasos = Number(ajustes.saltosTope);
    if (Number.isFinite(topePasos)) ctx.runtime.saltosTope = Math.max(24, Math.min(400, Math.round(topePasos)));
    const segundos = Number(ajustes.comandoSegundos);
    if (Number.isFinite(segundos)) ctx.runtime.comandoTimeoutMs = Math.max(10, Math.min(1800, Math.round(segundos))) * 1000;

    const mgTokens = Number(ajustes.memoriaGlobalTokens);
    ctx.chat.globalMemoryBudget = ajustes.memoriaGlobal === false
      ? 0
      : Math.max(0, Math.min(2000, Number.isFinite(mgTokens) ? Math.round(mgTokens) : 480));
  }

  /**
   * Lo que la interfaz necesita saber del razonamiento.
   * @returns {{modelo: string, compatible: boolean, recomendado: number, efectivo: number, solicitado: number, limiteCoding: number, servidor: number | null}}
   */
  function infoPensar() {
    const clave = ctx.getModelKey();
    const { compatible, presupuesto } = ctx.pensarDe(clave);
    return {
      modelo: clave,
      compatible,
      recomendado: presupuesto,
      efectivo: ctx.chat.effectiveThinkingBudget(),
      solicitado: ctx.chat.thinkBudget,
      limiteCoding: ctx.chat.thinkingLimit(),
      servidor: pensarServidor,
    };
  }

  return {
    UI_VERSION,
    AJUSTES_DEFECTO,
    leerAjustes,
    guardarAjustes,
    aplicarAjustesAlChat,
    infoPensar,
    setPensarServidor(valor) { pensarServidor = valor; },
  };
}
