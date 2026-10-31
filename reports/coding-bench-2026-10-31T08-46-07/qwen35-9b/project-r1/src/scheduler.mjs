import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  #queue = new PriorityQueue();
  #concurrency;
  #running = 0;
  #results = [];
  #nextId = 1;
  #runningPromises = [];

  constructor({ concurrency = 1 }) {
    this.#concurrency = concurrency;
  }

  add(fn, { priority = 0, retries = 0 }) {
    const id = this.#nextId++;
    const task = { id, fn, priority, retries, attempts: 0 };
    this.#queue.enqueue(task, priority);
    return id;
  }

  async run() {
    const results = [];

    while (this.#queue.size > 0 || this.#runningPromises.length > 0) {
      while (this.#running < this.#concurrency && this.#queue.size > 0) {
        const task = this.#queue.dequeue();
        const promise = this.#executeTask(task);
        this.#runningPromises.push({ task, promise });
        this.#running++;
      }

      await Promise.race(this.#runningPromises.map(p => p.promise));
      this.#runningPromises = this.#runningPromises.filter(p => !p.promise.resolved);
      this.#running--;
    }

    return results;
  }

  #executeTask(task) {
    return (async () => {
      let lastError = null;
      let lastValue = null;

      for (let attempt = 0; attempt <= task.retries; attempt++) {
        task.attempts = attempt + 1;
        try {
          const result = await task.fn();
          lastValue = result;
          return { id: task.id, ok: true, value: result, error: null, attempts: task.attempts };
        } catch (error) {
          lastError = error;
          if (attempt < task.retries) {
            continue;
          }
        }
      }

      return { id: task.id, ok: false, value: lastValue, error: lastError, attempts: task.attempts };
    })();
  }
}
