// Isolated smoke check for native Node apps exposing startServer(port).
// Executed as a verification child, with the same bounds as project tests.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { webAppFailureFacts } from "./runtime-facts.mjs";

let server;
let source = "";
try { source = fs.readFileSync(path.resolve(process.argv[2], "server.mjs"), "utf8"); } catch { /* el contrato de abajo lo explicará */ }
const webFacts = webAppFailureFacts(source);
const failureHint = webFacts ? `\n${webFacts}` : "";
const watchdog = setTimeout(() => { console.error("La aplicación no terminó la comprobación HTTP en 15 s."); process.exit(1); }, 15000);
try {
  const app = await import(pathToFileURL(path.resolve(process.argv[2], "server.mjs")));
  assert.equal(typeof app.startServer, "function", "Falta startServer(port) para la comprobación aislada.");
  server = await app.startServer(0);
  const address = server.address();
  assert.ok(address && typeof address === "object" && address.port, "startServer(0) debe devolver el servidor HTTP listo.");
  const base = new URL(`http://127.0.0.1:${address.port}`);
  const response = await fetch(base, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, `La interfaz solicitada no está disponible: GET / devolvió ${response.status}. Sirve también el HTML y sus recursos; pasar los tests de la API no comprueba la interfaz.${failureHint}`);
  assert.match(response.headers.get("content-type") || "", /text\/html/i, "GET / debe responder HTML.");
  const html = await response.text();
  assert.match(html, /<(?:html|body|main|form)\b/i, "La raíz no contiene una interfaz HTML.");
  const assets = new Map();
  for (const tag of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const href = /\b(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(tag[0])?.[1];
    if (!href || (tag[1].toLowerCase() === "link" && !/\bstylesheet\b/i.test(tag[0]))) continue;
    const url = new URL(href, base);
    if (url.origin === base.origin) assets.set(url.href, tag[1].toLowerCase() === "script" ? /(?:javascript|ecmascript)/i : /text\/css/i);
  }
  assert.ok(assets.size <= 30, "Demasiados recursos para la comprobación HTTP acotada.");
  for (const [url, mime] of assets) {
    const asset = await fetch(url, { signal: AbortSignal.timeout(3000) });
    assert.equal(asset.status, 200, `${new URL(url).pathname}: HTTP ${asset.status}; falta un recurso de la interfaz.`);
    assert.match(asset.headers.get("content-type") || "", mime, `Tipo de contenido incorrecto: ${new URL(url).pathname}`);
    assert.ok((await asset.text()).trim(), `Recurso vacío: ${new URL(url).pathname}`);
  }
  console.log(`Interfaz HTTP: GET / HTML y ${assets.size} recursos locales accesibles. Esta prueba no ejecuta la interacción del navegador.`);
} catch (error) {
  console.error(error.stack); process.exitCode = 1;
} finally {
  server?.closeAllConnections?.();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  clearTimeout(watchdog);
}
