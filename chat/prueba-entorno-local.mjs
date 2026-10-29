/** Regresiones del contrato de desarrollo local, sin modelo ni GPU. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { contextoEntorno, nombreSistema, shellPredeterminada } from "./entorno.mjs";
import { commandAllowed, extractWrites, nativeToolEffects, resolveInside, writeOutputs } from "./actions.mjs";
import { rutaProyecto, rutaSegura } from "./archivos-seguros.mjs";
import { describirLectura } from "./lecturas.mjs";
import { agentText } from "./context.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai entorno local "));
try {
  assert.match(nombreSistema("win32", "10.0.19044"), /Windows 10/);
  assert.match(nombreSistema("win32", "10.0.22631"), /Windows 11/);
  assert.equal(shellPredeterminada({ ComSpec: "C:\\Windows\\System32\\cmd.exe" }, "win32"), "C:\\Windows\\System32\\cmd.exe");
  const prompt = agentText({ root, permiso: "all", timeoutMs: 90000 });
  assert.ok(prompt.includes(JSON.stringify(root)));
  assert.ok(prompt.includes("90 s") && prompt.includes("autonomía local autorizada"));
  assert.ok(!prompt.includes("hasta el final del turno") && !prompt.includes("tuberías están bloqueadas"));
  assert.ok(contextoEntorno({ root }).includes("NO un sandbox"));
  for (const rel of ["Proyecto.csproj", "project.godot", "scenes/main.tscn", "Dockerfile", ".gitignore", ".env.example", "bin/build.props", "models/personaje.tres", "logs/build.txt", "node_modules/parche/index.js"]) {
    const abs = path.join(root, rel);
    writeOutputs(root, [{ rel: abs, content: "contenido local" }]);
    assert.equal(resolveInside(root, rel), abs);
    assert.match(describirLectura({ root, clave: abs }), /contenido local/);
  }
  assert.equal(rutaProyecto(root, ".", { permitirRaiz: true }), root);
  assert.equal(rutaProyecto(root, root, { permitirRaiz: true }), root);
  assert.equal(rutaProyecto(root, path.join(root, "..", "externo.txt")), null);
  assert.equal(rutaSegura(root, path.join(root, "Dockerfile")), null, "la API estricta conserva su contrato");
  assert.throws(() => writeOutputs(root, [{ rel: ".git/config", content: "x" }]));
  assert.throws(() => writeOutputs(root, [{ rel: "bin/app.exe", content: "x" }]));
  assert.throws(() => writeOutputs(root, [{ rel: "datos.txt", content: "x\0y" }]));
  const trusted = { trusted: true };
  for (const command of ["taskkill /PID 12345 /T /F", '"C:\\Program Files\\nodejs\\node.exe" --version', "npm ci && npm run build", "powershell.exe -NoProfile -Command Get-ChildItem", `node -e "console.log('${"x".repeat(900)}')"`]) assert.ok(commandAllowed(command, trusted), command);
  for (const command of ["shutdown /s", "echo ok && format C:", "diskpart", "reg delete HKLM\\Software /f", "\0"]) assert.ok(!commandAllowed(command, trusted), command);
  assert.ok(!commandAllowed("taskkill /PID 12345 /T /F"), "el modo limitado sigue disponible");
  const effects = nativeToolEffects([{ id: "r", name: "ejecutar", arguments: { comando: "node verificar.cjs", repetir: true } }]);
  assert.ok(effects.repetir.has("node verificar.cjs"));
  assert.equal(extractWrites("```archivo Proyecto.csproj\n<Project/>\n```", "", { soloExplicitas: true })[0].rel, "Proyecto.csproj");
  const procs = nativeToolEffects([{ id: "uno", name: "proceso", arguments: { accion: "leer", id: "bg1" } }, { id: "dos", name: "proceso", arguments: { accion: "leer", id: "bg2" } }]);
  assert.equal(procs.ids.get("proc:leer:bg1"), "uno"); assert.equal(procs.ids.get("proc:leer:bg2"), "dos");
  console.log("Entorno local: Windows 10, shell, rutas, formatos nativos, comandos y límites verificados.");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
