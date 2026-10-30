import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scheduler } from '../src/scheduler.mjs';

test('runs tasks respecting priority and reports completion order', async () => {
  const scheduler = new Scheduler({ concurrency: 2 });
  const order = [];

  scheduler.add(async () => {
    order.push('low');
    return 'low-done';
  }, { priority: 0 });

  scheduler.add(async () => {
    order.push('high');
    return 'high-done';
  }, { priority: 10 });

  scheduler.add(async () => {
    order.push('mid');
    return 'mid-done';
  }, { priority: 5 });

  const results = await scheduler.run();

  assert.equal(results.length, 3);
  assert.deepEqual(
    results.map((r) => r.ok),
    [true, true, true]
  );
  // Highest priority finishes first.
  assert.equal(results[0].id, 'high');
  assert.equal(results[1].id, 'mid');
  assert.equal(results[2].id, 'low');
});

test('never exceeds concurrency limit', async () => {
  const concurrency = 3;
  const scheduler = new Scheduler({ concurrency });
  let maxActive = 0;
  let active = 0;
  let peak = 0;

  for (let i = 0; i < 20; i++) {
    scheduler.add(
      async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return 'ok';
      },
      { priority: i }
    );
  }

  const results = await scheduler.run();

  assert.equal(results.length, 20);
  assert.equal(peak, concurrency);
  assert.ok(peak <= concurrency, `peak ${peak} exceeded concurrency ${concurrency}`);
});

test('retries failed task and succeeds on the third attempt', async () => {
  const scheduler = new Scheduler({ concurrency: 1 });
  let attempts = 0;

  scheduler.add(
    async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error(`fail ${attempts}`);
      }
      return 'success';
    },
    { retries: 2 }
  );

  const results = await scheduler.run();

  assert.equal(results.length, 1);
  const result = results[0];
  assert.equal(result.ok, true);
  assert.equal(result.value, 'success');
  assert.equal(result.attempts, 3);
  assert.equal(result.error, undefined);
});

test('task that always fails returns ok:false with error and attempts', async () => {
  const scheduler = new Scheduler({ concurrency: 1 });
  scheduler.add(
    async () => {
      throw new Error('boom');
    },
    { retries: 2 }
  );

  const results = await scheduler.run();

  const result = results[0];
  assert.equal(result.ok, false);
  assert.equal(result.error.message, 'boom');
  assert.equal(result.attempts, 3);
  assert.equal(result.value, undefined);
});

test('results are ordered by completion time', async () => {
  const scheduler = new Scheduler({ concurrency: 2 });

  scheduler.add(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return 'slow';
    },
    { priority: 1 }
  );

  scheduler.add(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 'fast';
    },
    { priority: 2 }
  );

  scheduler.add(
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return 'mid';
    },
    { priority: 3 }
  );

  const results = await scheduler.run();

  // Completion order reflects how long each took, not priority.
  assert.equal(results[0].value, 'fast');
  assert.equal(results[1].value, 'mid');
  assert.equal(results[2].value, 'slow');
});
