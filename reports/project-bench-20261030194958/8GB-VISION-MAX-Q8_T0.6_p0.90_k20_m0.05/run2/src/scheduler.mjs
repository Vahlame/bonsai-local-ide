import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency = 1 } = {}) {
    if (!(concurrency >= 1)) {
      throw new Error('concurrency must be >= 1');
    }
    this.concurrency = concurrency;
    this.queue = new PriorityQueue();
    this.idCounter = 0;
    this.results = [];
    this.running = 0;
    this._runScheduled = false;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    if (typeof fn !== 'function') {
      throw new Error('fn must be a function');
    }
    const id = this.idCounter++;
    this.queue.enqueue({ id, fn, priority, retries }, priority);
  }

  async run() {
    this.results = [];
    this.running = 0;
    this._runScheduled = false;

    const dispatch = (task) => {
      this.running += 1;
      Promise.resolve()
        .then(() => task.fn())
        .then(
          (value) => this._finish(task, value),
          (error) => this._retry(task, error)
        )
        .finally(() => {
          this.running -= 1;
          this._maybeSchedule();
        });
    };

    const maybeSchedule = () => {
      if (!this._runScheduled && this.queue.size > 0) {
        this._runScheduled = true;
        queueMicrotask(() => this._drain());
      }
    };

    this._drain = () => {
      while (this.running < this.concurrency && this.queue.size > 0) {
        const task = this.queue.dequeue();
        dispatch(task);
      }
      maybeSchedule();
    };

    this._maybeSchedule = maybeSchedule;
    this._drain();
  }

  _finish(task, value) {
    this.results.push({
      id: task.id,
      ok: true,
      value,
      attempts: 1,
    });
  }

  _retry(task, error) {
    if (task.retries > 0) {
      task.retries -= 1;
      queueMicrotask(() => this._drain());
      return;
    }
    this.results.push({
      id: task.id,
      ok: false,
      error,
      attempts: task.retries + 2,
    });
  }
}
