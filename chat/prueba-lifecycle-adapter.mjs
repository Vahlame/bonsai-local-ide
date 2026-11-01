// Windows adapter regressions. Real owned processes, but no GPU/model is loaded.
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import childProcess, { execFile, spawn } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter, once } from "node:events";
import { PassThrough } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { promisify } from "node:util";
import { createProcessAdapter } from "./lifecycle/process-adapter.mjs";

const root = path.resolve(import.meta.dirname, "..");
const run = promisify(execFile);
function removeSandbox(sandbox) {
  assert.equal(path.dirname(sandbox), os.tmpdir());
  assert.ok(path.basename(sandbox).startsWith("bonsai-adapter-"));
  fs.rmSync(sandbox, { recursive: true, force: true });
}
const adapter = (sandbox = root) => createProcessAdapter({ root: sandbox, catalog: { catalogo: { fixture: {} } },
  getSettings: () => ({}), isNamedEnginePreset: () => false, engineProfile: () => ({}),
  mmprojDisponible: () => false, presupuestoPensar: () => 0 });

test("ContextoExplicito solo llega al lanzador optimizado; conserva ContextSize en ambos", async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-adapter-args-"));
  const launches = [];
  const replacement = mock.method(childProcess, "spawn", (_exe, args) => {
    launches.push(args);
    return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), unref() {} });
  });
  syncBuiltinESMExports();
  try {
    for (const enginePreset of ["", "CUSTOM"]) {
      adapter(sandbox).launch({ model: "fixture", port: 8080, config: { enginePreset, contexto: 8192, contextoExplicito: true, pensar: 0 } });
    }
    assert.equal(path.basename(launches[0][launches[0].indexOf("-File") + 1]), "start-server.ps1");
    assert.equal(launches[0].includes("-ContextoExplicito"), false);
    assert.equal(path.basename(launches[1][launches[1].indexOf("-File") + 1]), "start-gpu-model-rtx4060-optimized.ps1");
    assert.equal(launches[1].includes("-ContextoExplicito"), true);
    for (const args of launches) assert.equal(args[args.indexOf("-ContextSize") + 1], "8192");
  } finally {
    replacement.mock.restore(); syncBuiltinESMExports();
    removeSandbox(sandbox);
  }
});

test("cancelLaunch termina su proceso propio aunque ya tenga errorArranque", async () => {
  const owned = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { windowsHide: true, stdio: "ignore" });
  await once(owned, "spawn");
  const exited = once(owned, "exit");
  try {
    owned.errorArranque = new Error("handshake inválido de prueba");
    await adapter().cancelLaunch(owned);
    await exited;
    assert.equal(await adapter().isAlive(owned.pid), false);
    await adapter().cancelLaunch(owned); // already exited is harmless
  } finally { if (owned.exitCode === null && owned.signalCode === null) { owned.kill(); await exited; } }
});

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

for (const stale of [true, false]) test(`marcador de arranque: PID vivo con fecha ${stale ? "distinta se reemplaza" : "correcta se preserva"}`, async () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-adapter-marker-"));
  const port = await freePort();
  const markerPath = path.join(sandbox, "logs", `servidor-administrado-${port}.json`);
  const scriptPath = path.join(sandbox, "probe.ps1");
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-Command", `(Get-Process -Id ${process.pid}).StartTime.ToUniversalTime().Ticks.ToString()`], { windowsHide: true });
  const ticks = (BigInt(stdout.trim()) + (stale ? 1n : 0n)).toString();
  const marker = { wrapperPid: process.pid, pid: process.pid, pidServidor: process.pid, iniciado: ticks, iniciadoServidor: ticks };
  fs.mkdirSync(path.dirname(markerPath));
  fs.writeFileSync(markerPath, JSON.stringify(marker));
  fs.writeFileSync(scriptPath, `param($Common, $Sandbox, [int]$Port, $NodeExe)
$ErrorActionPreference = 'Stop'
. $Common
$RootDir = $Sandbox
$ManagedByIDE = $true
$Json = $true
$IsMoe = $false
$FreeMiB = 0
$Binary = @{ id = 'owned-test-node' }
$BinPath = $NodeExe
$ArgumentLine = '-e "setTimeout(() => {}, 500)"'
$env:BONSAI_LLAMA_LOG_PREFIX = Join-Path $RootDir 'logs\\owned-test'
$code = Start-BonsaiManagedProcess ([ordered]@{ modelo = 'fixture'; puerto = $Port })
exit $code
`);
  try {
    const launched = run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath,
      "-Common", path.join(root, "scripts", "managed-server-common.ps1"), "-Sandbox", sandbox, "-Port", String(port), "-NodeExe", process.execPath],
      { windowsHide: true, timeout: 15000 });
    if (stale) {
      const result = JSON.parse((await launched).stdout.trim());
      assert.equal(result.state, "starting");
      assert.equal(result.binId, "owned-test-node");
      assert.equal(fs.existsSync(markerPath), false, "el hijo y su wrapper deben limpiar su marcador");
      assert.equal(await adapter().isAlive(result.serverPid), false);
      assert.equal(await adapter().isAlive(result.wrapperPid), false);
    } else {
      await assert.rejects(launched, /marcador con procesos vivos/);
      assert.deepEqual(JSON.parse(fs.readFileSync(markerPath, "utf8")), marker);
      assert.equal(fs.existsSync(path.join(sandbox, "logs", "owned-test.out.log")), false, "no debe crear un hijo");
    }
    assert.equal(await adapter().isAlive(process.pid), true, "el PID reutilizado no se toca");
  } finally { removeSandbox(sandbox); }
});
