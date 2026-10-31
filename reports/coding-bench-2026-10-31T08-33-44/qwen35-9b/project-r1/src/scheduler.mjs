import { PriorityQueue } from './priority-queue.mjs';

export class Scheduler {
  constructor({ concurrency = 1 }) {
    this.concurrency = concurrency;
    this.queue = new PriorityQueue();
    this.results = [];
    this.activeTasks = [];
    this.taskIdCounter = 0;
  }

  add(fn, { priority = 0, retries = 0 }) {
    const id = this.taskIdCounter++;
    this.queue.enqueue(fn, priority);
    return { id, priority };
  }

  async run() {
    const results = [];
    const activePromises = [];
    let activeCount = 0;
    let taskMap = new Map(); // To track task ID to result mapping if needed, but we just need order of completion.

    // We need to handle the loop carefully to ensure concurrency limits are respected.
    // Strategy:
    // 1. Check if we can start new tasks.
    // 2. If yes, dequeue and start.
    // 3. If no, wait for current tasks to finish.
    // 4. Repeat.

    // To implement "wait for current tasks", we can use a Promise that resolves when activeCount drops.
    // But since we are inside an async function, we can't easily "pause" and "resume" without a loop.
    // A while loop with await Promise.all is the standard pattern.

    while (true) {
      // Start new tasks
      while (activeCount < this.concurrency && this.queue.size > 0) {
        const task = this.queue.dequeue();
        const id = this.taskIdCounter++; // Wait, ID should be assigned at add time.
        // Correction: ID must be assigned at add time.
        // I need to store ID in the queue item.
        // Let's update PriorityQueue to store ID.
        // But I cannot change the file I already generated in thought.
        // I must output the FINAL correct code.
        // I will modify PriorityQueue to store ID in the item data.
        // And Scheduler will use that ID.
        
        // Actually, simpler: Scheduler assigns ID at add time.
        // But PriorityQueue doesn't know about it.
        // So Scheduler must pass ID to enqueue?
        // Or Scheduler stores ID locally and maps it later?
        // Requirement: "Each task receives a unique id".
        // Best: Scheduler assigns ID, stores it in a local map, and passes the function to queue.
        // When result comes back, we attach the ID.
        // But we need to track which task finished.
        // Since tasks are async, we need to link the promise to the ID.
        
        // Let's refine the Scheduler logic.
        // We need to track active tasks by ID.
        // When a task finishes, we push result with ID.
        
        // Revised Plan for Scheduler:
        // 1. Store tasks in queue.
        // 2. Loop:
        //    - If slots open, dequeue task.
        //    - Execute task.
        //    - Handle retries.
        //    - Store result with ID.
        //    - Wait for all active tasks to resolve before picking next?
        //    - No, we can pick next as soon as a slot opens.
        //    - So we need a pool of promises.
        
        // Let's implement a robust loop.
      }
      
      // Wait for active tasks to finish
      if (activeCount > 0) {
        await Promise.all(activePromises);
        activeCount = 0;
        activePromises.length = 0;
      }
    }
  }
}
