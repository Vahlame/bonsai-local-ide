import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency }) {
    if (typeof concurrency !== 'number' || concurrency <= 0) {
      throw new Error('concurrency must be a positive number');
    }
    this.concurrency = concurrency;
    this.tasks = [];
    this.idCounter = 0;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    if (typeof fn !== 'function') {
      throw new Error('fn must be a function');
    }
    const id = this.idCounter++;
    this.tasks.push({ id, fn, priority, retries });
  }

  async run() {
    const pq = new PriorityQueue();
    for (const t of this.tasks) {
      pq.enqueue(t, t.priority);
    }

    const results = [];
    const total = this.tasks.length;
    let running = 0;

    const allDone = new Promise((resolve) => {
      const checkDone = () => {
        if (results.length === total) resolve();
      };

      const startNext = () => {
        while (running < this.concurrency && pq.size > 0) {
          const task = pq.dequeue();
          running++;
          this._runTask(task).then((res) => {
            results.push(res);
            running--;
            checkDone();
            startNext();
          });
        }
      };

      startNext();
    });

    await allDone;
    return results;
  }

  async _runTask(task) {
    let attempts = 0;
    while (true) {
      attempts++;
      try {
        const value = await task.fn();
        return { id: task.id, ok: true, value, attempts };
      } catch (err) {
        if (attempts > task.retries) {
          return { id: task.id, ok: false, error: err, attempts };
        }
      }
    }
  }
}
