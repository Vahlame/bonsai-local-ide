import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency }) {
    this.concurrency = concurrency;
    this.queue = new PriorityQueue();
    this.idCounter = 0;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    const id = this.idCounter++;
    this.queue.enqueue({ id, fn, retries }, priority);
    return id;
  }

  async run() {
    const results = [];
    if (this.queue.size === 0) return results;

    const workers = Array.from({ length: this.concurrency }, async () => {
      while (this.queue.size > 0) {
        const task = this.queue.dequeue(); // { id, fn, retries }
        const { id, fn, retries } = task;
        let attempts = 0;
        while (true) {
          attempts++;
          try {
            const value = await fn();
            results.push({ id, ok: true, value, attempts });
            break;
          } catch (err) {
            if (attempts > retries) {
              results.push({ id, ok: false, error: err, attempts });
              break;
            }
          }
        }
      }
    });

    await Promise.all(workers);
    return results;
  }
}
