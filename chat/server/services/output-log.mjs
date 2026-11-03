/**
 * Registros acotados de salidas largas del agente. Cada registro vive fuera del
 * proyecto del usuario y se corta a 64 MiB para que una tool call no llene el
 * disco.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVOS = 100;
const MAX_TOTAL = 512 * 1024 * 1024;

/**
 * @param {{dir: string, maxArchivos?: number, maxTotalBytes?: number}} ctx
 */
export function createOutputLogService(ctx) {
  /**
   * Conserva los registros más recientes. Son artefactos generados: no se
   * tocan chats ni archivos del proyecto.
   */
  function podar() {
    try {
      const filas = fs.readdirSync(ctx.dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
        .map((entry) => {
          const abs = path.join(ctx.dir, entry.name);
          const st = fs.statSync(abs);
          return { abs, mtime: st.mtimeMs, bytes: st.size };
        })
        .sort((a, b) => b.mtime - a.mtime);
      const maxArchivos = ctx.maxArchivos ?? MAX_ARCHIVOS;
      const maxTotal = ctx.maxTotalBytes ?? MAX_TOTAL;
      let total = 0;
      for (let i = 0; i < filas.length; i += 1) {
        total += filas[i].bytes;
        if (i >= maxArchivos || total > maxTotal) {
          try { fs.rmSync(filas[i].abs, { force: true }); } catch { /* otro proceso */ }
        }
      }
    } catch {
      /* si no se puede listar, el registro nuevo sigue funcionando */
    }
  }

  /** @returns {{id: string, guardar: (texto: unknown) => void}} */
  function create() {
    fs.mkdirSync(ctx.dir, { recursive: true });
    const id = crypto.randomBytes(16).toString("hex");
    const archivo = path.join(ctx.dir, `${id}.log`);
    fs.writeFileSync(archivo, "", { flag: "wx" });
    podar();
    let bytes = 0;
    let incompleto = false;
    return {
      id,
      guardar(texto) {
        if (incompleto) return;
        try {
          const fragmento = Buffer.from(String(texto), "utf8");
          if (bytes + fragmento.length > MAX_BYTES) {
            fs.appendFileSync(archivo, "\n[Registro incompleto: límite de 64 MiB alcanzado.]\n");
            incompleto = true;
            return;
          }
          fs.appendFileSync(archivo, fragmento);
          bytes += fragmento.length;
        } catch (err) {
          incompleto = true;
          process.stderr.write(`[salida-agente] No se pudo guardar ${id}: ${err instanceof Error ? err.message : String(err)}\n`);
        }
      },
    };
  }

  return { create };
}
