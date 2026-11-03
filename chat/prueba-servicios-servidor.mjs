#!/usr/bin/env node
/**
 * Pruebas de los servicios extraídos de ui-server.mjs. No arrancan HTTP ni
 * necesitan GPU: comprueban los contratos que antes vivían enterrados en main().
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createWorkspaceService } from "./server/services/workspace.mjs";
import { createSettingsService } from "./server/services/settings.mjs";
import { createPermissionService } from "./server/services/permissions.mjs";
import { createCommandService, findPythonHome } from "./server/services/commands.mjs";
import { createRulesService } from "./server/services/rules.mjs";
import { createStatsService } from "./server/services/stats.mjs";
import { createLauncherService } from "./server/services/launcher.mjs";
import { createOutputLogService } from "./server/services/output-log.mjs";
import { createBackgroundProcessRegistry } from "./server/services/background-processes.mjs";
import { createHistoryService } from "./server/services/history.mjs";
import { createSymbolIndex } from "./server/services/symbol-index.mjs";
import { crearObservabilidad, redactar } from "./server/observability.mjs";
import { parseChatRequest } from "./server/agent/request.mjs";
import { EventEmitter } from "node:events";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-services-"));
let checks = 0;
function check(name, condition, detail = "") {
  checks += 1;
  if (!condition) throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
  process.stdout.write(`ok ${checks}: ${name}\n`);
}
function dir(name) {
  const abs = path.join(tmp, name);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

try {
  // ------------------------------------------------------------- workspace
  const project = dir("project");
  write(path.join(project, "src", "app.js"), "const aguja = 'hola';\n");
  write(path.join(project, "bin", "ignorado.js"), "aguja\n");
  write(path.join(project, "grande.txt"), "x".repeat(900_000));
  const stateFile = path.join(tmp, "workspace.json");
  const workspace = createWorkspaceService({ projectRoot: project, stateFile });
  check("workspace: carga el proyecto por defecto", workspace.load() === project);
  check("workspace: el payload lista archivos", workspace.payload().files.some((f) => f.rel === "src/app.js"));
  const hits = workspace.search("aguja", 10);
  check("workspace: busca texto y omite bin/", hits.some((h) => h.rel === "src/app.js") && !hits.some((h) => h.rel.startsWith("bin/")));
  const otro = dir("otro");
  workspace.setRoot(otro);
  check("workspace: cambia la raíz y persiste", workspace.getRoot() === otro && JSON.parse(fs.readFileSync(stateFile, "utf8")).path === otro);
  assert.throws(() => workspace.setRoot(path.join(tmp, "no-existe")), /no existe/i);
  check("workspace: rechaza carpetas inexistentes", true);

  // -------------------------------------------------------------- settings
  const settingsFile = path.join(tmp, "settings.json");
  write(settingsFile, JSON.stringify({ tema: "ocean", uiVersion: "2.4.12", historial: 8192 }));
  const runtime = { saltosTope: 192, comandoTimeoutMs: 180000 };
  const chat = {
    nCtx: 32768,
    agentProfile: "legacy",
    perfil: "codigo",
    thinkBudget: 0,
    configuredCap: 0,
    globalMemoryBudget: 0,
    coderConfig: {},
    historyCap: () => 24000,
    effectiveThinkingBudget: () => 2048,
    thinkingLimit: () => 2048,
  };
  const settings = createSettingsService({
    stateFile: settingsFile,
    args: { think: 0 },
    chat,
    initialProfile: "legacy",
    catalog: { catalogo: { modelo: { vision: { imageMaxTokens: 1024 } } }, muestreo: { codigo: {} } },
    catalogoModelos: () => [{ clave: "modelo", pensar: { nivel: "medium" } }],
    pensarDe: () => ({ compatible: true, presupuesto: 2048 }),
    presupuestoPensar: (_clave, pedido) => pedido,
    engineProfile: () => ({ context: 32768, thinkingTokens: 2048 }),
    isNamedEnginePreset: () => false,
    coderConfig: { contextTokens: 16384 },
    coderOptions: () => ({}),
    getModelKey: () => "modelo",
    runtime,
  });
  const loaded = settings.leerAjustes();
  check("settings: no resetea el tema en una versión posterior a la migración", loaded.tema === "ocean", loaded.tema);
  check("settings: actualiza uiVersion sin tocar el tema", loaded.uiVersion !== "2.4.12" && loaded.tema === "ocean");
  settings.aplicarAjustesAlChat({ ...loaded, saltosTope: 50, comandoSegundos: 30, memoriaGlobalTokens: 100 });
  check("settings: aplica límites de runtime", runtime.saltosTope === 50 && runtime.comandoTimeoutMs === 30000);
  check("settings: aplica presupuesto de memoria", chat.globalMemoryBudget === 100);
  check("settings: infoPensar devuelve el contrato", settings.infoPensar().efectivo === 2048);
  write(settingsFile, JSON.stringify({ tema: "ocean", uiVersion: "2.2.0", historial: 32768 }));
  const migrated = settings.leerAjustes();
  check("settings: migra instalaciones anteriores a 2.3.0", migrated.tema === "slate" && migrated.historial === 0);

  // ----------------------------------------------------------- permissions
  const permitFile = path.join(tmp, "permit.json");
  const permissions = createPermissionService({ stateFile: permitFile, timeoutMs: 50 });
  permissions.setMode("all");
  check("permisos: persiste el modo", JSON.parse(fs.readFileSync(permitFile, "utf8")).mode === "all");
  const ac = new AbortController();
  const espera = permissions.wait("a1", ac.signal);
  permissions.permits.get("a1")?.(true);
  check("permisos: resuelve la espera por id", (await espera) === true);
  const ac2 = new AbortController();
  const espera2 = permissions.wait("a2", ac2.signal);
  ac2.abort();
  check("permisos: cancelar el turno deniega", (await espera2) === false);
  const espera3 = permissions.wait("a3", new AbortController().signal);
  check("permisos: el timeout deniega", (await espera3) === false);

  // -------------------------------------------------------------- commands
  const appData = dir("appdata");
  const pythonHome = path.join(appData, "uv", "python", "3.10.0");
  write(path.join(pythonHome, "python.exe"), "");
  write(path.join(pythonHome, "Lib", "site-packages", "pip", "x"), "");
  check("comandos: encuentra el Python de uv", findPythonHome({ APPDATA: appData }) === pythonHome);
  const commandService = createCommandService({
    here: dir("chat"),
    env: { APPDATA: appData, PATH: "C:\\Windows" },
    getRoot: () => project,
    getTimeoutMs: () => 1000,
    snapshot: () => new Map(),
    ejecutar: async () => ({ code: 0, output: "listo" }),
    recortar: (texto) => texto,
  });
  const result = await commandService.runCommand("echo hola");
  check("comandos: ejecuta y devuelve salida", result.code === 0 && result.output.includes("listo"));
  check("comandos: crea los shims", fs.existsSync(path.join(tmp, "chat", ".shims", "python3.cmd")));

  // ----------------------------------------------------------------- rules
  write(path.join(project, "BONSAI.md"), "# Reglas\nSé breve.");
  write(path.join(project, ".cursor", "rules", "api.mdc"), "---\nalwaysApply: true\n---\nUsa la API.");
  const rules = createRulesService({
    getRoot: () => project,
    fileInside: (root, rel) => {
      const abs = path.resolve(root, rel);
      return abs.startsWith(path.resolve(root)) ? abs : null;
    },
    readLimited: (abs) => fs.existsSync(abs) ? { ok: true, texto: fs.readFileSync(abs, "utf8") } : { ok: false, texto: "" },
    takeHeadByTokens: (texto) => texto,
    estimateTokens: (texto) => texto.length,
    rulesCapTokens: 700,
  });
  const reglas = rules.leerReglas();
  check("reglas: lee BONSAI.md y .cursor/rules", reglas.fuentes.includes("BONSAI.md") && reglas.fuentes.includes(".cursor/rules/api.mdc"));
  check("reglas: quita el frontmatter", !reglas.texto.includes("alwaysApply"));

  // ----------------------------------------------------------------- stats
  const stats = createStatsService({
    chat: {
      nCtx: 32768,
      session: { files: [{ rel: "a.js", bytes: 10 }], memory: "nota", turns: [1, 2], folded: 1 },
      usage: { prompt: 100, generated: 20 },
      livePrompt: 0,
      liveGenerated: 0,
      model: "modelo",
      vision: true,
      historyCap: () => 24000,
    },
    getRoot: () => project,
    startedAt: Date.now(),
    estimateTokens: (texto) => texto.length,
    legacyMetrics: () => ({ n: 1 }),
    list: () => [{ rel: "a.js" }],
  });
  const state = stats.build();
  check("stats: resume sesión y archivos", state.saved.count === 1 && state.turns === 2 && state.vision === true);
  let llamadasLista = 0;
  let ahora = 1000;
  const statsCache = createStatsService({
    chat: { session: { files: [], memory: "", turns: [], folded: 0 }, usage: null, nCtx: 1, livePrompt: 0, liveGenerated: 0, historyCap: () => 1 },
    getRoot: () => project,
    startedAt: 0,
    estimateTokens: () => 0,
    legacyMetrics: () => ({}),
    list: () => { llamadasLista += 1; return [{ rel: "x" }]; },
    workspaceTtlMs: 1000,
    now: () => ahora,
  });
  statsCache.build();
  statsCache.build();
  check("stats: cachea el conteo de workspace", llamadasLista === 1, String(llamadasLista));
  ahora = 2001;
  statsCache.build();
  check("stats: refresca el conteo al expirar el TTL", llamadasLista === 2, String(llamadasLista));
  statsCache.invalidate();
  statsCache.build();
  check("stats: invalidate fuerza un recuento", llamadasLista === 3, String(llamadasLista));

  const symbolIndex = createSymbolIndex({ getRoot: () => project, ttlMs: 1000 });
  const indice = await symbolIndex.get();
  check("symbol-index: indexa en worker y encuentra el símbolo", indice.has("aguja"), [...indice.keys()].join(","));
  const mismo = await symbolIndex.get();
  check("symbol-index: reutiliza la caché", mismo === indice);
  symbolIndex.invalidate();
  const deNuevo = await symbolIndex.get();
  check("symbol-index: invalidate fuerza un índice nuevo", deNuevo !== indice && deNuevo.has("aguja"));

  const redactado = redactar({ token: "secreto", ruta: "C:\\Users\\user\\proyecto\\x.js", anidado: { password: "p" } });
  check(
    "observability: redacta secretos y rutas absolutas",
    redactado.token === "[redactado]" && redactado.ruta === "[ruta]" && redactado.anidado.password === "[redactado]",
    JSON.stringify(redactado),
  );
  const lineas = [];
  let reloj = 5000;
  const obs = crearObservabilidad({
    version: "1.2.3",
    startedAt: 1000,
    now: () => reloj,
    write: (linea) => lineas.push(linea),
    getModel: () => "modelo-local",
    getWorkspace: () => "C:\\Users\\user\\proyecto",
  });
  const salud = obs.health();
  check(
    "observability: health resume versión, uptime y carpeta",
    salud.ok === true && salud.version === "1.2.3" && salud.uptime === 4 && salud.workspace === "proyecto" && salud.model === "modelo-local",
    JSON.stringify(salud),
  );
  const req = Object.assign(new EventEmitter(), { url: "/api/x?token=no-debe-salir", method: "GET" });
  const res = Object.assign(new EventEmitter(), {
    statusCode: 500,
    cabeceras: /** @type {Record<string, string>} */ ({}),
    setHeader(clave, valor) { this.cabeceras[clave] = valor; },
  });
  const id = obs.begin(req, res);
  res.emit("finish");
  const fila = JSON.parse(lineas.at(-1));
  check(
    "observability: request-id y log de 5xx sin query",
    id.length > 0 && res.cabeceras["X-Request-Id"] === id && fila.status === 500 && fila.path === "/api/x" && !JSON.stringify(fila).includes("no-debe-salir"),
    lineas.at(-1),
  );

  // -------------------------------------------------------------- launcher
  class LifecycleError extends Error {}
  const launcher = createLauncherService({
    projectRoot: project,
    catalog: { catalogo: { modelo: { clave: "modelo", archivo: "modelo.gguf", servidor: {}, vision: null, chat_template: "template" } } },
    isNamedEnginePreset: () => false,
    engineProfile: () => ({ context: 16384, kv: "q8_0", batch: 512, ubatch: 256 }),
    selectBinary: () => ({ exe: "llama-server.exe" }),
    LifecycleError,
  });
  const comando = launcher.comandoServidorOptimizado("8GB-VISION-MAX-Q8-100K", 8080, "modelo");
  check("launcher: arma el comando con el modelo", comando.includes("modelo.gguf") && comando.includes("--port 8080"));
  assert.throws(() => launcher.comandoServidorOptimizado("x", 8080, "no-existe"), LifecycleError);
  check("launcher: rechaza modelos desconocidos", true);

  // ------------------------------------------------------------ output-log
  const logs = createOutputLogService({ dir: dir("logs") });
  const log = logs.create();
  log.guardar("hola");
  check("output-log: crea y escribe el registro", fs.readFileSync(path.join(tmp, "logs", `${log.id}.log`), "utf8") === "hola");
  const logsAcotados = createOutputLogService({ dir: dir("logs-acotados"), maxArchivos: 2 });
  logsAcotados.create();
  logsAcotados.create();
  logsAcotados.create();
  check("output-log: conserva solo los últimos registros", fs.readdirSync(path.join(tmp, "logs-acotados")).filter((n) => n.endsWith(".log")).length === 2);

  // ------------------------------------------------------------ background
  const background = createBackgroundProcessRegistry({ maxTerminados: 2 });
  let stopped = false;
  background.vivos.set("p1", { parar: () => { stopped = true; } });
  background.stopAll();
  check("background: detiene los procesos vivos", stopped && background.vivos.size === 0);
  background.recordTerminated("p1", { code: 0 });
  background.recordTerminated("p2", { code: 0 });
  background.recordTerminated("p3", { code: 0 });
  check("background: conserva solo los últimos terminados", background.terminados.size === 2 && !background.terminados.has("p1"));

  // --------------------------------------------------------------- history
  const stateDir = dir("state");
  const sessionPath = path.join(stateDir, "ui-session.json");
  const fakeChat = {
    session: { memory: "", folded: 0, turns: [{ role: "user", content: "hola" }], draft: "", files: [] },
    tighten: 0,
    saveSession() { fs.writeFileSync(sessionPath, JSON.stringify(this.session), "utf8"); },
  };
  const history = createHistoryService({
    stateDir,
    sessionPath,
    chat: fakeChat,
    chatTitle: () => "Prueba",
  });
  fakeChat.saveSession();
  const index = history.historial.readIndex();
  check("history: archiva la sesión activa", index.items.length === 1 && fs.existsSync(history.historial.chatFile(index.active)));
  const nueva = history.startChat();
  check("history: crea una conversación nueva", nueva.active !== index.active);
  history.loadChat(index.active);
  check("history: recupera la conversación archivada", fakeChat.session.turns[0].content === "hola");
  const despues = history.removeChat(index.active);
  check("history: borra y elige otra conversación", despues.items.every((item) => item.id !== index.active));

  // --------------------------------------------------------------- request
  const getSettings = () => ({ modoRespuesta: "agente" });
  const pedido = parseChatRequest({ text: "implementa una función", files: ["a.js"] }, { getSettings });
  check("request: acepta un pedido de agente", pedido.ok === true && pedido.attached.length === 1);
  const invalido = parseChatRequest({ text: "hola", modo: "otro" }, { getSettings });
  check("request: rechaza un modo inválido", invalido.ok === false && invalido.status === 400);
  const vacio = parseChatRequest({ text: "   " }, { getSettings });
  check("request: rechaza un texto vacío", vacio.ok === false && vacio.message === "falta el texto");
  const consulta = parseChatRequest({ text: "¿qué es esto?", modo: "consulta" }, { getSettings });
  check("request: el modo consulta no usa herramientas", consulta.ok === true && consulta.consulta === true && consulta.soloCharla === true);

  process.stdout.write(`\nprueba-servicios-servidor: OK (${checks} comprobaciones)\n`);
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
}
