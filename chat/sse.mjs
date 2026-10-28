/**
 * Lector único de Server-Sent Events (SSE) para todo el proyecto.
 *
 * Antes cada sitio (bonsai-chat.mjs, medir-agente.mjs, medir-formato.mjs, medir-stacks.mjs,
 * evaluar/ejecutar.mjs y evaluar/tarea-grande.mjs) repetía su propio bucle de
 * `reader.read()` + TextDecoder + cortar por "\n" + `data:`. Nadie miraba los finales
 * rotos: una conexión que se cortaba tras un trozo válido parecía una respuesta completa
 * (hallazgo 1 del informe). Este módulo centraliza el protocolo:
 *
 *  - Fragmentos de red: un evento puede llegar partido en cualquier byte.
 *  - Finales de línea CRLF, LF y CR (también el CRLF partido entre dos trozos).
 *  - Comentarios (`: ping`) y campos que no son `data` (`event:`, `id:`, `retry:`).
 *  - `data:` multilínea: las líneas se acumulan y el evento se despacha en la línea en
 *    blanco (como dice la especificación). Si el flujo termina sin esa línea en blanco,
 *    se despacha igualmente lo pendiente (antes se perdía el último evento).
 *  - UTF-8 partido entre trozos: TextDecoder en modo `stream`.
 *  - `[DONE]` y `finish_reason` cuentan como fin legítimo.
 *  - JSON inválido y cierre prematuro lanzan `ErrorSSE` con `motivo`, `parcial` (el texto
 *    ya recibido) y `eventos` (los ya vistos), para que el llamador conserve lo parcial y
 *    avise o reintente. Los scripts de medición pueden pasar `jsonInvalido:"ignorar"` y
 *    `exigirFin:false` para conservar su comportamiento tolerante de siempre.
 *
 * No usa dependencias: todo es Node estándar.
 */

/**
 * Error de un flujo SSE. `motivo` dice qué pasó:
 *  - "json_invalido": una línea `data:` no era JSON (el servidor rompió el protocolo).
 *  - "cierre_prematuro": la conexión terminó sin `finish_reason` ni `[DONE]`.
 *  - "flujo_invalido": el argumento no es un cuerpo/stream legible.
 *
 * `parcial` es el texto que el consumidor ya había producido (según `contarTexto`),
 * `eventos` los eventos JSON vistos y `lineas` las líneas `data:` crudas.
 */
export class ErrorSSE extends Error {
  /**
   * @param {string} mensaje
   * @param {{
   *   motivo?: "json_invalido" | "cierre_prematuro" | "flujo_invalido",
   *   parcial?: string,
   *   eventos?: unknown[],
   *   lineas?: string[],
   *   finishReason?: string,
   *   payload?: string,
   *   causa?: unknown,
   * }} [detalles]
   */
  constructor(mensaje, detalles = {}) {
    super(mensaje, detalles.causa === undefined ? undefined : { cause: detalles.causa });
    this.name = "ErrorSSE";
    this.motivo = detalles.motivo || "cierre_prematuro";
    /** Texto ya producido por el modelo antes del fallo. */
    this.parcial = typeof detalles.parcial === "string" ? detalles.parcial : "";
    /** Eventos JSON ya vistos (puede venir acotado por `maxEventos`). */
    this.eventos = Array.isArray(detalles.eventos) ? detalles.eventos : [];
    /** Líneas `data:` crudas ya vistas. */
    this.lineas = Array.isArray(detalles.lineas) ? detalles.lineas : [];
    /** Último `finish_reason` visto, si hubo alguno. */
    this.finishReason = typeof detalles.finishReason === "string" ? detalles.finishReason : "";
    /** Payload que no se pudo interpretar (solo en `json_invalido`). */
    this.payload = typeof detalles.payload === "string" ? detalles.payload : "";
    /** Para que el llamador distinga un error de protocolo de uno de red. */
    this.esSSE = true;
  }
}

