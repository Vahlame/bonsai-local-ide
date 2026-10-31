/**
 * Model Hub: catálogo, descarga reanudable, registro local y plan de motor.
 *
 * Fuentes:
 *   · config/model-catalog.json  catálogo curado (HF y enlaces directos);
 *   · Hugging Face API           búsqueda e inspección de repos;
 *   · URL directa                cualquier .gguf HTTPS;
 *   · models/*.gguf              modelos ya presentes se registran solos.
 *
 * Los modelos descargados se guardan en `models/` y se añaden a
 * `models/hub-catalog.json` (ignorado por Git). Al importar este módulo, esas
 * entradas se fusionan en `MODELO.catalogo`, así que el resto del IDE (selector,
 * lanzador, cambio en caliente, pruebas) las ve como modelos normales.
 *
 * No hay dependencias externas: usa fetch, crypto y streams de Node.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MODELO } from "./modelo.mjs";
import {
  arquitecturaDesdeGGUF,
  entradaCatalogoDesdeGGUF,
  leerMetadatosGGUF,
  nombreArchivoSeguro,
  planAuto,
} from "./model-plan.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const MIB = 1024 * 1024;
export const MODELS_DIR = path.resolve(process.env.BONSAI_MODELS_DIR || path.join(PROJECT, "models"));
export const HUB_FILE = path.resolve(process.env.BONSAI_HUB_CATALOG || path.join(MODELS_DIR, "hub-catalog.json"));
export const CURATED_FILE = path.resolve(process.env.BONSAI_CURATED_CATALOG || path.join(PROJECT, "config", "model-catalog.json"));
const ALLOW_PRIVATE = process.env.BONSAI_HUB_ALLOW_PRIVATE === "1";
const USER_AGENT = "Bonsai-Model-Hub/1.0 (+https://github.com/Vahlame/bonsai-local-ide)";
const MAX_PARALELOS = 2;

/** @typedef {{archivo: string, url: string, bytes: number, sha256?: string, tipo: "modelo"|"vision"}} ArchivoDescarga */
/** @typedef {{id: string, clave: string, nombre: string, repo?: string, origen: string, archivos: ArchivoDescarga[], estado: string, progreso: number, bytesHechos: number, totalBytes: number, velocidad: number, eta: number, archivoActual: string, error: string, inicio: number, fin: number, cancelado: boolean}} Trabajo */

/** @type {Map<string, Trabajo>} */
const trabajos = new Map();
/** @type {{version: number, actualizado: string, modelos: Record<string, any>} | null} */
let registroCache = null;
let registroMtime = -1;
/** @type {Map<string, AbortController>} */
const abortos = new Map();

function log(...args) {
  process.stderr.write(`[model-hub] ${args.join(" ")}\n`);
}

/**
 * @param {unknown} v
 * @returns {any}
 */
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

function existeArchivo(archivo) {
  try {
    return fs.statSync(path.join(MODELS_DIR, archivo)).isFile();
  } catch {
    return false;
  }
}

function tamanoArchivo(archivo) {
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
    instalado: m.instalado || "",
    fuente: m.fuente || "hub",
    oculto: m.oculto === true,
  })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
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
export async function buscarHuggingFace(q, opciones = {}) {
  const consulta = String(q || "").trim();
  if (!consulta) return [];
  const limite = Math.max(1, Math.min(40, Number(opciones.limit) || 24));
  const url = new URL("https://huggingface.co/api/models");
  url.searchParams.set("search", consulta);
  url.searchParams.set("filter", "gguf");
  url.searchParams.set("sort", "downloads");
  url.searchParams.set("direction", "-1");
  url.searchParams.set("limit", String(limite));
  url.searchParams.set("full", "true");
  const datos = await pedirJson(url.toString());
  if (!Array.isArray(datos)) return [];
  return datos
    .filter((m) => !m.private && (m.tags || []).some((t) => String(t).toLowerCase() === "gguf"))
    .map((m) => ({
      repo: m.id,
      nombre: m.id,
      descargas: Number(m.downloads) || 0,
      likes: Number(m.likes) || 0,
      actualizado: m.lastModified || "",
      licencia: m.cardData?.license || (m.tags || []).find((t) => String(t).startsWith("license:"))?.slice(8) || "",
      etiquetas: m.tags || [],
      tarea: m.pipeline_tag || "",
    }));
}

