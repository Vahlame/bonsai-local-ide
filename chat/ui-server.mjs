/**
 * Interfaz local. El modelo sigue con el historial corto y, si responde
 * con un archivo, se guarda en salida/ y se puede abrir desde la página.
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import crypto from "node:crypto";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveInside } from "./actions.mjs";
import { metricasLegacyToolParser } from "./legacy-tool-parser.mjs";

import { BonsaiChat, metadatosSesion } from "./bonsai-chat.mjs";
import { MODELO, pensarDe, presupuestoPensar } from "./modelo.mjs";
import { RULES_CAP_TOKENS, estimateTokens, takeHeadByTokens } from "./context.mjs";
import { parseArgs, fileInside } from "./server/http.mjs";
import { catalogoModelos, mmprojDisponible } from "./server/catalog.mjs";

import { openBrowser } from "./server/browser.mjs";
import { UndoStore } from "./server/undo.mjs";
import { SKIP_DIR, SKIP_EXT, createWorkspaceTools, fileDelta, listWorkspace, snapshotFiles } from "./server/workspace.mjs";
import { chatTitle } from "./server/text.mjs";
import { createRoutes } from "./server/routes/index.mjs";
import { createAgentLoop } from "./server/agent-loop.mjs";

import { revisarPeticion } from "./guardia.mjs";
import { ejecutarComando, recortarCentro } from "./procesos.mjs";

import { buscarWeb } from "./investigacion.mjs";

import { createManagedServer, configurationFromMarker, closeHttpServer, LifecycleError } from "./lifecycle/managed-server.mjs";
import { createProcessAdapter } from "./lifecycle/process-adapter.mjs";
import { selectBinary } from "./lifecycle/binary-registry.mjs";

import { rutaProyecto, escribirAtomico } from "./archivos-seguros.mjs";
import { LIMITE_TEXTO, leerTextoAcotado } from "./lecturas.mjs";
import { crearHistorial } from "./historial.mjs";
import { crearMemoriaGlobal } from "./memoria-global.mjs";
import { Terminales } from "./terminal.mjs";
import { indiceSimbolos } from "./diagnosticos.mjs";
import { CODER_CONFIG, coderOptions } from "./coder-harness.mjs";

import { engineProfile, isNamedEnginePreset } from "./engine-profiles.mjs";
import { escanearModelos } from "./model-hub.mjs";

const UI_THEME_IDS = new Set(JSON.parse(fs.readFileSync(new URL("./ui/themes.json", import.meta.url), "utf8")).map(t => t.id));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
// BONSAI_STATE aparta chats, sesión, permisos y carpeta de trabajo (pruebas sin tocar los tuyos)
const STATE = process.env.BONSAI_STATE ? path.resolve(process.env.BONSAI_STATE) : HERE;
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
function crearRegistroSalida() {
  fs.mkdirSync(REGISTROS_DIR, { recursive: true });
  const id = crypto.randomBytes(16).toString("hex"), archivo = path.join(REGISTROS_DIR, `${id}.log`);
  fs.writeFileSync(archivo, "", { flag: "wx" });
  let bytes = 0, incompleto = false;
  return { id, guardar(texto) {
    if (incompleto) return;
    try {
      const fragmento = Buffer.from(String(texto), "utf8");
      if (bytes + fragmento.length > 64 * 1024 * 1024) {
        fs.appendFileSync(archivo, "\n[Registro incompleto: límite de 64 MiB alcanzado.]\n");
        incompleto = true; return;
      }
      fs.appendFileSync(archivo, fragmento); bytes += fragmento.length;
    } catch (err) { incompleto = true; process.stderr.write(`[salida-agente] No se pudo guardar ${id}: ${err.message}\n`); }
  } };
}
/** @type {string} */
let workspaceRoot = PROJECT;
const undoStore = new UndoStore({
  dir: UNDO_DIR,
  getWorkspaceRoot: () => workspaceRoot,
  fileInside,
  escribirAtomico,
  limiteTexto: LIMITE_TEXTO,
});
const workspaceTools = createWorkspaceTools({
  getRoot: () => workspaceRoot,
  adjuntosDir: ADJUNTOS_DIR,
  fileInside,
  rutaProyecto,
  resolveInside,
  readLimited: (abs, limite) => leerTextoAcotado(abs, limite),
  takeHeadByTokens,
  estimateTokens,
});
const { repoIndex, attachFiles, attachSnippets, attachImagenes, filesNamedIn, relCanonica, pdfReady } = workspaceTools;

// --- Ajustes de alcance que se pueden cambiar desde Ajustes (ver aplicarAjustesAlChat) ---
/** Tope duro de pasos del agente en un turno (el bucle puede encadenar tandas hasta este número). */
let saltosTope = 192;
/** Tiempo máximo de un comando del agente, en ms (antes eran 60 s fijos y cortaba builds/instalaciones). */
let comandoTimeoutMs = 180000;
/** Sesiones del terminal integrado (se recrean si cambia la carpeta de trabajo). */
let terminales = null;
/** Índice de símbolos cacheado del proyecto (para «ir a definición»). */
let indiceCache = null;
/** Momento en que se construyó el índice (se descarta a los 60 s por si un comando tocó archivos). */
let indiceCacheTs = 0;

/** @returns {Terminales} */
function sesionesTerminal() {
  if (!terminales || terminales.root !== workspaceRoot) {
    try { terminales?.cerrarTodo(); } catch { /* sin sesiones */ }
    terminales = new Terminales({ root: workspaceRoot, env: shellEnv, pty: process.env.BONSAI_PTY !== "0" });
  }
  return terminales;
}

