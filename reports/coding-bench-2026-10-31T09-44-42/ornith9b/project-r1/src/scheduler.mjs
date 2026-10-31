import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency = 1 }) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error('concurrency must be a positive integer');
    }
    this.concurrency = concurrency;
    this.queue = new PriorityQueue();
    this._idCounter = 0;
    this._running = 0;
    this._finished = [];
    this._stopped = false;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    const id = this._idCounter++;
    this.queue.enqueue({ id, fn, priority, retries }, priority);
    return id;
  }

  async run() {
    this._stopped = false;
    this._finished = [];
    this._running = 0;

    const workers = [];
    for (let i = 0; i < this.concurrency; i++) {
      workers.push(this._worker());
    }

    await Promise.all(workers);
    return this._finished;
  }

  _worker() {
    return async () => {
      while (true) {
        if (this._stopped) {
          return;
        }
        const task = this.queue.dequeue();
        if (!task) {
          break;
        }

        this._running++;
        try {
          let attempts = 0;
          let ok = false;
          let value;
          let error;
          while (attempts <= task.retries) {
            attempts++;
            try {
              const result = task.fn(task.id);
              value = await result;
              ok = true;
              break;
            } catch (err) {
              error = err;
            }
          }
          this._finished.push({
            id: task.id,
            ok,
            value: ok ? value : undefined,
            error: ok ? undefined : error,
            attempts,
          });
        } catch (err) {
          this._finished.push({
            id: task.id,
            ok: false,
            value: undefined,
            error: err,
            attempts,
          });
        } finally {
          this._running--;
        }
      }
    };
  }
}
