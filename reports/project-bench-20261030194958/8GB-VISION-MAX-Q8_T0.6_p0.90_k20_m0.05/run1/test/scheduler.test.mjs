import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../src/scheduler.mjs';

test('runs tasks respecting priority', async () => {
  const results = await new Scheduler({ concurrency: 1 }).run();
  const order = results.map((r) => r.id);

  // ids are assigned in insertion order (1..3); priority 2 must run first.
  assert.deepEqual(order, [2, 1, 3]);
});

test('never runs more than concurrency tasks at once', async () => {
  const scheduler = new Scheduler({ concurrency: 2 });
  let maxConcurrent = 0;
  const inFlight = new Set();

  const ids = [];
  for (let i = 0; i < 10; i++) {
    ids.push(
      scheduler.add(async () => {
        inFlight.add(i);
        maxConcurrent = Math.max(maxConcurrent, inFlight.size);
        await new Promise((r) => setTimeout(r, 20));
        inFlight.delete(i);
        return i;
      })
    );
  }

  await scheduler.run();
  assert.equal(maxConcurrent, 2);
  assert.equal(inFlight.size, 0);
});

test('retries a failing task and succeeds after retries', async () => {
  let attempts = 0;
  const scheduler = new Scheduler({ concurrency: 1 });
  scheduler.add(async () => {
    attempts++;
    if (attempts < 3) {
      throw new Error('boom');
    }
    return 'ok';
  }, { retries: 2 });

  const [result] = await scheduler.run();
  assert.deepEqual(result, { id: 1, ok: true, value: 'ok', attempts: 3 });
});

test('a task that keeps failing returns ok:false with error', async () => {
  const scheduler = new Scheduler({ concurrency: 1 });
  scheduler.add(async () => {
    throw new Error('permanent');
  }, { retries: 2 });

  const [result] = await scheduler.run();
  assert.deepEqual(result, { id: 1, ok: false, error: new Error('permanent'), attempts: 3 });
});

test('results are returned in order of completion', async () => {
  const scheduler = new Scheduler({ concurrency: 2 });
  const finish = [];

  scheduler.add(async () => {
    await new Promise((r) => setTimeout(r, 100));
    finish.push(1);
    return 'one';
  }, { priority: 0 });

  scheduler.add(async () => {
    await new Promise((r) => setTimeout(r, 10));
    finish.push(2);
    return 'two';
  }, { priority: 0 });

  scheduler.add(async () => {
    await new Promise((r) => setTimeout(r, 50));
    finish.push(3);
    return 'three';
  }, { priority: 0 });

  const results = await scheduler.run();
  assert.deepEqual(finish, [2, 3, 1]);
  assert.equal(results.length, 3);
  assert.equal(results[0].value, 'two');
  assert.equal(results[1].value, 'three');
  assert.equal(results[2].value, 'one');
});
