/**
 * Interfaz local. El modelo sigue con el historial corto y, si responde
 * con un archivo, se guarda en salida/ y se puede abrir desde la página.
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveInside } from "./actions.mjs";
import { metricasLegacyToolParser } from "./legacy-tool-parser.mjs";

import { BonsaiChat } from "./bonsai-chat.mjs";
import { MODELO, pensarDe, presupuestoPensar } from "./modelo.mjs";
import { RULES_CAP_TOKENS, estimateTokens, takeHeadByTokens } from "./context.mjs";
import { parseArgs, fileInside } from "./server/http.mjs";
import { catalogoModelos, mmprojDisponible } from "./server/catalog.mjs";

import { openBrowser } from "./server/browser.mjs";
import { UndoStore } from "./server/undo.mjs";
import { cerrarSnapshotCache, createWorkspaceTools } from "./server/workspace.mjs";
import { chatTitle } from "./server/text.mjs";
import { createRoutes } from "./server/routes/index.mjs";
import { createAgentLoop } from "./server/agent-loop.mjs";

import { revisarPeticion } from "./guardia.mjs";

import { createManagedServer, configurationFromMarker, closeHttpServer, LifecycleError } from "./lifecycle/managed-server.mjs";
import { createProcessAdapter } from "./lifecycle/process-adapter.mjs";
import { selectBinary } from "./lifecycle/binary-registry.mjs";
import { podarEstadoOperativo } from "./retencion.mjs";

import { rutaProyecto, escribirAtomico } from "./archivos-seguros.mjs";
import { LIMITE_TEXTO, leerTextoAcotado } from "./lecturas.mjs";
import { crearHistorial } from "./historial.mjs";
import { crearMemoriaGlobal } from "./memoria-global.mjs";
import { Terminales } from "./terminal.mjs";
import { CODER_CONFIG, coderOptions } from "./coder-harness.mjs";

import { engineProfile, isNamedEnginePreset } from "./engine-profiles.mjs";
import { escanearModelos } from "./model-hub.mjs";

import { createSettingsService } from "./server/services/settings.mjs";
import { createWorkspaceService } from "./server/services/workspace.mjs";
import { createCommandService } from "./server/services/commands.mjs";
import { createHistoryService } from "./server/services/history.mjs";
import { createRulesService } from "./server/services/rules.mjs";
import { createGitService } from "./server/services/git.mjs";
import { createPermissionService } from "./server/services/permissions.mjs";
import { createSymbolIndex } from "./server/services/symbol-index.mjs";
import { createStatsService } from "./server/services/stats.mjs";
import { createLauncherService } from "./server/services/launcher.mjs";
import { createFolderPicker } from "./server/services/folder-picker.mjs";
import { createBackgroundProcessRegistry } from "./server/services/background-processes.mjs";
import { createOutputLogService } from "./server/services/output-log.mjs";
import { aplicarCabecerasSeguridad } from "./server/security-headers.mjs";
import { crearObservabilidad } from "./server/observability.mjs";
import { construirOpenApi } from "./server/contracts.mjs";

const UI_THEME_IDS = new Set(JSON.parse(fs.readFileSync(new URL("./ui/themes.json", import.meta.url), "utf8")).map(t => t.id));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
let VERSION = "0.0.0";
try {
  VERSION = JSON.parse(fs.readFileSync(path.join(PROJECT, "package.json"), "utf8")).version || VERSION;
} catch {
  /* la copia aislada puede no llevar package.json */
}
// BONSAI_STATE aparta chats, sesión, permisos y carpeta de trabajo (pruebas sin tocar los tuyos)
const STATE = process.env.BONSAI_STATE ? path.resolve(process.env.BONSAI_STATE) : HERE;
// Retención oportunista: no bloquea el arranque y nunca toca el archivo más
// reciente de cada carpeta. Los chats personales se conservan 1 año/1000.
setImmediate(() => {
  try { podarEstadoOperativo({ stateDir: STATE, logsDir: path.join(PROJECT, "logs") }); } catch { /* sin permisos */ }
});
const SALIDA = process.env.BONSAI_SALIDA ? path.resolve(process.env.BONSAI_SALIDA) : path.join(PROJECT, "salida");
const PAGE = path.join(HERE, "ui", "index.html");
const WORKSPACE_FILE = path.join(STATE, "ui-workspace.json");
const PERMIT_FILE = path.join(STATE, "ui-permit.json");
// Copias para deshacer lo que escribe el agente o el editor (una por escritura).
const UNDO_DIR = path.join(STATE, "undo");
/** Adjuntos (imágenes pegadas o arrastradas) fuera del proyecto del usuario. */
const ADJUNTOS_DIR = path.join(SALIDA, "adjuntos");
const startedAt = Date.now();
const REGISTROS_DIR = path.join(STATE, "salidas-agente");

