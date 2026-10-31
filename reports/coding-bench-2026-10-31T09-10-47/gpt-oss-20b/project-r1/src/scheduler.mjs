import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency }) {
    if (typeof concurrency !== 'number' || concurrency <= 0) {
      throw new Error('concurrency must be a positive number');
    }
    this.concurrency = concurrency;
    this._queue = new PriorityQueue();
    this._idCounter = 0;
    this._tasks = [];
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    if (typeof fn !== 'function') throw new Error('fn must be a function');
    const id = this._idCounter++;
    const task = { id, fn, priority, retries };
    this._queue.enqueue(task, priority);
    this._tasks.push(task);
  }

  async run() {
    const results = [];
    let running = 0;
    const total = this._tasks.length;
    const taskMap = new Map(); // id -> task

    // Helper to start next tasks
    const startNext = () => {
      while (running < this.concurrency && this._queue.size > 0) {
        const task = this._queue.dequeue();
        taskMap.set(task.id, task);
        running++;
        this._executeTask(task)
          .then((res) => {
            results.push(res);
          })
          .finally(() => {
            running--;
            startNext();
          });
      }
    };

    // Execute a single task with retries
    const self = this;
    this._executeTask = async function (task) {
      let attempts = 0;
      while (true) {
        attempts++;
        try {
          const value = await task.fn();
          return {
            id: task.id,
            ok: true,
            value,
            attempts,
          };
        } catch (err) {
          if (attempts > task.retries) {
            return {
              id: task.id,
              ok: false,
              error: err,
              attempts,
            };
          }
          // else retry
        }
      }
    };

    // Start initial batch
    startNext();

    // Wait until all tasks finished
    while (results.length < total) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    return results;
  }
}
