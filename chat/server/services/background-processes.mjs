/**
 * Procesos en segundo plano del agente que sobreviven al turno hasta que el
 * usuario los pare. El registro conserva los últimos 50 terminados para que
 * `proceso leer` pueda comprobar builds asíncronos.
 */
export function createBackgroundProcessRegistry({ maxTerminados = 50 } = {}) {
  /** @type {Map<string, any>} */
  const vivos = new Map();
  /** @type {Map<string, any>} */
  const terminados = new Map();

  /** @param {string} id @param {any} estado */
  function recordTerminated(id, estado) {
    terminados.set(id, { id, ...estado });
    while (terminados.size > maxTerminados) {
      const oldest = terminados.keys().next().value;
      if (oldest === undefined) break;
      terminados.delete(oldest);
    }
  }

  function stopAll() {
    for (const p of vivos.values()) {
      try { p.parar(); } catch { /* ya terminó */ }
    }
    vivos.clear();
  }

  return { vivos, terminados, recordTerminated, stopAll };
}
