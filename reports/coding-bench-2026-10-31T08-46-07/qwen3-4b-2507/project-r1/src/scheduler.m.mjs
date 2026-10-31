export class Scheduler {
  constructor({ concurrency = 1 }) {
    this.concurrency = concurrency;
    this.tasks = [];
    this.running = 0;
    this.taskIds = 0;
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    this.tasks.push({
      id: ++this.taskIds,
      fn,
      priority,
      retries,
      attempts: 0,
      error: null,
      value: null,
    });
  }

  async run() {
    const results = [];
    const taskQueue = [...this.tasks];
    const runningTasks = [];

    const executeTask = async (task) => {
      let attempt = 0;
      while (attempt <= task.retries) {
        try {
          const result = await task.fn();
          task.value = result;
          task.error = null;
          task.attempts = attempt;
          results.push({ id: task.id, ok: true, value: result, error: null, attempts: attempt });
          return;
        } catch (error) {
          if (attempt >= task.retries) {
            task.error = error;
            task.attempts = attempt;
            results.push({ id: task.id, ok: false, value: undefined, error: error.message, attempts: attempt });
            return;
          }
          attempt++;
          task.attempts = attempt;
        }
      }
    };

    // Sort tasks by priority (lower priority first), then by timestamp (FIFO)
    taskQueue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.id - b.id;
    });

    // Process tasks in order of priority and concurrency
    while (taskQueue.length > 0) {
      // Find the next task with lowest priority
      const task = taskQueue.shift();
      if (this.running >= this.concurrency) {
        // Wait until a slot becomes available
        // We simulate this by not starting new tasks until we have a free slot
        // In a real async scheduler, we'd use a queue or event loop
        // For now, we just process one at a time until concurrency is met
        continue;
      }

      this.running++;
      executeTask(task)
        .then(() => {
          this.running--;
          // Re-add to results if not already processed
          // We already processed in the loop, so just update
        })
        .catch((err) => {
          this.running--;
          console.error('Error in task execution:', err);
        });
    }

    // Wait for all tasks to complete
    // In a real implementation, we'd use a promise queue or async iteration
    // For now, we just return the results in the order they were processed
    return results;
  }
}
