/**
 * Lectura de GPU/RAM para el medidor. Cachea nvidia-smi durante ~1 s para no
 * lanzar un proceso por cada pestana o refresco de la UI.
 */
import os from "node:os";
import { execFile } from "node:child_process";

/** @type {{at: number, data: Record<string, unknown>}} */
let gpuCache = { at: 0, data: { ok: false } };

/** Fuerza una medicion nueva (p. ej. antes de adjuntar una imagen). */
export function resetGpuCache() {
  gpuCache.at = 0;
}

/**
 * @returns {Promise<Record<string, unknown>>}
 */
export function readGpu() {
  if (Date.now() - gpuCache.at < 900) return Promise.resolve(gpuCache.data);
  return new Promise((resolve) => {
    const fields = "name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,enforced.power.limit,clocks.sm,clocks.max.sm,pstate,power.default_limit,memory.free";
    execFile("nvidia-smi", [`--query-gpu=${fields}`, "--format=csv,noheader,nounits"], { timeout: 3000, windowsHide: true }, (err, stdout) => {
      const mem = { ramFreeMiB: Math.round(os.freemem() / 1048576), ramTotalMiB: Math.round(os.totalmem() / 1048576) };
      let data = { ok: false, ...mem };
      if (!err) {
        const p = String(stdout).trim().split("\n")[0].split(",").map((s) => s.trim());
        const n = (i) => (Number.isFinite(Number(p[i])) ? Number(p[i]) : null);
        if (p.length >= 10) {
          data = { ok: true, name: p[0], util: n(1), vramUsedMiB: n(2), vramTotalMiB: n(3), temp: n(4), watts: n(5), wattsLimit: n(6), mhz: n(7), mhzMax: n(8), pstate: p[9], wattsDefault: n(10), vramFreeMiB:n(11), visionTransientMiB:64, ...mem };
        }
      }
      gpuCache = { at: Date.now(), data };
      resolve(data);
    });
  });
}
