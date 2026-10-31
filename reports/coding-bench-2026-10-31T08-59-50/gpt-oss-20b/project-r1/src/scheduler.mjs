import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency }) {
    if (typeof concurrency !== 'number' || concurrency <= 0) {
      throw new Error('concurrency must be a positive number');
    }
    this.concurrency = concurrency;
    this._tasks = [];
    this._nextId = 1;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    if (typeof fn !== 'function') {
      throw new Error('fn must be a function');
    }
    const task = {
      id: this._nextId++,
      fn,
      priority,
      retries: Math.max(0, retries),
    };
    this._tasks.push(task);
    return task.id;
  }

  async run() {
    const pq = new PriorityQueue();
    for (const task of this._tasks) {
      pq.enqueue(task, task.priority);
    }

    const results = [];
    let running = 0;

    return new Promise((resolve) => {
      const startNext = () => {
        if (pq.size === 0 && running === 0) {
          resolve(results);
          return;
        }

        while (running < this.concurrency && pq.size > 0) {
          const task = pq.dequeue();
          running++;
          this._executeTask(task, 1)
            .then((res) => {
              results.push(res);
            })
            .finally(() => {
              running--;
              startNext();
            });
        }
      };

      startNext();
    });
  }

  async _executeTask(task, attempt) {
    try {
      const value = await task.fn();
      return {
        id: task.id,
        ok: true,
        value,
        attempts: attempt,
      };
    } catch (err) {
      if (attempt < task.retries + 1) {
        return this._executeTask(task, attempt + 1);
      }
      return {
        id: task.id,
        ok: false,
        error: err,
        attempts: attempt,
      };
    }
  }
}
