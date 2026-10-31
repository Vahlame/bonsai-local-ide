import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency }) {
    this.concurrency = concurrency;
    this._tasks = [];
    this._idCounter = 0;
  }

  add(fn, { priority = 0, retries = 0 }) {
    this._tasks.push({ fn, priority, retries, id: ++this._idCounter });
  }

  async run() {
    const pq = new PriorityQueue();
    for (const t of this._tasks) {
      pq.enqueue(t, t.priority);
    }

    const results = [];
    const active = [];

    const runTask = async (task) => {
      let attempts = 0;
      const maxAttempts = task.retries + 1;
      while (attempts < maxAttempts) {
        attempts++;
        try {
          const value = await task.fn();
          return { id: task.id, ok: true, value, attempts };
        } catch (error) {
          if (attempts === maxAttempts) {
            return { id: task.id, ok: false, error, attempts };
          }
        }
      }
    };

    const spawn = () => {
      while (active.length < this.concurrency && pq.size > 0) {
        const task = pq.dequeue();
        const promise = runTask(task).then((res) => {
          results.push(res);
          active.splice(active.indexOf(promise), 1);
          spawn();
        });
        active.push(promise);
      }
    };

    spawn();
    await Promise.all(active);
    return results;
  }
}
