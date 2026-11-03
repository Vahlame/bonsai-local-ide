/**
 * Métricas que expone /api/state. Son de solo lectura y no tocan el modelo:
 * contexto, historial, tokens, archivos guardados y tiempo de actividad.
 */
import { listWorkspace } from "../workspace.mjs";

/**
 * @param {{
 *   chat: Record<string, any>,
 *   getRoot: () => string,
 *   startedAt: number,
 *   estimateTokens: (texto: string) => number,
 *   legacyMetrics: () => unknown,
 *   list?: typeof listWorkspace,
 *   workspaceTtlMs?: number,
 *   now?: () => number,
 * }} ctx
 */
export function createStatsService(ctx) {
  const list = ctx.list || listWorkspace;
  const workspaceTtlMs = ctx.workspaceTtlMs ?? 30_000;
  const now = ctx.now || Date.now;
  let workspaceCount = null;
  let workspaceTs = 0;

  function invalidate() {
    workspaceCount = null;
  }

  /** @returns {Record<string, any>} */
  function build() {
    if (workspaceCount === null || now() - workspaceTs > workspaceTtlMs) {
      workspaceCount = list(ctx.getRoot(), "", [], 0).length;
      workspaceTs = now();
    }
    const saved = ctx.chat.session.files || [];
    let bytes = 0;
    for (const file of saved) bytes += Number(file.bytes) || 0;
    const usage = ctx.chat.usage;
    /** @type {Record<string, any>} */
    const stats = {
      nCtx: ctx.chat.nCtx,
      historyCap: ctx.chat.historyCap(),
      prompt: usage ? usage.prompt : ctx.chat.livePrompt,
      generated: usage ? usage.generated : ctx.chat.liveGenerated,
      memory: ctx.estimateTokens(ctx.chat.session.memory || ""),
      turns: ctx.chat.session.turns.length,
      folded: ctx.chat.session.folded,
      saved: { count: saved.length, bytes },
      workspace: workspaceCount,
      seconds: Math.max(0, Math.floor((Date.now() - ctx.startedAt) / 1000)),
      legacyToolParser: ctx.legacyMetrics(),
    };
    if (typeof ctx.chat.model === "string" && ctx.chat.model) stats.model = ctx.chat.model;
    stats.vision = Boolean(ctx.chat.vision);
    return stats;
  }

  return { build, invalidate };
}