/**
 * Texto “de respuesta” de un evento, por defecto:
 *  - OpenAI chat completions: `choices[0].delta.content` (stream) o `message.content`.
 *  - La interfaz del IDE: `{type:"token"|"replace"|"error", text}`.
 * Es solo para poder devolver `err.parcial`; cada consumidor puede pasar `contarTexto`.
 * @param {unknown} evento
 * @returns {string}
 */
export function textoDeEvento(evento) {
  if (!evento || typeof evento !== "object") return "";
  const fila = /** @type {Record<string, unknown>} */ (evento);
  if (Array.isArray(fila.choices)) {
    const eleccion = /** @type {Record<string, unknown> | undefined} */ (fila.choices[0]);
    if (eleccion && typeof eleccion === "object") {
      const delta = /** @type {Record<string, unknown> | undefined} */ (eleccion.delta);
      if (delta && typeof delta.content === "string") return delta.content;
      const mensaje = /** @type {Record<string, unknown> | undefined} */ (eleccion.message);
      if (mensaje && typeof mensaje.content === "string") return mensaje.content;
    }
    return "";
  }
  if (typeof fila.text === "string") return fila.text;
  return "";
}

/**
 * ¿Este evento marca el final de la respuesta?
 * Acepta `finish_reason` (OpenAI/llama.cpp) y el evento `{type:"done"}` de la interfaz.
 * @param {unknown} evento
 * @returns {string} "" si no es final; si lo es, el motivo ("evento_fin" o el finish_reason)
 */
function finDeEvento(evento) {
  if (!evento || typeof evento !== "object") return "";
  const fila = /** @type {Record<string, unknown>} */ (evento);
  if (fila.type === "done") return "evento_fin";
  if (Array.isArray(fila.choices)) {
    for (const eleccion of fila.choices) {
      if (!eleccion || typeof eleccion !== "object") continue;
      const finish = /** @type {{finish_reason?: unknown}} */ (eleccion).finish_reason;
      if (typeof finish === "string" && finish) return finish;
    }
  }
  if (typeof fila.finish_reason === "string" && fila.finish_reason) return fila.finish_reason;
  return "";
}

/**
 * Normaliza la entrada a algo con `read()/cancel()`.
 * Acepta un `Response`, su `body`, un ReadableStream, un stream de Node o un texto/Buffer.
 * @param {unknown} flujo
 */
function obtenerLector(flujo) {
  if (flujo && typeof /** @type {{getReader?: unknown}} */ (flujo).getReader === "function") {
    const lector = /** @type {{getReader: () => any}} */ (flujo).getReader();
    return {
      read: () => lector.read(),
      cancel: async () => { try { await lector.cancel(); } catch { /* ya cerrado */ } },
      release: () => { try { lector.releaseLock?.(); } catch { /* sin lock */ } },
    };
  }
  const cuerpo = flujo && typeof flujo === "object" ? /** @type {{body?: unknown}} */ (flujo).body : undefined;
  if (cuerpo && typeof /** @type {{getReader?: unknown}} */ (cuerpo).getReader === "function") {
    return obtenerLector(cuerpo);
  }
  if (typeof flujo === "string" || flujo instanceof Uint8Array) {
    let pendiente = true;
    return {
      async read() {
        if (!pendiente) return { done: true, value: undefined };
        pendiente = false;
        return { done: false, value: typeof flujo === "string" ? new TextEncoder().encode(flujo) : flujo };
      },
      async cancel() {},
      release() {},
    };
  }
  const iterable = flujo && typeof flujo === "object" ? /** @type {Record<symbol, unknown>} */ (flujo) : {};
  if (typeof iterable[Symbol.asyncIterator] === "function") {
    // @ts-ignore - iterador asíncrono genérico
    const it = /** @type {AsyncIterator<unknown>} */ (flujo)[Symbol.asyncIterator]();
    return {
      async read() {
        const paso = await it.next();
        return paso.done ? { done: true, value: undefined } : { done: false, value: paso.value };
      },
      async cancel() { try { await it.return?.(); } catch { /* ya cerrado */ } },
      release() {},
    };
  }
  throw new ErrorSSE("leerSSE: el argumento no es un cuerpo legible", { motivo: "flujo_invalido" });
}

