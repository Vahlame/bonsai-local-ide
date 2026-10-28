/**
 * Terminal persistente con stdin y procesos en segundo plano que sobreviven al turno.
 *
 * Vive aparte de ui-server.mjs (igual que chat/procesos.mjs) para poder probarse sin
 * arrancar el servidor HTTP ni la GPU: chat/prueba-terminal.mjs.
 *
 * QUÉ RESUELVE
 *  - `Terminales`: una shell que se queda abierta entre comandos, con stdin de verdad.
 *    Antes cada comando era un proceso nuevo, sin teclado y con tope de 60 s; aquí la
 *    shell vive hasta que el usuario la cierra y los comandos largos no tienen tope.
 *  - `Fondo`: procesos que NO terminan solos (un servidor, un `watch`…) y que ya no
 *    mueren al acabar el turno del agente. No hay timeout; sobreviven entre llamadas
 *    mientras el proceso de este módulo (ui-server) siga vivo. `detener` los mata con
 *    todo su árbol de procesos.
 *
 * API PÚBLICA (firmas exactas)
 *
 *   class Terminales extends EventEmitter
 *     constructor({ root, maxBuffer = 200_000 })
 *     abrir({ cwd = "" } = {}) -> { id, cwd, shell }
 *     escribir(id, datos) -> boolean
 *     leer(id, desde = 0) -> { salida, siguiente, vivo, codigo }
 *     cerrar(id) -> boolean
 *     listar() -> [{ id, cwd, vivo, inicio, pid }]
 *     cerrarTodo() -> void
 *     on("salida" | "fin", cb): "salida" -> { id, texto }; "fin" -> { id, codigo }
 *
 *   class Fondo extends EventEmitter
 *     constructor({ root, maxBuffer = 200_000 })
 *     iniciar({ comando, cwd = "", env = {} } = {}) -> { id, pid, comando }
 *     leer(id, desde = 0) -> { salida, siguiente, vivo, codigo }
 *     listar() -> [{ id, comando, cwd, vivo, inicio, pid, codigo }]
 *     detener(id) -> boolean
 *     detenerTodo() -> void
 *     on("salida" | "fin", cb): igual que en Terminales
 *
 * OFFSETS Y BUFFER CIRCULAR (`leer`)
 *  - Cada sesión guarda como mucho `maxBuffer` caracteres (200 000 por defecto).
 *  - `siguiente` es un offset ABSOLUTO (caracteres desde el arranque de la sesión), no
 *    relativo al buffer: se puede pasar tal cual a la siguiente llamada.
 *  - Si el llamador se retrasa y el buffer ya recortó el principio, `leer` devuelve solo
 *    la cola que aún se conserva (no falla). Cuánto se perdió se deduce sin ambigüedad:
 *    `perdido = (siguiente - desde) - salida.length` (con `desde <= total`); el llamador
 *    puede avisar en la UI con ese cálculo. El texto perdido no se puede recuperar.
 *  - `desde = 0` devuelve todo lo conservado. Si `desde` está por delante del final se
 *    devuelve `salida: ""` y `siguiente` = final (el llamador debe quedarse con ese
 *    `siguiente`, no con el `desde` que pidió).
 *
 * ESTADO
 *  - `vivo`: true mientras el proceso (la shell o el comando) siga en marcha.
 *  - `codigo`: null mientras `vivo`; cuando termina es un número. Si el proceso muere
 *    solo se informa su código real; si lo matamos nosotros (`cerrar`/`detener`) y el
 *    sistema no da código, se informa 1 (un cierre forzado no es un éxito).
 *  - `cerrar`/`detener` dejan un registro mínimo (sin procesos) para que `leer` siga
 *    informando `vivo: false` y `codigo`. `cerrarTodo`/`detenerTodo` lo borra todo.
 *  - `leer`/`escribir` lanzan si el `id` no existe (error de programación, no de la
 *    sesión); `cerrar`/`detener` devuelven false en ese caso y nunca lanzan.
 *
 * MATAR EL ÁRBOL
 *  - Windows: `taskkill /PID <pid> /T /F` (matar solo `cmd.exe` dejaría vivos a node,
 *    python o al servidor de verdad). Es síncrono: al volver de `cerrar`/`detener` el
 *    árbol ya fue mandado matar.
 *  - POSIX: el proceso se lanza con `detached: true` (grupo de procesos propio) y se usa
 *    `process.kill(-pid, "SIGKILL")`, con `child.kill()` de reserva.
 *
 * CODIFICACIÓN
 *  - La SALIDA se decodifica como UTF-8 incremental con `TextDecoder(stream: true)`:
 *    un carácter multibyte partido entre dos bloques no se rompe. Las dos tuberías
 *    (stdout y stderr) se mezclan en un único flujo con orden aproximado.
 *  - La ENTRADA de `Terminales` va CRUDA al stdin de la shell (el llamador añade `\r\n`
 *    si quiere ejecutar). En Windows `cmd.exe` la interpreta con la página de códigos
 *    OEM: los comandos deben ser ASCII (p. ej. no se pueden teclear rutas con acentos).
 *    La salida de los programas hijos, en cambio, sí es UTF-8.
 *
 * LIMITACIONES REALES (importantes para la UI)
 *  - No hay PTY: es una shell por tuberías. Los programas que exigen una consola de
 *    verdad (editores de pantalla completa, `top`, `vim`, colores, detección de TTY)
 *    no funcionan o lo hacen sin capacidades interactivas. No es una terminal de
 *    emulación completa.
 *  - La shell no es interactiva: no hay eco local de lo que se escribe (la UI debe
 *    mostrar el comando en su propio historial) ni autocompletado, y `cmd.exe` imprime
 *    su banner y su prompt (`C:\ruta>`) en la salida.
 *  - stdin COMPARTIDO: `cmd.exe` lee del mismo pipe que los hijos. Por eso hay que
 *    escribir datos para un hijo cuando ya está en marcha (p. ej. después de ver su
 *    primera salida); si se escriben dos líneas a la vez, cmd puede consumir la
 *    segunda como si fuera un comando.
 *  - En Windows `env` solo se puede pasar a `Fondo.iniciar` (a la shell de `Terminales`
 *    no: se hereda el entorno del proceso). `Fondo` lanza `cmd.exe /d /s /c "<comando>"`
 *    con el comando como argumento ÚNICO (misma construcción que child_process con
 *    shell:true): no se interpola ningún otro dato, pero el comando SÍ es una línea de
 *    shell y admite `&&`, redirecciones, etc. Si el texto del comando acaba en comilla
 *    doble, cmd puede recortarla (limitación conocida de `/s /c`).
 *  - Un `Terminales`/`Fondo` que no se cierre mantiene procesos vivos: la integración
 *    debe llamar a `cerrarTodo`/`detenerTodo` al apagar el servidor. Este módulo no
 *    instala manejadores globales de salida para no matar procesos de otros.
 */

