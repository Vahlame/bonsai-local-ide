// Real GPU fault probes. Requires ports 8080 and 8787 free; does not replace the UI E2E.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createManagedServer } from "../chat/lifecycle/managed-server.mjs";
import { createProcessAdapter } from "../chat/lifecycle/process-adapter.mjs";
import { MODELO, presupuestoPensar } from "../chat/modelo.mjs";
import { engineProfile, isNamedEnginePreset } from "../chat/engine-profiles.mjs";

const root = path.resolve(import.meta.dirname, "..");
const directory = path.resolve(process.env.BONSAI_EVIDENCE_DIR || path.join(root, "reports", "lifecycle-2026-11-01"));
fs.mkdirSync(directory, { recursive: true });
const adapter = createProcessAdapter({ root, catalog: MODELO, getSettings: () => ({ enginePreset: "CUSTOM", engineVision: false }),
  isNamedEnginePreset, engineProfile, presupuestoPensar, mmprojDisponible: () => false });
const lifecycle = createManagedServer({ adapter, port: 8080 });
const markerPath = path.join(root, "logs", "servidor-administrado-8080.json");
const evidence = { started: new Date().toISOString(), steps: [] };
const config = { enginePreset: "CUSTOM", contexto: 65536, contextoExplicito: true, kv: "q8_0", vision: false, pensar: 4096, dormir: 0, hostIP: "127.0.0.1" };
const options = { model: "gpt-oss-20b", config };
assert.equal(await adapter.portOpen(8080), false, "8080 debe estar libre");
assert.equal(await adapter.portOpen(8787), false, "8787 debe estar libre");
const idleFreeMiB = await adapter.vramFree();
async function assertEmpty(name, marker) {
  assert.equal(await adapter.portOpen(8080), false);
  assert.equal(fs.existsSync(markerPath), false);
  if (marker) {
    assert.equal(await adapter.isAlive(marker.wrapperPid), false);
    assert.equal(await adapter.isAlive(marker.pidServidor), false);
  }
  const step = { name, markerBefore: marker || null, portClosed: true, markerRemoved: true, vramFreeMiB: await adapter.vramFree() };
  if (idleFreeMiB !== null && step.vramFreeMiB !== null) assert.ok(step.vramFreeMiB >= idleFreeMiB - 256, "La VRAM no volvió al reposo");
  evidence.steps.push(step); console.log(JSON.stringify(step));
}
try {
  // Cancellation before the marker exists: preflight must not spawn a child later.
  const originalReady = adapter.ready;
  adapter.ready = async () => false;
  await assert.rejects(lifecycle.start({ ...options, timeoutMs: 1 }), /plazo/);
  await new Promise((r) => setTimeout(r, 1500));
  await assertEmpty("cancelled-preflight");
  adapter.ready = originalReady;

  let failedMarker;
  await assert.rejects(lifecycle.start({ ...options, onReady: async () => {
    failedMarker = JSON.parse(fs.readFileSync(markerPath, "utf8").replace(/^\uFEFF/, ""));
    throw new Error("Fallo inyectado tras cargar el modelo real");
  } }), /Fallo inyectado/);
  assert.ok(failedMarker?.pidServidor, "debe haberse cargado el modelo real");
  await assertEmpty("failed-after-real-ready", failedMarker);

  const first = await lifecycle.start(options);
  const validMarker = JSON.parse(fs.readFileSync(markerPath, "utf8").replace(/^\uFEFF/, ""));
  try {
    fs.writeFileSync(markerPath, JSON.stringify({ ...validMarker, binId: "build-no-permitido" }));
    await assert.rejects(adapter.stop({ port: 8080 }), (e) => e.state === "foreign");
    assert.equal(await adapter.isAlive(validMarker.pidServidor), true);
    assert.equal(await adapter.isAlive(validMarker.wrapperPid), true);
    evidence.steps.push({ name: "invalid-binId-preserved", serverPid: validMarker.pidServidor, wrapperPid: validMarker.wrapperPid });
  } finally { fs.writeFileSync(markerPath, JSON.stringify(validMarker)); }
  let rejectedMarker, restoredMarker;
  const rejected = await lifecycle.restart({ ...options,
    onReady: async () => {
      rejectedMarker = JSON.parse(fs.readFileSync(markerPath, "utf8").replace(/^\uFEFF/, ""));
      throw new Error("Fallo inyectado durante rearranque");
    },
    onRestore: async () => { restoredMarker = JSON.parse(fs.readFileSync(markerPath, "utf8").replace(/^\uFEFF/, "")); },
  }).catch((e) => e);
  assert.equal(rejected.context.restored, true, rejected.message);
  assert.ok(restoredMarker);
  assert.notEqual(restoredMarker.pidServidor, first.pid);
  assert.equal(await adapter.isAlive(rejectedMarker.pidServidor), false);
  assert.equal((await lifecycle.inspect()).healthy, true);
  assert.equal(restoredMarker.contexto, config.contexto);
  assert.equal(restoredMarker.kv, config.kv);
  evidence.steps.push({ name: "rollback-real", previousPid: first.pid, rejectedPid: rejectedMarker.pidServidor, restoredMarker });
  await lifecycle.stop();
  await assertEmpty("rollback-cleaned", restoredMarker);
  evidence.ok = true;
} catch (e) { evidence.ok = false; evidence.error = e.stack; throw e; }
finally {
  evidence.finished = new Date().toISOString();
  fs.writeFileSync(path.join(directory, "faults-evidence.json"), JSON.stringify(evidence, null, 2));
}
