/**
 * Lanzamiento y vigilancia de los procesos que pide el agente.
 *
 * Vive aparte de ui-server.mjs por una razón concreta: ui-server.mjs arranca el
 * servidor HTTP al importarse (main() al final del archivo), así que una prueba no
 * puede importarlo. El vigilante del proceso —que es lo que estaba roto— se prueba
 * aquí sin GPU y sin HTTP (chat/prueba-procesos.mjs).
 *
 * Lo que garantiza:
 *  - un comando que se pasa del tiempo se mata CON sus hijos (taskkill /T en Windows),
 *    no solo la shell: si no, el proceso de verdad sigue vivo y escribiendo en la
 *    carpeta del proyecto después de que el turno ya haya terminado;
 *  - si el turno se cancela (el usuario cierra la pestaña), el comando muere con él;
 *  - los pipes de stdout/stderr se cierran siempre, para no dejar descriptores
 *    abiertos ni al padre pendiente de un hijo que ya no existe;
 *  - el error de spawn no se traga: viaja en la salida del comando.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { shellPredeterminada } from "./entorno.mjs";

/** Tiempo máximo de un comando del agente, en milisegundos. */
export const TIMEOUT_MS = 60000;
/** Tope de salida que se le devuelve al modelo. */
export const MAX_SALIDA = 8000;

/**
 * Sin teclado: stdin cerrado. Con el pipe abierto (lo que hace `spawn` por defecto) un
 * `input()` de Python, un `pause` o un instalador que pregunta se quedaban esperando una
 * respuesta que nunca llega hasta el tope de 60 s. Cerrado, leen EOF y fallan al momento
 * con un error que el modelo sí puede corregir.
 */
const STDIO = /** @type {const} */ (["ignore", "pipe", "pipe"]);

/**
 * Recorta un texto largo conservando la CABEZA y, sobre todo, la COLA: en la salida de un
 * comando el final es lo que importa (el traceback, `FAILED`, el código de error). Cortar
 * solo por delante dejaba al modelo sin ver el error.
 * @param {string} texto
 * @param {number} max caracteres como mucho (sin contar la marca del recorte)
 * @param {number} [cabeza] fracción para la cabeza (el resto va a la cola)
 * @returns {string}
 */
export function recortarCentro(texto, max, cabeza = 0.3) {
  const limpio = String(texto || "");
  if (limpio.length <= max) return limpio;
  const n = Math.max(0, Math.floor(max * cabeza));
  const quitados = limpio.length - max;
  return `${limpio.slice(0, n)}\n[…${quitados} caracteres recortados…]\n${limpio.slice(limpio.length - (max - n))}`;
}

/**
 * Acumula la salida de un comando conservando desde el PRIMER bloque la cabeza Y la
 * cola, sin crecer sin limite (hallazgo 12). Antes se hacia `output += ...` y, al
 * pasar de 4*max, `output.slice(-4*max)` borraba el principio: recortarCentro ya no
 * podia conservar la cabeza, aunque el mensaje decia lo contrario. Aqui los dos
 * extremos se guardan por separado desde el primer bloque y el texto final tiene el
 * mismo formato que recortarCentro (cabeza + marca de recorte + cola).
 * @param {number} max caracteres maximos (sin contar la marca del recorte)
 * @param {number} [cabeza] fraccion para la cabeza (el resto va a la cola)
 * @returns {{take: (texto: string) => void, texto: () => string}}
 */
function crearSalida(max, cabeza = 0.3, guardar = null) {
  const capCabeza = Math.max(0, Math.floor(max * cabeza));
  const capCola = Math.max(0, Math.floor(max) - capCabeza);
  let inicio = "";
  let final = "";
  let total = 0;
  return {
    /** @param {string} texto */
    take(texto) {
      const limpio = String(texto || "");
      if (!limpio) return;
      if (guardar) guardar(limpio);
      total += limpio.length;
      let resto = limpio;
      if (inicio.length < capCabeza) {
        const falta = capCabeza - inicio.length;
        inicio += resto.slice(0, falta);
        resto = resto.slice(falta);
      }
      if (resto) {
        final += resto;
        if (final.length > capCola) final = final.slice(-capCola);
      }
    },
    texto() {
      const quitados = total - (inicio.length + final.length);
      return quitados > 0 ? `${inicio}\n[…${quitados} caracteres recortados…]\n${final}` : inicio + final;
    },
  };
}

