import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency }) {
    if (typeof concurrency !== 'number' || concurrency <= 0) {
      throw new Error('concurrency must be a positive number');
    }
    this.concurrency = concurrency;
    this._queue = new PriorityQueue();
    this._idCounter = 0;
    this._tasks = []; // store task metadata for reference
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    if (typeof fn !== 'function') {
      throw new Error('fn must be a function');
    }
    const id = this._idCounter++;
    const task = { id, fn, priority, retries };
    this._tasks.push(task);
    this._queue.enqueue(task, priority);
  }

  async run() {
    const results = [];
    let active = 0;
    let finished = 0;
    const total = this._tasks.length;

    return new Promise((resolve, reject) => {
      const startNext = () => {
        while (active < this.concurrency && this._queue.size > 0) {
          const task = this._queue.dequeue();
          active++;
          this._executeTask(task)
            .then((res) => {
              results.push(res);
            })
            .catch((err) => {
              // Should not happen; _executeTask handles errors
              reject(err);
            })
            .finally(() => {
              active--;
              finished++;
              if (finished === total) {
                resolve(results);
              } else {
                startNext();
              }
            });
        }
      };

      startNext();
    });
  }

  async _executeTask(task) {
    const { id, fn, retries } = task;
    let attempts = 0;
    while (true) {
      try {
        const value = await fn();
        return { id, ok: true, value, attempts: attempts + 1 };
      } catch (e) {
        attempts++;
        if (attempts > retries) {
          return { id, ok: false, error: e, attempts };
        }
        // else retry
      }
    }
  }
}
