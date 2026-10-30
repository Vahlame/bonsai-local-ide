import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../src/scheduler.mjs';

test('runs tasks respecting priority', async () => {
  const scheduler = new Scheduler({ concurrency: 2 });
  const order = [];
  scheduler.add(async () => { order.push('low'); }, { priority: 10 });
  scheduler.add(async () => { order.push('high'); }, { priority: 1 });
  scheduler.add(async () => { order.push('mid'); }, { priority: 5 });

  const results = await scheduler.run();

  assert.deepEqual(order, ['high', 'mid', 'low']);
  assert.equal(results.length, 3);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].value, 'high');
});

test('respects concurrency limit by measuring max simultaneous', async () => {
  const maxConcurrency = 3;
  const scheduler = new Scheduler({ concurrency: maxConcurrency });
  let maxSimultaneous = 0;
  const active = new Set();

  const tasks = [];
  for (let i = 0; i < 6; i++) {
    tasks.push(scheduler.add(async () => {
      active.add(i);
      maxSimultaneous = Math.max(maxSimultaneous, active.size);
      await new Promise((r) => setTimeout(r, 10));
      active.delete(i);
      return i;
    }, { priority: 0 }));
  }

  await scheduler.run();

  assert.equal(maxSimultaneous, maxConcurrency);
  assert.equal(tasks.length, 6);
});

test('retries on failure then succeeds', async () => {
  const scheduler = new Scheduler({ concurrency: 1 });
  let attempts = 0;
  const task = scheduler.add(async () => {
    attempts++;
    if (attempts < 3) {
      throw new Error('temporary failure');
    }
    return 'ok';
  }, { priority: 0, retries: 5 });

  const results = await scheduler.run();

  assert.equal(results.length, 1);
  assert.equal(results[0].ok, true);
  assert.equal(results[0].value, 'ok');
  assert.equal(results[0].attempts, 3);
});

test('definitive failure returns ok:false with error', async () => {
  const scheduler = new Scheduler({ concurrency: 1 });
  const task = scheduler.add(async () => {
    throw new Error('permanent failure');
  }, { priority: 0, retries: 2 });

  const results = await scheduler.run();

  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.equal(results[0].error.message, 'permanent failure');
  assert.equal(results[0].attempts, 3);
});

test('results are in order of completion by duration', async () => {
  const scheduler = new Scheduler({ concurrency: 1 });
  const ids = [];
  scheduler.add(async () => {
    await new Promise((r) => setTimeout(r, 30));
    return 'slow';
  }, { priority: 0 });
  scheduler.add(async () => {
    await new Promise((r) => setTimeout(r, 10));
    return 'fast';
  }, { priority: 0 });
  scheduler.add(async () => {
    await new Promise((r) => setTimeout(r, 20));
    return 'mid';
  }, { priority: 0 });

  const results = await scheduler.run();

  assert.deepEqual(results.map((r) => r.value), ['fast', 'mid', 'slow']);
});
