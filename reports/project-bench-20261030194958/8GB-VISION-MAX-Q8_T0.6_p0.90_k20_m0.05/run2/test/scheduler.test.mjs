import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../src/scheduler.mjs';

test('respects priority ordering', async () => {
  const scheduler = new Scheduler({ concurrency: 1 });
  scheduler.add(async () => 'low', { priority: 1 });
  scheduler.add(async () => 'high', { priority: 10 });
  scheduler.add(async () => 'mid', { priority: 5 });
  const results = await scheduler.run();
  assert.deepEqual(results.map((r) => r.value), ['high', 'mid', 'low']);
});

test('never runs more than concurrency tasks at once', async () => {
  const scheduler = new Scheduler({ concurrency: 2 });
  let maxSimultaneous = 0;
  let active = 0;
  for (let i = 0; i < 10; i++) {
    scheduler.add(async () => {
      active += 1;
      maxSimultaneous = Math.max(maxSimultaneous, active);
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
      active -= 1;
      return i;
    });
  }
  const results = await scheduler.run();
  assert.equal(maxSimultaneous, 2);
  assert.deepEqual(results.map((r) => r.value), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('retries twice and then succeeds', async () => {
  const scheduler = new Scheduler({ concurrency: 1 });
  let attempts = 0;
  scheduler.add(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new Error('transient');
    }
    return 'ok';
  }, { retries: 2 });
  const results = await scheduler.run();
  const result = results[0];
  assert.equal(result.ok, true);
  assert.equal(result.value, 'ok');
  assert.equal(result.attempts, 3);
});

test('definitive failure returns ok:false with error', async () => {
  const scheduler = new Scheduler({ concurrency: 1 });
  scheduler.add(async () => {
    throw new Error('boom');
  }, { retries: 2 });
  const results = await scheduler.run();
  const result = results[0];
  assert.equal(result.ok, false);
  assert.equal(result.error.message, 'boom');
  assert.equal(result.attempts, 3);
});

test('results are ordered by completion duration', async () => {
  const scheduler = new Scheduler({ concurrency: 1 });
  scheduler.add(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return 'slow';
  });
  scheduler.add(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return 'fast';
  });
  const results = await scheduler.run();
  assert.deepEqual(results.map((r) => r.value), ['fast', 'slow']);
});
