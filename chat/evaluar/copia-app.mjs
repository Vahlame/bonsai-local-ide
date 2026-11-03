/** Copia solamente el código y los recursos necesarios para ejecutar la interfaz de evaluación. */
import fs from "node:fs";
import path from "node:path";

// Mantener esta lista al agregar dependencias o recursos a la interfaz. No copiar por extensión:
// el directorio de la app puede contener archivos personales de cualquier tipo o nombre.
const ARCHIVOS = [
  "actions.mjs", "actions/text.mjs", "actions/edit.mjs", "actions/diff.mjs", "actions/effects.mjs", "actions/files.mjs",
  "tool-registry.mjs", "adaptadores.mjs", "almacen-json.mjs", "archivos-seguros.mjs", "bonsai-chat.mjs", "session-store.mjs", "llama-client.mjs", "prompting.mjs", "compaction.mjs",
  "cambio-modelo.mjs", "context.mjs", "context/prompts.mjs", "context/budget.mjs", "context/history.mjs", "diagnosticos.mjs", "diagnostics/analysis.mjs", "diagnostics/symbols.mjs", "diagnostics/index-worker.mjs", "editar.mjs", "entorno.mjs", "escritura-incremental.mjs", "git-seguro.mjs", "guardia.mjs", "historial.mjs", "lecturas.mjs", "legacy-tool-parser.mjs", "harmony.mjs",
  "code-context.mjs", "coder-harness.mjs", "coder/contracts.mjs", "coder/task.mjs", "coder-profile.json", "project-verification.mjs", "code-intelligence.mjs", "engine-profiles.mjs",
  "model-plan.mjs", "model-plan/gguf.mjs", "model-plan/planner.mjs", "model-hub.mjs", "model-hub/common.mjs", "model-hub/store.mjs", "model-hub/remote.mjs", "model-hub/downloads.mjs", "model-hub/jobs.mjs", "imagenes.mjs", "code-search.mjs",
  "investigacion.mjs", "mcp-playwright.mjs", "memoria-global.mjs", "registros.mjs", "modelo.mjs", "modelo.json", "navegador.mjs", "ocr.mjs", "procesos.mjs", "sse.mjs", "terminal.mjs", "ui-server.mjs",
  "lifecycle/managed-server.mjs", "lifecycle/process-adapter.mjs", "lifecycle/binary-registry.mjs", "runtime-facts.mjs", "verify-node-webapp.mjs",
  "server/http.mjs", "server/catalog.mjs", "server/gpu.mjs", "server/browser.mjs", "server/undo.mjs",
  "server/workspace.mjs", "server/text.mjs", "server/agent-loop.mjs",
  "server/agent/request.mjs", "server/agent/helpers.mjs", "server/agent/prompt.mjs",
  "server/agent/present.mjs", "server/agent/action-rows.mjs", "server/agent/verify.mjs", "server/agent/sse-session.mjs",
  "server/services/settings.mjs", "server/services/workspace.mjs", "server/services/project-search.mjs",
  "server/services/symbol-index.mjs", "server/services/commands.mjs", "server/services/rules.mjs",
  "server/services/git.mjs", "server/services/permissions.mjs", "server/services/history.mjs",
  "server/services/stats.mjs", "server/services/launcher.mjs", "server/services/folder-picker.mjs",
  "server/services/background-processes.mjs", "server/services/output-log.mjs", "server/security-headers.mjs",
  "server/observability.mjs", "server/contracts.mjs", "red-segura.mjs",
  "server/routes/index.mjs", "server/routes/static.mjs", "server/routes/files.mjs",
  "server/routes/git.mjs", "server/routes/models.mjs", "server/routes/settings.mjs", "server/routes/chat.mjs", "server/routes/contracts.mjs",
  "ui/server-controller.js", "ui/appearance.js", "ui/theme-boot.js", "ui/stats-boot.js", "ui/themes.json", "ui/refresh.css", "ui/app.js", "ui/chat-core.js", "ui/chat-core-live.js", "ui/chat-core-actions.js", "ui/chat-core-chat.js", "ui/chat-core-input.js", "ui/chat-core-turn.js", "ui/chat-core-init.js", "ui/hub.js", "ui/iconos.js", "ui/ide.css", "ui/ide.js", "ui/index.html", "ui/markdown.js", "ui/paneles.js",
  "ui/core/dom.mjs", "ui/core/api.mjs", "ui/core/state.mjs", "ui/format.mjs", "ui/app-git.mjs", "ui/app-search.mjs", "ui/app-rules.mjs",
  "ui/editor/text.mjs", "ui/workspace/paths.mjs",
  "ui/vendor/editor.js", "ui/vendor/terminal.js", "ui/vendor/xterm.css",
  "ui/tema.css", "ui/fuentes/fuentes.css", "ui/fuentes/inter-latin.woff2",
  "ui/fuentes/jetbrains-mono-latin.woff2",
];

export function copiarApp(origen, destino) {
  if (fs.existsSync(destino)) throw new Error(`La carpeta de evaluación ya existe: ${destino}. Elige otra carpeta de salida.`);
  // Los logos del Hub son recursos estáticos dentro de ui/iconos/modelos; se
  // copian solo si existen, sin abrir la puerta a archivos arbitrarios.
  const logosDir = path.join(origen, "ui/iconos/modelos");
  const logos = fs.existsSync(logosDir)
    ? fs.readdirSync(logosDir).filter((n) => n.endsWith(".svg") && !n.startsWith("."))
    : [];
  const archivos = [...ARCHIVOS, ...logos.map((n) => `ui/iconos/modelos/${n}`)];
  for (const rel of archivos) {
    // No seguir enlaces, incluidos enlaces a directorios intermedios.
    let actual = origen;
    for (const parte of rel.split("/")) {
      actual = path.join(actual, parte);
      if (fs.lstatSync(actual).isSymbolicLink()) throw new Error(`La aplicación contiene un enlace no admitido: ${actual}`);
    }
    if (!fs.statSync(actual).isFile()) throw new Error(`Falta un archivo de la aplicación: ${actual}`);
  }
  fs.mkdirSync(destino, { recursive: false });
  for (const rel of archivos) {
    const salida = path.join(destino, rel);
    fs.mkdirSync(path.dirname(salida), { recursive: true });
    fs.copyFileSync(path.join(origen, rel), salida, fs.constants.COPYFILE_EXCL);
  }
  const presets = fs.existsSync(path.join(origen,"engine-presets.json")) ? path.join(origen,"engine-presets.json") : path.join(origen,"../config/local-engine-presets.json");
  if (fs.lstatSync(presets).isSymbolicLink()) throw new Error("Los presets no pueden ser un enlace");
  fs.copyFileSync(presets,path.join(destino,"engine-presets.json"),fs.constants.COPYFILE_EXCL);
}