/**
 * Parte las líneas nuevas de un buffer. Respeta CRLF (también si el CR queda al final y
 * el LF llega en el trozo siguiente: entonces no procesa esa línea todavía).
 * @param {string} texto
 * @param {(linea: string) => void} alLinea
 * @returns {string} el resto sin terminar
 */
function partirLineas(texto, alLinea) {
  let inicio = 0;
  let i = 0;
  while (i < texto.length) {
    const codigo = texto.charCodeAt(i);
    if (codigo === 10) {
      alLinea(texto.slice(inicio, i));
      i += 1;
      inicio = i;
    } else if (codigo === 13) {
      if (i + 1 >= texto.length) break; // puede ser un CRLF partido
      alLinea(texto.slice(inicio, i));
      i += texto.charCodeAt(i + 1) === 10 ? 2 : 1;
      inicio = i;
    } else {
      i += 1;
    }
  }
  return texto.slice(inicio);
}

/**
 * Recorta un texto para los mensajes de error sin partirlo de forma rara.
 * @param {string} texto
 * @param {number} max
 * @returns {string}
 */
function recorte(texto, max = 160) {
  const limpio = String(texto || "").replace(/\s+/g, " ").trim();
  return limpio.length > max ? `${limpio.slice(0, max)}…` : limpio;
}

/**
 * Consume un flujo SSE.
 *
 * @param {unknown} flujo `Response`, `response.body`, ReadableStream, stream de Node, texto o Buffer.
 * @param {{
 *   señal?: AbortSignal | null,
 *   alEvento?: ((evento: any) => void) | null,
 *   alLineaData?: ((linea: string, valor: string) => void) | null,
 *   contarTexto?: ((evento: any) => string) | null,
 *   jsonInvalido?: "error" | "ignorar",
 *   exigirFin?: boolean,
 *   guardarEventos?: boolean,
 *   maxEventos?: number,
 *   maxLineas?: number,
 * }} [opciones]
 * @returns {Promise<{
 *   completo: boolean,
 *   motivo: "done" | "finish_reason" | "evento_fin" | "cierre_sin_fin",
 *   finishReason: string,
 *   texto: string,
 *   eventos: any[],
 *   nEventos: number,
 *   nLineas: number,
 * }>}
 */
