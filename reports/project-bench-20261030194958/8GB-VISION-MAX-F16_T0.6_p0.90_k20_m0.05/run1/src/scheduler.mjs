import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency = 1 } = {}) {
    if (!Number.isFinite(concurrency) || concurrency < 1) {
      throw new RangeError('concurrency must be a number >= 1');
    }
    this.concurrency = concurrency;
    this.queue = new PriorityQueue();
    this.results = [];
    this.running = false;
    this.active = 0;
    this.maxActive = 0;
    this.finished = false;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    this.queue.enqueue(fn, priority);
  }

  async run() {
    this.running = true;
    this.active = 0;
    this.maxActive = 0;
    this.finished = false;
    this.results = [];

    while (this.queue.size > 0 || this.active > 0) {
      while (this.active < this.concurrency && this.queue.size > 0) {
        const fn = this.queue.dequeue();
        this.active++;
        this.maxActive = Math.max(this.maxActive, this.active);
        void this._runTask(fn);
      }

      // Wait for at least one running task to finish.
      await new Promise((resolve) => {
        this._waiters.push(resolve);
      });

      this.active = Math.max(0, this.active - 1);
      this._drain();
    }

    this.running = false;
    this.finished = true;
    return this.results;
  }

  async _runTask(fn) {
    let attempts = 0;
    let result = null;
    let ok = false;
    let value = undefined;
    let error = undefined;

    while (attempts <= this.queue.retries) {
      attempts++;
      try {
        value = await fn();
        ok = true;
        error = undefined;
        break;
      } catch (err) {
        error = err;
        if (attempts > this.queue.retries) {
          break;
        }
      }
    }

    const outcome = {
      id: fn.id,
      ok,
      value,
      error,
      attempts,
    };

    if (ok) {
      this.results.push({ ...outcome, ok: true });
    } else {
      this.results.push({ ...outcome, ok: false });
    }

    this._waiters.forEach((resolve) => resolve());
    this._waiters = [];
  }

  _drain() {
    while (this.active < this.concurrency && this.queue.size > 0) {
      const fn = this.queue.dequeue();
      this.active++;
      this.maxActive = Math.max(this.maxActive, this.active);
      void this._runTask(fn);
    }
  }
}