import { TextDecoder } from "node:util";
import { EventEmitter } from "node:events";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Tope de salida por defecto de cada sesión, en caracteres. */
export const MAX_BUFFER_POR_DEFECTO = 200_000;

const ES_WINDOWS = process.platform === "win32";

/**
 * Buffer circular de texto con offsets ABSOLUTOS.
 *
 * Se guarda una única cadena `cola` y `inicio` marca el offset absoluto de su primer
 * carácter, de modo que `total` = inicio + cola.length es siempre el offset del final
 * (lo que devuelve `siguiente`). Al recortar por delante solo sube `inicio`: los
 * offsets ya entregados nunca cambian de significado.
 */
class SalidaCircular {
  /** @param {number} maxBuffer caracteres como máximo */
  constructor(maxBuffer) {
    const tope = Math.trunc(Number(maxBuffer));
    this.maxBuffer = Number.isFinite(tope) && tope > 0 ? tope : MAX_BUFFER_POR_DEFECTO;
    /** Texto conservado. @type {string} */
    this.cola = "";
    /** Offset absoluto del primer carácter de `cola`. @type {number} */
    this.inicio = 0;
  }

  /** Offset absoluto del final: el `siguiente` que se devuelve al llamador. */
  get total() {
    return this.inicio + this.cola.length;
  }

