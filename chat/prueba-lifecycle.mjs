import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import { createManagedServer, closeHttpServer } from "./lifecycle/managed-server.mjs";

function fixture() {
  let current = { state: "ready", marker: { modelo: "gpt-oss-20b", binId: "lab-server-mvq2", vramBeforeMiB: 7400 }, serverPid: 42, wrapperPid: 41, portClosed: false };
  const alive = new Set([41, 42]);
  const calls = [];
  const adapter = {
    inspect: async () => ({ ...current }),
    isAlive: async (pid) => alive.has(pid),
    portOpen: async () => !current.portClosed,
    markerExists: async () => !!current.marker,
    vramFree: async () => current.state === "empty" ? 7400 : 400,
    stop: async () => {
      calls.push("stop");
      await new Promise((r) => setTimeout(r, 5));
      alive.clear();
      current = { state: "empty", marker: null, portClosed: true };
      return { state: "empty", stoppedPids: [42, 41], portClosed: true, markerRemoved: true };
    },
    launch: async () => { calls.push("launch"); throw new Error("fallo de arranque"); },
    ready: async () => true,
    lastOutput: () => "helper diagnóstico",
  };
  const lifecycle = createManagedServer({ adapter, port: 8080, pollMs: 1, log: () => {} });
  return { lifecycle, adapter, calls, set: (v) => { current = v; } };
}

test("lab: stop verifica PID, puerto, marcador y VRAM; dos stop comparten resultado", async () => {
  const { lifecycle, calls } = fixture();
  const [a, b] = await Promise.all([lifecycle.stop(), lifecycle.stop()]);
  assert.deepEqual(a, b);
  assert.equal(a.state, "empty");
  assert.equal(a.vramFreeMiB, 7400);
  assert.equal(a.portClosed, true);
  assert.equal(a.markerRemoved, true);
  assert.deepEqual(calls, ["stop"]);
  assert.equal((await lifecycle.stop()).state, "empty");
});

test("foreign: no llama al adaptador de parada", async () => {
  const { lifecycle, set, calls } = fixture();
  set({ state: "foreign", portClosed: false, marker: null });
  await assert.rejects(lifecycle.stop(), (e) => e.state === "foreign" && e.status === 409);
  assert.deepEqual(calls, []);
});

test("no cree un éxito del helper si siguen vivos el PID o el puerto", async () => {
  const { lifecycle, adapter } = fixture();
  adapter.stop = async () => ({ state: "empty", portClosed: true, markerRemoved: true });
  await assert.rejects(lifecycle.stop({ timeoutMs: 15 }), (e) => e.context.port === 8080 && e.context.serverPid === 42);
});

test("un error de parada impide cerrar HTTP y permite reintentar", async () => {
  const { lifecycle, adapter } = fixture();
  let closed = false;
  const stop = adapter.stop;
  adapter.stop = async () => { throw new Error("acceso denegado"); };
  await assert.rejects(lifecycle.closeIde({ shutdown: () => { closed = true; } }), /acceso denegado/);
  assert.equal(closed, false);
  adapter.stop = stop;
  const result = await lifecycle.closeIde({ shutdown: () => { closed = true; } });
  assert.equal(result.state, "empty");
  assert.equal(closed, true);
});

test("un arranque fallido limpia procesos y marcador", async () => {
  const { lifecycle, calls } = fixture();
  await assert.rejects(lifecycle.restart({ model: "gpt-oss-20b", rollback: false }), /fallo de arranque/);
  assert.deepEqual(calls, ["stop", "launch", "stop"]);
  assert.equal((await lifecycle.inspect()).marker, null);
});

test("un wrapper muerto no impide parar al hijo identificado", async () => {
  const { lifecycle, set } = fixture();
  set({ state: "ready", marker: { binId: "lab-server-mvq2" }, serverPid: 42, wrapperPid: null, portClosed: false });
  assert.equal((await lifecycle.stop()).portClosed, true);
});

test("VRAM por debajo del umbral es fallo aunque puerto y PIDs estén cerrados", async () => {
  const { lifecycle, adapter } = fixture();
  adapter.vramFree = async () => 500;
  await assert.rejects(lifecycle.stop({ timeoutMs: 15 }), /VRAM/);
  await assert.rejects(lifecycle.stop({ timeoutMs: 15 }), /VRAM/, "reintentar no pierde el umbral original");
  adapter.vramFree = async () => 7400;
  assert.equal((await lifecycle.stop()).state, "empty");
});

test("telemetría ausente se declara; telemetría que falla después de parar no confirma VRAM", async () => {
  const missing = fixture();
  missing.adapter.vramFree = async () => null;
  const result = await missing.lifecycle.stop();
  assert.equal(result.vramFreeMiB, null);
  assert.equal(result.vramVerified, false);
  const broken = fixture();
  let reads = 0;
  broken.adapter.vramFree = async () => ++reads === 1 ? 400 : null;
  await assert.rejects(broken.lifecycle.stop({ timeoutMs: 10 }), /VRAM/);
});

test("start y close reciben 409 mientras hay un stop; los stop se agrupan", async () => {
  const { lifecycle } = fixture();
  const stopping = lifecycle.stop();
  await assert.rejects(lifecycle.start(), (e) => e.status === 409);
  await assert.rejects(lifecycle.closeIde(), (e) => e.status === 409);
  await stopping;
});

test("un marcador rancio se limpia antes de arrancar", async () => {
  const { lifecycle, adapter, set, calls } = fixture();
  set({ state: "empty", marker: { pidServidor: 999 }, portClosed: true });
  adapter.launch = async () => {
    calls.push("launch");
    assert.equal(await adapter.markerExists(8080), false);
    set({ state: "ready", serverPid: 43, marker: { modelo: "gpt-oss-20b" } });
    return null;
  };
  assert.equal((await lifecycle.start({ model: "gpt-oss-20b" })).state, "ready");
  assert.deepEqual(calls, ["stop", "launch"]);
});

test("closeHttpServer termina con SSE y keep-alive abiertos", async () => {
  const server = http.createServer((_req, res) => { res.writeHead(200, { "Content-Type": "text/event-stream" }); res.write("data: vivo\n\n"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const response = await fetch(`http://127.0.0.1:${server.address().port}`);
  assert.equal(response.status, 200);
  await closeHttpServer(server, { timeoutMs: 500 });
  assert.equal(server.listening, false);
});
