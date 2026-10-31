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

    const executeTask = async (task) => {
      let attempts = 0;
      let result;

      while (attempts <= task.retries) {
        try {
          const value = await task.fn();
          result = { ok: true, value };
          break;
        } catch (error) {
          attempts++;
          if (attempts > task.retries) {
            result = { ok: false, error };
          }
        }
      }

      this.results.push({
        id: task.id,
        ok: result.ok,
        value: result.value,
        error: result.error,
        attempts: attempts
      });
    };

    const runTasks = async () => {
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
        await executeTask(task);
        this.running--;
      }
    };

    await runTasks();
    return this.results;
  }
}