  /**
   * Añade texto y recorta por delante si se pasa del tope.
   * @param {string} texto
   * @returns {void}
   */
  agregar(texto) {
    if (!texto) return;
    this.cola += texto;
    const sobran = this.cola.length - this.maxBuffer;
    if (sobran > 0) {
      this.cola = this.cola.slice(sobran);
      this.inicio += sobran;
    }
  }

  /**
   * @param {number} desde offset absoluto pedido
   * @returns {{ salida: string, siguiente: number }}
   */
  leer(desde) {
    let offset = Math.trunc(Number(desde));
    if (!Number.isFinite(offset) || offset < 0) offset = 0;
    // Si pidió más atrás de lo que se conserva, se devuelve la cola disponible; la
    // parte perdida se deduce con la resta documentada en la cabecera.
    if (offset < this.inicio) offset = this.inicio;
    if (offset > this.total) offset = this.total;
    return { salida: this.cola.slice(offset - this.inicio), siguiente: this.total };
  }
}

/**
 * @typedef {object} Registro
 * @property {string} id
 * @property {string} cwd
 * @property {string} comando
 * @property {number} pid
 * @property {string} inicio
 * @property {boolean} vivo
 * @property {number | null} codigo
 * @property {import("node:child_process").ChildProcess | null} hijo
 * @property {SalidaCircular} salida
 * @property {TextDecoder} decOut
 * @property {TextDecoder} decErr
 */

/**
 * Mata un proceso y toda su descendencia.
 * @param {import("node:child_process").ChildProcess | null} hijo
 * @returns {void}
 */
