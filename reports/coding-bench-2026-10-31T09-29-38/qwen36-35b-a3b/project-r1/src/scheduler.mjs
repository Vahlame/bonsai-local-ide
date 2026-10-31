import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency }) {
    this.concurrency = concurrency;
    this._tasks = [];
    this._nextId = 0;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    const id = this._nextId++;
    this._tasks.push({ id, fn, priority, retries });
  }

  async run() {
    const pq = new PriorityQueue();
    for (const task of this._tasks) {
      pq.enqueue(task, task.priority);
    }

    const results = [];
    const running = [];
    const limit = this.concurrency;

    const execute = async (task) => {
      let attempts = 0;
      let lastErr = undefined;
      while (attempts <= task.retries) {
        try {
          attempts++;
          const val = await task.fn();
          return { id: task.id, ok: true, value: val, attempts };
        } catch (e) {
          lastErr = e;
          attempts++;
        }
      }
      return { id: task.id, ok: false, error: lastErr, attempts };
    };

    while (pq.size > 0 || running.length > 0) {
      while (running.length < limit && pq.size > 0) {
        const task = pq.dequeue();
        const p = execute(task).then(res => {
          results.push(res);
          const idx = running.findIndex(r => r.task === task);
          if (idx !== -1) running.splice(idx, 1);
        });
        p.task = task;
        running.push(p);
      }

      if (running.length === 0) break;

      await Promise.race(running.map(p => p.then(() => p)));
    }

    return results;
  }
}
