import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../src/scheduler.mjs';

test('respects concurrency limit (measures max simultaneous)', async () => {
  let active = 0;
  let maxActive = 0;
  const scheduler = new Scheduler({ concurrency: 2 });
  for (let i = 0; i < 10; i++) {
    scheduler.add(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
    });
  }
  const results = await scheduler.run();
  assert.equal(maxActive, 2);
  assert.equal(results.length, 10);
  assert.ok(results.every((r) => r.ok));
});

test('runs at least one task at a time by default', async () => {
  let active = 0;
  let maxActive = 0;
  const scheduler = new Scheduler({ concurrency: 1 });
  for (let i = 0; i < 3; i++) {
    scheduler.add(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    });
  }
  await scheduler.run();
  assert.equal(maxActive, 1);
});

test('retries until success after 2 failures', async () => {
  let attempts = 0;
  const scheduler = new Scheduler({ concurrency: 1 });
  scheduler.add(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new Error('temporary');
    }
    return 'done';
  }, { priority: 0, retries: 2 });

  const results = await scheduler.run();
  assert.equal(results.length, 1);
  const [result] = results;
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.equal(result.value, 'done');
});

test('reports definitive failure when retries exhausted', async () => {
  const scheduler = new Scheduler({ concurrency: 1 });
  scheduler.add(async () => {
    throw new Error('permanent');
  }, { priority: 0, retries: 2 });

  const results = await scheduler.run();
  const [result] = results;
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 3);
  assert.equal(result.error.message, 'permanent');
  assert.equal(result.value, undefined);
});

test('retries=0 runs fn exactly once and surfaces the failure', async () => {
  const scheduler = new Scheduler({ concurrency: 1 });
  scheduler.add(async () => {
    throw new Error('once');
  }, { priority: 0, retries: 0 });

  const results = await scheduler.run();
  const [result] = results;
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 1);
  assert.equal(result.error.message, 'once');
});

test('returns results in completion order by duration', async () => {
  const order = [];
  const scheduler = new Scheduler({ concurrency: 4 });
  scheduler.add(async () => {
    await new Promise((resolve) => setTimeout(() => order.push('long'), 100));
  }, { priority: 0, retries: 0 });
  scheduler.add(async () => {
    await new Promise((resolve) => setTimeout(() => order.push('short'), 10));
  }, { priority: 0, retries: 0 });
  scheduler.add(async () => {
    await new Promise((resolve) => setTimeout(() => order.push('mid'), 50));
  }, { priority: 0, retries: 0 });

  const results = await scheduler.run();
  assert.deepEqual(order, ['short', 'mid', 'long']);
  // Completion order matches the pushed order.
  assert.deepEqual(results.map((r) => r.id), [2, 3, 1]);
});

test('priority ordering is honored across concurrent runs', async () => {
  const results = await new Scheduler({ concurrency: 4 }).run();
  assert.deepEqual(results.map((r) => r.id), [1, 2, 3, 4]);
});