/**
 * Catálogo online de novedades: los GGUF con más tracción ahora mismo.
 * Es la pestaña "Descubrir"; no descarga nada hasta que el usuario elige.
 * @param {{limit?: number, sort?: string}} [opciones]
 */
export async function descubrirHuggingFace(opciones = {}) {
  const limite = Math.max(1, Math.min(60, Number(opciones.limit) || 30));
  const orden = ["trendingScore", "downloads", "likes", "lastModified"].includes(String(opciones.sort))
    ? String(opciones.sort)
    : "trendingScore";
  const url = new URL("https://huggingface.co/api/models");
  url.searchParams.set("filter", "gguf");
  url.searchParams.set("sort", orden);
  url.searchParams.set("direction", "-1");
  url.searchParams.set("limit", String(limite));
  url.searchParams.set("full", "true");
  const datos = await pedirJson(url.toString());
  if (!Array.isArray(datos)) return [];
  return datos
    .filter((m) => !m.private)
    .map((m) => ({
      repo: m.id,
      nombre: m.id,
      descargas: Number(m.downloads) || 0,
      likes: Number(m.likes) || 0,
      actualizado: m.lastModified || "",
      licencia: m.cardData?.license || (m.tags || []).find((t) => String(t).startsWith("license:"))?.slice(8) || "",
      etiquetas: (m.tags || []).filter((t) => !String(t).startsWith("base_model:") && !String(t).startsWith("license:")),
      tarea: m.pipeline_tag || "",
      vision: (m.tags || []).some((t) => /vision|multimodal|image-text|image-to-text/i.test(String(t))),
      tendencia: Number(m.trendingScore) || 0,
    }));
}

