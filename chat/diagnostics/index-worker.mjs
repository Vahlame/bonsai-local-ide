/**
 * Worker del índice de símbolos. Mantiene el escaneo de hasta 4.000 archivos
 * fuera del event loop del servidor.
 */
import { parentPort, workerData } from "node:worker_threads";
import { indiceSimbolos } from "./symbols.mjs";

try {
  const archivos = Array.isArray(workerData.archivos) ? workerData.archivos : null;
  const indice = indiceSimbolos(workerData.root, archivos);
  parentPort?.postMessage({ ok: true, entradas: [...indice.entries()] });
} catch (err) {
  parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
}
