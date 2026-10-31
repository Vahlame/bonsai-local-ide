export class PriorityQueue {
  constructor() {
    this.queue = [];
  }

  enqueue(item, priority) {
    this.queue.push({ item, priority, timestamp: Date.now() });
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.timestamp - b.timestamp;
    });
  }

  dequeue() {
    if (this.queue.length === 0) {
      throw new Error('Priority queue is empty');
    }
    return this.queue.shift().item;
  }

  get size() {
    return this.queue.length;
  }
}