// --- Servicios de estado (sin HTTP) ----------------------------------------
const workspace = createWorkspaceService({ projectRoot: PROJECT, stateFile: WORKSPACE_FILE });
/** Configuración mutable que comparten ajustes, comandos y el bucle del agente. */
const runtime = { saltosTope: 192, comandoTimeoutMs: 180000 };
const outputLog = createOutputLogService({ dir: REGISTROS_DIR });
const commandService = createCommandService({
  here: HERE,
  getRoot: () => workspace.getRoot(),
  getTimeoutMs: () => runtime.comandoTimeoutMs,
});
const symbolIndex = createSymbolIndex({ getRoot: () => workspace.getRoot() });
const background = createBackgroundProcessRegistry();
const gitService = createGitService({ getRoot: () => workspace.getRoot() });
const folderPicker = createFolderPicker({ getStart: () => workspace.getRoot() });
const rulesService = createRulesService({
  getRoot: () => workspace.getRoot(),
  fileInside,
  readLimited: (abs, limite) => leerTextoAcotado(abs, limite),
  takeHeadByTokens,
  estimateTokens,
  rulesCapTokens: RULES_CAP_TOKENS,
});
const launcherService = createLauncherService({
  projectRoot: PROJECT,
  catalog: MODELO,
  isNamedEnginePreset,
  engineProfile,
  selectBinary,
  LifecycleError,
});

const undoStore = new UndoStore({
  dir: UNDO_DIR,
  getWorkspaceRoot: () => workspace.getRoot(),
  fileInside,
  escribirAtomico,
  limiteTexto: LIMITE_TEXTO,
});
const workspaceTools = createWorkspaceTools({
  getRoot: () => workspace.getRoot(),
  adjuntosDir: ADJUNTOS_DIR,
  fileInside,
  rutaProyecto,
  resolveInside,
  readLimited: (abs, limite) => leerTextoAcotado(abs, limite),
  takeHeadByTokens,
  estimateTokens,
});
const { repoIndex, attachFiles, attachSnippets, attachImagenes, filesNamedIn, relCanonica, pdfReady } = workspaceTools;

/** Sesiones del terminal integrado (se recrean si cambia la carpeta de trabajo). */
let terminales = null;

/** @returns {Terminales} */
function sesionesTerminal() {
  if (!terminales || terminales.root !== workspace.getRoot()) {
    try { terminales?.cerrarTodo(); } catch { /* sin sesiones */ }
    terminales = new Terminales({ root: workspace.getRoot(), env: commandService.shellEnv, pty: process.env.BONSAI_PTY !== "0" });
  }
  return terminales;
}

// Al apagar el servidor se cierran las shells abiertas (taskkill /T es síncrono).
for (const evento of ["exit", "SIGINT", "SIGTERM"]) {
  process.once(evento, () => {
    try { terminales?.cerrarTodo(); } catch { /* ya cerrado */ }
    background.stopAll();
    if (evento !== "exit") process.exit(0);
  });
}

/**
 * Texto del plan persistente (checklist) para el mensaje de sistema.
 * @param {{pasos?: string[], hechos?: number[]} | null | undefined} plan
 * @returns {string}
 */
