import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency }) {
    if (typeof concurrency !== 'number' || concurrency <= 0) {
      throw new Error('concurrency must be a positive number');
    }
    this._concurrency = concurrency;
    this._queue = new PriorityQueue();
    this._nextId = 1;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    if (typeof fn !== 'function') {
      throw new Error('fn must be a function');
    }
    const id = this._nextId++;
    this._queue.enqueue({ id, fn, retries }, priority);
  }

  async run() {
    const results = [];
    const workers = Array.from({ length: this._concurrency }, () => this._worker(results));
    await Promise.all(workers);
    return results;
  }

  async _worker(results) {
    while (true) {
      let task;
      try {
        task = this._queue.dequeue();
      } catch (_) {
        break; // queue empty
      }

      const { id, fn, retries } = task;
      let attempts = 0;
      let success = false;
      let value, error;

      while (attempts <= retries) {
        attempts++;
        try {
          value = await fn();
          success = true;
          break;
        } catch (e) {
          error = e;
        }
      }

      if (success) {
        results.push({ id, ok: true, value, attempts });
      } else {
        results.push({ id, ok: false, error, attempts });
      }
    }
  }
}
