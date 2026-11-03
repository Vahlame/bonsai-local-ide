/**
 * Historial de conversaciones: copia de trabajo, archivo por chat, índice y
 * recuperación. Es el único sitio que conoce la relación entre `ui-session.json`
 * y `ui-chats/<id>.json`.
 *
 * El archivado es recuperable: si falla, el mensaje sigue en la copia de trabajo
 * y se reintenta en el siguiente guardado; el error queda visible en /api/state.
 */
import fs from "node:fs";
import path from "node:path";
import { crearHistorial } from "../../historial.mjs";
import { metadatosSesion } from "../../session-store.mjs";

/**
 * @param {{
 *   stateDir: string,
 *   sessionPath: string,
 *   chat: Record<string, any>,
 *   chatTitle: (sesion: unknown) => string,
 *   historial?: ReturnType<typeof crearHistorial>,
 * }} ctx
 */
export function createHistoryService(ctx) {
  const historial = ctx.historial || crearHistorial({
    stateDir: ctx.stateDir,
    sessionPath: ctx.sessionPath,
    tituloDe: ctx.chatTitle,
  });
  const persistSessionOriginal = ctx.chat.saveSession.bind(ctx.chat);
  let errorHistorial = "";

  /** @returns {string} */
  function getErrorHistorial() {
    return errorHistorial;
  }

  /** Archiva la sesión activa en el índice y en su archivo. */
  function archiveActive() {
    const index = historial.readIndex();
    const id = index.active || historial.newChatId();
    if (!index.active) {
      index.active = id;
      index.items.unshift({ id, title: ctx.chatTitle(ctx.chat.session), updated: Date.now() });
    }
    // Reemplazo atómico también para el historial: un corte no debe dejar el
    // JSON a medias y el catch del llamador no debe tragárselo.
    historial.archive(id, ctx.chat.session);
    const item = index.items.find((row) => row.id === id);
    const title = ctx.chatTitle(ctx.chat.session);
    if (item) {
      item.title = title;
      item.updated = Date.now();
    } else {
      index.items.unshift({ id, title, updated: Date.now() });
    }
    historial.writeIndex(index);
  }

  /** Guarda la copia de trabajo y, después, archiva. */
  function persistSession() {
    persistSessionOriginal();
    try {
      archiveActive();
      errorHistorial = "";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errorHistorial = `no se pudo archivar el historial: ${message}. Tus mensajes siguen en la copia de trabajo y se reintentará al siguiente guardado.`;
      process.stderr.write(`[historial] ${errorHistorial}\n`);
    }
  }

  function blankSession() {
    ctx.chat.session = { memory: "", folded: 0, turns: [], draft: "", files: [] };
    ctx.chat.tighten = 0;
    ctx.chat.saveSession();
  }

  /**
   * @param {string} id
   */
  function loadChat(id) {
    const leido = historial.leerChat(id);
    if (!leido.ok) throw new Error(leido.motivo);
    const raw = /** @type {{memory?: unknown, folded?: unknown, turns?: unknown, files?: unknown}} */ (leido.dato);
    const index = historial.readIndex();
    index.active = id;
    if (!index.items.some((item) => item.id === id)) {
      index.items.unshift({ id, title: ctx.chatTitle(raw), updated: Date.now() });
    }
    historial.writeIndex(index);
    ctx.chat.session = {
      memory: typeof raw.memory === "string" ? raw.memory : "",
      folded: Number.isInteger(raw.folded) ? raw.folded : 0,
      turns: Array.isArray(raw.turns) ? raw.turns : [],
      draft: "",
      files: Array.isArray(raw.files) ? raw.files : [],
      ...metadatosSesion(raw),
    };
    ctx.chat.tighten = 0;
    ctx.chat.saveSession();
  }

  function startChat() {
    const empty = !(ctx.chat.session.turns || []).some((turn) => turn.role === "user");
    if (!empty) {
      archiveActive();
      const index = historial.readIndex();
      const id = historial.newChatId();
      index.active = id;
      index.items.unshift({ id, title: "Nueva conversación", updated: Date.now() });
      historial.writeIndex(index);
      blankSession();
    }
    return historial.readIndex();
  }

  /**
   * @param {string} id
   */
  function removeChat(id) {
    const index = historial.readIndex();
    index.items = index.items.filter((item) => item.id !== id);
    fs.rmSync(historial.chatFile(id), { force: true });
    if (index.active === id) {
      const next = index.items[0];
      if (next) {
        historial.writeIndex(index);
        loadChat(next.id);
        return historial.readIndex();
      }
      const fresh = historial.newChatId();
      index.active = fresh;
      index.items = [{ id: fresh, title: "Nueva conversación", updated: Date.now() }];
      historial.writeIndex(index);
      blankSession();
      return historial.readIndex();
    }
    historial.writeIndex(index);
    return index;
  }

  // El chat guarda a través del servicio; el original queda como copia de trabajo.
  ctx.chat.saveSession = persistSession;

  return {
    historial,
    archiveActive,
    persistSession,
    blankSession,
    loadChat,
    startChat,
    removeChat,
    getErrorHistorial,
    prepararSesionInicial: () => historial.prepararSesionInicial(),
  };
}