function textoPlan(plan) {
  if (!plan || !Array.isArray(plan.pasos) || !plan.pasos.length) return "";
  const hechos = new Set((Array.isArray(plan.hechos) ? plan.hechos : []).map(Number));
  const filas = plan.pasos.map((paso, i) => `${hechos.has(i + 1) ? "[x]" : "[ ]"} ${i + 1}. ${paso}`);
  return `PLAN DE LA TAREA (te lo recuerda la app; actualízalo con la función plan):\n${filas.join("\n")}`;
}

/**
 * @param {ReturnType<typeof parseArgs>} args
 */
async function main(args) {
  // Model Hub: los GGUF que ya estén en models/ se registran solos. En pruebas
  // (BONSAI_STATE definido) no se escanea el disco real salvo que se pida.
  if (!process.env.BONSAI_STATE || process.env.BONSAI_HUB_SCAN === "1") {
    try {
      await escanearModelos({ silencioso: true });
    } catch (error) {
      process.stderr.write(`[model-hub] no se pudo escanear models/: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }
  workspace.load();
  // El historial (índice, archivos y copia de trabajo) vive en chat/historial.mjs: aquí
  // solo se recupera lo que haya quedado corrupto antes de crear el chat.
  const historial = crearHistorial({ stateDir: STATE, sessionPath: path.join(STATE, "ui-session.json"), tituloDe: chatTitle });
  // Memoria global entre chats: archivo aparte en el estado local, fuera del proyecto
  // del usuario y de Git. Se selecciona por relevancia en cada turno (ver abajo).
  const memoriaGlobal = crearMemoriaGlobal({ stateDir: STATE });
  const avisosInicio = historial.prepararSesionInicial();
  const chat = new BonsaiChat({
    host: "127.0.0.1",
    port: args.llamaPort,
    historyCap: args.historyCap,
    sessionPath: path.join(STATE, "ui-session.json"),
    timingsPath: path.join(STATE, "timings.jsonl"),
    think: args.think,
    perfil: args.perfil,
  });
  chat.silent = true;
  chat.actOnPc = true;
  chat.loadSession();
  // A partir de aquí `chat.saveSession` guarda la copia de trabajo y archiva.
  const history = createHistoryService({
    stateDir: STATE,
    sessionPath: path.join(STATE, "ui-session.json"),
    chat,
    chatTitle,
    historial,
  });
  for (const aviso of avisosInicio) chat.note(`historial: ${aviso}`);
  // El servidor del modelo puede NO estar arrancado todavía: el usuario lo inicia
  // desde el botón "Iniciar" (o el comando del botón "Terminal"). La interfaz debe
  // abrir igualmente y mostrar "Desconectado" hasta que /api/server/start lo encienda.
  let modeloListo = false;
  try {
    await chat.connect();
    modeloListo = true;
  } catch {
    modeloListo = false;
  }
  /** Visión: el servidor la anuncia en /props. Sin mmproj no puede ver imágenes. */
  chat.vision = modeloListo && Boolean(chat.props?.modalities && chat.props.modalities.vision === true);

  let busy = false;
  let configuracionApagada = null;
  /** Puntos de deshacer de las escrituras del AGENTE en el turno en curso (para "revertir el turno"). */
  /** @type {string[]} */
  let undoDelTurno = [];
  /** Número de turno del chat: los ids de acción llevan este prefijo para no chocar entre turnos. */
  let turno = 0;
  const permissions = createPermissionService({ stateFile: PERMIT_FILE });

  /**
   * Clave del catálogo que está cargada ahora mismo (por el `model_path` de /props).
   * @returns {string}
   */
  function modeloActualClave() {
    const cargado = path.basename(String(chat.props?.model_path || chat.model || ""));
    const fila = catalogoModelos().find((m) => m.archivo === cargado);
    return fila ? fila.clave : "";
  }

  const SETTINGS_FILE = path.join(STATE, "ui-settings.json");
  // El lanzador de escritorio elige el perfil de agente. `optimized` era el
  // nombre histórico del perfil de coding; hoy el único perfil con el harness
  // nuevo es `small-local-coder`. Los ajustes guardados siguen mandando.
  const PERFIL_INICIAL = ["legacy", "small-local-coder"].includes(args.agentProfile)
    ? args.agentProfile
    : (process.env.BONSAI_AGENT_PROFILE || "legacy");
  const settings = createSettingsService({
    stateFile: SETTINGS_FILE,
    args,
    chat,
    initialProfile: PERFIL_INICIAL,
    catalog: MODELO,
    catalogoModelos,
    pensarDe,
    presupuestoPensar,
    engineProfile,
    isNamedEnginePreset,
    coderConfig: CODER_CONFIG,
    coderOptions,
    getModelKey: modeloActualClave,
    runtime,
  });

  const lifecycle = createManagedServer({
    port: args.llamaPort,
    adapter: createProcessAdapter({ root: PROJECT, catalog: MODELO, getSettings: settings.leerAjustes, isNamedEnginePreset,
      engineProfile, mmprojDisponible, presupuestoPensar, onThinking: (n) => { settings.setPensarServidor(n); } }),
  });
  async function configuracionAnterior() {
    const state = await lifecycle.inspect();
    // `state.state` puede ser "error" por un fallo anterior aunque el servidor
    // real esté vacío; `actualState` es el estado del adaptador. Sin esto, un
    // solo fallo de arranque deja el cambio de modelo bloqueado hasta reiniciar.
    const actual = state.actualState || state.state;
    if (actual === "empty") return null;
    if (actual !== "ready") throw new LifecycleError("El servidor no está listo para cambiar de modelo", state, 409);
    const previous = configurationFromMarker(state.marker);
    const perfil = MODELO.catalogo?.[previous?.model]?.servidor;
    if (!previous || previous.model !== modeloActualClave() || !["gpu-completa", "moe-hibrido", "gpu-parcial"].includes(perfil?.tipo) || previous.config.contexto > perfil.contexto) {
      return { error: "no se guardó una configuración anterior recuperable" };
    }
    return { clave: previous.model, ...previous.config };
  }
  async function conectarModelo(clave) {
    await chat.connect();
    if (modeloActualClave() !== clave) throw new Error("El servidor respondió con otro modelo");
    chat.vision = Boolean(chat.props?.modalities?.vision);
    settings.aplicarAjustesAlChat(settings.leerAjustes());
  }

  try { history.archiveActive(); } catch { /* sigue con la sesión en curso */ }

  // Los ajustes guardados en la interfaz (perfil de muestreo, tope de historial,
  // pensar) mandan sobre los valores por defecto de la línea de comandos.
  let inicial = settings.leerAjustes();
  if (args.enginePreset) {
    if (args.enginePreset === "CUSTOM") {
      inicial = settings.guardarAjustes({ enginePreset: "CUSTOM", ...(args.thinkProvided ? { pensar: args.think } : {}) });
    } else if (isNamedEnginePreset(args.enginePreset)) {
      const p = engineProfile(args.enginePreset);
      // Si el modelo aún no está cargado (nCtx vacío), no se puede comparar: se guarda
      // el preset como predeterminado y el usuario lo inicia con el botón Iniciar.
      if (modeloListo && (chat.nCtx !== p.context || chat.vision !== Boolean(p.vision))) {
        throw new Error("El motor en ejecución no coincide con el perfil solicitado; vuelve a iniciarlo desde el lanzador.");
      }
      inicial = settings.guardarAjustes({ enginePreset: args.enginePreset, coderContextTokens: p.context, historial: 0, ...(args.thinkProvided ? { pensar: args.think } : {}) });
    }
  } else if (args.thinkProvided) inicial = settings.guardarAjustes({ pensar: args.think });
  settings.aplicarAjustesAlChat(inicial);

  const stats = createStatsService({
    chat,
    getRoot: () => workspace.getRoot(),
    startedAt,
    estimateTokens,
    legacyMetrics: metricasLegacyToolParser,
  });

  const observability = crearObservabilidad({
    version: VERSION,
    startedAt,
    getModel: () => modeloActualClave() || chat.model,
    getWorkspace: () => workspace.getRoot(),
  });

  let server = null;
  /**
   * Contexto explícito del servidor. Las rutas reciben este objeto y no leen
   * variables de este archivo. Los getters/setters mantienen el estado mutable
   * (carpeta, turno, permisos) sin duplicarlo.
   */
  const routeContext = {
    args, chat, historial, memoriaGlobal, lifecycle, undoStore,
    HERE, PROJECT, STATE, SALIDA, PAGE, ADJUNTOS_DIR, REGISTROS_DIR,
    shellEnv: commandService.shellEnv,
    fileInside,
    readLimited: (abs, limite) => leerTextoAcotado(abs, limite),
    uiThemeIds: UI_THEME_IDS,
    permits: permissions.permits,
    procesosFondoVivos: background.vivos,
    procesosFondoTerminados: background.terminados,
    get workspaceRoot() { return workspace.getRoot(); },
    get busy() { return busy; },
    set busy(value) { busy = value; },
    get permitMode() { return permissions.mode; },
    get undoDelTurno() { return undoDelTurno; },
    set undoDelTurno(value) { undoDelTurno = value; },
    get configuracionApagada() { return configuracionApagada; },
    set configuracionApagada(value) { configuracionApagada = value; },
    get errorHistorial() { return history.getErrorHistorial(); },
    get turno() { return turno; },
    set turno(value) { turno = value; },
    get saltosTope() { return runtime.saltosTope; },
    get comandoTimeoutMs() { return runtime.comandoTimeoutMs; },
    invalidateIndice: () => symbolIndex.invalidate(),
    setPermitMode: permissions.setMode,
    waitPermit: permissions.wait,
    leerAjustes: settings.leerAjustes,
    guardarAjustes: settings.guardarAjustes,
    aplicarAjustesAlChat: settings.aplicarAjustesAlChat,
    modeloActualClave,
    configuracionAnterior, conectarModelo,
    comandoServidorOptimizado: launcherService.comandoServidorOptimizado,
    infoPensar: settings.infoPensar,
    leerReglas: rulesService.leerReglas,
    reglasParaModelo: rulesService.reglasParaModelo,
    workspacePayload: workspace.payload,
    setWorkspace: (value) => {
      const anterior = workspace.getRoot();
      const root = workspace.setRoot(value);
      cerrarSnapshotCache(anterior);
      stats.invalidate();
      symbolIndex.invalidate();
      return root;
    },
    pickFolder: folderPicker.pick,
    buscarEnProyecto: workspace.search,
    gitRun: gitService.gitRun,
    git: gitService.git,
    buildStats: stats.build,
    health: observability.health,
    openapi: () => construirOpenApi(VERSION),
    sesionesTerminal,
    indiceProyecto: symbolIndex.get,
    crearRegistroSalida: outputLog.create,
    runCommand: (command, signal, onOutput) => commandService.runCommand(command, signal, onOutput).finally(() => stats.invalidate()),
    pdfReady, repoIndex, relCanonica, filesNamedIn, attachFiles, attachSnippets, attachImagenes, textoPlan,
    startChat: history.startChat,
    loadChat: history.loadChat,
    removeChat: history.removeChat,
    shutdownIde(res) {
      let scheduled = false;
      const shutdown = () => {
        if (scheduled) return;
        scheduled = true;
        void closeHttpServer(server, { timeoutMs: 3000, exit: (code) => process.exit(code) }).catch((err) => process.stderr.write(`[lifecycle] ${err.message}\n`));
      };
      res.once("finish", shutdown);
      res.once("close", shutdown);
      if (res.destroyed) setImmediate(shutdown);
    },
  };
  routeContext.agentLoop = createAgentLoop(routeContext);
  const routes = createRoutes(routeContext);

  server = http.createServer(async (req, res) => {
    const requestId = observability.begin(req, res);
    try {
      // Guardia anti-CSRF / anti-DNS-rebinding: cualquier web abierta en el navegador
      // puede mandar POST a 127.0.0.1 (mode:"no-cors"). Ver chat/guardia.mjs.
      const guardia = revisarPeticion(req, args);
      if (!guardia.ok) {
        res.writeHead(guardia.status || 403, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        res.end(`rechazado: ${guardia.motivo}`);
        return;
      }
      aplicarCabecerasSeguridad(res);
      const url = new URL(req.url || "/", `http://${args.host}`);
      // El primer acceso LAN llega como `/?token=...`: se deja una cookie de
      // sesión y se redirige a `/` para que el token no quede en la barra.
      if (args.token && url.pathname === "/" && url.searchParams.get("token") === args.token) {
        res.writeHead(302, {
          Location: "/",
          "Set-Cookie": `bonsai_token=${encodeURIComponent(args.token)}; HttpOnly; SameSite=Strict; Path=/`,
          "Cache-Control": "no-store",
        }).end();
        return;
      }
      if (await routes(req, res, url)) return;
      res.writeHead(404).end("no está");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const codigo = err && typeof err === "object" ? /** @type {{code?: string}} */ (err).code : "";
      const status = err && typeof err === "object" ? Number(/** @type {{status?: number}} */ (err).status) || 0 : 0;
      const demasiadoGrande = codigo === "PAYLOAD_TOO_LARGE";
      const jsonInvalido = err instanceof SyntaxError;
      const contratoInvalido = status >= 400 && status < 500;
      observability.log(contratoInvalido ? "warn" : "error", "request_failed", {
        id: requestId,
        method: req.method || "",
        path: (() => { try { return new URL(req.url || "/", "http://local").pathname; } catch { return "/"; } })(),
        message,
      });
      if (!res.headersSent) {
        if (demasiadoGrande) res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", Connection: "close" });
        else if (jsonInvalido || contratoInvalido) res.writeHead(contratoInvalido ? status : 400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        else res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      if (!res.writableEnded) {
        const salida = demasiadoGrande ? "mensaje demasiado largo para este endpoint" : jsonInvalido ? "el cuerpo de la petición no es JSON válido" : message;
        // Con un cuerpo gigante que el cliente sigue enviando, la respuesta se manda y
        // después se cierra: así llega el 413 limpio en vez de un reset de conexión.
        res.end(salida, demasiadoGrande ? () => { try { req.destroy(); } catch { /* ya cerrada */ } } : undefined);
      }
    }
  });

  await new Promise((resolve) => {
    server.listen(args.port, args.host, () => resolve(undefined));
  });
  const hostVisible = args.host === "0.0.0.0" || args.host === "::" ? "127.0.0.1" : args.host;
  const pageUrl = `http://${hostVisible}:${args.port}`;
  const pythonHome = commandService.pythonHome;
  const thinkNote = chat.thinkBudget ? `razonamiento ${chat.thinkBudget} tok` : "sin razonamiento";
  process.stdout.write(`Bonsai en ${pageUrl}\nmodelo ${modeloActualClave() || chat.model} · ventana ${chat.nCtx} · historial ${chat.historyCap()} · muestreo ${chat.perfil} · ${thinkNote}${chat.vision ? " · visión" : ""} · carpeta ${workspace.getRoot()}\npython ${pythonHome || "(no encontrado)"}\n`);
  if (args.open) {
    // El navegador necesita el token una vez para obtener la cookie; la consola
    // no lo imprime para no dejarlo en logs.
    const openUrl = args.token ? `${pageUrl}/?token=${encodeURIComponent(args.token)}` : pageUrl;
    openBrowser(openUrl);
  }
}

main(parseArgs(process.argv.slice(2))).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