/** @param {string} repo */
export async function inspeccionarRepo(repo) {
  const id = String(repo || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new Error(`repo de Hugging Face no válido: ${repo}`);
  const datos = await pedirJson(`https://huggingface.co/api/models/${id}?blobs=true`);
  if (!datos || !Array.isArray(datos.siblings)) throw new Error(`no se pudo leer el repo ${id}`);
  const archivos = datos.siblings
    .filter((s) => /\.gguf$/i.test(String(s.rfilename || "")))
    .map((s) => {
      const nombre = String(s.rfilename);
      return {
        archivo: nombre,
        bytes: Number(s.size) || 0,
        quant: (nombre.match(/(?:^|[-_.])((?:IQ|Q|UD-Q|UD-IQ)\d[^./]*|f16|bf16|q8_0|q4_0)/i) || [])[1] || "",
        vision: /^mmproj/i.test(nombre) || /mmproj/i.test(nombre),
        lfs: s.lfs?.oid || "",
      };
    })
    .sort((a, b) => Number(a.vision) - Number(b.vision) || a.bytes - b.bytes);
  return {
    repo: id,
    revision: datos.sha || "main",
    nombre: id,
    descargas: Number(datos.downloads) || 0,
    likes: Number(datos.likes) || 0,
    licencia: datos.cardData?.license || "",
    actualizado: datos.lastModified || "",
    gated: Boolean(datos.gated),
    archivos,
    principales: archivos.filter((a) => !a.vision),
    proyectores: archivos.filter((a) => a.vision),
  };
}

/**
 * @param {string} url
 * @param {number} [timeout]
 */
async function pedirJson(url, timeout = 20000) {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al leer ${url}`);
  return res.json();
}

/**
 * Valida una URL de descarga. Solo HTTPS; por defecto rechaza hosts privados.
 * @param {string} url
 * @param {{allowPrivate?: boolean}} [opciones]
 * @returns {URL}
 */
export function validarUrl(url, opciones = {}) {
  const permitirPrivado = opciones.allowPrivate ?? ALLOW_PRIVATE;
  let u;
  try {
    u = new URL(String(url));
  } catch {
    throw new Error(`URL no válida: ${url}`);
  }
  if (u.username || u.password) throw new Error("la URL no puede llevar credenciales");
  if (u.protocol === "https:") return comprobarHost(u, permitirPrivado);
  if (permitirPrivado && u.protocol === "http:") return comprobarHost(u, permitirPrivado);
  throw new Error("la descarga debe usar HTTPS");
}

/** @param {URL} u @param {boolean} permitirPrivado */
function comprobarHost(u, permitirPrivado) {
  if (permitirPrivado) return u;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privado = host === "localhost" || host === "::1" || host.endsWith(".local") ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^0\.0\.0\.0$/.test(host) || /^fc|^fd|^fe80/i.test(host);
  if (privado) throw new Error(`host privado no permitido para descargas: ${host}`);
  return u;
}

/**
 * Lee tamaño y SHA-256 de un archivo remoto sin descargarlo. HF expone
 * `x-linked-etag` con el SHA-256 del blob; si no, se usa ETag o el valor
 * aportado por el catálogo curado.
 * @param {string} url
 * @returns {Promise<{bytes: number, sha256: string, aceptaRangos: boolean}>}
 */
export async function cabeceraRemota(url) {
  const u = validarUrl(url);
  // HF responde 302 hacia su CDN y el SHA-256 del blob viaja en la cabecera
  // `x-linked-etag` DE LA REDIRECCIÓN. Con redirect:"follow" se pierde, así
  // que se pide manualmente y después se completa el tamaño en el destino.
  try {
    const res = await fetch(u, { method: "HEAD", redirect: "manual", headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(25000) });
    if (res.status >= 300 && res.status < 400) {
      const cab = leerCabecera(res);
      const destino = res.headers.get("location");
      if (destino) {
        try {
          const final = await fetch(new URL(destino, u), { method: "HEAD", redirect: "follow", headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(25000) });
          if (final.ok) {
            const tam = Number(final.headers.get("content-length") || 0) || 0;
            if (!cab.bytes && tam) cab.bytes = tam;
          }
        } catch { /* el tamaño puede venir de x-linked-size */ }
      }
      if (cab.bytes) return cab;
    } else if (res.ok) {
      return leerCabecera(res);
    }
  } catch {
    /* algunos CDN no admiten HEAD; se prueba un GET de 1 byte */
  }
  const res = await fetch(u, { headers: { "user-agent": USER_AGENT, range: "bytes=0-0" }, redirect: "follow", signal: AbortSignal.timeout(25000) });
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} al inspeccionar ${url}`);
  const cab = leerCabecera(res);
  const rango = String(res.headers.get("content-range") || "");
  const m = rango.match(/bytes\s+\d+-\d+\/(\d+)/i);
  if (!cab.bytes && m) cab.bytes = Number(m[1]);
  if (res.body) {
    try { await res.body.cancel(); } catch { /* el cuerpo de 1 byte da igual */ }
  }
  return cab;
}

