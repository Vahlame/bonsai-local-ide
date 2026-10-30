/**
 * Almacenamiento del historial de conversaciones de la interfaz.
 *
 * Vive fuera de `ui-server.mjs` (la auditoría pedía separar el almacenamiento de
 * sesiones del servidor HTTP). Aquí están las dos copias del historial y su política:
 *
 *  - `ui-chats/<id>.json`  → copia ARCHIVADA por conversación (fuente de verdad cuando
 *                            es válida y no es más vieja que la copia de trabajo).
 *  - `ui-session.json`     → copia de TRABAJO que usa el chat; se escribe primero en cada
 *                            guardado y sirve para recuperar un turno si el archivado
 *                            falló a medias.
 *  - `ui-chats/index.json` → índice (activa + títulos). Si se corrompe se reconstruye
 *                            leyendo las conversaciones; los archivos ilegibles se
 *                            apartan como `.corrupto-<fecha>` y NUNCA se borran.
 *
 * Todas las escrituras son atómicas (temporal + fsync + rename) con `.bak` de la
 * versión anterior válida. Dos escrituras separadas no son una transacción: por eso la
 * política al arrancar es "gana la copia válida más nueva", y el fallo del archivado se
 * devuelve para que la interfaz lo pueda enseñar.
 */

import fs from "node:fs";
import path from "node:path";
import { apartarCorrupto, escribirJsonAtomico, leerJson } from "./almacen-json.mjs";

/**
 * ¿Tiene forma de sesión de chat? (no se carga cualquier JSON como conversación)
 * @param {unknown} dato
 * @returns {boolean}
 */
export function sesionValida(dato) {
  return Boolean(dato && typeof dato === "object" && Array.isArray(/** @type {{turns?: unknown}} */ (dato).turns));
}

/**
 * @param {object} args
 * @param {string} args.stateDir carpeta de estado (BONSAI_STATE)
 * @param {string} args.sessionPath `ui-session.json` (copia de trabajo)
 * @param {(sesion: {turns?: Array<{role?: string, content?: string}>}) => string} args.tituloDe
 * @returns {{
 *   chatsDir: string,
 *   indexFile: string,
 *   readIndex: () => {active: string, items: Array<{id: string, title: string, updated: number}>},
 *   writeIndex: (index: {active: string, items: Array<{id: string, title: string, updated: number}>}) => void,
 *   chatFile: (id: string) => string,
 *   newChatId: () => string,
 *   leerChat: (id: string) => {ok: true, dato: unknown} | {ok: false, code: string, motivo: string},
 *   prepararSesionInicial: () => string[],
 *   archive: (id: string, sesion: unknown) => void,
 * }}
 */
