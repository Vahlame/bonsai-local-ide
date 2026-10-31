import { PriorityQueue } from './priority-queue.mjs';

class Scheduler {
  constructor({ concurrency }) {
    this.concurrency = concurrency;
    this.queue = new PriorityQueue();
    this.running = 0;
    this.results = [];
    this.idCounter = 0;
  }

  add(fn, { priority = 0, retries = 0 }) {
    this.queue.enqueue({ fn, priority, retries, attempts: 0 }, priority);
  }

  async run() {
    while (this.queue.size > 0 || this.running > 0) {
      while (this.running < this.concurrency && this.queue.size > 0) {
        const { fn, retries, attempts, id } = this.queue.dequeue();
        this.running++;
        this.idCounter++;
        this.executeTask(fn, retries, attempts, id);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return this.results;
  }

  async executeTask(fn, retries, attempts, id) {
    try {
      const result = await fn();
      this.results.push({ id, ok: true, value: result });
    } catch (error) {
      attempts++;
      if (attempts <= retries) {
        this.queue.enqueue({ fn, retries, attempts, id }, 0);
      } else {
        this.results.push({ id, ok: false, error });
      }
    } finally {
      this.running--;
    }
  }
}

export { Scheduler };