/** @param {Response} res */
function leerCabecera(res) {
  const h = res.headers;
  const etag = String(h.get("x-linked-etag") || h.get("etag") || "").replace(/^W\//, "").replace(/^"|"$/g, "");
  const sha = /^[a-f0-9]{64}$/i.test(etag) ? etag.toLowerCase() : "";
  const bytes = Number(h.get("x-linked-size") || h.get("content-length") || 0) || 0;
  return { bytes, sha256: sha, aceptaRangos: String(h.get("accept-ranges") || "").toLowerCase().includes("bytes") };
}

/**
 * Inspecciona un archivo de un repo de Hugging Face y devuelve la URL fijada a
 * la revisión (commit), no a `main`, para que la descarga sea reproducible.
 * @param {string} repo
 * @param {string} archivo
 * @param {string} [revision]
 */
export async function archivoHF(repo, archivo, revision = "main") {
  const id = String(repo || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new Error(`repo no válido: ${repo}`);
  const limpio = String(archivo || "").replace(/\\/g, "/");
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._()+@/-]*\.gguf$/i.test(limpio) || limpio.includes("..")) {
    throw new Error(`archivo no válido: ${archivo}`);
  }
  const nombre = nombreArchivoSeguro(path.basename(limpio));
  const rev = String(revision || "main");
  if (!/^[A-Za-z0-9._-]+$/.test(rev)) throw new Error(`revisión no válida: ${revision}`);
  const ruta = limpio.split("/").map((s) => encodeURIComponent(s)).join("/");
  const url = `https://huggingface.co/${id}/resolve/${rev}/${ruta}`;
  const cab = await cabeceraRemota(url);
  return { url, archivo: nombre, bytes: cab.bytes, sha256: cab.sha256, revision: rev, repo: id };
}

/**
 * @param {unknown} url
 * @param {{nombre?: string, bytes?: number, sha256?: string}} [datos]
 */
export async function archivoUrlDirecta(url, datos = {}) {
  const u = validarUrl(String(url));
  const nombre = nombreArchivoSeguro(datos.nombre || decodeURIComponent(path.basename(u.pathname)));
  const cab = await cabeceraRemota(u.toString());
  return {
    url: u.toString(),
    archivo: nombre,
    bytes: Number(datos.bytes) || cab.bytes,
    sha256: String(datos.sha256 || cab.sha256 || "").toLowerCase(),
    revision: "",
    repo: "",
  };
}

/**
 * Crea un trabajo de descarga. No espera a que termine.
 * @param {{
 *   clave?: string, nombre?: string, repo?: string, revision?: string,
 *   archivo?: string, url?: string, bytes?: number, sha256?: string,
 *   vision?: {archivo: string, bytes?: number, sha256?: string, url?: string},
 *   rol?: string, uso?: string, licencia?: string, origen?: string,
 *   pensar?: any, muestreo?: any, agente?: any, toolcalls?: string,
 * }} pedido
 */
