import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../src/scheduler.mjs';

test('never runs more than concurrency tasks at once', async () => {
  const scheduler = new Scheduler({ concurrency: 2 });
  let maxSimultaneous = 0;
  let active = 0;
  const results = [];

  const addTask = (delay) => {
    return scheduler.add(async () => {
      active++;
      maxSimultaneous = Math.max(maxSimultaneous, active);
      await new Promise((r) => setTimeout(r, delay));
      active--;
      return 'done';
    });
  };

  for (let i = 0; i < 6; i++) {
    addTask(10);
  }

  const promise = scheduler.run();
  await promise;

  assert.equal(maxSimultaneous, 2);
  assert.deepEqual(results, ['done', 'done', 'done', 'done', 'done', 'done']);
});

test('retries twice then succeeds', async () => {
  const scheduler = new Scheduler({ concurrency: 1 });
  let attempts = 0;
  const results = [];

  scheduler.add(async () => {
    attempts++;
    if (attempts < 3) {
      throw new Error('boom');
    }
    return 'ok';
  }, { retries: 2 });

  await scheduler.run();

  assert.deepEqual(results[0], { id: 1, ok: true, value: 'ok', attempts: 3 });
});

test('definitive failure returns ok:false with error', async () => {
  const scheduler = new Scheduler({ concurrency: 1 });
  const results = [];

  scheduler.add(async () => {
    throw new Error('permanent');
  }, { retries: 2 });

  await scheduler.run();

  assert.deepEqual(results[0], {
    id: 1,
    ok: false,
    attempts: 3,
    error: new Error('permanent'),
  });
});

test('results are ordered by completion duration', async () => {
  const scheduler = new Scheduler({ concurrency: 1 });
  const results = [];

  scheduler.add(async () => {
    await new Promise((r) => setTimeout(r, 50));
    return 'last';
  }, { priority: 1 });

  scheduler.add(async () => {
    await new Promise((r) => setTimeout(r, 10));
    return 'first';
  }, { priority: 0 });

  await scheduler.run();

  assert.deepEqual(results, ['first', 'last']);
});

test('priority ordering across tasks', async () => {
  const scheduler = new Scheduler({ concurrency: 1 });
  const results = [];

  scheduler.add(async () => {
    await new Promise((r) => setTimeout(r, 5));
    return 'low';
  }, { priority: 0 });

  scheduler.add(async () => {
    await new Promise((r) => setTimeout(r, 5));
    return 'high';
  }, { priority: 5 });

  await scheduler.run();

  assert.deepEqual(results, ['high', 'low']);
});
