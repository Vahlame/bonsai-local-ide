// Prueba aislada: nunca utiliza el puerto habitual ni detiene procesos ajenos.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stop = path.join(root, "scripts", "stop-managed-server.ps1");
const launch = path.join(root, "scripts", "start-server.ps1");
const run = promisify(execFile);
const ps = (...args) => run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", stop, ...args], { windowsHide: true, timeout: 20000 });
const testServer = http.createServer((_req, res) => res.end("servidor ajeno"));
await new Promise((resolve) => testServer.listen(0, "127.0.0.1", resolve));
const port = testServer.address().port;
try {
  await assert.rejects(ps("-Port", String(port)));
  const respuesta = await fetch(`http://127.0.0.1:${port}`);
  assert.equal(await respuesta.text(), "servidor ajeno");
  console.log("OK: no se detiene el servidor ajeno del puerto solicitado");
} finally {
  await new Promise((resolve) => testServer.close(resolve));
}
assert.equal((await ps("-Port", String(port), "-CheckOnly")).stdout.trim(), "empty");
console.log("OK: puerto libre identificado");

if (process.argv.includes("--gpu")) {
  const marker = path.join(root, "logs", `servidor-administrado-${port}.json`);
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launch, "-ManagedByIDE", "-Modelo", "ornith9b", "-Port", String(port), "-ContextSize", "8192", "-Pensar", "0"], { cwd: root, windowsHide: true, stdio: "ignore" });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    let ready = false;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline && child.exitCode === null) {
      try { if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) })).ok) { ready = true; break; } } catch { /* cargando */ }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.equal(ready, true, "servidor GPU de prueba no arrancó");
    assert.equal((await ps("-Port", String(port), "-CheckOnly")).stdout.trim(), "managed");
    await ps("-Port", String(port));
    await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error("el wrapper no terminó")), 15000))]);
    console.log("OK: se identifica y detiene solo el servidor de prueba administrado");
  } finally {
    if (child.exitCode === null) {
      try { await ps("-Port", String(port)); } catch { /* no tocar procesos no verificados */ }
    }
    try { fs.unlinkSync(marker); } catch { /* ya no existe */ }
  }
}