function matarArbol(hijo) {
  if (!hijo || !hijo.pid) return;
  if (ES_WINDOWS) {
    try {
      execFileSync("taskkill", ["/PID", String(hijo.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      // taskkill puede fallar si el proceso ya murió; se intenta el kill normal.
      try {
        hijo.kill();
      } catch {
        /* ya no estaba */
      }
    }
    return;
  }
  // POSIX: se lanzó con detached:true, así que -pid es el grupo entero.
  try {
    process.kill(-hijo.pid, "SIGKILL");
  } catch {
    try {
      hijo.kill("SIGKILL");
    } catch {
      /* ya no estaba */
    }
  }
}

/**
 * Resuelve `cwd` relativo a la raíz y rechaza lo que se salga de ella.
 * @param {string} root ruta absoluta ya validada
 * @param {string} cwd
 * @returns {string} ruta absoluta dentro de la raíz
 */
function resolverCwd(root, cwd) {
  const crudo = typeof cwd === "string" && cwd.trim() ? cwd : ".";
  const destino = path.resolve(root, crudo);
  const relativa = path.relative(root, destino);
  if (relativa.startsWith("..") || path.isAbsolute(relativa)) {
    throw new Error(`cwd fuera del proyecto: ${JSON.stringify(cwd)} (raíz: ${root})`);
  }
  let info;
  try {
    info = fs.statSync(destino);
  } catch {
    throw new Error(`cwd no existe: ${destino}`);
  }
  if (!info.isDirectory()) throw new Error(`cwd no es una carpeta: ${destino}`);
  return destino;
}

/**
 * Entorno para un proceso hijo: el del IDE más lo que pida el llamador (texto).
 * @param {Record<string, unknown>} [extra]
 * @returns {NodeJS.ProcessEnv}
 */
function mezclarEnv(extra) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env };
  if (!extra || typeof extra !== "object") return env;
  for (const [clave, valor] of Object.entries(extra)) {
    if (valor === undefined || valor === null) continue;
    env[clave] = String(valor);
  }
  return env;
}

/**
 * Shell persistente por plataforma.
 * @returns {{ archivo: string, args: string[], descripcion: string }}
 */
function definirShell() {
  if (ES_WINDOWS) {
    return {
      archivo: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/q"],
      descripcion: "cmd.exe /d /q",
    };
  }
  const archivo = process.env.SHELL || "/bin/sh";
  return { archivo, args: [], descripcion: `${archivo} (tuberías)` };
}

/**
 * Gestor común: misma sesión, mismo buffer, mismos eventos y mismo `leer` para la
 * terminal persistente y para los procesos en segundo plano. Cada subclase solo cambia
 * cómo lanza, mata y qué campos devuelve `listar`.
 */
class GestorProcesos extends EventEmitter {
  /**
   * @param {{ root?: string, maxBuffer?: number, prefijo?: string, etiqueta?: string }} [opciones]
   */
  constructor(opciones = {}) {
    super();
    const root = path.resolve(opciones.root || process.cwd());
    let info;
    try {
      info = fs.statSync(root);
    } catch {
      throw new Error(`la raíz no existe: ${root}`);
    }
    if (!info.isDirectory()) throw new Error(`la raíz no es una carpeta: ${root}`);
    this.root = root;
    const tope = Math.trunc(Number(opciones.maxBuffer));
    this.maxBuffer = Number.isFinite(tope) && tope > 0 ? tope : MAX_BUFFER_POR_DEFECTO;
    this.prefijo = opciones.prefijo || "s";
    this.etiqueta = opciones.etiqueta || "proceso";
    /** @type {Map<string, Registro>} */
    this.sesiones = new Map();
    this.contador = 0;
  }

  /**
   * Crea el registro, engancha las tuberías y empieza a acumular salida.
   * @param {string} cwd ruta absoluta
   * @param {string} comando descripción del proceso (shell o línea de comando)
   * @param {import("node:child_process").ChildProcess} hijo
   * @returns {Registro}
   */
  _crear(cwd, comando, hijo) {
    const id = `${this.prefijo}${++this.contador}`;
    /** @type {Registro} */
    const registro = {
      id,
      cwd,
      comando,
      pid: typeof hijo.pid === "number" ? hijo.pid : 0,
      inicio: new Date().toISOString(),
      vivo: true,
      codigo: null,
      hijo,
      salida: new SalidaCircular(this.maxBuffer),
      decOut: new TextDecoder("utf-8", { fatal: false }),
      decErr: new TextDecoder("utf-8", { fatal: false }),
    };
    this.sesiones.set(id, registro);
    hijo.stdout?.on("data", (buf) => this._volcar(registro, registro.decOut, buf));
    hijo.stderr?.on("data", (buf) => this._volcar(registro, registro.decErr, buf));
    // EPIPE es normal cuando el proceso ya no lee (p. ej. lo matamos); no debe romper.
    hijo.stdin?.on("error", () => {});
    hijo.on("error", (error) => {
      this._volcarTexto(registro, `\n[error] ${error instanceof Error ? error.message : String(error)}\n`);
      this._finalizar(registro, 1);
    });
    hijo.on("close", (codigo) => this._finalizar(registro, codigo));
    return registro;
  }

  /**
   * Decodifica un bloque de bytes y lo acumula. Decodificación INCREMENTAL: un carácter
   * UTF-8 puede venir partido entre dos bloques y `buf.toString("utf8")` lo rompería.
   * @param {Registro} registro
   * @param {TextDecoder} decodificador
   * @param {Buffer} buf
   * @returns {void}
   */
  _volcar(registro, decodificador, buf) {
    const texto = decodificador.decode(buf, { stream: true });
    if (texto) this._volcarTexto(registro, texto);
  }

  /**
   * Acumula texto en el buffer y emite "salida".
   * @param {Registro} registro
   * @param {string} texto
   * @returns {void}
   */
  _volcarTexto(registro, texto) {
    if (!texto) return;
    registro.salida.agregar(texto);
    this.emit("salida", { id: registro.id, texto });
  }

  /**
   * Cierra la sesión una sola vez: vuelca lo que quedara en los decodificadores, fija
   * `vivo`/`codigo`, suelta las tuberías y emite "fin".
   * @param {Registro} registro
   * @param {number | null} codigo código real o null si no lo hubo (matado o error)
   * @returns {void}
   */
  _finalizar(registro, codigo) {
    if (!registro.vivo) return;
    // Flush: puede quedar un carácter UTF-8 a medias en el decodificador.
    const resto = registro.decOut.decode();
    if (resto) this._volcarTexto(registro, resto);
    const restoErr = registro.decErr.decode();
    if (restoErr) this._volcarTexto(registro, restoErr);
    registro.vivo = false;
    registro.codigo = Number.isInteger(codigo) ? Number(codigo) : 1;
    const hijo = registro.hijo;
    registro.hijo = null;
    if (hijo) {
      try {
        hijo.stdin?.destroy();
      } catch {
        /* ya cerrado */
      }
      try {
        hijo.stdout?.destroy();
      } catch {
        /* ya cerrado */
      }
      try {
        hijo.stderr?.destroy();
      } catch {
        /* ya cerrado */
      }
    }
    this.emit("fin", { id: registro.id, codigo: registro.codigo });
  }

  /**
   * Implementación de `cerrar`/`detener`.
   * @param {string} id
   * @returns {boolean} false si el id no existe
   */
  _cerrar(id) {
    const registro = this.sesiones.get(String(id));
    if (!registro) return false;
    if (registro.vivo) {
      if (registro.hijo) matarArbol(registro.hijo);
      this._finalizar(registro, null);
    }
    return true;
  }

  /**
   * Implementación de `leer`.
   * @param {string} id
   * @param {number} [desde]
   * @returns {{ salida: string, siguiente: number, vivo: boolean, codigo: number | null }}
   */
  _leer(id, desde = 0) {
    const registro = this._obtener(id);
    const { salida, siguiente } = registro.salida.leer(desde);
    return { salida, siguiente, vivo: registro.vivo, codigo: registro.codigo };
  }

  /**
   * @param {string} id
   * @returns {Registro}
   */
  _obtener(id) {
    const registro = this.sesiones.get(String(id));
    if (!registro) {
      throw new Error(`${this.etiqueta}: no existe la sesión ${JSON.stringify(id)}`);
    }
    return registro;
  }

  /** Implementación de `cerrarTodo`/`detenerTodo`. */
  _cerrarTodo() {
    for (const id of [...this.sesiones.keys()]) this._cerrar(id);
    this.sesiones.clear();
  }
}

/**
 * Shell persistente por tuberías: se abre una vez y se le escriben comandos con
 * `escribir`; su salida se recoge con `leer`. Sin PTY (ver limitaciones en la cabecera).
 */
export class Terminales extends GestorProcesos {
  /**
   * @param {{ root?: string, maxBuffer?: number }} [opciones]
   */
  constructor(opciones = {}) {
    super({ root: opciones.root, maxBuffer: opciones.maxBuffer, prefijo: "t", etiqueta: "terminal" });
  }

  /**
   * Abre una shell persistente con stdin, stdout y stderr por tuberías.
   * @param {{ cwd?: string }} [opciones] `cwd` relativo a la raíz del proyecto
   * @returns {{ id: string, cwd: string, shell: string }}
   */
  abrir(opciones = {}) {
    const cwd = resolverCwd(this.root, opciones.cwd);
    const shell = definirShell();
    /** @type {import("node:child_process").ChildProcess} */
    let hijo;
    try {
      hijo = spawn(shell.archivo, shell.args, {
        cwd,
        env: { ...process.env },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        // POSIX: grupo propio para poder matar el árbol con kill(-pid).
        detached: !ES_WINDOWS,
      });
    } catch (error) {
      throw new Error(`no se pudo abrir la shell (${shell.descripcion}): ${error instanceof Error ? error.message : String(error)}`);
    }
    const registro = this._crear(cwd, shell.descripcion, hijo);
    return { id: registro.id, cwd, shell: shell.descripcion };
  }

  /**
   * Escribe datos CRUDOS en el stdin de la shell. El llamador añade `\r\n` si quiere
   * ejecutar el comando. Devuelve false si la sesión no existe, ya terminó o su stdin
   * está cerrado.
   * @param {string} id
   * @param {string} datos
   * @returns {boolean}
   */
  escribir(id, datos) {
    const registro = this._obtener(id);
    if (!registro.vivo || !registro.hijo?.stdin) return false;
    try {
      registro.hijo.stdin.write(String(datos ?? ""));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lee la salida acumulada desde `desde` y devuelve el offset para la próxima llamada.
   * @param {string} id
   * @param {number} [desde]
   * @returns {{ salida: string, siguiente: number, vivo: boolean, codigo: number | null }}
   */
  leer(id, desde = 0) {
    return this._leer(id, desde);
  }

  /**
   * Mata el árbol de procesos de la terminal (Windows: taskkill /T /F) y libera las
   * tuberías. Deja un registro para que `leer` siga informando `vivo: false`.
   * @param {string} id
   * @returns {boolean} false si el id no existe
   */
  cerrar(id) {
    return this._cerrar(id);
  }

  /**
   * @returns {{ id: string, cwd: string, vivo: boolean, inicio: string, pid: number }[]}
   */
  listar() {
    return [...this.sesiones.values()].map((registro) => ({
      id: registro.id,
      cwd: registro.cwd,
      vivo: registro.vivo,
      inicio: registro.inicio,
      pid: registro.pid,
    }));
  }

  /** Cierra todas las terminales y vacía el registro. @returns {void} */
  cerrarTodo() {
    this._cerrarTodo();
  }
}

/**
 * Procesos en segundo plano sin timeout: no mueren al acabar el turno del agente; se
 * paran explícitamente con `detener`/`detenerTodo` (matando su árbol de procesos).
 */
export class Fondo extends GestorProcesos {
  /**
   * @param {{ root?: string, maxBuffer?: number }} [opciones]
   */
  constructor(opciones = {}) {
    super({ root: opciones.root, maxBuffer: opciones.maxBuffer, prefijo: "f", etiqueta: "fondo" });
  }

  /**
   * Lanza un comando en segundo plano (stdout+stderr mezclados, sin timeout).
   * Windows: `cmd.exe /d /s /c "<comando>"` con el comando como argumento ÚNICO
   * (misma construcción que child_process con shell:true; no se interpola nada más).
   * @param {{ comando?: string, cwd?: string, env?: Record<string, unknown> }} [opciones]
   * @returns {{ id: string, pid: number, comando: string }}
   */
  iniciar(opciones = {}) {
    const comando = typeof opciones.comando === "string" ? opciones.comando : "";
    if (!comando.trim()) throw new Error("comando vacío: Fondo.iniciar necesita un comando");
    const cwd = resolverCwd(this.root, opciones.cwd);
    const env = mezclarEnv(opciones.env);
    /** @type {import("node:child_process").ChildProcess} */
    let hijo;
    try {
      if (ES_WINDOWS) {
        const archivo = process.env.ComSpec || "cmd.exe";
        // /s /c + comando entre comillas + windowsVerbatimArguments: cmd recibe la línea
        // tal cual (nada de reinterpretar comillas ni inyectar argumentos extra).
        hijo = spawn(archivo, ["/d", "/s", "/c", `"${comando}"`], {
          cwd,
          env,
          windowsHide: true,
          windowsVerbatimArguments: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } else {
        const shell = process.env.SHELL || "/bin/sh";
        hijo = spawn(shell, ["-c", comando], {
          cwd,
          env,
          windowsHide: true,
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
      }
    } catch (error) {
      throw new Error(`no se pudo lanzar en segundo plano: ${error instanceof Error ? error.message : String(error)}`);
    }
    const registro = this._crear(cwd, comando, hijo);
    return { id: registro.id, pid: registro.pid, comando };
  }

  /**
   * @param {string} id
   * @param {number} [desde]
   * @returns {{ salida: string, siguiente: number, vivo: boolean, codigo: number | null }}
   */
  leer(id, desde = 0) {
    return this._leer(id, desde);
  }

  /**
   * Mata el árbol del proceso en segundo plano y libera las tuberías.
   * @param {string} id
   * @returns {boolean} false si el id no existe
   */
  detener(id) {
    return this._cerrar(id);
  }

  /**
   * @returns {{ id: string, comando: string, cwd: string, vivo: boolean, inicio: string, pid: number, codigo: number | null }[]}
   */
  listar() {
    return [...this.sesiones.values()].map((registro) => ({
      id: registro.id,
      comando: registro.comando,
      cwd: registro.cwd,
      vivo: registro.vivo,
      inicio: registro.inicio,
      pid: registro.pid,
      codigo: registro.codigo,
    }));
  }

  /** Detiene todos los procesos de fondo y vacía el registro. @returns {void} */
  detenerTodo() {
    this._cerrarTodo();
  }
}
