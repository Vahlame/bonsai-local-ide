```mjs
import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency }) {
    this.concurrency = concurrency;
    this.tasks = [];
    this.running = 0;
    this.results = [];
    this.nextId = 1;
  }

  add(fn, { priority = 0, retries = 0 }) {
    this.tasks.push({
      fn,
      priority,
      retries,
      id: this.nextId++
    });
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

      return { id: task.id, ok: result.ok, value: result.value, error: result.error, attempts };
    };

    const runTasks = async () => {
      while (queue.size > 0) {
        if (this.running >= this.concurrency) {
          await new Promise(resolve => setTimeout(resolve, 10));
          continue;
        }

        const task = queue.dequeue();
        this.running++;

        const taskResult = await executeTask(task);
        this.results.push(taskResult);

        this.running--;
      }
    };

    await runTasks();
    return this.results;
  }
}
```
