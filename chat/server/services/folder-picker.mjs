/**
 * Selector nativo de carpeta en Windows. Aísla el script de PowerShell y el
 * archivo temporal; el servidor solo recibe la ruta elegida (o "").
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

/**
 * @param {{getStart?: () => string, timeoutMs?: number}} [ctx]
 */
export function createFolderPicker(ctx = {}) {
  const timeoutMs = ctx.timeoutMs ?? 120_000;
  const getStart = ctx.getStart || (() => "");

  /**
   * @param {string} [startDir]
   * @returns {Promise<string>}
   */
  function pick(startDir = getStart()) {
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
      }, timeoutMs);
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

  return { pick };
}
