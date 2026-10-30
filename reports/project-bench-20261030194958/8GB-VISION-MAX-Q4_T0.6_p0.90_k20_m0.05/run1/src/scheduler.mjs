import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency = 1 } = {}) {
    if (!Number.isFinite(concurrency) || concurrency < 1) {
      throw new Error('concurrency must be a positive number');
    }
    this.concurrency = concurrency;
    this.queue = new PriorityQueue();
    this.results = [];
    this._ids = 0;
    this._active = 0;
    this._finished = false;
    this._onComplete = null;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    const id = this._ids++;
    this.queue.enqueue({ id, fn, priority, retries }, priority);
    return id;
  }

  onResult(handler) {
    this._onComplete = handler;
  }

  async run() {
    this._finished = false;
    this.results = [];
    this._active = 0;

    const slots = new Array(this.concurrency).fill(null);

    const tryStart = () => {
      while (this._active < this.concurrency) {
        const next = this.queue.dequeue();
        if (!next) break;
        slots[this._active] = next;
        this._active++;
      }
      if (this._active === 0 && this.queue.size === 0) {
        this._finished = true;
      }
    };

    tryStart();

    while (this._active > 0) {
      await new Promise((resolve) => {
        const i = this._active - 1;
        const slot = slots[i];

        const runTask = async () => {
          let attempts = 0;
          let lastError;
          let ok = false;
          let value;

          while (attempts <= slot.retries) {
            try {
              value = await slot.fn();
              ok = true;
              break;
            } catch (err) {
              lastError = err;
              attempts++;
              if (attempts <= slot.retries) {
                await new Promise((r) => setTimeout(r, 0));
              }
            }
          }

          if (ok) {
            this.results.push({ id: slot.id, ok: true, value, attempts });
          } else {
            this.results.push({ id: slot.id, ok: false, error: lastError, attempts });
          }

          this._active--;
          slots[i] = null;

          if (this._onComplete) {
            this._onComplete(this.results[this.results.length - 1]);
          }
          resolve();
        };

        runTask();
      });

      tryStart();
    }

    return this.results;
  }
}
