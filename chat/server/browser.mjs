/**
 * Abre la UI en una ventana de aplicacion sin GPU. El lanzador PowerShell se
 * ocupa de Edge/Chrome; el servidor solo lo invoca.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

/** @param {string} url */
export function openBrowser(url) {
  try {
    const launcher = path.join(PROJECT, "scripts", "open-ide.ps1");
    const port = new URL(url).port || "8787";
    if (process.platform === "win32" && fs.existsSync(launcher)) {
      // Sin `detached`: en Windows, un PowerShell detached + stdio ignore no puede
      // crear la ventana de Edge y falla en silencio (el acceso directo abria la UI
      // pero no el navegador). El proceso lanzador termina enseguida; no hace falta
      // desacoplarlo para que sobreviva.
      const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launcher, "-Port", port], { stdio: "ignore", windowsHide: true });
      child.unref();
      return;
    }
  } catch { /* cae al navegador normal */ }
  const child = spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}
