/**
 * Resolución local de Playwright y del navegador para los checkers.
 * No fija rutas del usuario: en un clon se instala con `npm ci --prefix chat`.
 */
const fs = require("fs");
const path = require("path");

function loadPlaywright() {
  const local = path.join(__dirname, "..", "..", "chat", "node_modules", "playwright-core");
  for (const candidate of [local, "playwright-core"]) {
    try {
      return require(candidate);
    } catch {
      /* siguiente */
    }
  }
  throw new Error("Falta playwright-core. Ejecuta `npm ci --prefix chat` en la raíz del proyecto.");
}

function browserPath() {
  const candidates = [
    process.env.BONSAI_BROWSER,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

module.exports = { loadPlaywright, browserPath };