export function crearHistorial({ stateDir, sessionPath, tituloDe }) {
  const chatsDir = path.join(stateDir, "ui-chats");
  const indexFile = path.join(chatsDir, "index.json");
  /** Avisos de recuperación para mostrar al usuario. */
  /** @type {string[]} */
  const avisos = [];

  /**
   * @param {string} id
   * @returns {string}
   */
  function chatFile(id) {
    if (!/^[a-z0-9]{6,40}$/.test(id)) throw new Error("conversación desconocida");
    return path.join(chatsDir, `${id}.json`);
  }

  /** @returns {string} */
  function newChatId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Reconstruye `index.json` a partir de los archivos de conversación válidos.
   * Solo se pierde el orden si los propios archivos tampoco existen.
   * @param {string} [motivo]
   * @returns {{active: string, items: Array<{id: string, title: string, updated: number}>}}
   */
  function reconstruir(motivo) {
    /** @type {Array<{id: string, title: string, updated: number}>} */
    const items = [];
    try {
      for (const nombre of fs.readdirSync(chatsDir)) {
        if (!/^[a-z0-9]{6,40}\.json$/.test(nombre) || nombre === "index.json") continue;
        const id = nombre.slice(0, -5);
        const abs = path.join(chatsDir, nombre);
        const leido = leerJson(abs, { validar: sesionValida });
        if (!leido.ok) continue;
        let updated = 0;
        try { updated = fs.statSync(abs).mtimeMs; } catch { updated = 0; }
        items.push({ id, title: tituloDe(/** @type {{turns?: Array<{role?: string, content?: string}>}} */ (leido.dato)), updated });
      }
    } catch { /* carpeta inexistente: índice vacío */ }
    items.sort((a, b) => b.updated - a.updated);
    const index = { active: items[0]?.id || "", items };
    if (items.length) {
      try { writeIndex(index); } catch { /* se usa en memoria */ }
    }
    if (motivo) avisos.push(`el índice de conversaciones estaba ilegible (${motivo}); se reconstruyó con ${items.length} conversación(es) recuperada(s)`);
    return index;
  }

  /**
   * @returns {{active: string, items: Array<{id: string, title: string, updated: number}>}}
   */
  function readIndex() {
    const leido = leerJson(indexFile, {
      validar: (dato) => Boolean(
        dato && typeof dato === "object"
        && Array.isArray(/** @type {{items?: unknown}} */ (dato).items)
        && typeof /** @type {{active?: unknown}} */ (dato).active === "string",
      ),
    });
    if (leido.ok) {
      const raw = /** @type {{active: string, items: unknown[]}} */ (leido.dato);
      /** @type {Array<{id: string, title: string, updated: number}>} */
      const items = [];
      for (const item of raw.items) {
        if (!item || typeof item !== "object") continue;
        const fila = /** @type {{id?: unknown, title?: unknown, updated?: unknown}} */ (item);
        if (typeof fila.id !== "string" || !/^[a-z0-9]{6,40}$/.test(fila.id)) continue;
        items.push({
          id: fila.id,
          title: typeof fila.title === "string" && fila.title.trim() ? fila.title.trim().slice(0, 80) : "Nueva conversación",
          updated: Number(fila.updated) || 0,
        });
      }
      return { active: /^[a-z0-9]{6,40}$/.test(raw.active) ? raw.active : "", items };
    }
    if (leido.code === "ENOENT") return { active: "", items: [] };
    return reconstruir(leido.apartado ? "se conservó una copia apartada" : leido.error);
  }

  /**
   * @param {{active: string, items: Array<{id: string, title: string, updated: number}>}} index
   */
  function writeIndex(index) {
    fs.mkdirSync(chatsDir, { recursive: true });
    escribirJsonAtomico(indexFile, index, { copia: false, espacio: 0 });
  }

  /**
   * Archiva la sesión de la conversación indicada. Lanza si no se pudo escribir: el
   * llamador decide cómo avisar (la copia de trabajo ya está guardada).
   * @param {string} id
   * @param {unknown} sesion
   */
  function archive(id, sesion) {
    fs.mkdirSync(chatsDir, { recursive: true });
    escribirJsonAtomico(chatFile(id), sesion);
  }

  /**
   * Lee una conversación archivada, apartando la copia ilegible si la hubiera.
   * @param {string} id
   * @returns {{ok: true, dato: unknown} | {ok: false, code: string, motivo: string}}
   */
  function leerChat(id) {
    const leido = leerJson(chatFile(id), { validar: sesionValida });
    if (!leido.ok) {
      return {
        ok: false,
        code: leido.code,
        motivo: leido.code === "CORRUPTO"
          ? `esa conversación estaba corrupta; se conservó aparte${leido.apartado ? ` como ${path.basename(leido.apartado)}` : ""}`
          : "no se pudo abrir esa conversación",
      };
    }
    return { ok: true, dato: leido.dato };
  }

  /**
   * Recupera la sesión de trabajo y su copia archivada al arrancar.
   * @returns {string[]} avisos para mostrar al usuario
   */
  function prepararSesionInicial() {
    /** @type {string[]} */
    const salida = avisos.splice(0, avisos.length);
    const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
    let index = readIndex();
    const archivoDe = (id) => (id ? path.join(chatsDir, `${id}.json`) : "");
    const archivoActivo = archivoDe(index.active);
    const leidoArch = archivoActivo ? leerJson(archivoActivo, { validar: sesionValida }) : { ok: false, code: "ENOENT", error: "no existe" };
    const leidoSes = fs.existsSync(sessionPath) ? leerJson(sessionPath, { validar: sesionValida }) : { ok: false, code: "ENOENT", error: "no existe" };
    /** @type {null | {ok: true, dato: unknown}} */
    let fuente = null;
    if (leidoArch.ok && (!leidoSes.ok || mtime(archivoActivo) >= mtime(sessionPath))) fuente = leidoArch;
    if (leidoArch.ok && !leidoSes.ok) salida.push(`la sesión de trabajo estaba ilegible; se recuperó la copia archivada${leidoSes.apartado ? " (la mala se conservó aparte)" : ""}`);
    if (fuente) {
      try {
        escribirJsonAtomico(sessionPath, fuente.dato, { copia: false, espacio: 0 });
      } catch (err) {
        salida.push(`no se pudo restaurar la sesión desde el historial: ${err instanceof Error ? err.message : String(err)}`);
      }
      return salida;
    }
    if (leidoSes.ok) {
      if (!index.active) {
        index = reconstruir();
        if (!index.active) {
          const id = newChatId();
          index = { active: id, items: [{ id, title: tituloDe(/** @type {{turns?: Array<{role?: string, content?: string}>}} */ (leidoSes.dato)), updated: Date.now() }] };
          try { writeIndex(index); } catch { /* se archivará al primer guardado */ }
        }
      }
      if (leidoSes.apartado) salida.push(`se recuperó la sesión desde el respaldo (${path.basename(leidoSes.apartado)} quedó apartado)`);
      return salida;
    }
    if (leidoSes.apartado) salida.push(`la sesión estaba ilegible y se apartó como ${path.basename(leidoSes.apartado)}; empiezo con una sesión vacía`);
    // Último recurso: la conversación archivada válida más reciente.
    const reciente = readIndex().items[0]?.id || "";
    if (reciente && reciente !== index.active) {
      const otro = leerJson(archivoDe(reciente), { validar: sesionValida });
      if (otro.ok) {
        try {
          escribirJsonAtomico(sessionPath, otro.dato, { copia: false, espacio: 0 });
          const idx = readIndex();
          idx.active = reciente;
          writeIndex(idx);
          salida.push("se recuperó la conversación archivada más reciente");
        } catch { /* sin recuperación posible */ }
      }
    }
    return salida;
  }

  return {
    chatsDir,
    indexFile,
    readIndex,
    writeIndex,
    chatFile,
    newChatId,
    leerChat,
    prepararSesionInicial,
    archive,
  };
}

/**
 * Exportado para pruebas: aparta un archivo corrupto (lo reexporta el módulo de
 * almacenamiento para que el historial no dependa de detalles internos).
 */
export { apartarCorrupto };
