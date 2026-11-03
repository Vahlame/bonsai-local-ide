/**
 * Traducción de tool calls nativas a efectos del turno. El registro de tools
 * valida y despacha cada nombre; aquí solo se acumulan los efectos.
 */
import { argText, dispatchToolEffect, parseToolArgs } from "../tool-registry.mjs";
import { esObjetoJson } from "./text.mjs";

/**
 * Traduce las tool calls a efectos. `ids` dice qué llamada pidió cada efecto (clave
 * `cmd:<comando>`, `read:<clave>`, `write:<ruta>`, `search:<consulta>`, `index`) y
 * `notesIds` va en paralelo a `notes`: así cada resultado vuelve a SU llamada.
 * @param {Array<{id?: string, name?: string, arguments?: unknown}>} calls
 * @returns {{navegaciones: Array<Record<string, unknown>>, commands: string[], searches: string[], reads: string[], writes: Array<{rel: string, content: string}>, edits: Array<{rel: string, buscar: string, poner: string}>, enFondo: Set<string>, scope: string | null, notes: string[], ids: Map<string, string>, notesIds: string[]}}
 */
export function nativeToolEffects(calls) {
  const navegaciones = [];
  /** @type {Array<{rel: string, buscar: string, poner: string}>} */
  const edits = [];
  /** Comandos pedidos con `segundo_plano: true`. */
  /** @type {Set<string>} */
  const enFondo = new Set();
  const repetir = new Set();
  /** @type {string[]} */
  const commands = [];
  /** @type {string[]} */
  const searches = [];
  const webs = [];
  /** @type {string[]} */
  const reads = [];
  /** @type {Array<{rel: string, content: string}>} */
  const writes = [];
  /** Procesos en segundo plano pedidos con `proceso`. @type {Array<{accion: string, id: string}>} */
  const procesos = [];
  /** Archivos o carpetas que el modelo pide borrar. @type {string[]} */
  const borrados = [];
  /** Movimientos o renombrados pedidos. @type {Array<{origen: string, destino: string}>} */
  const movidos = [];
  /** Plan de la tarea pedido con la función `plan` (null si no la llamó). @type {{pasos: string[], hechos: number[]} | null} */
  let plan = null;
  /** @type {string[]} */
  const notes = [];
  /** @type {string[]} */
  const notesIds = [];
  /** @type {Map<string, string>} */
  const ids = new Map();
  /** @type {string | null} */
  let scope = null;
  calls.forEach((call, index) => {
    // El mismo id que le pone apiTurn (context.mjs) al reenviar la llamada.
    const id = String(call?.id || `call_${index}`);
    /** @param {string} texto */
    const nota = (texto) => {
      notes.push(texto);
      notesIds.push(id);
    };
    /** @param {string} clave */
    const marca = (clave) => {
      if (!ids.has(clave)) ids.set(clave, id);
    };
    const name = String(call?.name || "").toLowerCase();
    const crudo = argText(call?.arguments);
    const cortada = crudo !== "" && !esObjetoJson(crudo);
    /** Nota para una llamada que llegó a medias: el modelo necesita saber qué pasó y cómo salir. */
    const notaCortada = (funcion) =>
      `la llamada a ${funcion} llegó CORTADA (el JSON no cierra: no cabía en el hueco de generación). Pide el trabajo en trozos más pequeños o divide el archivo en varios.`;
    const args = parseToolArgs(call?.arguments);
    const handled = dispatchToolEffect(name, {
      name, args, raw: crudo, cortada, note: nota, marca,
      commands, searches, reads, writes, edits, navegaciones, webs, procesos, borrados, movidos, enFondo, repetir,
      getScope: () => scope,
      setScope: (value) => { scope = value; },
      setPlan: (value) => { plan = value; },
      notaCortada,
    });
    if (!handled && name) nota(`función desconocida: ${name}. Las que hay: ejecutar, leer, indice, archivo, reemplazar, buscar, leer_web, navegador, proceso, plan, borrar, mover.`);
  });
  if (commands.length > 6) {
    notes.push(`quedaron ${commands.length - 6} comandos sin lanzar; pídelos en el siguiente paso`);
    notesIds.push(ids.get(`cmd:${commands[6]}`) || "");
  }
  if (searches.length > 4) {
    notes.push(`quedaron ${searches.length - 4} búsquedas sin hacer`);
    notesIds.push(ids.get(`search:${searches[4]}`) || "");
  }
  if (writes.length > 6) {
    notes.push(`quedaron ${writes.length - 6} escrituras sin lanzar; pídelas en el siguiente paso`);
    notesIds.push(ids.get(`write:${writes[6].rel}`) || "");
  }
  if (edits.length > 8) {
    notes.push(`quedaron ${edits.length - 8} ediciones sin lanzar; pídelas en el siguiente paso`);
    notesIds.push(ids.get("edit:8") || "");
  }
  if (borrados.length > 6) {
    notes.push(`quedaron ${borrados.length - 6} borrados sin lanzar; pídelos en el siguiente paso`);
    notesIds.push(ids.get(`del:${borrados[6]}`) || "");
  }
  if (movidos.length > 6) {
    notes.push(`quedaron ${movidos.length - 6} movimientos sin lanzar; pídelos en el siguiente paso`);
    notesIds.push(ids.get(`move:${movidos[6].origen}`) || "");
  }
  return {
    navegaciones,
    commands: commands.slice(0, 6),
    searches: searches.slice(0, 4),
    webs,
    reads: reads.slice(0, 8),
    writes: writes.slice(0, 6),
    edits: edits.slice(0, 8),
    borrados: borrados.slice(0, 6),
    movidos: movidos.slice(0, 6),
    procesos: procesos.slice(0, 6),
    plan,
    enFondo,
    repetir,
    scope,
    notes,
    ids,
    notesIds,
  };
}