export async function leerSSE(flujo, opciones = {}) {
  const {
    señal = null,
    alEvento = null,
    alLineaData = null,
    contarTexto = textoDeEvento,
    jsonInvalido = "error",
    exigirFin = true,
    guardarEventos = true,
    maxEventos = 20000,
    maxLineas = 20000,
  } = opciones;

  const lector = obtenerLector(flujo);
  const decodificador = new TextDecoder("utf-8");
  /** @type {any[]} */
  const eventos = [];
  /** @type {string[]} */
  const lineas = [];
  let texto = "";
  let nEventos = 0;
  let nLineas = 0;
  let finishReason = "";
  let fueDone = false;
  let finPorEvento = false;
  /** @type {string[]} */
  let datosEvento = [];
  let resto = "";
  let primeraLinea = true;
  let terminado = false;

  const abortado = () => Boolean(señal && señal.aborted);

  /** Despacha el evento SSE acumulado (varias líneas `data:` unidas). */
  const despachar = () => {
    if (datosEvento.length === 0) return;
    const payload = datosEvento.join("\n");
    datosEvento = [];
    const limpio = payload.trim();
    if (!limpio) return;
    if (limpio === "[DONE]") {
      fueDone = true;
      return;
    }
    /** @type {any} */
    let json;
    try {
      json = JSON.parse(limpio);
    } catch (causa) {
      if (jsonInvalido === "ignorar") return;
      throw new ErrorSSE(`el servidor envió un evento SSE con JSON inválido: ${recorte(limpio)}`, {
        motivo: "json_invalido",
        parcial: texto,
        eventos,
        lineas,
        finishReason,
        payload: limpio,
        causa,
      });
    }
    nEventos += 1;
    if (guardarEventos && eventos.length < maxEventos) eventos.push(json);
    const trozo = contarTexto(json);
    if (typeof trozo === "string" && trozo) texto += trozo;
    if (!finPorEvento) {
      const fin = finDeEvento(json);
      if (fin) {
        finPorEvento = true;
        if (fin !== "evento_fin") finishReason = fin;
      }
    }
    if (alEvento) alEvento(json);
  };

  /**
   * Procesa una línea SSE completa.
   * @param {string} linea
   */
  const procesarLinea = (linea) => {
    let limpia = linea;
    if (primeraLinea) {
      primeraLinea = false;
      if (limpia.charCodeAt(0) === 0xfeff) limpia = limpia.slice(1);
    }
    if (limpia === "") {
      despachar();
      return;
    }
    if (limpia.startsWith(":")) return; // comentario de keep-alive
    const dosPuntos = limpia.indexOf(":");
    const campo = dosPuntos < 0 ? limpia : limpia.slice(0, dosPuntos);
    if (campo !== "data") return; // event:, id:, retry: no aportan datos aquí
    let valor = dosPuntos < 0 ? "" : limpia.slice(dosPuntos + 1);
    if (valor.startsWith(" ")) valor = valor.slice(1);
    nLineas += 1;
    if (lineas.length < maxLineas) lineas.push(limpia);
    if (alLineaData) alLineaData(limpia, valor);
    datosEvento.push(valor);
  };

  try {
    while (true) {
      if (abortado()) throw señal.reason ?? Object.assign(new Error("abortado"), { name: "AbortError" });
      let paso;
      try {
        paso = await lector.read();
      } catch (err) {
        if (abortado()) throw señal.reason ?? err;
        throw err;
      }
      if (paso.done) break;
      const trozo = typeof paso.value === "string" ? paso.value : decodificador.decode(paso.value, { stream: true });
      if (!trozo) continue;
      resto += trozo;
      resto = partirLineas(resto, procesarLinea);
    }
    // Últimos bytes (puede completar un carácter UTF-8 partido) y última línea sin salto.
    const cola = decodificador.decode();
    if (cola) resto += cola;
    if (resto.endsWith("\r")) {
      procesarLinea(resto.slice(0, -1));
    } else if (resto) {
      procesarLinea(resto);
    }
    resto = "";
    despachar(); // evento final sin línea en blanco
    if (abortado()) throw señal.reason ?? Object.assign(new Error("abortado"), { name: "AbortError" });
    terminado = true;
  } finally {
    // Si el consumidor lanzó su propio error (p. ej. el evento `error` del servidor), se
    // propaga tal cual; aquí solo se cierra el flujo para no dejar la conexión colgada.
    try {
      if (!terminado) await lector.cancel();
    } catch {
      /* el flujo ya estaba cerrado */
    }
    lector.release();
  }

  const completo = fueDone || finPorEvento;
  /** @type {"done" | "finish_reason" | "evento_fin" | "cierre_sin_fin"} */
  const motivo = fueDone
    ? "done"
    : finPorEvento
      ? (finishReason ? "finish_reason" : "evento_fin")
      : "cierre_sin_fin";
  if (!completo && exigirFin) {
    throw new ErrorSSE(
      `la conexión se cortó antes de terminar la respuesta (${nEventos} evento(s) recibidos, ${texto.length} carácter(es) de texto)`,
      { motivo: "cierre_prematuro", parcial: texto, eventos, lineas, finishReason },
    );
  }
  return { completo, motivo, finishReason, texto, eventos, nEventos, nLineas };
}
