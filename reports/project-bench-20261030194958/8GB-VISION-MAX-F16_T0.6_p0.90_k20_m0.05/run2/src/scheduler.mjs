export class Scheduler {
  #concurrency;
  #waiting = [];
  #running = new Set();
  #idCounter = 0;
  #started = false;
  #resolve = () => {};

  constructor({ concurrency = 1 } = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new RangeError('concurrency must be a positive integer');
    }
    this.#concurrency = concurrency;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    const task = { id: ++this.#idCounter, fn, priority, retries };
    this.#waiting.push(task);
    if (!this.#started) {
      this.#started = true;
      this.#pump();
    }
    return task.id;
  }

  run() {
    this.#started = true;
    this.#pump();
    return new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  #pump() {
    while (this.#running.size < this.#concurrency && this.#waiting.length > 0) {
      const task = this.#waiting.shift();
      this.#running.add(task.id);
      this.#dispatch(task);
    }
  }

  #dispatch(task) {
    const result = { id: task.id, ok: false, attempts: 0 };
    const execute = async () => {
      let lastError;
      for (let attempt = 0; attempt <= task.retries; attempt++) {
        result.attempts = attempt + 1;
        try {
          const value = await task.fn();
          result.ok = true;
          result.value = value;
          return;
        } catch (err) {
          lastError = err;
        }
      }
      result.error = lastError;
    };
    execute().finally(() => {
      this.#running.delete(task.id);
      this.#results.push(result);
      this.#resolve();
      this.#pump();
    });
  }

  get results() {
    return this.#results;
  }
}
