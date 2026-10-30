/** OCR local opcional con la API de Windows. No envía imágenes a ningún servicio. */
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = process.env.BONSAI_OCR_SCRIPT || fileURLToPath(new URL("../scripts/ocr-winrt.ps1", import.meta.url));

export async function ocrLocal(imagePath, { signal, timeoutMs = 12000 } = {}) {
  if (process.platform !== "win32") return { ok: false, error: "OCR local solo disponible en Windows." };
  return new Promise((resolve) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SCRIPT, "-ImagePath", path.resolve(imagePath)],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 150000, signal, encoding: "utf8" }, (err, stdout) => {
        if (signal?.aborted) return resolve({ ok: false, error: "OCR cancelado." });
        try {
          const data = JSON.parse(String(stdout || "").trim());
          resolve({ ok: data.ok === true, idioma: String(data.idioma || ""), texto: String(data.texto || "").slice(0, 6000), error: String(data.error || "") });
        } catch { resolve({ ok: false, error: err ? "No se pudo ejecutar OCR local." : "OCR local devolvió una respuesta inválida." }); }
      });
  });
}
