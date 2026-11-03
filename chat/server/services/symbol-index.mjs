/**
 * Índice nombre → definiciones del proyecto, con caché corta. Se invalida al
 * escribir y se descarta solo, para no servir símbolos de archivos que cambió
 * un comando externo.
 *
 * El escaneo se hace en un worker: indexar miles de archivos no debe bloquear
 * SSE ni las peticiones del editor.
 */
import { Worker } from "node:worker_threads";
import { indiceSimbolos } from "../../diagnosticos.mjs";
import { snapshotFiles } from "../workspace.mjs";

/**
 * @param {{
 *   getRoot: () => string,
 *   indexar?: typeof indiceSimbolos,
 *   snapshot?: typeof snapshotFiles,
 *   ttlMs?: number,
 *   now?: () => number,
 * }} ctx
 */
export function createSymbolIndex(ctx) {
  const indexar = ctx.indexar || indiceSimbolos;
  const snapshot = ctx.snapshot || snapshotFiles;
  const ttlMs = ctx.ttlMs ?? 60_000;
  const now = ctx.now || Date.now;
  /** @type {Map<string, Array<{archivo: string, linea: number, columna: number, tipo: string}>> | null} */
  let cache = null;
  let cacheTs = 0;
  /** @type {Promise<Map<string, any>> | null} */
  let enCurso = null;
  /** @type {Worker | null} */
  let worker = null;

  /**
   * @param {string} root
   * @param {string[]} archivos
   * @returns {Promise<Map<string, any>>}
   */
  function indexarEnWorker(root, archivos) {
    return new Promise((resolve, reject) => {
      let terminado = false;
      const w = new Worker(new URL("../../diagnostics/index-worker.mjs", import.meta.url), {
        workerData: { root, archivos },
      });
      worker = w;
      const cerrar = () => {
        if (terminado) return;
        terminado = true;
        worker = null;
        void w.terminate().catch(() => {});
      };
      w.once("message", (msg) => {
        if (!msg || msg.ok !== true) {
          cerrar();
          reject(new Error(msg?.error || "el worker del índice falló"));
          return;
        }
        cerrar();
        resolve(new Map(msg.entradas));
      });
      w.once("error", (err) => {
        cerrar();
        reject(err);
      });
      w.once("exit", (code) => {
        if (terminado) return;
        terminado = true;
        worker = null;
        reject(new Error(`el worker del índice terminó con código ${code}`));
      });
    });
  }

  /**
   * @returns {Promise<Map<string, Array<{archivo: string, linea: number, columna: number, tipo: string}>>>}
   */
  async function get() {
    if (cache && now() - cacheTs < ttlMs) return cache;
    if (enCurso) return enCurso;
    const root = ctx.getRoot();
    const archivos = [...snapshot(root).keys()];
    enCurso = (async () => {
      const indice = ctx.indexar
        ? indexar(root, archivos)
        : await indexarEnWorker(root, archivos);
      cache = indice;
      cacheTs = now();
      return indice;
    })();
    try {
      return await enCurso;
    } finally {
      enCurso = null;
    }
  }

  function invalidate() {
    cache = null;
    cacheTs = 0;
    if (worker) {
      try { void worker.terminate(); } catch { /* ya terminó */ }
      worker = null;
    }
  }

  return { get, invalidate };
}
