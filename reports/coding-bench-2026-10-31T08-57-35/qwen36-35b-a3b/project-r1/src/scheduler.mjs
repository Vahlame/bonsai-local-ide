import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency }) {
    this.concurrency = Math.max(1, concurrency);
    this.tasks = [];
    this._nextId = 0;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    const id = ++this._nextId;
    this.tasks.push({ id, fn, priority, retries });
  }

  async run() {
    const pq = new PriorityQueue();
    for (const task of this.tasks) {
      pq.enqueue(task, task.priority);
    }

    const results = [];
    const workers = [];

    for (let i = 0; i < this.concurrency; i++) {
      workers.push(this._worker(pq, results));
    }

    await Promise.all(workers);
    return results;
  }

  async _worker(queue, results) {
    while (queue.size > 0) {
      const { id, fn, retries } = queue.dequeue();
      let attempts = 0;
      let lastError = null;
      let value = undefined;
      let ok = false;

      while (attempts <= retries) {
        attempts++;
        try {
          const res = await fn();
          value = res;
          ok = true;
          break;
        } catch (err) {
          lastError = err;
        }
      }

      results.push({ id, ok, value, error: lastError, attempts });
    }
  }
}
