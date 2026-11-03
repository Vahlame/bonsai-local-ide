/**
 * Sesión SSE de un turno: cabeceras, envío de eventos, latido, cancelación por
 * desconexión y cierre ordenado. El bucle del agente no toca `res` directamente.
 */

/**
 * @param {{
 *   req: import("node:http").IncomingMessage,
 *   res: import("node:http").ServerResponse,
 *   ctx: Record<string, any>,
 * }} input
 */
export function createSseSession({ req, res, ctx }) {
  const ac = new AbortController();
  /** @type {(event: Record<string, unknown>) => void} */
  let sendEvent = () => {};
  /** @type {NodeJS.Timeout | null} */
  let latido = null;
  let finished = false;

  // El chat conoce el controlador desde el primer momento: la comprobación de
  // VRAM puede cancelar antes de abrir el stream.
  ctx.chat.active = ac;

  /** @param {string} motivo */
  function cancelar(motivo) {
    if (!ac.signal.aborted) ac.abort(new Error(motivo));
  }

  function start() {
    // `req` ya terminó de leerse; su `close` se emitió antes. La desconexión se
    // detecta en la respuesta (`res.close`), que sí se emite al cortar el socket.
    const desconectado = () => {
      if (!finished && !res.writableEnded) cancelar("Cliente desconectado; turno cancelado");
    };
    req.on("aborted", desconectado);
    res.on("close", desconectado);
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    sendEvent = (event) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    // Latido: un comentario SSE cada 15 s. Mientras el modelo escribe un archivo
    // grande dentro de una tool call puede pasar minutos sin tokens de texto.
    latido = setInterval(() => {
      if (!res.writableEnded) res.write(": latido\n\n");
    }, Number(process.env.BONSAI_LATIDO_MS) || 15000);
    ctx.chat.push = (event) => sendEvent(event);
  }

  function stopHeartbeat() {
    if (latido) {
      clearInterval(latido);
      latido = null;
    }
  }

  function finish() {
    finished = true;
    stopHeartbeat();
    ctx.chat.active = null;
    ctx.chat.push = null;
    if (!res.writableEnded) res.end();
  }

  return {
    ac,
    start,
    finish,
    stopHeartbeat,
    cancelar,
    send: (event) => sendEvent(event),
    get finished() { return finished; },
    set finished(value) { finished = Boolean(value); },
  };
}
