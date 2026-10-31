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
  }

  async run() {
    const pq = new PriorityQueue();
    for (const task of this._tasks) {
      pq.enqueue(task, task.priority);
    }
    this._tasks = [];

    const results = [];
    const active = [];

    const runTask = async () => {
      if (pq.size === 0) return;
      const { id, fn, retries } = pq.dequeue();

      let attempts = 0;
      let lastError = null;
      let value = undefined;
      let ok = false;

      while (attempts <= retries) {
        attempts++;
        try {
          const res = await fn();
          ok = true;
          value = res;
          break;
        } catch (e) {
          lastError = e;
        }
      }

      active.push(
        Promise.resolve({ id, ok, value, error: lastError, attempts }).then((r) => {
          results.push(r);
        })
      );
    };

    for (let i = 0; i < this.concurrency; i++) {
      runTask();
    }

    await Promise.all(active);
    return results;
  }
}
