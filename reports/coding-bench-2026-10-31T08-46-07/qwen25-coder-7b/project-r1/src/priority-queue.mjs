class PriorityQueue {
  constructor() {
    this.queue = [];
  }

  enqueue(item, priority) {
    this.queue.push({ item, priority });
    this.queue.sort((a, b) => a.priority - b.priority || a.timestamp - b.timestamp);
  }

  dequeue() {
    if (this.queue.length === 0) {
      throw new Error('Queue is empty');
    }
    return this.queue.shift().item;
  }

  get size() {
    return this.queue.length;
  }
}

export { PriorityQueue };