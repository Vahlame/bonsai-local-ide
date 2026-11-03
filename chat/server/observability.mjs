/**
 * Observabilidad mínima del servidor local: request-id, log estructurado de
 * peticiones lentas/fallidas y un `/api/health` barato. No depende de nada
 * externo y nunca debe tumbar una petición si el log falla.
 */
import crypto from "node:crypto";

const CLAVES_SECRETAS = /^(authorization|cookie|set-cookie|token|secret|password|api[-_]?key)$/i;
const RUTA_ABSOLUTA = /(?:[A-Za-z]:\\|\/(?:home|Users|root)\/)[^\s"']+/g;

/**
 * Redacta secretos y rutas absolutas de un valor antes de escribirlo.
 * @param {unknown} valor
 * @param {string} [clave]
 * @returns {unknown}
 */
export function redactar(valor, clave = "") {
  if (CLAVES_SECRETAS.test(clave)) return "[redactado]";
  if (typeof valor === "string") return valor.replace(RUTA_ABSOLUTA, "[ruta]");
  if (Array.isArray(valor)) return valor.map((item) => redactar(item));
  if (valor && typeof valor === "object") {
    /** @type {Record<string, unknown>} */
    const salida = {};
    for (const [k, v] of Object.entries(valor)) salida[k] = redactar(v, k);
    return salida;
  }
  return valor;
}

/**
 * @param {{
 *   version?: string,
 *   startedAt?: number,
 *   slowMs?: number,
 *   now?: () => number,
 *   write?: (line: string) => void,
 *   nuevoId?: () => string,
 *   getModel?: () => string,
 *   getWorkspace?: () => string,
 * }} [opciones]
 */
export function crearObservabilidad(opciones = {}) {
  const version = opciones.version || "0.0.0";
  const startedAt = opciones.startedAt || Date.now();
  const slowMs = opciones.slowMs ?? 1500;
  const now = opciones.now || Date.now;
  const write = opciones.write || ((line) => process.stderr.write(`${line}\n`));
  const nuevoId = opciones.nuevoId || (() => crypto.randomUUID());
  const getModel = opciones.getModel || (() => "");
  const getWorkspace = opciones.getWorkspace || (() => "");

  /**
   * @param {"info"|"warn"|"error"} level
   * @param {string} event
   * @param {Record<string, unknown>} [fields]
   */
  function log(level, event, fields = {}) {
    try {
      write(JSON.stringify({ ts: new Date(now()).toISOString(), level, event, ...redactar(fields) }));
    } catch {
      /* el diagnóstico nunca debe romper la petición */
    }
  }

  /**
   * Asigna un id a la respuesta y registra solo lo que importa (5xx o lentitud).
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @returns {string}
   */
  function begin(req, res) {
    const id = nuevoId();
    try {
      res.setHeader("X-Request-Id", id);
    } catch {
      /* cabeceras ya enviadas */
    }
    const t0 = now();
    res.once("finish", () => {
      const ms = now() - t0;
      if (res.statusCode < 500 && ms < slowMs) return;
      let path = "/";
      try {
        path = new URL(req.url || "/", "http://local").pathname;
      } catch {
        /* URL rara */
      }
      log(res.statusCode >= 500 ? "error" : "warn", "request", {
        id,
        method: req.method || "",
        path,
        status: res.statusCode,
        ms,
      });
    });
    return id;
  }

  /** @returns {Record<string, unknown>} */
  function health() {
    const root = String(getWorkspace() || "");
    const carpeta = root ? root.split(/[\\/]/).filter(Boolean).pop() : "";
    return {
      ok: true,
      version,
      uptime: Math.max(0, Math.round((now() - startedAt) / 1000)),
      pid: process.pid,
      model: getModel() || "",
      workspace: carpeta || "",
    };
  }

  return { begin, log, health };
}
