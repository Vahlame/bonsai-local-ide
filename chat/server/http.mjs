/**
 * Utilidades HTTP puras del servidor del IDE: argumentos, lectura acotada del
 * cuerpo, MIME y resolución de rutas. No conocen el estado del agente.
 */
import { muestreo } from "../modelo.mjs";
import { engineProfile, isNamedEnginePreset } from "../engine-profiles.mjs";
import { rutaSegura } from "../archivos-seguros.mjs";

export const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".py": "text/plain; charset=utf-8",
};

/** Extensiones que se pueden servir desde chat/ui/ (todo lo demas es 404). */
export const UI_SERVIDOS = new Set([".js", ".mjs", ".css", ".html", ".svg", ".json", ".woff2", ".woff", ".png"]);

/**
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  // think = presupuesto de razonamiento en tokens; 0 (por defecto) = APAGADO.
  // historyCap = 0 -> automatico: el historial usa toda la ventana menos la reserva de salida.
  const out = { host: "127.0.0.1", port: 8787, llamaPort: 8080, historyCap: 0, open: false, think: 0, thinkProvided:false, enginePreset:"", perfil: "codigo", agentProfile:"optimized" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host") out.host = argv[++i] ?? out.host;
    else if (arg === "--port") out.port = Number(argv[++i]);
    else if (arg === "--llama-port") out.llamaPort = Number(argv[++i]);
    else if (arg === "--prompt-cap") out.historyCap = Number(argv[++i]);
    else if (arg === "--think") {out.think = Number(argv[++i]);out.thinkProvided=true;}
    else if (arg === "--engine-preset") {out.enginePreset=argv[++i];if (isNamedEnginePreset(out.enginePreset)) engineProfile(out.enginePreset);}
    else if (arg === "--perfil") out.perfil = argv[++i] ?? out.perfil;
    else if (arg === "--agent-profile") out.agentProfile = argv[++i] ?? out.agentProfile;
    else if (arg === "--open") out.open = true;
    else throw new Error(`Argumento desconocido: ${arg}`);
  }
  // -1 es "sin limite" (Qwen3.6 free thinking); 0 apaga el razonamiento.
  if (!Number.isInteger(out.think) || out.think < -1) throw new Error("--think es un presupuesto en tokens (-1 = sin limite, 0 = apagado)");
  muestreo(out.perfil);
  return out;
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {number} [limite] bytes maximos; por defecto 200 KB (mensajes de chat)
 * @returns {Promise<string>}
 */
export function readBody(req, limite = 200_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rechazado = false;
    req.on("data", (chunk) => {
      if (rechazado) return;
      size += chunk.length;
      if (size > limite) {
        rechazado = true;
        chunks.length = 0;
        const err = new Error(`cuerpo demasiado grande (maximo ${limite} bytes)`);
        err.name = "PayloadTooLargeError";
        err.code = "PAYLOAD_TOO_LARGE";
        err.limite = limite;
        reject(err);
        req.pause();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!rechazado) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", (err) => {
      if (!rechazado) reject(err);
    });
    req.on("aborted", () => {
      if (!rechazado) reject(new Error("peticion interrumpida por el cliente"));
    });
  });
}

/**
 * Resuelve una ruta YA DECODIFICADA dentro de `root`, o null si se sale.
 * La decodificacion de URL se hace en los handlers que son de verdad una URL.
 * @param {string} root
 * @param {string} rel
 * @returns {string | null}
 */
export function fileInside(root, rel) {
  return rutaSegura(root, rel);
}
