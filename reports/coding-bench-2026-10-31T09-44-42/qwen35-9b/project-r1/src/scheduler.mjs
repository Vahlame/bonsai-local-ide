import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency = 1 }) {
    this.concurrency = concurrency;
    this.taskQueue = new PriorityQueue();
    this.activeTasks = new Set();
    this.results = [];
    this.taskIdCounter = 0;
  }

  add(fn, { priority = 0, retries = 0 }) {
    const id = this.taskIdCounter++;
    const task = { id, fn, priority, retries, attempts: 0 };
    this.taskQueue.enqueue(task, priority);
    return id;
  }

  async run() {
    const results = [];
    const activePromises = [];
    let activeCount = 0;

    while (this.taskQueue.size > 0 || activeCount < this.concurrency) {
      if (activeCount < this.concurrency && this.taskQueue.size > 0) {
        const task = this.taskQueue.dequeue();
        const promise = this._executeTask(task);
        activePromises.push(promise);
        activeCount++;
      } else if (activeCount === this.concurrency && activePromises.length > 0) {
        const nextIndex = activePromises.findIndex(p => p.status === 'pending');
        if (nextIndex === -1) {
          // All pending tasks are resolving or resolved
          await Promise.all(activePromises);
          activePromises.length = 0;
          activeCount = 0;
          continue;
        }
        // Wait for one to finish
        const resolvedPromise = await Promise.race(activePromises);
        activePromises.splice(nextIndex, 1);
        activeCount--;
      }
    }

    // Wait for remaining tasks to finish
    if (activePromises.length > 0) {
      await Promise.all(activePromises);
    }

    return results;
  }

  async _executeTask(task) {
    const { id, fn, retries, attempts } = task;
    let lastResult = { ok: false, error: null };
    let attempts = 0;

    while (attempts <= retries) {
      try {
        const result = await fn();
        lastResult = { ok: true, value: result, error: null, attempts: attempts + 1 };
        break;
      } catch (error) {
        attempts++;
        lastResult = { ok: false, error, attempts };
        if (attempts > retries) break;
      }
    }

    this.results.push({ id, ...lastResult });
  }
}