export async function crearTrabajo(pedido = {}) {
  const activos = [...trabajos.values()].filter((t) => t.estado === "descargando" || t.estado === "verificando" || t.estado === "instalando");
  if (activos.length >= MAX_PARALELOS) throw new Error(`ya hay ${activos.length} descargas en curso; espera o cancela una`);
  /** @type {ArchivoDescarga[]} */
  const archivos = [];
  let origen = String(pedido.origen || "");
  let repo = String(pedido.repo || "");
  let revision = String(pedido.revision || "main");
  let clave = String(pedido.clave || "");
  let nombre = String(pedido.nombre || "");
  let licencia = String(pedido.licencia || "");
  /** Prefijo local para no pisar proyectores homónimos de otros modelos. */
  const localizar = (a, prefijo) => {
    const p = String(prefijo || "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
    return p ? { ...a, archivo: nombreArchivoSeguro(`${p}-${a.archivo}`) } : a;
  };

  if (pedido.url && !pedido.repo) {
    const a = await archivoUrlDirecta(pedido.url, { nombre: pedido.archivo || pedido.nombre, bytes: pedido.bytes, sha256: pedido.sha256 });
    archivos.push({ ...a, tipo: "modelo" });
    origen = origen || "url";
  } else {
    if (!pedido.repo && pedido.clave) {
      const curado = leerCurado().modelos.find((m) => m.clave === pedido.clave || m.id === pedido.clave);
      if (!curado) throw new Error(`la clave ${pedido.clave} no está en el catálogo curado`);
      repo = curado.repo || "";
      revision = curado.revision || "main";
      nombre = nombre || curado.nombre || "";
      licencia = licencia || curado.licencia || "";
      origen = origen || (repo ? `https://huggingface.co/${repo}` : "");
      if (repo && curado.archivo) {
        const a = await archivoHF(repo, curado.archivo, revision);
        archivos.push({ ...localizar(a, curado.clave || clave), bytes: Number(curado.bytes) || a.bytes, sha256: curado.sha256 || a.sha256, tipo: "modelo" });
      }
      if (curado.vision?.archivo) {
        if (curado.vision.url) {
          const a = await archivoUrlDirecta(curado.vision.url, { nombre: curado.vision.archivo, bytes: curado.vision.bytes, sha256: curado.vision.sha256 });
          archivos.push({ ...localizar(a, curado.clave || clave), tipo: "vision" });
        } else if (repo) {
          const a = await archivoHF(repo, curado.vision.archivo, revision);
          archivos.push({ ...localizar(a, curado.clave || clave), bytes: Number(curado.vision.bytes) || a.bytes, sha256: curado.vision.sha256 || a.sha256, tipo: "vision" });
        }
      }
      if (curado.url && !archivos.length) {
        const a = await archivoUrlDirecta(curado.url, { nombre: curado.archivo || curado.nombre, bytes: curado.bytes, sha256: curado.sha256 });
        archivos.push({ ...localizar(a, curado.clave || clave), tipo: "modelo" });
        origen = origen || "url";
      }
    } else {
      if (!repo || !pedido.archivo) throw new Error("faltan repo y archivo para descargar");
      const a = await archivoHF(repo, pedido.archivo, revision);
      const prefijo = String(pedido.clave || repo.split("/").pop() || "modelo");
      archivos.push({ ...localizar(a, prefijo), bytes: Number(pedido.bytes) || a.bytes, sha256: pedido.sha256 || a.sha256, tipo: "modelo" });
      origen = origen || `https://huggingface.co/${repo}`;
      if (pedido.vision?.archivo) {
        const v = await archivoHF(repo, pedido.vision.archivo, revision);
        archivos.push({ ...localizar(v, prefijo), bytes: Number(pedido.vision.bytes) || v.bytes, sha256: pedido.vision.sha256 || v.sha256, tipo: "vision" });
      }
    }
  }
  if (!archivos.length) throw new Error("no hay archivos que descargar");
  for (const a of archivos) {
    if (!a.bytes) throw new Error(`no se pudo saber el tamaño de ${a.archivo}`);
    if (existeArchivo(a.archivo) && tamanoArchivo(a.archivo) === a.bytes) {
      a.url = ""; // ya está entero; se omite la descarga
    }
  }
  const total = archivos.reduce((s, a) => s + (a.url ? a.bytes : 0), 0);
  const id = `dl_${crypto.randomBytes(8).toString("hex")}`;
  /** @type {Trabajo} */
  const trabajo = {
    id,
    clave: clave || "",
    nombre: nombre || archivos[0].archivo.replace(/\.gguf$/i, ""),
    repo,
    origen: origen || (repo ? `https://huggingface.co/${repo}` : "url"),
    archivos,
    estado: total > 0 ? "descargando" : "instalando",
    progreso: total > 0 ? 0 : 100,
    bytesHechos: 0,
    totalBytes: total,
    velocidad: 0,
    eta: 0,
    archivoActual: "",
    error: "",
    inicio: Date.now(),
    fin: 0,
    cancelado: false,
  };
  trabajos.set(id, trabajo);
  void ejecutarTrabajo(trabajo, pedido).catch((error) => {
    trabajo.estado = "error";
    trabajo.error = error instanceof Error ? error.message : String(error);
    trabajo.fin = Date.now();
    log(`descarga ${id} falló: ${trabajo.error}`);
  });
  return { id, trabajo: publicoTrabajo(trabajo) };
}

/** @param {Trabajo} t */
function publicoTrabajo(t) {
  return {
    id: t.id,
    clave: t.clave,
    nombre: t.nombre,
    repo: t.repo,
    origen: t.origen,
    estado: t.estado,
    progreso: Math.round(t.progreso * 10) / 10,
    bytesHechos: t.bytesHechos,
    totalBytes: t.totalBytes,
    velocidad: Math.round(t.velocidad),
    eta: Math.round(t.eta),
    archivoActual: t.archivoActual,
    error: t.error,
    inicio: t.inicio,
    fin: t.fin,
  };
}

export function listarTrabajos() {
  return [...trabajos.values()].map(publicoTrabajo).sort((a, b) => b.inicio - a.inicio);
}

/** @param {string} id */
export function cancelarTrabajo(id) {
  const t = trabajos.get(id);
  if (!t) throw new Error(`descarga desconocida: ${id}`);
  if (["listo", "error", "cancelado"].includes(t.estado)) return publicoTrabajo(t);
  t.cancelado = true;
  t.estado = "cancelado";
  t.fin = Date.now();
  abortos.get(id)?.abort();
  return publicoTrabajo(t);
}

/**
 * @param {Trabajo} trabajo
 * @param {Record<string, any>} pedido
 */
async function ejecutarTrabajo(trabajo, pedido) {
  try {
    for (const archivo of trabajo.archivos) {
      if (!archivo.url) continue;
      if (trabajo.cancelado) throw new Error("descarga cancelada");
      trabajo.archivoActual = archivo.archivo;
      const antes = trabajo.bytesHechos;
      await descargarArchivo(trabajo, archivo);
      trabajo.bytesHechos = antes + archivo.bytes;
    }
    if (trabajo.cancelado) throw new Error("descarga cancelada");
    trabajo.estado = "verificando";
    trabajo.progreso = 100;
    const principal = trabajo.archivos.find((a) => a.tipo === "modelo");
    const proyector = trabajo.archivos.find((a) => a.tipo === "vision");
    if (!principal) throw new Error("no hay archivo principal");
    if (!existeArchivo(principal.archivo) || (principal.bytes && tamanoArchivo(principal.archivo) !== principal.bytes)) {
      throw new Error(`el archivo principal no quedó entero: ${principal.archivo}`);
    }
    trabajo.estado = "instalando";
    const curado = leerCurado().modelos.find((m) => m.clave === pedido.clave || (pedido.repo && m.repo === pedido.repo));
    const vision = proyector && existeArchivo(proyector.archivo)
      ? { archivo: proyector.archivo, bytes: proyector.bytes, sha256: proyector.sha256 }
      : null;
    const entrada = await registrarArchivo(principal.archivo, {
      clave: pedido.clave || trabajo.clave || curado?.clave || curado?.id || "",
      nombre: pedido.nombre || curado?.nombre || trabajo.nombre,
      rol: pedido.rol || curado?.rol || "modelo descargado",
      uso: pedido.uso || curado?.uso || "Modelo descargado desde el catálogo. El plan se calcula con su GGUF real.",
      origen: trabajo.origen,
      revision: pedido.revision || curado?.revision || "",
      licencia: pedido.licencia || curado?.licencia || "",
      vision,
      pensar: pedido.pensar || curado?.pensar,
      muestreo: pedido.muestreo || curado?.muestreo,
      agente: pedido.agente || curado?.agente,
      toolcalls: pedido.toolcalls || curado?.toolcalls,
      oculto: Boolean(pedido.oculto || curado?.oculto),
      draftPara: pedido.draftPara || curado?.draftPara,
      draft: pedido.draft || curado?.draft,
      fuente: "hub",
    });
    trabajo.clave = entrada.clave;
    trabajo.nombre = entrada.nombre;
    trabajo.estado = "listo";
    trabajo.fin = Date.now();
    trabajo.progreso = 100;
    fusionarCatalogo();
    log(`instalado ${entrada.clave} (${entrada.archivo})`);
  } catch (error) {
    trabajo.estado = trabajo.cancelado ? "cancelado" : "error";
    trabajo.error = error instanceof Error ? error.message : String(error);
    trabajo.fin = Date.now();
  } finally {
    abortos.delete(trabajo.id);
  }
}

/**
 * Descarga un archivo con reanudación. Si el servidor ignora el Range, reinicia
 * el .part desde cero (nunca concatena bytes en el orden equivocado).
 * @param {Trabajo} trabajo
 * @param {ArchivoDescarga} archivo
 */
async function descargarArchivo(trabajo, archivo) {
  const destino = path.join(MODELS_DIR, nombreArchivoSeguro(archivo.archivo));
  const parte = `${destino}.part`;
  if (existeArchivo(archivo.archivo) && tamanoArchivo(archivo.archivo) === archivo.bytes) {
    if (archivo.sha256) {
      const sha = await sha256Archivo(destino);
      if (sha !== archivo.sha256.toLowerCase()) throw new Error(`SHA-256 no coincide para ${archivo.archivo} (¿archivo ya existente distinto?)`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  let offset = fs.existsSync(parte) ? fs.statSync(parte).size : 0;
  if (offset > archivo.bytes) {
    fs.rmSync(parte, { force: true });
    offset = 0;
  }
  const control = new AbortController();
  abortos.set(trabajo.id, control);
  const url = validarUrl(archivo.url).toString();
  const headers = { "user-agent": USER_AGENT };
  if (offset > 0) headers.range = `bytes=${offset}-`;
  const res = await fetch(url, { headers, redirect: "follow", signal: control.signal });
  if (res.status === 416 && offset === archivo.bytes) {
    await finalizarParte(parte, destino, archivo);
    return;
  }
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} al descargar ${archivo.archivo}`);
  // Si se pidió un rango y el servidor responde 200, está mandando el archivo
  // completo desde el byte 0: se reescribe el .part, no se añade.
  const desdeCero = offset > 0 && res.status !== 206;
  if (desdeCero || !res.body) {
    if (!res.body) throw new Error(`respuesta sin cuerpo para ${archivo.archivo}`);
    offset = 0;
  }
  const salida = fs.createWriteStream(parte, { flags: desdeCero || offset === 0 ? "w" : "a" });
  const reader = res.body.getReader();
  let hechos = offset;
  const previos = trabajoBytesPrevios(trabajo, archivo);
  let ultimo = Date.now();
  let bytesVentana = 0;
  try {
    while (true) {
      if (trabajo.cancelado) throw new Error("descarga cancelada");
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      await new Promise((resolve, reject) => {
        salida.write(Buffer.from(value), (err) => (err ? reject(err) : resolve(undefined)));
      });
      hechos += value.byteLength;
      bytesVentana += value.byteLength;
      trabajo.bytesHechos = previos + hechos;
      const ahora = Date.now();
      if (ahora - ultimo >= 500) {
        const segundos = (ahora - ultimo) / 1000;
        trabajo.velocidad = bytesVentana / segundos;
        trabajo.eta = trabajo.velocidad > 0 ? Math.max(0, (archivo.bytes - hechos) / trabajo.velocidad) : 0;
        trabajo.progreso = trabajo.totalBytes > 0 ? Math.min(99, ((previos + hechos) / trabajo.totalBytes) * 100) : 0;
        ultimo = ahora;
        bytesVentana = 0;
      }
    }
  } finally {
    await new Promise((resolve) => salida.end(resolve));
    try { await reader.cancel(); } catch { /* ya terminó */ }
  }
  const talla = fs.statSync(parte).size;
  if (talla !== archivo.bytes) throw new Error(`descarga incompleta de ${archivo.archivo}: ${talla}/${archivo.bytes} bytes (se conserva el .part para reanudar)`);
  await finalizarParte(parte, destino, archivo);
  trabajo.bytesHechos = previos + talla;
}

/** @param {Trabajo} t @param {ArchivoDescarga} a */
function trabajoBytesPrevios(t, a) {
  let total = 0;
  for (const x of t.archivos) {
    if (x === a) break;
    total += x.bytes;
  }
  return total;
}

/** @param {string} parte @param {string} destino @param {ArchivoDescarga} archivo */
async function finalizarParte(parte, destino, archivo) {
  if (archivo.sha256) {
    const sha = await sha256Archivo(parte);
    if (sha !== archivo.sha256.toLowerCase()) {
      throw new Error(`SHA-256 no coincide para ${archivo.archivo}: esperado ${archivo.sha256}, obtenido ${sha}`);
    }
  }
  if (fs.existsSync(destino)) fs.rmSync(destino, { force: true });
  fs.renameSync(parte, destino);
}

/** @param {string} ruta */
export function sha256Archivo(ruta) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(ruta);
    stream.on("error", reject);
    stream.on("data", (c) => hash.update(c));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Borra un modelo instalado y sus archivos (solo dentro de models/).
 * @param {string} clave
 * @param {{confirmar?: boolean}} [opciones]
 */
export function borrarModelo(clave, opciones = {}) {
  if (opciones.confirmar !== true) throw new Error("falta confirmar el borrado del modelo");
  let registro;
  try {
    // Se lee del disco, no de la caché: así se respeta lo que otro proceso acaba
    // de añadir o quitar y el borrado no resucita entradas antiguas.
    registro = JSON.parse(fs.readFileSync(HUB_FILE, "utf8"));
  } catch {
    registro = leerRegistro();
  }
  if (!registro || typeof registro.modelos !== "object") registro = { version: 1, actualizado: "", modelos: {} };
  const entrada = registro.modelos[clave];
  if (!entrada) throw new Error(`modelo no instalado: ${clave}`);
  const archivos = [entrada.archivo, entrada.vision?.archivo].filter(Boolean);
  for (const archivo of archivos) {
    const seguro = nombreArchivoSeguro(archivo);
    const usado = Object.entries(registro.modelos).some(([k, m]) => k !== clave && (m.archivo === seguro || m.vision?.archivo === seguro));
    if (usado) continue;
    const ruta = path.join(MODELS_DIR, seguro);
    if (fs.existsSync(ruta)) fs.rmSync(ruta, { force: true });
    const parte = `${ruta}.part`;
    if (fs.existsSync(parte)) fs.rmSync(parte, { force: true });
  }
  delete registro.modelos[clave];
  guardarRegistro(registro, { merge: false });
  if (MODELO.catalogo?.[clave]?.fuente === "hub") delete MODELO.catalogo[clave];
  return { ok: true, clave, borrados: archivos };
}

/**
 * Importa un .gguf de fuera de models/ copiándolo al almacén del IDE.
 * @param {string} rutaOriginal
 * @param {{nombre?: string}} [opciones]
 */
export async function importarArchivo(rutaOriginal, opciones = {}) {
  const origen = path.resolve(String(rutaOriginal || ""));
  if (!fs.existsSync(origen) || !fs.statSync(origen).isFile()) throw new Error(`no existe el archivo: ${origen}`);
  const nombre = nombreArchivoSeguro(opciones.nombre || path.basename(origen));
  const destino = path.join(MODELS_DIR, nombre);
  if (path.resolve(destino) === origen) return registrarArchivo(nombre, { fuente: "local" });
  if (fs.existsSync(destino)) throw new Error(`ya existe models/${nombre}; no se sobrescribe`);
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  fs.copyFileSync(origen, destino);
  return registrarArchivo(nombre, { fuente: "local" });
}

/** @returns {{modelos: number, descargasActivas: number, modelosDir: string, hubFile: string}} */
export function resumen() {
  const activas = [...trabajos.values()].filter((t) => ["descargando", "verificando", "instalando"].includes(t.estado));
  return {
    modelos: Object.keys(leerRegistro().modelos).length,
    descargasActivas: activas.length,
    modelosDir: MODELS_DIR,
    hubFile: HUB_FILE,
  };
}