// Al apagar el servidor se cierran las shells abiertas (taskkill /T es síncrono).
for (const evento of ["exit", "SIGINT", "SIGTERM"]) {
  process.once(evento, () => {
    try { terminales?.cerrarTodo(); } catch { /* ya cerrado */ }
    for (const p of procesosFondoVivos.values()) { try { p.parar(); } catch { /* ya terminó */ } }
    procesosFondoVivos.clear();
    if (evento !== "exit") process.exit(0);
  });
}

/**
 * Índice nombre → definiciones del proyecto, con caché corta. Se invalida al escribir.
 * @returns {Map<string, Array<{archivo: string, linea: number, columna: number, tipo: string}>>}
 */
function indiceProyecto() {
  if (indiceCache && Date.now() - indiceCacheTs < 60000) return indiceCache;
  const archivos = [...snapshotFiles(workspaceRoot).keys()];
  indiceCache = indiceSimbolos(workspaceRoot, archivos);
  indiceCacheTs = Date.now();
  return indiceCache;
}
/** Procesos en segundo plano del agente que SOBREVIVEN al turno hasta que se paren. */
const procesosFondoVivos = new Map();
/** Salida final de los últimos 50 procesos; permite comprobar builds asíncronos. */
const procesosFondoTerminados = new Map();

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
 * @param {string} command
 * @returns {Promise<{code: number, output: string}>}
 */
function findPythonHome() {
  const root = path.join(process.env.APPDATA || "", "uv", "python");
  if (!fs.existsSync(root)) return "";
  /** @param {string} dir */
  const version = (dir) => path.basename(dir).split(".").map((n) => Number.parseInt(n, 10) || 0);
  const homes = fs.readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((dir) => fs.existsSync(path.join(dir, "python.exe")))
    // Orden NUMÉRICO descendente: comparadas como texto, "3.9.13" va después de
    // "3.10.0" y el reverse dejaba el Python más viejo el primero del PATH (es el que
    // se le anuncia al modelo y con el que se lanzan sus scripts).
    .sort((a, b) => {
      const x = version(a);
      const y = version(b);
      for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
        const d = (y[i] || 0) - (x[i] || 0);
        if (d) return d;
      }
      return 0;
    });
  return homes.find((dir) => fs.existsSync(path.join(dir, "Lib", "site-packages", "pip"))) || homes[0] || "";
}

function commandEnv() {
  const home = findPythonHome();
  const shim = path.join(HERE, ".shims");
  fs.mkdirSync(shim, { recursive: true });
  fs.writeFileSync(path.join(shim, "pip.cmd"), "@echo off\r\npython -m pip %*\r\n");
  fs.writeFileSync(path.join(shim, "pip3.cmd"), "@echo off\r\npython -m pip %*\r\n");
  fs.writeFileSync(path.join(shim, "python3.cmd"), "@echo off\r\npython %*\r\n");
  const localBin = path.join(os.homedir(), ".local", "bin");
  const extra = [home, shim, localBin].filter((dir) => dir && fs.existsSync(dir));
  const env = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
  const key = Object.keys(env).find((name) => name.toUpperCase() === "PATH") || "PATH";
  env[key] = [...extra, env[key] || ""].join(path.delimiter);
  return env;
}

const shellEnv = commandEnv();

/**
 * Ejecuta un comando del agente en la carpeta de trabajo y devuelve su salida junto a
 * lo que cambió en los archivos.
 *
 * El vigilante del proceso (tiempo agotado, cancelación del turno y matado del ÁRBOL
 * de procesos, no solo de la shell) vive en chat/procesos.mjs: allí sí se puede probar
 * sin arrancar este servidor (`node chat\prueba-procesos.mjs`).
 * @param {string} command
 * @param {AbortSignal} [signal] se cancela cuando el usuario cierra la pestaña o el turno
 * @returns {Promise<{code: number, output: string}>}
 */
function runCommand(command, signal, onOutput) {
  const text = command.trim();
  if (!text || text.length > 32768) return Promise.resolve({ code: 1, output: "Comando vacío o demasiado largo (máximo 32768 caracteres)." });
  const before = snapshotFiles(workspaceRoot);
  return ejecutarComando(text, { cwd: workspaceRoot, env: shellEnv, signal, timeoutMs: comandoTimeoutMs, onOutput }).then((result) => {
    const files = fileDelta(before, snapshotFiles(workspaceRoot));
    const body = result.output.trim();
    // Recorte por el MEDIO: el final (traceback, FAILED) es lo que el modelo necesita.
    return { code: result.code, output: recortarCentro(`${files}\n${body || "(sin salida en stdout ni stderr)"}`, 8000) };
  });
}

/**
 * @param {string} query
 * @returns {Promise<string>}
 */
async function webSearch(query, signal, blockedPorts) {
  return buscarWeb(query, { signal, blockedPorts });
}

/**
 * @param {InstanceType<typeof BonsaiChat>} chat
 */
function buildStats(chat) {
  const saved = chat.session.files || [];
  let bytes = 0;
  for (const file of saved) bytes += Number(file.bytes) || 0;
  const usage = chat.usage;
  /** @type {Record<string, number | string | { count: number, bytes: number }>} */
  const stats = {
    nCtx: chat.nCtx,
    historyCap: chat.historyCap(),
    prompt: usage ? usage.prompt : chat.livePrompt,
    generated: usage ? usage.generated : chat.liveGenerated,
    memory: estimateTokens(chat.session.memory || ""),
    turns: chat.session.turns.length,
    folded: chat.session.folded,
    saved: { count: saved.length, bytes },
    workspace: listWorkspace(workspaceRoot, "", [], 0).length,
    seconds: Math.max(0, Math.floor((Date.now() - startedAt) / 1000)),
    legacyToolParser: metricasLegacyToolParser(),
  };
  if (typeof chat.model === "string" && chat.model) stats.model = chat.model;
  stats.vision = Boolean(chat.vision);
  return stats;
}