/**
 * Borra un archivo temporal sin poder romper el comando (BUG-04). En Windows el
 * `.cmd`/`.py` recien ejecutado puede seguir retenido por el proceso que acaba de
 * cerrarse, por el antivirus o por otro handle (EBUSY/EPERM); `rmSync` con
 * `force:true` no basta y una excepcion aqui se llevaria por delante el `resolve`
 * del resultado. Se reintenta un poco de forma sincrona y, si sigue bloqueado, en
 * segundo plano; los temporizadores van con `unref()` para no retrasar la salida.
 * @param {string} file
 * @returns {void}
 */
function borrarTemporal(file) {
  if (!file) return;
  /** @param {number} reintentos */
  const intento = (reintentos) => {
    try {
      fs.rmSync(file, { force: true, maxRetries: reintentos, retryDelay: 50 });
      return true;
    } catch {
      return false;
    }
  };
  if (intento(2)) return;
  let pendientes = 3;
  const reintentar = () => {
    if (intento(1)) return;
    if (pendientes > 0) {
      pendientes -= 1;
      setTimeout(reintentar, 150).unref();
    }
  };
  setTimeout(reintentar, 100).unref();
}

/**
 * Mata un proceso y toda su descendencia.
 * En Windows `child.kill()` solo mata la shell (`cmd.exe` cuando se lanza con
 * `shell: true`), y el proceso de verdad —python, node, lo que sea— sobrevive.
 * `taskkill /T` recorre el árbol. En otros sistemas queda el kill normal: matar el
 * grupo de procesos exigiría lanzar con `detached: true`, que en Windows deja al hijo
 * sin consola y rompe el arranque de PowerShell (ver lanzarServidorLlama).
 * @param {import("node:child_process").ChildProcess | null | undefined} hijo
 * @returns {void}
 */
export function matarArbol(hijo) {
  if (!hijo || !hijo.pid) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/pid", String(hijo.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      hijo.kill("SIGKILL");
    }
  } catch {
    try {
      hijo.kill("SIGKILL");
    } catch {
      /* ya no está */
    }
  }
}

/**
 * `python -c "…"` / `node -e "…"` de varias líneas: el código va a un archivo temporal y
 * se ejecuta ese archivo. El prefijo admite una ruta (`.venv\Scripts\python`) pero no la
 * exige: antes el patrón era `.+?\bpython`, que pide al menos un carácter delante, así que
 * el `python -c` pelado (el caso normal) nunca entraba aquí y acababa en PowerShell, que
 * destroza las comillas escapadas `\"` del código.
 */
