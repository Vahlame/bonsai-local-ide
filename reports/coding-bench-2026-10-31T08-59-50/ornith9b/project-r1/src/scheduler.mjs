import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency = 1 } = {}) {
    this.concurrency = concurrency;
    this.queue = new PriorityQueue();
    this.results = [];
    this._idCounter = 0;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    const id = this._idCounter++;
    this.queue.enqueue({ id, fn, priority, retries }, priority);
    return id;
  }

  async run() {
    const results = [];
    let available = this.concurrency;

    const dispatch = () => {
      while (available > 0 && this.queue.size() > 0) {
        const task = this.queue.dequeue();
        available -= 1;
        const result = this._execute(task).then((r) => {
          results.push(r);
          available += 1;
          dispatch();
        });
        result.catch(() => {});
      }
    };

    dispatch();
    await this._waitAll();
    return results;
  }

  async _execute(task) {
    let attempts = 0;
    let lastError;
    while (attempts <= task.retries) {
      attempts += 1;
      try {
        const value = await task.fn();
        return { id: task.id, ok: true, value, attempts };
      } catch (error) {
        lastError = error;
      }
    }
    return { id: task.id, ok: false, error: lastError, attempts };
  }

  _waitAll() {
    return new Promise((resolve) => {
      if (this.queue.size() === 0 && this._running === 0) {
        resolve();
        return;
      }
      this._running += 1;
      const check = () => {
        if (this.queue.size() === 0 && this._running === 0) {
          this._running -= 1;
          resolve();
        } else {
          setTimeout(check, 0);
        }
      };
      setTimeout(check, 0);
    });
  }
}
