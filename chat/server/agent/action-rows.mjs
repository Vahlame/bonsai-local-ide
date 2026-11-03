/**
 * Emisión de filas de acción del agente. La interfaz pinta una tarjeta por fila;
 * este módulo solo traduce la fila al evento SSE, sin conocer el turno.
 */

/**
 * @param {(event: Record<string, unknown>) => void} send
 * @param {{id: string, kind: string, title: string, state: string, detail: string, code?: number, undo?: string, captura?: unknown, vision?: unknown}} row
 */
export function emitActionEvent(send, row) {
  /** @type {Record<string, unknown>} */
  const event = { type: "action", id: row.id, kind: row.kind, title: row.title, state: row.state, detail: row.detail };
  if (row.code !== undefined) event.code = row.code;
  if (row.undo) event.undo = row.undo;
  if (row.captura) {
    event.captura = row.captura;
    event.vision = row.vision;
  }
  send(event);
}