function loadWorkspace() {
  try {
    const raw = JSON.parse(fs.readFileSync(WORKSPACE_FILE, "utf8"));
    if (!raw || typeof raw.path !== "string") return;
    const abs = path.resolve(raw.path);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) workspaceRoot = abs;
  } catch {
    workspaceRoot = PROJECT;
  }
}

/**
 * @param {string} raw
 */
function setWorkspace(raw) {
  const abs = path.resolve(String(raw));
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new Error("Esa carpeta no existe.");
  }
  if (!stat.isDirectory()) throw new Error("Eso no es una carpeta.");
  workspaceRoot = abs;
  const tmp = `${WORKSPACE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ path: abs }), "utf8");
  fs.renameSync(tmp, WORKSPACE_FILE);
}

/**
 * @returns {{root: string, name: string, files: Array<{rel: string, bytes: number}>}}
 */
function workspacePayload() {
  return {
    root: workspaceRoot,
    name: path.basename(workspaceRoot) || workspaceRoot,
    files: listWorkspace(workspaceRoot, "", [], 0),
  };
}

/**
 * @param {string} startDir
 * @returns {Promise<string>}
 */
function pickFolder(startDir) {
  const outFile = path.join(os.tmpdir(), `bonsai-pick-${process.pid}.txt`);
  try { fs.rmSync(outFile, { force: true }); } catch { /* no estaba */ }
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Windows.Forms",
    "[System.Windows.Forms.Application]::EnableVisualStyles() | Out-Null",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = 'Carpeta de trabajo de Bonsai'",
    "$dialog.ShowNewFolderButton = $true",
    "$start = $env:BONSAI_WORKSPACE",
    "if ($start -and (Test-Path -LiteralPath $start -PathType Container)) { $dialog.SelectedPath = $start }",
    "$owner = New-Object System.Windows.Forms.Form",
    "$owner.TopMost = $true",
    "$owner.ShowInTaskbar = $false",
    "$owner.WindowState = 'Minimized'",
    "$owner.Show()",
    "$owner.Activate()",
    "$result = $dialog.ShowDialog($owner)",
    "$owner.Close()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  $utf8 = New-Object System.Text.UTF8Encoding $false",
    "  [System.IO.File]::WriteAllText($env:BONSAI_PICK_OUT, $dialog.SelectedPath, $utf8)",
    "}",
  ].join("\n");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-STA", "-WindowStyle", "Hidden", "-EncodedCommand", encoded],
      {
        windowsHide: false,
        env: { ...process.env, BONSAI_WORKSPACE: startDir, BONSAI_PICK_OUT: outFile },
      },
    );
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("El selector de carpeta no respondió."));
    }, 120000);
    child.stderr?.on("data", (buf) => {
      err += buf.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let chosen = "";
      try {
        if (fs.existsSync(outFile)) chosen = fs.readFileSync(outFile, "utf8").trim();
      } catch {
        chosen = "";
      }
      try { fs.rmSync(outFile, { force: true }); } catch { /* ya no está */ }
      if (chosen) {
        resolve(chosen);
        return;
      }
      if (code && code !== 0) {
        reject(new Error(err.trim() || "No se pudo abrir el selector de carpeta."));
        return;
      }
      resolve("");
    });
  });
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
  loadWorkspace();
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
  /** Último fallo del archivado del historial (se muestra en /api/state; "" si ninguno). */
  let errorHistorial = "";
  /** Puntos de deshacer de las escrituras del AGENTE en el turno en curso (para "revertir el turno"). */
  /** @type {string[]} */
  let undoDelTurno = [];
  /** Número de turno del chat: los ids de acción llevan este prefijo para no chocar entre turnos. */
  let turno = 0;
  /** @type {"ask" | "all"} */
  let permitMode = "ask";
  try {
    const saved = JSON.parse(fs.readFileSync(PERMIT_FILE, "utf8"));
    if (saved && (saved.mode === "ask" || saved.mode === "all")) permitMode = saved.mode;
  } catch { /* preguntar es el perfil inicial */ }
  /** @type {Map<string, (allow: boolean) => void>} */
  const permits = new Map();

  /**
   * @param {"ask" | "all"} mode
   */
  function setPermitMode(mode) {
    permitMode = mode;
    fs.writeFileSync(PERMIT_FILE, JSON.stringify({ mode }));
  }

  /**
   * @param {string} id
   * @param {AbortSignal} signal
   * @returns {Promise<boolean>}
   */
  function waitPermit(id, signal) {
    return new Promise((resolve) => {
      // Si el turno ya se canceló (el usuario cerró la pestaña) el evento `abort` NO
      // vuelve a dispararse: sin esta comprobación el servidor se quedaba con
      // `busy = true` los 180 s del temporizador y todo contestaba 409.
      if (signal.aborted) {
        resolve(false);
        return;
      }
      const finish = (allow) => {
        clearTimeout(timer);
        permits.delete(id);
        resolve(allow);
      };
      const timer = setTimeout(() => finish(false), 180000);
      permits.set(id, finish);
      signal.addEventListener("abort", () => finish(false), { once: true });
    });
  }

  /**
   * Clave del catálogo que está cargada ahora mismo (por el `model_path` de /props).
   * @returns {string}
   */
  function modeloActualClave() {
    const cargado = path.basename(String(chat.props?.model_path || chat.model || ""));
    const fila = catalogoModelos().find((m) => m.archivo === cargado);
    return fila ? fila.clave : "";
  }

  /**
   * Comando PowerShell listo para pegar que arranca el servidor optimizado con el
   * preset dado, usando rutas absolutas (la interfaz corre en el navegador y no
   * conoce el disco). Refleja exactamente la logica de flags de
   * start-gpu-model-rtx4060-optimized.ps1 (f16 estable, vision, plantilla, etc.).
   * @param {string} preset
   * @param {number} puerto
   * @param {string} [clave]
   * @returns {string}
   */
  function comandoServidorOptimizado(preset, puerto, clave = "ornith9b") {
    const modeloItem = MODELO.catalogo?.[clave];
    if (!modeloItem) throw new LifecycleError(`Modelo desconocido: ${clave}`, { state: "error", port: puerto }, 400);
    const planGuardado = modeloItem.plan;
    const nombre = isNamedEnginePreset(preset) ? preset : (preset === "AUTO" || preset === "CUSTOM") && planGuardado ? "" : "8GB-VISION-MAX-Q8-100K";
    const p = nombre
      ? engineProfile(nombre)
      : {
          context: Number(planGuardado?.contexto) || 16384,
          kv: String(planGuardado?.kv || "q8_0"),
          vision: planGuardado?.vision !== false,
          mmprojCPU: planGuardado?.mmprojCPU === true,
          batch: Number(modeloItem.servidor?.batch) || 512,
          ubatch: Number(modeloItem.servidor?.ubatch) || 256,
        };
    const ctx = Number(p.context) || 16384;
    const kv = String(p.kv || "f16");
    const vision = Boolean(p.vision);
    const estable = true;

    const modelPath = path.join(PROJECT, "models", modeloItem.archivo || "Ornith-1.5-9B-Q4_K_M.gguf");
    const projArchivo = modeloItem.vision && modeloItem.vision.archivo;
    const projPath = projArchivo ? path.join(PROJECT, "models", projArchivo) : "";
    const templatePath = path.join(PROJECT, "logs", `chat_template_${puerto}.jinja`);

    const { exe: bin } = selectBinary(PROJECT);

    const a = ["-m", modelPath, "--gpu-layers", "99"];
    if (!estable) a.push("--fit", "off", "--kv-offload");
    a.push("--flash-attn", "on", "-c", String(ctx), "-ctk", kv, "-ctv", kv);
    if (!estable) a.push("-np", "1");
    a.push("-b", String(Number(p.batch) || 512), "-ub", String(Number(p.ubatch) || 256), "-t", "4", "--host", "127.0.0.1", "--port", String(puerto), "--jinja", "--metrics");
    if (!estable) a.push("--cache-ram", "0");
    a.push("-lv", "4",
      "--cors-origins", `http://127.0.0.1:${puerto},http://localhost:${puerto},http://127.0.0.1:8787,http://localhost:8787,http://127.0.0.1:8788,http://localhost:8788`,
      "--temp", "0.6", "--top-p", "0.90", "--top-k", "20", "--min-p", "0.05",
      "--presence-penalty", "0", "--repeat-penalty", "1", "--spec-type", "none", "--no-context-shift");
    if (estable) a.push("--ctx-checkpoints", "0");
    // La plantilla se genera desde modelo.json para que exista al pegar el comando.
    try {
      if (modeloItem.chat_template) {
        fs.mkdirSync(path.dirname(templatePath), { recursive: true });
        fs.writeFileSync(templatePath, modeloItem.chat_template, "utf8");
      }
    } catch { /* se intentara igualmente */ }
    a.push("--chat-template-file", templatePath);
    if (modeloItem.clave === "gpt-oss-20b" || (Array.isArray(modeloItem.capacidades) && modeloItem.capacidades.includes("Harmony"))) {
      a.push("--skip-chat-parsing");
    }
    if (vision && projPath) {
      a.push("--mmproj", projPath);
      if (p.mmprojCPU) a.push("--no-mmproj-offload");
      else a.push("--mmproj-offload", "--mmproj-device", "CUDA0");
      a.push("--image-max-tokens", "512");
    }
    if (p.spec === "draft" && p.draftModel) {
      const draftPath = path.join(PROJECT, "models", String(p.draftModel));
      try {
        if (fs.existsSync(draftPath)) {
          a.push("--spec-type", "draft-simple", "--spec-draft-model", draftPath, "--spec-draft-n-max", String(p.draftTokens || 4));
        }
      } catch { /* sin draft */ }
    } else if (modeloItem.servidor?.draftModel) {
      const draftPath = path.join(PROJECT, "models", String(modeloItem.servidor.draftModel));
      try {
        if (fs.existsSync(draftPath)) {
          a.push("--spec-type", "draft-simple", "--spec-draft-model", draftPath, "--spec-draft-n-max", String(modeloItem.servidor.draftTokens || 4));
        }
      } catch { /* sin draft */ }
    }
    a.push("--reasoning-budget", "4096", "--reasoning-format", "deepseek");

    const quote = (s) => (/[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
    const linea = [bin, ...a].map(quote).join(" ");
    return `cd "${PROJECT}"; & ${linea}`;
  }

  const lifecycle = createManagedServer({
    port: args.llamaPort,
    adapter: createProcessAdapter({ root: PROJECT, catalog: MODELO, getSettings: leerAjustes, isNamedEnginePreset,
      engineProfile, mmprojDisponible, presupuestoPensar, onThinking: (n) => { pensarServidor = n; } }),
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
    aplicarAjustesAlChat(leerAjustes());
  }

  function archiveActive() {
    const index = historial.readIndex();
    const id = index.active || historial.newChatId();
    if (!index.active) {
      index.active = id;
      index.items.unshift({ id, title: chatTitle(chat.session), updated: Date.now() });
    }
    // Reemplazo atómico TAMBIÉN para el historial: antes un corte dejaba el JSON a medias
    // y el catch del llamador se lo tragaba sin avisar al usuario.
    historial.archive(id, chat.session);
    const item = index.items.find((row) => row.id === id);
    const title = chatTitle(chat.session);
    if (item) {
      item.title = title;
      item.updated = Date.now();
    } else index.items.unshift({ id, title, updated: Date.now() });
    historial.writeIndex(index);
  }

  const persistSession = chat.saveSession.bind(chat);
  chat.saveSession = () => {
    // La copia de trabajo es el dato crítico: si falla, el error sube (no se puede seguir
    // fingiendo que se guardó). El archivado sí es recuperable: se reintenta en el
    // siguiente guardado y el fallo queda visible en /api/state.
    persistSession();
    try {
      archiveActive();
      errorHistorial = "";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errorHistorial = `no se pudo archivar el historial: ${message}. Tus mensajes siguen en la copia de trabajo y se reintentará al siguiente guardado.`;
      process.stderr.write(`[historial] ${errorHistorial}\n`);
    }
  };

  function blankSession() {
    chat.session = { memory: "", folded: 0, turns: [], draft: "", files: [] };
    chat.tighten = 0;
    chat.saveSession();
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
      index.items.unshift({ id, title: chatTitle(raw), updated: Date.now() });
    }
    historial.writeIndex(index);
    chat.session = {
      memory: typeof raw.memory === "string" ? raw.memory : "",
      folded: Number.isInteger(raw.folded) ? raw.folded : 0,
      turns: Array.isArray(raw.turns) ? raw.turns : [],
      draft: "",
      files: Array.isArray(raw.files) ? raw.files : [],
      ...metadatosSesion(raw),
    };
    chat.tighten = 0;
    chat.saveSession();
  }

  function startChat() {
    const empty = !(chat.session.turns || []).some((turn) => turn.role === "user");
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

  try { archiveActive(); } catch { /* sigue con la sesión en curso */ }

  /* ------------------------------------------------------------------------
     Ayudantes de las funciones nuevas: guardar, buscar, git, reglas, ajustes.
     ------------------------------------------------------------------------ */

  // Carpetas que nunca se tocan al guardar (ni se recorren al buscar).
  /**
   * Busca un texto en el proyecto. Devuelve coincidencias con su línea.
   * Acota el trabajo (máximo de archivos y de tamaño) para no congelar la interfaz.
   * @param {string} consulta
   * @param {number} limite
   * @returns {{rel: string, linea: number, texto: string}[]}
   */
  function buscarEnProyecto(consulta, limite) {
    const aguja = consulta.toLowerCase();
    /** @type {{rel: string, linea: number, texto: string}[]} */
    const out = [];
    /** @type {string[]} */
    const pendientes = [""];
    let archivos = 0;
    while (pendientes.length && out.length < limite && archivos < 3000) {
      const rel = /** @type {string} */ (pendientes.shift());
      const absDir = rel ? path.join(workspaceRoot, rel) : workspaceRoot;
      let entradas;
      try {
        entradas = fs.readdirSync(absDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entradas) {
        if (out.length >= limite || archivos >= 3000) break;
        if (e.name.startsWith(".") && e.name !== ".cursor") continue;
        const hijoRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (SKIP_DIR.has(e.name) || e.name === ".git") continue;
          pendientes.push(hijoRel);
          continue;
        }
        if (!e.isFile()) continue;
        if (SKIP_EXT.has(path.extname(e.name).toLowerCase())) continue;
        let buf;
        try {
          // stat antes de leer: un archivo de 500 MB no debe cargarse para luego
          // descubrir que supera el límite de 800 KB.
          const st = fs.statSync(path.join(workspaceRoot, hijoRel));
          if (st.size > 800_000) continue;
          buf = fs.readFileSync(path.join(workspaceRoot, hijoRel));
        } catch {
          continue;
        }
        if (buf.length > 800_000 || buf.includes(0)) continue;
        archivos += 1;
        const lineas = buf.toString("utf8").split("\n");
        for (let i = 0; i < lineas.length; i += 1) {
          if (lineas[i].toLowerCase().includes(aguja)) {
            out.push({ rel: hijoRel, linea: i + 1, texto: lineas[i].trim().slice(0, 220) });
            if (out.length >= limite) break;
          }
        }
      }
    }
    return out;
  }

  /**
   * Ejecuta git en la carpeta de trabajo SIN tragarse el error.
   * Antes esto devolvía "" cuando git fallaba, así que "esto no es un repo", "git no
   * está instalado" y "el commit no se pudo hacer" eran indistinguibles: la interfaz
   * solo podía decir que no se pudo, y el motivo real se perdía.
   * @param {string[]} args
   * @returns {Promise<{ok: boolean, salida: string, error: string}>}
   */
  function gitRun(args, cwd = workspaceRoot) {
    return new Promise((resolve) => {
      execFile("git", args, { cwd, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, salida: String(stdout || ""), error: String(stderr || "").trim() || err.message });
          return;
        }
        resolve({ ok: true, salida: String(stdout || ""), error: "" });
      });
    });
  }

  /**
   * Solo la salida ("" si falló), que es lo que esperan las lecturas del panel de git.
   * El motivo queda en el log del servidor; para decisiones, usa gitRun.
   * @param {string[]} args
   * @returns {Promise<string>}
   */
  function git(args) {
    return gitRun(args).then((r) => {
      // "not a repository" es el caso NORMAL cuando la carpeta de trabajo no es un repo git (el
      // panel ya responde repo:false): avisar de eso llenaba la consola cada 15 s. Solo se avisa
      // de fallos de verdad (git sin instalar, permisos…).
      if (!r.ok && !/not a git repository/i.test(r.error)) process.stderr.write(`[git] ${args.join(" ")} falló: ${r.error}\n`);
      return r.ok ? r.salida : "";
    });
  }

  /**
   * Reglas de proyecto compatibles con Cursor: BONSAI.md, AGENTS.md y
   * .cursor/rules/*.mdc|*.md (sin el frontmatter YAML).
   * @returns {{fuentes: string[], texto: string}}
   */
  function leerReglas() {
    /** @type {string[]} */
    const fuentes = [];
    /** @type {string[]} */
    const trozos = [];
    // Política de rutas compartida con el resto del servidor: `fileInside` rechaza
    // enlaces/junctions en cualquier componente, así que una regla enlazada a un archivo
    // de fuera del proyecto no se lee (antes se seguía el enlace y su contenido acababa
    // en el contexto del modelo). Además se limita el tamaño antes de leer.
    const leerRegla = (rel) => {
      const abs = fileInside(workspaceRoot, rel);
      if (!abs) return "";
      const leido = leerTextoAcotado(abs, 128 * 1024);
      return leido.ok ? leido.texto.slice(0, 8000) : "";
    };
    const sueltos = ["BONSAI.md", "AGENTS.md", ".cursorrules"];
    for (const nombre of sueltos) {
      const txt = leerRegla(nombre);
      if (txt.trim()) {
        trozos.push(`# ${nombre}\n${txt}`);
        fuentes.push(nombre);
      }
    }
    const dirRel = ".cursor/rules";
    const dirAbs = fileInside(workspaceRoot, dirRel);
    let esCarpeta = false;
    try { esCarpeta = Boolean(dirAbs) && fs.statSync(/** @type {string} */ (dirAbs)).isDirectory(); } catch { esCarpeta = false; }
    if (esCarpeta) {
      let entradas = [];
      try {
        entradas = fs.readdirSync(/** @type {string} */ (dirAbs), { withFileTypes: true });
      } catch {
        entradas = [];
      }
      for (const e of entradas) {
        if (!/\.(mdc|md)$/i.test(e.name)) continue;
        try {
          let txt = leerRegla(`${dirRel}/${e.name}`);
          if (!txt) continue;
          const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
          let siempre = true;
          if (m) {
            // `alwaysApply: false` sin `globs` => la regla no se aplica sola.
            siempre = !/alwaysApply:\s*false/i.test(m[1]);
            txt = txt.slice(m[0].length);
          }
          if (!siempre || !txt.trim()) continue;
          trozos.push(`# .cursor/rules/${e.name}\n${txt}`);
          fuentes.push(`.cursor/rules/${e.name}`);
        } catch {
          /* ilegible */
        }
      }
    }
    return { fuentes, texto: trozos.join("\n\n") };
  }

  /**
   * Reglas del proyecto listas para el mensaje de sistema, recortadas al tope.
   * Estables por carpeta: no rompen la caché del prompt entre turnos.
   * @returns {string}
   */
  function reglasParaModelo() {
    const { texto } = leerReglas();
    if (!texto.trim()) return "";
    return takeHeadByTokens(texto, RULES_CAP_TOKENS, estimateTokens);
  }

  const SETTINGS_FILE = path.join(STATE, "ui-settings.json");
  const UI_VERSION = "2.4.9";
  // El lanzador de escritorio elige el perfil de agente. `optimized` era el
  // nombre histórico del perfil de coding; hoy el único perfil con el harness
  // nuevo es `small-local-coder`. Los ajustes guardados siguen mandando.
  const PERFIL_INICIAL = ["legacy", "small-local-coder"].includes(args.agentProfile)
    ? args.agentProfile
    : (process.env.BONSAI_AGENT_PROFILE || "legacy");
  const AJUSTES_DEFECTO = { tema: "slate", perfil: "codigo", pensar: args.think, verPensamiento:true, reglas: true, historial: 0, continuarAuto: true, saltosTope: 192, comandoSegundos: 180, agentePerfil: PERFIL_INICIAL, memoriaGlobal: true, memoriaGlobalAuto: true, memoriaGlobalTokens: 480, engineEffort: "default", preguntarModelo: true, editorModerno: true, uiVersion: UI_VERSION };
  // Los ajustes guardados en la interfaz (perfil de muestreo, tope de historial, pensar)
  // mandan sobre los valores por defecto de la línea de comandos. Va AQUÍ y no al principio
  // de main(): `AJUSTES_DEFECTO` es un `const` y llamarlo antes revienta el arranque con
  // "Cannot access 'AJUSTES_DEFECTO' before initialization".
  let inicial=leerAjustes();
  if (args.enginePreset) {
    if (args.enginePreset === "CUSTOM") {
      inicial = guardarAjustes({ enginePreset: "CUSTOM", ...(args.thinkProvided ? { pensar: args.think } : {}) });
    } else if (isNamedEnginePreset(args.enginePreset)) {
      const p = engineProfile(args.enginePreset);
      // Si el modelo aún no está cargado (nCtx vacío), no se puede comparar: se guarda
      // el preset como predeterminado y el usuario lo inicia con el botón Iniciar.
      if (modeloListo && (chat.nCtx !== p.context || chat.vision !== Boolean(p.vision))) {
        throw new Error("El motor en ejecución no coincide con el perfil solicitado; vuelve a iniciarlo desde el lanzador.");
      }
      inicial = guardarAjustes({ enginePreset: args.enginePreset, coderContextTokens: p.context, historial: 0, ...(args.thinkProvided ? { pensar: args.think } : {}) });
    }
  } else if (args.thinkProvided) inicial = guardarAjustes({ pensar: args.think });
  aplicarAjustesAlChat(inicial);

  /** @returns {Record<string, unknown>} */
  function leerAjustes() {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const datos = { ...AJUSTES_DEFECTO, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
        // Migración de la capa visual 2.3: CodeMirror pasa a ser el único
        // editor y el tema por defecto es slate. Solo se ejecuta una vez por
        // instalación; después el usuario puede cambiar de tema.
        if (datos.uiVersion !== UI_VERSION) {
          datos.uiVersion = UI_VERSION;
          datos.tema = "slate";
          datos.editorModerno = true;
          // El viejo default (32768) partía la ventana 50/50. En 2.3.4 el
          // presupuesto vuelve a ser automático: ventana - salida - margen.
          if (Number(datos.historial) >= 32768) datos.historial = 0;
          try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(datos, null, 2), "utf8"); } catch { /* solo lectura */ }
        }
        return datos;
      }
    } catch {
      /* json roto: se usan los de defecto */
    }
    return { ...AJUSTES_DEFECTO };
  }

  /** @param {Record<string, unknown>} nuevos */
  function guardarAjustes(nuevos) {
    const actual = leerAjustes();
    const mezcla = { ...actual, ...nuevos };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(mezcla, null, 2), "utf8");
    return mezcla;
  }

  /**
   * Pasa los ajustes de la interfaz al chat. `perfil`, `historial` y `pensar` se aplican en
   * la siguiente petición (el muestreo y la ventana de razonamiento viajan en cada petición).
   * @param {Record<string, unknown>} ajustes
   */
  function aplicarAjustesAlChat(ajustes) {
    const agentProfile = ajustes.agentePerfil || process.env.BONSAI_AGENT_PROFILE;
    if (["legacy", "small-local-coder"].includes(agentProfile)) chat.agentProfile = agentProfile;
    const engine = (ajustes.enginePreset && isNamedEnginePreset(ajustes.enginePreset)) ? engineProfile(ajustes.enginePreset) : null;
    const ctxTokens = Number(ajustes.coderContextTokens) || engine?.context || chat.nCtx || 16384;
    // historial 0 (o vacío) = AUTOMÁTICO: se usa la ventana menos la reserva de salida
    // (pensamiento + respuesta). Es el reparto de los modelos frontera; el usuario solo
    // fija el techo si de verdad quiere dejar contexto sin usar.
    const histPedido = Number(ajustes.historial);
    const histAuto = !Number.isFinite(histPedido) || histPedido <= 0;
    const histTokens = histAuto ? ctxTokens : Math.min(histPedido, ctxTokens);
    const salidaTokens = histTokens >= ctxTokens ? Math.min(18000, Math.max(256, Math.floor(ctxTokens / 2) - 128)) : Math.max(256, ctxTokens - histTokens);
    // Presupuesto automático estilo modelos frontera: reserva una salida amplia
    // pero no la mitad de la ventana. 12k cubre una tool call de escritura y deja
    // ~80 % del contexto para historial, herramientas y resultados.
    const outTokens = histAuto
      ? Math.min(engine?.coderOutputTokens || 12288, salidaTokens)
      : salidaTokens;
    const pedidoPensar = Number(ajustes.pensar);
    const thinkingTokens = Number.isFinite(pedidoPensar) && pedidoPensar !== 0
      ? pedidoPensar
      : (engine?.thinkingTokens || 2048);
    chat.coderConfig = { ...CODER_CONFIG, contextTokens: ctxTokens, outputTokens: outTokens, toolResultTokens: Math.max(1000, Math.min(6000, Math.floor(ctxTokens / 10))), thinkingTokens, ...coderOptions(process.env.BONSAI_CODER_OPTIONS), ...(ajustes.coderContextTokens ? { contextTokens: ajustes.coderContextTokens } : {}) };
    const itemRazonamiento = catalogoModelos().find((m) => m.clave === modeloActualClave());
    chat.razonamientoEsfuerzo = itemRazonamiento?.pensar?.nivel || "";
    chat.imageMaxTokens = Number(MODELO.catalogo?.[modeloActualClave()]?.vision?.imageMaxTokens) || 1024;
    const perfil = typeof ajustes.perfil === "string" ? ajustes.perfil : "";
    if (perfil && MODELO.muestreo[perfil]) chat.perfil = perfil;
    const tope = Number(ajustes.historial);
    // 0 = automático (ventana - reserva). Un valor >= 512 fija un techo manual.
    chat.configuredCap = Number.isFinite(tope) && tope > 0 ? Math.max(512, tope) : 0;
    // Razonamiento: el que pidió el usuario, pero SOLO si el modelo cargado lo admite
    // (catalogo.<clave>.pensar). Con bolding_v1 se queda apagado aunque esté pedido.
    const capacidadPensar = pensarDe(modeloActualClave());
    const pedidoEfectivo = Number.isFinite(pedidoPensar) && pedidoPensar !== 0 ? pedidoPensar : capacidadPensar.presupuesto;
    chat.thinkBudget = presupuestoPensar(modeloActualClave(), pedidoEfectivo);
    // Tope de pasos del agente y tope de tiempo por comando: configurables con límites sanos.
    const topePasos = Number(ajustes.saltosTope);
    if (Number.isFinite(topePasos)) saltosTope = Math.max(24, Math.min(400, Math.round(topePasos)));
    const segundos = Number(ajustes.comandoSegundos);
    if (Number.isFinite(segundos)) comandoTimeoutMs = Math.max(10, Math.min(1800, Math.round(segundos))) * 1000;
    // Presupuesto de la memoria global: 0 la apaga; el máximo evita que una nota
    // seleccionada se coma el contexto del proyecto.
    const mgTokens = Number(ajustes.memoriaGlobalTokens);
    chat.globalMemoryBudget = ajustes.memoriaGlobal === false
      ? 0
      : Math.max(0, Math.min(2000, Number.isFinite(mgTokens) ? Math.round(mgTokens) : 480));
  }

  /**
   * Presupuesto con el que se arrancó el llama-server desde ESTA app (null = no lo arrancó
   * ella: lo lanzó start-ui.ps1, que ya lee el mismo ajuste, o el usuario a mano).
   * @type {number | null}
   */
  let pensarServidor = null;

  /**
   * Lo que la interfaz necesita saber del razonamiento: si el modelo cargado lo admite, el
   * presupuesto recomendado, el que se está usando y con cuál arrancó el servidor.
   * @returns {{modelo: string, compatible: boolean, recomendado: number, efectivo: number, servidor: number | null}}
   */
  function infoPensar() {
    const clave = modeloActualClave();
    const { compatible, presupuesto } = pensarDe(clave);
    return { modelo: clave, compatible, recomendado: presupuesto, efectivo: chat.effectiveThinkingBudget(), solicitado: chat.thinkBudget, limiteCoding: chat.thinkingLimit(), servidor: pensarServidor };
  }

  let server = null;
  /**
   * Contexto explícito del servidor. Las rutas reciben este objeto y no leen
   * variables de este archivo. Los getters/setters mantienen el estado mutable
   * (carpeta, turno, permisos) sin duplicarlo.
   */
  const routeContext = {
    args, chat, historial, memoriaGlobal, lifecycle, undoStore,
    HERE, PROJECT, STATE, SALIDA, PAGE, ADJUNTOS_DIR, REGISTROS_DIR,
    shellEnv, fileInside, readLimited: (abs, limite) => leerTextoAcotado(abs, limite),
    uiThemeIds: UI_THEME_IDS,
    permits,
    procesosFondoVivos, procesosFondoTerminados,
    get workspaceRoot() { return workspaceRoot; },
    set workspaceRoot(value) { workspaceRoot = value; },
    get busy() { return busy; },
    set busy(value) { busy = value; },
    get permitMode() { return permitMode; },
    get undoDelTurno() { return undoDelTurno; },
    set undoDelTurno(value) { undoDelTurno = value; },
    get configuracionApagada() { return configuracionApagada; },
    set configuracionApagada(value) { configuracionApagada = value; },
    get errorHistorial() { return errorHistorial; },
    get turno() { return turno; },
    set turno(value) { turno = value; },
    get saltosTope() { return saltosTope; },
    get comandoTimeoutMs() { return comandoTimeoutMs; },
    invalidateIndice() { indiceCache = null; },
    setPermitMode, waitPermit,
    leerAjustes, guardarAjustes, aplicarAjustesAlChat, modeloActualClave,
    configuracionAnterior, conectarModelo, comandoServidorOptimizado, infoPensar,
    leerReglas, reglasParaModelo, workspacePayload, setWorkspace, pickFolder,
    buscarEnProyecto, gitRun, git, buildStats, sesionesTerminal,
    indiceProyecto, crearRegistroSalida, runCommand,
    pdfReady, repoIndex, relCanonica, filesNamedIn, attachFiles, attachSnippets, attachImagenes, textoPlan,
    startChat, loadChat, removeChat,
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
    try {
      // Guardia anti-CSRF / anti-DNS-rebinding: cualquier web abierta en el navegador
      // puede mandar POST a 127.0.0.1 (mode:"no-cors"). Ver chat/guardia.mjs.
      const guardia = revisarPeticion(req, args);
      if (!guardia.ok) {
        res.writeHead(guardia.status || 403, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        res.end(`rechazado: ${guardia.motivo}`);
        return;
      }
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
      const demasiadoGrande = codigo === "PAYLOAD_TOO_LARGE";
      const jsonInvalido = err instanceof SyntaxError;
      if (!res.headersSent) {
        if (demasiadoGrande) res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", Connection: "close" });
        else if (jsonInvalido) res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
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
  const pythonHome = findPythonHome();
  const thinkNote = chat.thinkBudget ? `razonamiento ${chat.thinkBudget} tok` : "sin razonamiento";
  process.stdout.write(`Bonsai en ${pageUrl}\nmodelo ${modeloActualClave() || chat.model} · ventana ${chat.nCtx} · historial ${chat.historyCap()} · muestreo ${chat.perfil} · ${thinkNote}${chat.vision ? " · visión" : ""} · carpeta ${workspaceRoot}\npython ${pythonHome || "(no encontrado)"}\n`);
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
