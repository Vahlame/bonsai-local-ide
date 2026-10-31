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
  }

  async run() {
    const results = [];
    let active = 0;
    let completed = 0;
    const total = this.queue.size;
    let resolveFn;

    const promise = new Promise((resolve) => {
      resolveFn = resolve;
    });

    const startNext = () => {
      while (active < this.concurrency && !this.queue.isEmpty()) {
        const task = this.queue.dequeue();
        active++;
        const { id, fn, retries } = task;

        const attemptTask = async () => {
          let attempts = 0;
          while (true) {
            attempts++;
            try {
              const value = await fn();
              active--;
              results.push({ id, ok: true, value, attempts });
              completed++;
              if (completed === total) resolveFn(results);
              startNext();
              return;
            } catch (err) {
              if (attempts > retries) {
                active--;
                results.push({ id, ok: false, error: err, attempts });
                completed++;
                if (completed === total) resolveFn(results);
                startNext();
                return;
              }
              // else retry
            }
          }
        };

        attemptTask();
      }
    };

    startNext();
    return promise;
  }
}
