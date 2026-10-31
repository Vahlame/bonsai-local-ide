export class Scheduler {
  constructor({ concurrency = 1 }) {
    this.concurrency = concurrency;
    this._tasks = [];
    this._nextId = 0;
    this._running = 0;
    this._waiters = [];
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    const id = this._nextId++;
    this._tasks.push({ id, fn, priority, retries });
  }

  async run() {
    const results = [];
    const running = new Set();

    const worker = async (task) => {
      let attempts = 0;
      let value;
      let error;
      let ok = false;
      while (attempts <= task.retries) {
        attempts++;
        try {
          value = await task.fn();
          ok = true;
          break;
        } catch (e) {
          error = e;
        }
        if (attempts > task.retries) {
          break;
        }
      }
      results.push({ id: task.id, ok, value, error, attempts });
    };

    for (const task of this._tasks) {
      if (this._running >= this.concurrency) {
        await this._wait();
      }
      this._running++;
      const p = worker(task);
      p.catch(() => {});
      running.add(task.id);
    }

    await Promise.all(running);
    this._running = 0;
    return results;
  }

  _wait() {
    return new Promise((resolve) => {
      this._waiters.push(resolve);
    });
  }
}
