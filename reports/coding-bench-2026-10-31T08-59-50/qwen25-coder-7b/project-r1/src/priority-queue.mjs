class PriorityQueue {
  constructor() {
    this.queue = [];
  }

  enqueue(item, priority) {
    const index = this.queue.findIndex(q => q.priority < priority);
    if (index === -1) {
      this.queue.push({ item, priority });
    } else {
      this.queue.splice(index, 0, { item, priority });
    }
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