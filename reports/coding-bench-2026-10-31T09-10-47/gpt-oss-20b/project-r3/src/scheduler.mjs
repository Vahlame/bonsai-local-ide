import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency }) {
    if (typeof concurrency !== 'number' || concurrency <= 0) {
      throw new Error('concurrency must be a positive number');
    }
    this.concurrency = concurrency;
    this._queue = new PriorityQueue();
    this._idCounter = 0;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    if (typeof fn !== 'function') {
      throw new Error('fn must be a function');
    }
    const id = ++this._idCounter;
    this._queue.enqueue({ id, fn, priority, retries }, priority);
    return id;
  }

  get size() {
    return this._queue.size;
  }

  async run() {
    const results = [];
    const tasks = [];
    while (!this._queue.isEmpty()) {
      tasks.push(this._queue.dequeue());
    }

    const runNext = async () => {
      if (tasks.length === 0) return;
      const task = tasks.shift();
      const res = await this._executeTask(task);
      results.push(res);
      await runNext();
    };

    const workers = [];
    const workerCount = Math.min(this.concurrency, tasks.length);
    for (let i = 0; i < workerCount; i++) {
      workers.push(runNext());
    }

    await Promise.all(workers);
    return results;
  }

  async _executeTask(task) {
    let attempts = 0;
    while (true) {
      attempts++;
      try {
        const value = await task.fn();
        return { id: task.id, ok: true, value, attempts };
      } catch (error) {
        if (attempts <= task.retries) continue;
        return { id: task.id, ok: false, error, attempts };
      }
    }
  }
}
