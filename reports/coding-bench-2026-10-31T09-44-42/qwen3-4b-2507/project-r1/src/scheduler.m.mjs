export class Scheduler {
  constructor({ concurrency = 1 }) {
    this.concurrency = concurrency;
    this.tasks = [];
    this.running = 0;
    this.taskMap = new Map();
  }

  add(fn, { priority = 0, retries = 0 } = {}) {
    const id = this.tasks.length;
    this.tasks.push({
      id,
      fn,
      priority,
      retries,
      attempts: 0,
      result: null,
      error: null
    });
    return id;
  }

  async run() {
    const results = [];
    const taskQueue = [...this.tasks];
    const activeTasks = [];

    const executeTask = async (task) => {
      try {
        task.attempts++;
        const result = await task.fn();
        task.result = result;
        task.error = null;
        results.push({ id: task.id, ok: true, value: result, attempts: task.attempts });
      } catch (error) {
        if (task.attempts < task.retries) {
          task.error = error;
          task.attempts++;
          // Reintenta con el mismo id, pero en cola
          this.scheduleTask(task);
        } else {
          task.error = error;
          results.push({ id: task.id, ok: false, error: error, attempts: task.attempts });
        }
      }
    };

    const scheduleTask = (task) => {
      const priorityIndex = taskQueue.findIndex(t => t.priority === task.priority);
      if (priorityIndex === -1) {
        taskQueue.push(task);
      } else {
        taskQueue.splice(priorityIndex, 0, task);
      }
      taskQueue.sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return a.attempts - b.attempts;
      });
    };

    // Enviar tareas en orden de prioridad
    while (taskQueue.length > 0) {
      const task = taskQueue.shift();
      if (this.running >= this.concurrency) {
        // Esperar hasta que haya espacio
        await new Promise(resolve => setTimeout(resolve, 0));
        continue;
      }

      this.running++;
      executeTask(task)
        .then(() => {
          this.running--;
          // Si hay más tareas, continuar
          if (taskQueue.length > 0) {
            const nextTask = taskQueue.shift();
            if (nextTask) {
              this.running++;
              executeTask(nextTask)
                .then(() => {
                  this.running--;
                });
            }
          }
        })
        .catch(() => {
          this.running--;
        });
    }

    return results;
  }

  scheduleTask(task) {
    // Reintenta en cola
    const priorityIndex = this.tasks.findIndex(t => t.priority === task.priority);
    if (priorityIndex === -1) {
      this.tasks.push(task);
    } else {
      this.tasks.splice(priorityIndex, 0, task);
    }
    this.tasks.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.attempts - b.attempts;
    });
  }
}
