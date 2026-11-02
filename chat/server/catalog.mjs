/**
 * Catalogo de modelos del IDE: que GGUF esta entero, cual es el recomendado y
 * que eleccion quedo guardada. Es estado de modelo, no de la conversacion.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODELO } from "../modelo.mjs";
import { MODELS_DIR, fusionarCatalogo } from "../model-hub.mjs";

const CHAT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/** Carpeta de los GGUF y catalogo de modelos que se pueden cargar en caliente. */
export const MODELOS_DIR = MODELS_DIR;
const MODELO_ACTIVO = path.join(CHAT_DIR, "modelo-activo.json");

/**
 * Clave del modelo guardado en disco ("" si no hay archivo o esta ilegible).
 * @returns {string}
 */
export function modeloGuardadoClave() {
  try {
    const raw = JSON.parse(fs.readFileSync(MODELO_ACTIVO, "utf8"));
    return raw && typeof raw.clave === "string" ? raw.clave.trim() : "";
  } catch {
    return "";
  }
}

/**
 * Persiste la eleccion de modelo. Se llama SOLO cuando el modelo nuevo ya contesto:
 * asi el archivo nunca apunta a uno que no llego a cargar.
 * @param {{clave: string, archivo: string}} item
 * @returns {void}
 */
export function guardarModeloActivo(item) {
  const tmp = `${MODELO_ACTIVO}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({
    clave: item.clave,
    archivo: item.archivo,
    actualizado: new Date().toISOString(),
  }, null, 2), "utf8");
  fs.renameSync(tmp, MODELO_ACTIVO);
}

/**
 * Catalogo de modelos de `chat/modelo.json`, con si el GGUF esta entero en disco.
 * @returns {Array<{clave: string, nombre: string, archivo: string, bytes: number, esperado: number, rol: string, uso: string, existe: boolean, predeterminado: boolean, recomendado: boolean, tareas: number}>}
 */
export function catalogoModelos() {
  fusionarCatalogo();
  const out = [];
  const cat = MODELO.catalogo || {};
  for (const clave of Object.keys(cat)) {
    if (clave.startsWith("_")) continue;
    const row = cat[clave];
    if (!row || typeof row.archivo !== "string") continue;
    let bytes = 0;
    try {
      bytes = fs.statSync(path.join(MODELOS_DIR, row.archivo)).size;
    } catch {
      bytes = 0;
    }
    const esperado = Number(row.bytes) || 0;
    out.push({
      clave,
      nombre: typeof row.nombre === "string" && row.nombre ? row.nombre : clave,
      archivo: row.archivo,
      bytes,
      esperado,
      rol: typeof row.rol === "string" ? row.rol : "",
      uso: typeof row.uso === "string" ? row.uso : "",
      existe: bytes > 0 && (esperado === 0 || bytes === esperado),
      gpuCompleta: row.servidor?.tipo === "gpu-completa" || row.servidor?.tipo === "moe-hibrido" || row.servidor?.tipo === "gpu-parcial",
      margenObjetivoMiB: Number(row.servidor?.margenObjetivoMiB) || 0,
      predeterminado: clave === MODELO.modeloPredeterminado,
      recomendado: clave === MODELO.modeloRecomendado,
      tareas: Number(MODELO.benchmarkTareas?.[clave]) || 0,
      fuente: typeof row.fuente === "string" ? row.fuente : "curado",
      origen: typeof row.origen === "string" ? row.origen : "",
      licencia: typeof row.licencia === "string" ? row.licencia : "",
      oculto: row.oculto === true,
      vision: Boolean(row.vision?.archivo && mmprojDisponible(clave)),
      visionArchivo: typeof row.vision?.archivo === "string" ? row.vision.archivo : "",
      plan: row.plan || null,
      pruebas: row.pruebas || null,
      contextos: Array.isArray(row.contextos) ? row.contextos : [],
      contextoMaximo: Number(row.contextoMaximo) || 0,
      contextoPorDefecto: Number(row.contextoPorDefecto) || 0,
      capacidades: Array.isArray(row.capacidades) ? row.capacidades : [],
      etiquetas: Array.isArray(row.etiquetas) ? row.etiquetas : [],
      pensar: row.pensar || null,
      muestreo: row.muestreo || null,
    });
  }
  out.sort((a, b) =>
    (a.oculto ? 1 : 0) - (b.oculto ? 1 : 0) ||
    (Number(b.recomendado) || 0) - (Number(a.recomendado) || 0) ||
    (Number(b.tareas) || 0) - (Number(a.tareas) || 0) ||
    (Number(b.pruebas?.coding?.global) || 0) - (Number(a.pruebas?.coding?.global) || 0) ||
    (Number(b.pruebas?.webapp?.global) || 0) - (Number(a.pruebas?.webapp?.global) || 0) ||
    String(a.nombre).localeCompare(String(b.nombre), "es"));
  return out;
}

/** Esta el proyector de vision descargado y entero? */
export function mmprojDisponible(clave) {
  const config = MODELO.catalogo?.[clave]?.vision;
  if (config === false) return false;
  const vision = config?.archivo ? config : MODELO.vision;
  const archivo = vision?.archivo;
  if (!archivo) return false;
  try {
    const bytes = fs.statSync(path.join(MODELOS_DIR, archivo)).size;
    return bytes > 0 && (!vision.bytes || bytes === Number(vision.bytes));
  } catch {
    return false;
  }
}
