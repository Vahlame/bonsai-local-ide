/**
 * Cabeceras de seguridad de la UI local. Se aplican a todas las respuestas; las
 * rutas de artefactos pueden sobrescribir la CSP con su propio sandbox.
 */

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // La UI ya no tiene bloques <style>: las hojas viven en /ui/base.css y
  // /ui/drawer.css. Los atributos `style` que escribe el editor siguen
  // permitidos con style-src-attr; los <style> inyectados, no.
  "style-src 'self'",
  // xterm inyecta hojas <style> propias al montar/cambiar de tema. Se permite
  // 'unsafe-inline' SOLO en style-src-elem para no romper la terminal; los
  // bloques <style> propios del IDE ya viven en /ui/base.css y /ui/drawer.css.
  // La CSP de scripts sigue siendo estricta; migrar xterm a hojas externas es
  // una deuda separada (xterm 6 no expone una API para desactivar la inyección).
  "style-src-elem 'self' 'unsafe-inline'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

/**
 * @param {import("node:http").ServerResponse} res
 */
export function aplicarCabecerasSeguridad(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  // SAMEORIGIN y no DENY: la vista previa de artefactos vive en un iframe del
  // mismo origen. Un sitio externo sigue sin poder incrustar el IDE.
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", CSP);
}
