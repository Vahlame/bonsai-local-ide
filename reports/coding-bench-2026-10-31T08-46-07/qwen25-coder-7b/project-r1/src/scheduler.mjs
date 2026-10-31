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
    this.queue.enqueue({ fn, priority, retries, attempts: 0, id: this.idCounter++ });
  }

  async run() {
    while (this.queue.size > 0 || this.running > 0) {
      while (this.running < this.concurrency && this.queue.size > 0) {
        const { fn, retries, attempts, id } = this.queue.dequeue();
        this.running++;
        (async () => {
          try {
            const result = await fn();
            this.results.push({ id, ok: true, value: result });
          } catch (error) {
            if (attempts < retries) {
              this.queue.enqueue({ fn, retries, attempts: attempts + 1, id });
            } else {
              this.results.push({ id, ok: false, error });
            }
          } finally {
            this.running--;
          }
        })();
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return this.results;
  }
}

export { Scheduler };