const INTERPRETES = [
  { patron: /^((?:[^\r\n"]*?[\\/])?(?:python3?|py)(?:\.exe)?)\s+-c\s+"([\s\S]*)"\s*$/i, ext: ".py" },
  { patron: /^((?:[^\r\n"]*?[\\/])?node(?:\.exe)?)\s+-e\s+"([\s\S]*)"\s*$/i, ext: ".cjs" },
];

/**
 * Quita el escapado de shell de un argumento entre comillas dobles, con las reglas de
 * Windows (las de `CommandLineToArgvW`, que es lo que vería python con un `-c` de una
 * línea): 2n+1 barras + `"` son n barras y una comilla literal. Las barras que no van
 * delante de una comilla se quedan como están.
 * @param {string} texto
 * @returns {string}
 */
export function desescaparComillas(texto) {
  return texto.replace(/(\\+)"/g, (todo, barras) => (barras.length % 2 ? `${"\\".repeat((barras.length - 1) / 2)}"` : todo));
}

/**
 * @param {string} ext
 * @returns {string}
 */
function temporal(ext) {
  return path.join(os.tmpdir(), `bonsai-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
}

/**
 * Lanza un comando. Todo va por la MISMA shell, cmd.exe (la que se le anuncia al modelo):
 * antes los comandos de una línea iban por cmd.exe y los de varias por PowerShell, y el
 * modelo no podía saber cuál le tocaba. Los `python -c "…"`/`node -e "…"` de varias líneas
 * van a un `.py`/`.cjs` temporal; el resto de comandos de varias líneas, a un `.cmd`.
 * `cleanup` borra el temporal.
 * @param {string} command
 * @param {string} cwd
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ child: import("node:child_process").ChildProcess, cleanup: () => void }}
 */
export function launchCommand(command, cwd, env) {
  const shell = shellPredeterminada(env);
  const multiline = /[\r\n]/.test(command);
  for (const { patron, ext } of multiline ? INTERPRETES : []) {
    const hallado = command.match(patron);
    if (!hallado) continue;
    const file = temporal(ext);
    fs.writeFileSync(file, desescaparComillas(hallado[2].replace(/^\r?\n/, "")), "utf8");
    return {
      child: spawn(`"${hallado[1].trim()}" "${file}"`, { cwd, shell, windowsHide: true, env, stdio: STDIO }),
      cleanup: () => borrarTemporal(file),
    };
  }
  if (multiline && process.platform === "win32") {
    // CRLF: cmd.exe lee los .cmd por líneas y con LF solo puede partir mal los bloques.
    // chcp 65001 para que las rutas y textos con tildes no salgan en la página OEM.
    const file = temporal(".cmd");
    const lineas = command.replace(/\r\n?/g, "\n").split("\n");
    fs.writeFileSync(file, ["@echo off", "chcp 65001 >nul", ...lineas].join("\r\n"), "utf8");
    return {
      child: spawn(`"${file}"`, { cwd, shell, windowsHide: true, env, stdio: STDIO }),
      cleanup: () => borrarTemporal(file),
    };
  }
  return {
    child: spawn(command, { cwd, shell, windowsHide: true, env, stdio: STDIO }),
    cleanup: () => {},
  };
}

/**
 * Lanza un comando que NO termina solo (un servidor, un `watch`…) y lo deja corriendo.
 * Espera `esperaMs` para devolver su primera salida (o su error si muere enseguida). Quien
 * lo lanza guarda `parar` y lo llama al acabar el turno: así un servidor del agente nunca
 * se queda vivo ocupando un puerto. Antes la única forma era lanzarlo en primer plano y que
 * se cortara a los 60 s (`proyecto-completo`: 4 comandos así, 4 minutos perdidos).
 * @param {string} command
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, esperaMs?: number, maxBytes?: number}} [opts]
 * @returns {Promise<{vivo: boolean, code: number | null, output: string, pid: number, parar: () => void}>}
 */
export function lanzarEnFondo(command, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const env = opts.env || process.env;
  const esperaMs = Number.isFinite(opts.esperaMs) ? Number(opts.esperaMs) : 4000;
  const maxBytes = Number.isFinite(opts.maxBytes) ? Number(opts.maxBytes) : MAX_SALIDA;
  return new Promise((resolve) => {
    /** @type {{ child: import("node:child_process").ChildProcess, cleanup: () => void }} */
    let lanzado;
    try {
      lanzado = launchCommand(command, cwd, env);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resolve({ vivo: false, code: 1, output: `No se pudo lanzar el comando: ${message}`, pid: 0, parar: () => {} });
      return;
    }
    const { child, cleanup } = lanzado;
    let notificarFin;
    const finalizado = new Promise((resolve) => { notificarFin = resolve; });
    const salida = crearSalida(maxBytes, 0.3, opts.onOutput);
    const decodificadorOut = new TextDecoder();
    const decodificadorErr = new TextDecoder();
    // Decodificacion INCREMENTAL: un caracter UTF-8 puede quedar partido entre dos
    // bloques de datos y `buf.toString("utf8")` por bloque lo rompe (hallazgo 12).
    child.stdout?.on("data", (buf) => salida.take(decodificadorOut.decode(buf, { stream: true })));
    child.stderr?.on("data", (buf) => salida.take(decodificadorErr.decode(buf, { stream: true })));
    /** @type {number | null} */
    let code = null;
    let parado = false;
    const parar = () => {
      if (parado) return;
      parado = true;
      matarArbol(child);
      child.stdout?.destroy();
      child.stderr?.destroy();
      cleanup();
    };
    let resuelto = false;
    const responder = () => {
      if (resuelto) return;
      resuelto = true;
      // Volcar lo que quedara a medias en los decodificadores antes de recoger el texto.
      salida.take(decodificadorOut.decode());
      salida.take(decodificadorErr.decode());
      const vivo = code === null;
      if (!vivo) parar();
      resolve({ vivo, code, output: salida.texto().trim() || "(sin salida todavía)", pid: child.pid || 0, parar, finalizado, estado: () => ({ vivo: code === null && !parado, code, output: salida.texto().trim() || "(sin salida todavía)" }) });
    };
    child.on("close", (c) => {
      code = c ?? 1;
      responder();
      notificarFin();
    });
    child.on("error", (err) => {
      salida.take(`\n${err.message}`);
      code = 1;
      responder();
      notificarFin();
    });
    setTimeout(responder, esperaMs);
  });
}

/**
 * Ejecuta un comando y espera a que termine, se pase del tiempo o se cancele el turno.
 * Nunca lanza: el fallo viaja en `code`/`output`, que es lo que se le enseña al modelo.
 * @param {string} command
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, maxBytes?: number, signal?: AbortSignal}} [opts]
 * @returns {Promise<{code: number, output: string, motivo: "" | "timeout" | "cancelado" | "error"}>}
 */
export function ejecutarComando(command, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const env = opts.env || process.env;
  const timeoutMs = Number.isFinite(opts.timeoutMs) ? Number(opts.timeoutMs) : TIMEOUT_MS;
  const maxBytes = Number.isFinite(opts.maxBytes) ? Number(opts.maxBytes) : MAX_SALIDA;
  const signal = opts.signal;
  return new Promise((resolve) => {
    /** @type {{ child: import("node:child_process").ChildProcess, cleanup: () => void }} */
    let lanzado;
    try {
      lanzado = launchCommand(command, cwd, env);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resolve({ code: 1, output: `No se pudo lanzar el comando: ${message}`, motivo: "error" });
      return;
    }
    const { child, cleanup } = lanzado;
    const salida = crearSalida(maxBytes, 0.3, opts.onOutput);
    const decodificadorOut = new TextDecoder();
    const decodificadorErr = new TextDecoder();
    let settled = false;
    /** @type {NodeJS.Timeout | null} */
    let timer = null;
    /** @type {"" | "timeout" | "cancelado" | "error"} */
    let motivo = "";
    /**
     * @param {number} code
     * @param {string} [extra]
     */
    const finish = (code, extra = "") => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", alAbortar);
      // Volcar primero los decodificadores: puede quedar un caracter UTF-8 a medias.
      salida.take(decodificadorOut.decode());
      salida.take(decodificadorErr.decode());
      if (extra) salida.take(extra);
      // Cerrar los pipes aquí: si el árbol sobreviviera, el padre se quedaría con el
      // descriptor abierto y recibiendo datos de un proceso que ya no le importa.
      child.stdout?.destroy();
      child.stderr?.destroy();
      // Puede fallar en Windows (EBUSY/EPERM); cleanup lo tolera y nunca lanza.
      cleanup();
      const body = salida.texto().trim();
      resolve({ code, output: body || "(sin salida en stdout ni stderr)", motivo });
    };
    // La cabeza y la cola se guardan desde el PRIMER bloque (hallazgo 12): el final
    // es donde van los tracebacks de Python y el principio donde va el mensaje
    // inicial del script; `output.slice(-4*max)` perdia la cabeza.
    child.stdout?.on("data", (buf) => salida.take(decodificadorOut.decode(buf, { stream: true })));
    child.stderr?.on("data", (buf) => salida.take(decodificadorErr.decode(buf, { stream: true })));
    const alAbortar = () => {
      motivo = "cancelado";
      matarArbol(child);
      finish(1, "\n(turno cancelado)");
    };
    child.on("close", (code) => finish(code ?? 1));
    child.on("error", (err) => {
      motivo = "error";
      finish(1, `\n${err.message}`);
    });
    if (signal) {
      if (signal.aborted) {
        alAbortar();
        return;
      }
      signal.addEventListener("abort", alAbortar, { once: true });
    }
    timer = setTimeout(() => {
      motivo = "timeout";
      matarArbol(child);
      finish(1, "\n(tiempo agotado)");
    }, timeoutMs);
  });
}
