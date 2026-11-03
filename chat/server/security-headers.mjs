/**
 * Cabeceras de seguridad de la UI local. Se aplican a todas las respuestas; las
 * rutas de artefactos pueden sobrescribir la CSP con su propio sandbox.
 */

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
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
