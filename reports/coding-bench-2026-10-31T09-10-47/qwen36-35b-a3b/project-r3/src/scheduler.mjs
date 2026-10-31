import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency }) {
    this.concurrency = concurrency;
    this._tasks = [];
    this._nextId = 0;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    const id = this._nextId++;
    this._tasks.push({ id, fn, priority, retries });
    return id;
  }

  async _runTask(task) {
    let attempts = 0;
    let lastError = null;

    while (attempts <= task.retries) {
      try {
        const value = await task.fn();
        return { id: task.id, ok: true, value, attempts: attempts + 1 };
      } catch (err) {
        lastError = err;
        attempts++;
      }
    }

    return { id: task.id, ok: false, error: lastError, attempts };
  }

  async run() {
    const pq = new PriorityQueue();
    for (const task of this._tasks) {
      pq.enqueue(task, task.priority);
    }

    const results = [];
    const active = [];

    while (pq.size > 0 || active.length > 0) {
      while (active.length < this.concurrency && pq.size > 0) {
        const task = pq.dequeue();
        const p = this._runTask(task);
        active.push(p);
      }

      if (active.length === 0) break;

      const settledPromise = await Promise.race(active);
      const result = await settledPromise;
      results.push(result);
      active.splice(active.indexOf(settledPromise), 1);
    }

    return results;
  }
}
