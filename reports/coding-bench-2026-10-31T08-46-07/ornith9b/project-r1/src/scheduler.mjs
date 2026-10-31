import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency = 1 } = {}) {
    if (!Number.isFinite(concurrency) || concurrency < 1) {
      throw new Error('concurrency must be a positive number');
    }
    this.concurrency = concurrency;
    this._queue = new PriorityQueue();
    this._nextId = 0;
    this._running = 0;
    this._finished = [];
    this._done = false;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    if (typeof fn !== 'function') {
      throw new TypeError('fn must be a function');
    }
    const id = this._nextId++;
    const task = { id, fn, priority, retries };
    this._queue.enqueue(task, priority);
    return id;
  }

  async run() {
    this._done = true;
    while (this._running > 0 || this._queue.size > 0) {
      while (this._running < this.concurrency && this._queue.size > 0) {
        const task = this._queue.dequeue();
        this._running++;
        this._runTask(task)
          .then((result) => this._record(result))
          .catch((err) => this._record({ id: task.id, ok: false, error: err }));
      }
      await this._wait();
    }
  }

  _runTask(task) {
    const { id, fn, retries } = task;
    const attempts = retries + 1;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const value = await fn();
        return { id, ok: true, value };
      } catch (err) {
        lastError = err;
      }
    }
    return { id, ok: false, error: lastError };
  }

  _record(result) {
    this._finished.push(result);
    this._running--;
  }

  _wait() {
    return new Promise((resolve) => {
      if (this._running === 0) {
        resolve();
        return;
      }
      this._onFinish = resolve;
    });
  }

  get finished() {
    return this._finished;
  }
}
