import test from "node:test";
import assert from "node:assert/strict";
import { Scheduler } from "../src/scheduler.mjs";

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

test("respeta el limite de concurrencia", async () => {
  const s = new Scheduler({ concurrency: 2 });
  let activos = 0;
  let maximo = 0;
  for (let i = 0; i < 6; i += 1) {
    s.add(async () => {
      activos += 1;
      maximo = Math.max(maximo, activos);
      await dormir(40);
      activos -= 1;
      return i;
    }, { priority: 0 });
  }
  const r = await s.run();
  assert.equal(r.length, 6);
  assert.ok(maximo <= 2, `maximo simultaneo ${maximo}`);
  assert.ok(r.every((x) => x.ok));
});

test("empieza por la prioridad menor", async () => {
  const s = new Scheduler({ concurrency: 1 });
  const orden = [];
  s.add(async () => { orden.push("baja"); }, { priority: 10 });
  s.add(async () => { orden.push("alta"); }, { priority: 1 });
  s.add(async () => { orden.push("media"); }, { priority: 5 });
  await s.run();
  assert.deepEqual(orden, ["alta", "media", "baja"]);
});

test("reintenta hasta tener exito", async () => {
  const s = new Scheduler({ concurrency: 1 });
  let intentos = 0;
  s.add(async () => {
    intentos += 1;
    if (intentos < 3) throw new Error("fallo temporal");
    return "ok";
  }, { retries: 2 });
  const [r] = await s.run();
  assert.equal(r.ok, true);
  assert.equal(r.value, "ok");
  assert.equal(r.attempts, 3);
});

test("fallo definitivo devuelve ok:false con error", async () => {
  const s = new Scheduler({ concurrency: 1 });
  s.add(async () => { throw new Error("boom"); }, { retries: 1 });
  const [r] = await s.run();
  assert.equal(r.ok, false);
  assert.match(String(r.error), /boom/);
  assert.equal(r.attempts, 2);
});

test("devuelve resultados en orden de finalizacion", async () => {
  const s = new Scheduler({ concurrency: 3 });
  s.add(async () => { await dormir(60); return "lenta"; }, { priority: 0 });
  s.add(async () => { await dormir(10); return "rapida"; }, { priority: 0 });
  s.add(async () => { await dormir(30); return "media"; }, { priority: 0 });
  const r = await s.run();
  assert.deepEqual(r.map((x) => x.value), ["rapida", "media", "lenta"]);
  assert.ok(r.every((x) => x.ok && x.attempts === 1));
});
