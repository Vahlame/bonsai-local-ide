/**
 * Helpers de contexto del turno. Mantienen el archivo actual y el recorte de
 * evidencia fuera del bucle principal para que este no crezca.
 */
import fs from "node:fs";
import { estimateTokens, takeHeadByTokens } from "../../context.mjs";
import { looksLikeEdit } from "../text.mjs";

/**
 * @param {Record<string, any>} ctx
 */
export function createAgentHelpers(ctx) {
  /**
   * Añade el archivo actual al pedido cuando el modelo va a editarlo. Evita que
   * reescriba a ciegas después de una tanda larga.
   * @param {string} text
   * @returns {string}
   */
  function withCurrentFile(text) {
    const last = ctx.chat.session.files?.[ctx.chat.session.files.length - 1];
    if (!last || !looksLikeEdit(text)) return text;
    const inProject = ctx.fileInside(ctx.workspaceRoot, last.rel);
    const inSalida = ctx.fileInside(ctx.SALIDA, last.rel);
    const abs = inProject && fs.existsSync(inProject) ? inProject : inSalida;
    if (!abs || !fs.existsSync(abs)) return text;
    const leido = ctx.readLimited(abs, 512 * 1024);
    if (!leido.ok) return text;
    const clip = takeHeadByTokens(leido.texto, 1200, estimateTokens);
    if (!clip) return text;
    return `${text}\n\nArchivo actual ${last.rel}:\n${clip}${leido.truncado ? "\n[…archivo recortado]" : ""}`;
  }

  return { withCurrentFile };
}
