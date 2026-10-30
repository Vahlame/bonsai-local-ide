import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  /**
   * Runs async tasks respecting priority, a concurrency ceiling, and a retry
   * budget. Results are returned in completion order.
   */
  constructor({ concurrency = 1 } = {}) {
    this.concurrency = concurrency;
    this.queue = new PriorityQueue();
    this.running = 0;
    this.results = [];
    this.active = new Set();
    this.nextId = 0;
    this._started = false;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    const id = ++this.nextId;
    this.queue.enqueue({ id, fn, priority, retries }, priority);
    return id;
  }

  async run() {
    if (this._started) {
      throw new Error('Scheduler.run() can only be called once');
    }
    this._started = true;

    while (this.queue.size > 0 || this.running > 0) {
      while (this.running < this.concurrency && this.queue.size > 0) {
        const { id, fn, priority, retries } = this.queue.dequeue();
        this.running += 1;
        this.active.add(id);
        void this._runTask(id, fn, retries).finally(() => {
          this.running -= 1;
          this.active.delete(id);
        });
      }
      if (this.queue.size > 0 || this.running > 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    return this.results;
  }

  async _runTask(id, fn, retries) {
    let attempts = 0;
    let value;
    let ok = false;
    let lastError;

    while (attempts <= retries) {
      try {
        value = await fn();
        ok = true;
        break;
      } catch (err) {
        lastError = err;
        attempts += 1;
        if (attempts <= retries) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    }

    const result = { id, ok, attempts };
    if (ok) {
      result.value = value;
    } else {
      result.error = lastError;
    }
    this.results.push(result);
  }
}
