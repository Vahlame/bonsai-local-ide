import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency }) {
    this.concurrency = concurrency;
    this.tasks = [];
    this.running = 0;
    this.idCounter = 0;
    this.results = [];
  }

  add(fn, { priority = 0, retries = 0 }) {
    const id = this.idCounter++;
    this.tasks.push({ id, fn, priority, retries });
  }

  async run() {
    const queue = new PriorityQueue();
    this.tasks.forEach(task => queue.enqueue(task, task.priority));

    while (queue.size > 0) {
      const task = queue.dequeue();

      if (this.running >= this.concurrency) {
        await new Promise(resolve => {
          const interval = setInterval(() => {
            if (this.running < this.concurrency) {
              clearInterval(interval);
              resolve();
            }
          }, 10);
        });
      }

      this.running++;
      const attempts = { id: task.id, ok: false, error: null, attempts: 0 };

      let result;
      let success = false;
      let error = null;

      for (let i = 0; i <= task.retries; i++) {
        try {
          result = await task.fn();
          success = true;
          break;
        } catch (err) {
          error = err;
          attempts.attempts++;
        }
      }

      this.running--;
      attempts.ok = success;
      if (success) {
        attempts.value = result;
      } else {
        attempts.error = error;
      }

      this.results.push(attempts);
    }

    return this.results;
  }
}