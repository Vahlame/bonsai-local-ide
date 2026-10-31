import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency }) {
    this.concurrency = concurrency;
    this._tasks = [];
    this._idCounter = 0;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    const id = this._idCounter++;
    this._tasks.push({ id, fn, priority, retries });
  }

  async run() {
    const pq = new PriorityQueue();
    for (const task of this._tasks) {
      pq.enqueue(task, task.priority);
    }

    const results = [];
    const active = [];
    const concurrency = this.concurrency;

    const executeTask = async (task) => {
      let attempts = 0;
      let lastError = undefined;
      let value = undefined;
      let ok = false;

      while (attempts <= task.retries) {
        attempts++;
        try {
          value = await task.fn();
          ok = true;
          break;
        } catch (err) {
          lastError = err;
        }
      }

      const result = {
        id: task.id,
        ok,
        value,
        error: lastError,
        attempts
      };

      results.push(result);
      return result;
    };

    // Fill initial slots
    while (active.length < concurrency && pq.size > 0) {
      const task = pq.dequeue();
      const p = executeTask(task);
      active.push(p);
    }

    // Process as tasks complete
    while (active.length > 0 || pq.size > 0) {
      if (active.length === 0) break;

      // Wait for the first task to settle
      const [settled] = await Promise.race(
        active.map(p => p.then(v => ({ p, v })).catch(e => ({ p, e })))
      );

      // Remove from active
      const idx = active.indexOf(settled.p);
      if (idx !== -1) active.splice(idx, 1);

      // If there are still tasks in queue, start new ones
      while (active.length < concurrency && pq.size > 0) {
        const task = pq.dequeue();
        const p = executeTask(task);
        active.push(p);
      }
    }

    // Wait for remaining tasks to finish (if any)
    await Promise.all(active);

    return results;
  }
}
