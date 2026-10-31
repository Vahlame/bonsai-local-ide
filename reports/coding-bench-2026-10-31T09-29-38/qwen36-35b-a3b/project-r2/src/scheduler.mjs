import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency }) {
    this.concurrency = concurrency;
    this._tasks = [];
    this._nextId = 0;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    this._tasks.push({ id: this._nextId++, fn, priority, retries });
  }

  async run() {
    const pq = new PriorityQueue();
    for (const task of this._tasks) {
      pq.enqueue(task, task.priority);
    }

    const results = [];
    const workers = [];
    const limit = Math.max(1, this.concurrency);

    for (let i = 0; i < limit; i++) {
      workers.push(this._worker(pq, results));
    }

    await Promise.all(workers);
    return results;
  }

  async _worker(pq, results) {
    while (pq.size > 0) {
      const task = pq.dequeue();
      const maxAttempts = task.retries + 1;
      let attempts = 0;
      let lastError;
      let value;
      let ok = false;

      for (let i = 0; i < maxAttempts; i++) {
        attempts = i + 1;
        try {
          value = await task.fn();
          ok = true;
          break;
        } catch (err) {
          lastError = err;
        }
      }

      results.push({
        id: task.id,
        ok,
        value: ok ? value : undefined,
        error: ok ? undefined : lastError,
        attempts
      });
    }
  }
}
