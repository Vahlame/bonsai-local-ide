/** Verifica privacidad y funcionamiento de la copia aislada de evaluación. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copiarApp } from "./evaluar/copia-app.mjs";

const chat = path.dirname(fileURLToPath(import.meta.url));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-copia-eval-"));
const origen = path.join(temp, "origen"), copia = path.join(temp, "copia");
let ui, nav, modelo;
try {
  // El origen ficticio se crea sin copiar ningún estado personal real.
  copiarApp(chat, origen);
  for (const rel of ["undo/1.json", "ui-chats/index.json", "ui-settings.json", "ui-workspace.json", "modelo-activo.json", "timings.jsonl", "memoria-global.json", "secreto-inesperado.mjs", "ui/privado.txt", "node_modules/pkg/index.js"]) {
    const archivo = path.join(origen, rel); fs.mkdirSync(path.dirname(archivo), { recursive: true }); fs.writeFileSync(archivo, "DATO_PERSONAL_FICTICIO");
  }
  copiarApp(origen, copia);
  assert.equal(fs.readFileSync(path.join(copia, "ui/index.html"), "utf8"), fs.readFileSync(path.join(origen, "ui/index.html"), "utf8"));
  for (const rel of ["undo", "ui-chats", "ui-settings.json", "ui-workspace.json", "modelo-activo.json", "timings.jsonl", "memoria-global.json", "secreto-inesperado.mjs", "ui/privado.txt", "node_modules"]) assert.equal(fs.existsSync(path.join(copia, rel)), false, `${rel} no debe copiarse`);
  assert.throws(() => copiarApp(origen, copia), /ya existe/, "no mezclar resultados de evaluaciones anteriores");

  const portServer = http.createServer();
  await new Promise((resolve) => portServer.listen(0, "127.0.0.1", resolve));
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  const estado = path.join(temp, "estado"), salida = path.join(temp, "salida");
  fs.mkdirSync(estado);
  modelo = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.url === "/props" ? { default_generation_settings: { n_ctx: 32768 } } : req.url === "/v1/models" ? { data: [{ id: "ficticio" }] } : { status: "ok" }));
  });
  await new Promise((resolve) => modelo.listen(0, "127.0.0.1", resolve));
  ui = spawn(process.execPath, [path.join(copia, "ui-server.mjs"), "--port", String(port), "--llama-port", String(modelo.address().port)], { env: { ...process.env, BONSAI_STATE: estado, BONSAI_SALIDA: salida }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let log = ""; ui.stdout.on("data", (data) => { log += data; }); ui.stderr.on("data", (data) => { log += data; });
  let inicio = false;
  for (let i = 0; i < 100 && ui.exitCode === null; i++) {
    try { const res = await fetch(`http://127.0.0.1:${port}/api/stats`); if (res.ok) { inicio = true; break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(inicio, `la interfaz copiada debe iniciar sin instalar node_modules dentro de ella: ${log}`);
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);

  process.env.BONSAI_PLAYWRIGHT_MODULE = path.join(chat, "node_modules", "playwright-core", "index.mjs");
  const { NavegadorLocal } = await import(pathToFileURL(path.join(copia, "navegador.mjs")));
  const proyecto = path.join(temp, "proyecto"); fs.mkdirSync(proyecto);
  fs.writeFileSync(path.join(proyecto, "index.html"), "<!doctype html><title>Copia aislada</title><p>Hola</p>");
  nav = new NavegadorLocal({ root: proyecto, output: path.join(temp, "capturas") });
  const pantalla = JSON.parse((await nav.run({ accion: "abrir", ruta: "index.html" })).texto);
  assert.match(JSON.stringify(pantalla), /Copia aislada/);
  if (process.platform === "win32") {
    const script = path.join(temp, "ocr-ficticio.ps1");
    fs.writeFileSync(script, "param([string]$ImagePath)\nWrite-Output '{\"ok\":true,\"texto\":\"OCR_AISLADO\"}'\n");
    process.env.BONSAI_OCR_SCRIPT = script;
    const { ocrLocal } = await import(pathToFileURL(path.join(copia, "ocr.mjs")));
    assert.equal((await ocrLocal(path.join(temp, "imagen-ficticia.png"))).texto, "OCR_AISLADO");
  }
  const fuentes = path.join(origen, "ui", "fuentes"), fuera = path.join(temp, "fuentes-fuera");
  fs.renameSync(fuentes, fuera);
  fs.symlinkSync(fuera, fuentes, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => copiarApp(origen, path.join(temp, "copia-enlace")), /enlace no admitido/, "no se deben seguir enlaces a carpetas ajenas");
  console.log("Copia de evaluación: archivos personales excluidos, servidor, Playwright y referencia OCR verificados.");
} finally {
  if (nav) await nav.close();
  if (ui && ui.exitCode === null) { ui.kill(); await new Promise((resolve) => ui.once("exit", resolve)); }
  if (modelo) await new Promise((resolve) => modelo.close(resolve));
  if (path.dirname(temp) === os.tmpdir() && path.basename(temp).startsWith("bonsai-copia-eval-")) fs.rmSync(temp, { recursive: true, force: true });
}
