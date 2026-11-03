/** Catálogo local, registro, escaneo de GGUF y planes de modelo. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { MODELO } from "../modelo.mjs";
import {
  arquitecturaDesdeGGUF,
  entradaCatalogoDesdeGGUF,
  leerMetadatosGGUF,
  nombreArchivoSeguro,
  planAuto,
} from "../model-plan.mjs";
import { CURATED_FILE, HUB_FILE, MIB, MODELS_DIR, log } from "./common.mjs";
import { listarTrabajos } from "./jobs.mjs";

/** @type {{version: number, actualizado: string, modelos: Record<string, any>} | null} */
let registroCache = null;
let registroMtime = -1;

function objeto(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

/** @returns {{version: number, actualizado: string, modelos: Record<string, any>}} */
export function leerRegistro() {
  let mtime = -1;
  try { mtime = fs.statSync(HUB_FILE).mtimeMs; } catch { /* aún no existe */ }
  if (registroCache && mtime === registroMtime) return registroCache;
  try {
    const raw = JSON.parse(fs.readFileSync(HUB_FILE, "utf8"));
    registroCache = {
      version: 1,
      actualizado: String(raw.actualizado || ""),
      modelos: objeto(raw.modelos),
    };
  } catch {
    registroCache = { version: 1, actualizado: "", modelos: {} };
  }
  registroMtime = mtime;
  return registroCache;
}

/** @param {ReturnType<typeof leerRegistro>} [registro] @param {{merge?: boolean}} [opciones] */
export function guardarRegistro(registro = leerRegistro(), opciones = {}) {
  fs.mkdirSync(path.dirname(HUB_FILE), { recursive: true });
  const merge = opciones.merge !== false;
  // Lectura-modificación-escritura: varios procesos (descargas, model-lab,
  // model-tune) pueden terminar a la vez. Si este proceso trae una copia vieja,
  // no debe borrar las entradas que otro acaba de añadir.
  if (merge) {
    try {
      const actual = JSON.parse(fs.readFileSync(HUB_FILE, "utf8"));
      if (actual && typeof actual.modelos === "object") {
        registro.modelos = { ...objeto(actual.modelos), ...registro.modelos };
      }
    } catch { /* primer registro */ }
  }
  registro.actualizado = new Date().toISOString();
  const tmp = `${HUB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(registro, null, 2), "utf8");
  fs.renameSync(tmp, HUB_FILE);
  registroCache = registro;
  try { registroMtime = fs.statSync(HUB_FILE).mtimeMs; } catch { registroMtime = Date.now(); }
}

/**
 * Fusiona los modelos del registro en el catálogo que ya usa el IDE. El catálogo
 * curado (chat/modelo.json) manda si hay colisión de clave.
 * @param {Record<string, any>} [catalogo]
 * @returns {string[]} claves añadidas o actualizadas
 */
export function fusionarCatalogo(catalogo = MODELO.catalogo) {
  if (!catalogo || typeof catalogo !== "object") return [];
  const vistos = [];
  for (const [clave, entrada] of Object.entries(leerRegistro().modelos)) {
    if (clave.startsWith("_") || !entrada || typeof entrada !== "object") continue;
    if (!catalogo[clave]) {
      catalogo[clave] = entrada;
      vistos.push(clave);
    } else if (catalogo[clave].fuente === "hub") {
      catalogo[clave] = entrada;
      vistos.push(clave);
    }
  }
  return vistos;
}

// El resto del IDE puede importar este módulo y usar MODELO.catalogo directamente.
fusionarCatalogo();

/** @type {{ts: number, valor: {totalMiB: number, libreMiB: number, usadaMiB: number, fuente: string} | null}} */
let vramCache = { ts: 0, valor: null };

/** @returns {Promise<{totalMiB: number, libreMiB: number, usadaMiB: number, fuente: string}>} */
export function vramInfo(forzar = false) {
  if (!forzar && vramCache.valor && Date.now() - vramCache.ts < 2000) return Promise.resolve(vramCache.valor);
  return new Promise((resolve) => {
    execFile("nvidia-smi", ["--query-gpu=memory.total,memory.free,memory.used", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 8000 }, (err, stdout) => {
      if (err) {
        resolve({ totalMiB: 8188, libreMiB: 7600, usadaMiB: 588, fuente: "estimado" });
        return;
      }
      const fila = String(stdout || "").trim().split(/\r?\n/)[0] || "";
      const [total, libre, usada] = fila.split(",").map((v) => Number.parseInt(v.trim(), 10));
      if (!Number.isFinite(total) || !Number.isFinite(libre)) {
        resolve({ totalMiB: 8188, libreMiB: 7600, usadaMiB: 588, fuente: "estimado" });
        return;
      }
      const valor = { totalMiB: total, libreMiB: libre, usadaMiB: Number.isFinite(usada) ? usada : Math.max(0, total - libre), fuente: "nvidia-smi" };
      vramCache = { ts: Date.now(), valor };
      resolve(valor);
    });
  });
}

export function existeArchivo(archivo) {
  try {
    return fs.statSync(path.join(MODELS_DIR, archivo)).isFile();
  } catch {
    return false;
  }
}

export function tamanoArchivo(archivo) {
  try {
    return fs.statSync(path.join(MODELS_DIR, archivo)).size;
  } catch {
    return 0;
  }
}

/**
 * Plan recomendado para una clave del catálogo, con la VRAM disponible.
 * @param {string} clave
 * @param {{vision?: boolean, libreMiB?: number, actual?: boolean, reservaMiB?: number}} [opciones]
 * @returns {Promise<{ok: boolean, clave: string, entrada: any, plan: any, vr: any}>}
 */
export async function planParaModelo(clave, opciones = {}) {
  fusionarCatalogo();
  const entrada = MODELO.catalogo?.[clave];
  if (!entrada || !entrada.archivo) throw new Error(`modelo desconocido: ${clave}`);
  const principal = path.join(MODELS_DIR, entrada.archivo);
  if (!fs.existsSync(principal)) throw new Error(`falta el GGUF de ${clave}: models/${entrada.archivo}`);
  let kvF16 = Number(entrada.kvF16BytesPorToken || entrada.servidor?.kvF16BytesPorToken);
  if (!Number.isFinite(kvF16) || kvF16 <= 0) {
    const meta = leerMetadatosGGUF(principal);
    kvF16 = arquitecturaDesdeGGUF(meta.metadata, { archivo: principal }).kvF16BytesPorToken;
  }
  const kvFijo = Number(entrada.kvFijoF16Bytes || entrada.servidor?.kvFijoF16Bytes) || 0;
  const vision = entrada.vision && entrada.vision.archivo && existeArchivo(entrada.vision.archivo)
    ? { bytes: Number(entrada.vision.bytes) || tamanoArchivo(entrada.vision.archivo) }
    : false;
  const draftArchivo = entrada.servidor?.draftModel || entrada.draft?.archivo || "";
  const draftBytes = draftArchivo && existeArchivo(draftArchivo)
    ? (Number(entrada.servidor?.draftBytes) || Number(entrada.draft?.bytes) || tamanoArchivo(draftArchivo))
    : 0;
  const vr = await vramInfo();
  // Un denso más grande que la VRAM no cabe con la cuenta de "todo en GPU".
  // `gpu-parcial` declara el reparto medido (ngl, MiB en GPU, contexto y KV):
  // se devuelve tal cual en vez de recalcular un plan que siempre daría 0.
  if (entrada.servidor?.tipo === "gpu-parcial" && Number(entrada.plan?.contexto) >= 4096) {
    return {
      ok: true,
      clave,
      entrada,
      plan: { ...entrada.plan, ok: true, motivo: String(entrada.servidor.nota || "perfil gpu-parcial medido") },
      vr,
    };
  }
  // Por defecto se planifica como si la GPU quedara entera para este modelo:
  // el cambio de modelo apaga el anterior antes de arrancar. `actual` usa la
  // VRAM libre AHORA (útil para saber si cabe sin mover nada).
  const libreMiB = Number(opciones.libreMiB) || (opciones.actual ? vr.libreMiB : Math.max(4096, vr.totalMiB - 232));
  const plan = planAuto({
    bytes: tamanoArchivo(entrada.archivo) || Number(entrada.bytes) || 0,
    kvF16BytesPorToken: kvF16,
    kvFijoF16Bytes: kvFijo,
    draftBytes,
    draftCtxNativo: Number(entrada.draft?.ctxNativo) || 0,
    ctxNativo: Number(entrada.ctxNativo) || 32768,
    vision,
    nombre: entrada.nombre || clave,
    moe: entrada.servidor?.moe || entrada.moe || null,
  }, {
    libreMiB,
    vision: opciones.vision !== false,
    reservaMiB: Number(opciones.reservaMiB) || Number(entrada.servidor?.reservaMiB) || 850,
    pesosMiB: Number(entrada.servidor?.pesosGpuEstandarMiB) || undefined,
    ramTotalMiB: Math.round(os.totalmem() / MIB),
    ctxTopeMoe: Number(entrada.servidor?.moe?.ctxTope) || undefined,
    // Un modelo ya medido no debe superar su techo real aunque las cuentas den
    // más: Ornith, por ejemplo, arranca a 110.592 y falla a 114.688.
    ctxMaximo: Math.min(
      Number(entrada.ctxNativo) || 131072,
      Number(entrada.vision?.contextoMaximoManual) || Number(entrada.servidor?.contexto) || 131072,
    ),
  });
  return { ok: plan.ok, clave, entrada, plan, vr };
}

/**
 * Entrada de catálogo para un GGUF ya presente en models/. Lee su cabecera y
 * calcula el plan. Si ya hay una entrada con ese archivo, la reutiliza.
 * @param {string} archivo
 * @param {{clave?: string, nombre?: string, rol?: string, uso?: string, origen?: string, revision?: string, licencia?: string, vision?: any, pensar?: any, muestreo?: any, agente?: any, toolcalls?: string, fuente?: string, libreMiB?: number, oculto?: boolean, draftPara?: string, draft?: {archivo: string, bytes: number, tokens?: number, ctxNativo?: number}}} [opciones]
 */
export async function registrarArchivo(archivo, opciones = {}) {
  const seguro = nombreArchivoSeguro(archivo);
  const ruta = path.join(MODELS_DIR, seguro);
  if (!fs.existsSync(ruta)) throw new Error(`no existe el GGUF: ${ruta}`);
  const registro = leerRegistro();
  const ya = Object.entries(registro.modelos).find(([, m]) => m.archivo === seguro);
  if (ya && !opciones.clave) return ya[1];
  const meta = leerMetadatosGGUF(ruta);
  const arq = arquitecturaDesdeGGUF(meta.metadata, { archivo: ruta });
  let vision = opciones.vision || null;
  if (!vision) vision = detectarVision(seguro);
  const vr = await vramInfo();
  const clave = opciones.clave || claveUnica(seguro, registro);
  const entrada = entradaCatalogoDesdeGGUF({
    clave,
    archivo: seguro,
    ruta,
    bytes: fs.statSync(ruta).size,
    nombre: opciones.nombre,
    rol: opciones.rol,
    uso: opciones.uso,
    origen: opciones.origen || `local:${seguro}`,
    revision: opciones.revision,
    licencia: opciones.licencia,
    fuente: opciones.fuente || "hub",
    vision,
    pensar: opciones.pensar,
    muestreo: opciones.muestreo,
    agente: opciones.agente,
    toolcalls: opciones.toolcalls,
    oculto: opciones.oculto === true,
    draftPara: opciones.draftPara,
    draft: opciones.draft,
  }, {
    libreMiB: opciones.libreMiB || Math.max(4096, vr.totalMiB - 232),
  });
  // Un perfil medido manda sobre el plan automático. `gpu-parcial` describe un
  // denso que no cabe en VRAM (ngl y MiB en GPU medidos); sin este merge, volver
  // a registrar el modelo lo convertiría en `gpu-completa` y el IDE lo rechazaría.
  try {
    const curado = leerCurado().modelos.find((m) => m.clave === clave);
    if (curado?.servidor?.tipo === "gpu-parcial" && Number(curado.plan?.contexto) >= 4096) {
      entrada.servidor = { ...entrada.servidor, ...curado.servidor };
      entrada.plan = { ...entrada.plan, ...curado.plan, calculado: new Date().toISOString() };
    }
  } catch { /* catálogo curado ausente: se queda el plan automático */ }
  entrada.clave = clave;
  entrada.instalado = new Date().toISOString();
  entrada.gguf = {
    version: meta.version,
    tensorCount: meta.tensorCount,
    headerBytes: meta.headerBytes,
    arquitectura: arq.arquitectura,
    capas: arq.capas,
    ctxNativo: arq.ctxNativo,
    kvF16BytesPorToken: arq.kvF16BytesPorToken,
  };
  registro.modelos[clave] = entrada;
  guardarRegistro(registro);
  fusionarCatalogo();
  return entrada;
}

/**
 * @param {string} archivo
 * @param {ReturnType<typeof leerRegistro>} registro
 */
function claveUnica(archivo, registro) {
  const base = archivo
    .replace(/\.gguf$/i, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "modelo";
  let clave = base;
  let n = 2;
  while (MODELO.catalogo?.[clave] || registro.modelos[clave]) {
    clave = `${base}-${n}`;
    n += 1;
  }
  return clave;
}

/**
 * Busca un proyector de visión compatible por nombre. Es deliberadamente
 * conservador: si no hay coincidencia clara, el modelo se registra sin visión
 * y el usuario puede enlazarla desde el catálogo curado.
 * @param {string} archivo
 * @returns {{archivo: string, bytes: number} | null}
 */
export function detectarVision(archivo) {
  let nombres;
  try {
    nombres = fs.readdirSync(MODELS_DIR).filter((n) => /^mmproj.*\.gguf$/i.test(n));
  } catch {
    return null;
  }
  if (!nombres.length) return null;
  const ignorar = /^(mmproj|model|f16|bf16|f32|q8_0|q4_0|q4_k_m|q5_k_m|instruct|it|chat|base|gguf|\d+(?:\.\d+)?b|\d+(?:\.\d+)?)$/i;
  const tokens = (s) => s.toLowerCase().replace(/\.gguf$/i, "").split(/[^a-z0-9.]+/).filter((t) => t && t.length > 1 && !ignorar.test(t));
  const base = new Set(tokens(archivo));
  let mejor = null;
  for (const nombre of nombres) {
    // Solo una coincidencia de FAMILIA cuenta. "4b", "instruct" o "q4_k_m" no
    // identifican un modelo: antes eso asignaba el proyector de Qwen3-VL a Spark.
    const comunes = tokens(nombre).filter((t) => base.has(t) && t.length >= 5);
    const puntuacion = comunes.length;
    if (!mejor || puntuacion > mejor.puntuacion) mejor = { archivo: nombre, puntuacion };
  }
  if (!mejor || mejor.puntuacion < 1) return null;
  return { archivo: mejor.archivo, bytes: tamanoArchivo(mejor.archivo) };
}

/**
 * Escanea models/ y registra los GGUF que aún no estén en el catálogo.
 * @param {{silencioso?: boolean}} [opciones]
 * @returns {Promise<{registrados: string[], errores: Array<{archivo: string, error: string}>, total: number}>}
 */
export async function escanearModelos(opciones = {}) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  const registro = leerRegistro();
  const ya = new Set(Object.values(registro.modelos).map((m) => m.archivo));
  /** Archivos del catálogo curado: si faltan en el registro, se registran con sus datos. */
  const curadosPorArchivo = new Map();
  for (const m of leerCurado().modelos) {
    if (m && typeof m.archivo === "string") curadosPorArchivo.set(m.archivo, m);
  }
  /** @type {string[]} */
  const candidatos = [];
  for (const nombre of fs.readdirSync(MODELS_DIR)) {
    if (!/\.gguf$/i.test(nombre)) continue;
    if (/\.part$/i.test(nombre)) continue;
    if (/mmproj/i.test(nombre)) continue;
    if (ya.has(nombre)) continue;
    // Un GGUF curado que ya está en chat/modelo.json (Ornith, Bonsai) no se
    // duplica en el registro; el catálogo estático ya lo describe.
    const estatico = Object.values(MODELO.catalogo || {}).some((m) => m && m.archivo === nombre && m.fuente !== "hub");
    if (estatico) continue;
    if (tamanoArchivo(nombre) < 1024 * 1024) continue; // restos/kv-bias, no modelos
    candidatos.push(nombre);
  }
  const registrados = [];
  const errores = [];
  for (const archivo of candidatos) {
    const curado = curadosPorArchivo.get(archivo);
    try {
      await registrarArchivo(archivo, curado ? {
        clave: curado.clave,
        nombre: curado.nombre,
        rol: curado.rol,
        uso: curado.uso,
        origen: curado.origen || (curado.repo ? `https://huggingface.co/${curado.repo}` : ""),
        revision: curado.revision,
        licencia: curado.licencia,
        vision: curado.vision,
        pensar: curado.pensar,
        muestreo: curado.muestreo,
        agente: curado.agente,
        toolcalls: curado.toolcalls,
        oculto: curado.oculto,
        draft: curado.draft,
        fuente: "hub",
      } : { fuente: "local" });
      registrados.push(archivo);
    } catch (error) {
      errores.push({ archivo, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (!opciones.silencioso) {
    if (registrados.length) log(`registrados ${registrados.length} GGUF locales: ${registrados.join(", ")}`);
    for (const e of errores) log(`no se pudo registrar ${e.archivo}: ${e.error}`);
  }
  return { registrados, errores, total: candidatos.length };
}

/** @returns {any[]} */
export function listarInstalados() {
  const registro = leerRegistro();
  return Object.entries(registro.modelos).map(([clave, m]) => ({
    clave,
    nombre: m.nombre || clave,
    archivo: m.archivo,
    bytes: tamanoArchivo(m.archivo) || Number(m.bytes) || 0,
    esperado: Number(m.bytes) || 0,
    existe: existeArchivo(m.archivo) && (!m.bytes || tamanoArchivo(m.archivo) === Number(m.bytes)),
    rol: m.rol || "",
    uso: m.uso || "",
    origen: m.origen || "",
    licencia: m.licencia || "",
    vision: Boolean(m.vision?.archivo && existeArchivo(m.vision.archivo)),
    visionArchivo: m.vision?.archivo || "",
    visionBytes: Number(m.vision?.bytes) || 0,
    plan: m.plan || null,
    servidor: m.servidor || null,
    pruebas: m.pruebas || null,
    contextos: Array.isArray(m.contextos) ? m.contextos : [],
    contextoMaximo: Number(m.contextoMaximo) || 0,
    contextoPorDefecto: Number(m.contextoPorDefecto) || 0,
    capacidades: Array.isArray(m.capacidades) ? m.capacidades : [],
    pensar: m.pensar || null,
    muestreo: m.muestreo || null,
    instalado: m.instalado || "",
    fuente: m.fuente || "hub",
    oculto: m.oculto === true,
  })).sort((a, b) =>
    (Number(b.pruebas?.coding?.global) || 0) - (Number(a.pruebas?.coding?.global) || 0) ||
    (Number(b.pruebas?.webapp?.global) || 0) - (Number(a.pruebas?.webapp?.global) || 0) ||
    a.nombre.localeCompare(b.nombre, "es"));
}

/** @returns {any} */
export function leerCurado() {
  try {
    const raw = JSON.parse(fs.readFileSync(CURATED_FILE, "utf8"));
    const modelos = Array.isArray(raw) ? raw : Array.isArray(raw.modelos) ? raw.modelos : [];
    return { ...(Array.isArray(raw) ? {} : raw), modelos };
  } catch {
    return { version: 1, modelos: [] };
  }
}

/**
 * Catálogo para la interfaz: curado + instalados, con estimación de encaje.
 * @param {{libreMiB?: number}} [opciones]
 */
export async function catalogoHub(opciones = {}) {
  const vr = await vramInfo();
  const libre = Number(opciones.libreMiB) || Math.max(4096, vr.totalMiB - 232);
  const instalados = listarInstalados();
  const registro = leerRegistro();
  const porRepo = new Map();
  for (const m of Object.values(registro.modelos)) {
    if (m.origen) porRepo.set(String(m.origen).replace(/\/$/, ""), m);
  }
  const curados = leerCurado().modelos.map((m) => {
    const repo = String(m.repo || "").replace(/\/$/, "");
    const instalado = repo ? porRepo.get(`https://huggingface.co/${repo}`) : null;
    const kv = Number(m.kvF16BytesPorToken) || 131072;
    // Vista previa de un MoE aún no instalado: se estima el 84 % del GGUF como
    // expertos. El plan exacto se calcula al descargar, leyendo la tabla real.
    const capasMoe = Math.max(1, Math.trunc(Number(m.capas) || 48));
    const moeBytes = m.moe ? Math.round((Number(m.bytes) || 0) * 0.84) : 0;
    const plan = planAuto({
      bytes: Number(m.bytes) || 0,
      kvF16BytesPorToken: kv,
      ctxNativo: Number(m.ctxNativo) || 32768,
      vision: m.vision?.bytes ? { bytes: Number(m.vision.bytes) } : false,
      nombre: m.nombre,
      moe: moeBytes ? {
        bytes: moeBytes,
        capas: capasMoe,
        expertos: 0,
        porCapa: Array.from({ length: capasMoe }, () => Math.round(moeBytes / capasMoe)),
      } : null,
    }, { libreMiB: libre, reservaMiB: 850, margenMiB: 300, ramTotalMiB: Math.round(os.totalmem() / MIB) });
    return {
      ...m,
      instalado: Boolean(instalado),
      claveInstalada: instalado?.clave || "",
      plan: instalado?.plan || plan,
      visionIncluida: Boolean(m.vision?.archivo),
      tamanoTotalBytes: instalado?.bytes
        ? Number(instalado.bytes) + (Number(instalado.vision?.bytes) || 0)
        : (Number(m.bytes) || 0) + (Number(m.vision?.bytes) || 0),
    };
  });
  return {
    modelos: curados,
    instalados,
    trabajos: listarTrabajos(),
    vram: vr,
    librePlanMiB: libre,
    modelosDir: MODELS_DIR,
  };
}

/**
 * @param {string} q
 * @param {{limit?: number}} [opciones]
 */
