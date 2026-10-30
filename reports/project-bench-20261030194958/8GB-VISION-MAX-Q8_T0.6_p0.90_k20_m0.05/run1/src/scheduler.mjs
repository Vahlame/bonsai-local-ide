import { PriorityQueue } from './priority-queue.mjs';

/**
 * Runs async tasks respecting priority and a concurrency limit.
 *
 * - Tasks are stored in a priority queue (priority-queue.mjs).
 * - At most `concurrency` tasks run at the same time.
 * - A task is retried up to `retries` times; if it still throws, the
 *   result is { ok: false, error }.
 * - Results are returned in order of completion.
 */
export class Scheduler {
  constructor({ concurrency = 1 } = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error('concurrency must be an integer >= 1');
    }
    this.concurrency = concurrency;
    this._pq = new PriorityQueue();
    this._maxActive = 0;
    this._active = 0;
    this._counter = 0;
    this._finished = [];
    this._stopped = false;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    if (typeof fn !== 'function') {
      throw new Error('fn must be a function');
    }
    const id = ++this._counter;
    const entry = { id, fn, priority, retries, attempts: 0 };
    this._pq.enqueue(entry, priority);
    return id;
  }

  async run() {
    this._stopped = false;
    this._active = 0;
    this._maxActive = 0;
    this._finished = [];

    const worker = async () => {
      while (true) {
        if (this._stopped) {
          return;
        }
        const entry = this._pq.dequeue();
        if (!entry) {
          return;
        }
        this._active++;
        if (this._active > this._maxActive) {
          this._maxActive = this._active;
        }
        try {
          const value = await entry.fn();
          this._finished.push({
            id: entry.id,
            ok: true,
            value,
            attempts: entry.attempts + 1,
          });
        } catch (err) {
          if (entry.attempts < entry.retries) {
            entry.attempts++;
            continue;
          }
          this._finished.push({
            id: entry.id,
            ok: false,
            error: err,
            attempts: entry.attempts + 1,
          });
        } finally {
          this._active--;
        }
      }
    };

    const workers = [];
    for (let i = 0; i < this.concurrency; i++) {
      workers.push(worker());
    }
    await Promise.all(workers);
    return this._finished;
  }

  get maxActive() {
    return this._maxActive;
  }
}
