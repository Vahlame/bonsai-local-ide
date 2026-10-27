/** Comprueba OCR local con dígitos generados como píxeles, sin servidor de modelo. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { ocrLocal } from "./ocr.mjs";

if (process.platform !== "win32") { console.log("OCR omitido: requiere Windows."); process.exit(0); }
const edge = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => fs.existsSync(p));
assert.ok(edge, "se necesita Edge o Chrome");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-ocr-"));
const browser = await chromium.launch({ executablePath: edge, headless: true, args: ["--disable-gpu", "--disable-extensions"] });
const actual = [];
try {
  const page = await browser.newPage({ viewport: { width: 600, height: 264 }, deviceScaleFactor: 1 });
  const font = {
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"]
  };
  for (const number of ["2372", "4233", "5372", "2345", "7878", "3457", "3438"]) {
    await page.setContent('<style>body{margin:0}</style><canvas width="600" height="264"></canvas>');
    await page.evaluate(({ number, font }) => {
      const ctx = document.querySelector("canvas").getContext("2d");
      ctx.fillStyle = "white"; ctx.fillRect(0, 0, 600, 264); ctx.fillStyle = "black";
      [...number].forEach((digit, index) => font[digit].forEach((row, y) => [...row].forEach((v, x) => { if (v === "1") ctx.fillRect(index * 144 + x * 24, (y + 2) * 24, 24, 24); })));
    }, { number, font });
    const file = path.join(temp, `${number}.png`);
    await page.screenshot({ path: file });
    const result = await ocrLocal(file);
    actual.push({ esperado: number, leido: result.texto, ok: result.ok && result.texto.replace(/\s/g, "") === number, error: result.error });
  }
  for (const item of actual) console.log(`${item.ok ? "OK" : "FALLO"}: ${item.esperado} → ${item.leido || item.error}`);
  assert.ok(actual.every((item) => item.ok), "OCR no leyó todos los ejemplos de prueba");
} finally {
  await browser.close();
  if (path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith("bonsai-ocr-")) fs.rmSync(temp, { recursive: true, force: true });
}
