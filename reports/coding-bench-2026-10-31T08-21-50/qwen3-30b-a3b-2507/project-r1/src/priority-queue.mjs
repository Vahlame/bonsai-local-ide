```mjs
export class PriorityQueue {
  constructor() {
    this.queue = [];
  }

  enqueue(item, priority) {
    this.queue.push({ item, priority, timestamp: Date.now() });
  }

  dequeue() {
    if (this.queue.length === 0) {
      throw new Error('Queue is empty');
    }

    let minIndex = 0;
    for (let i = 1; i < this.queue.length; i++) {
      const current = this.queue[i];
      const previous = this.queue[minIndex];

      if (current.priority < previous.priority || 
          (current.priority === previous.priority && current.timestamp < previous.timestamp)) {
        minIndex = i;
      }
    }

    return this.queue.splice(minIndex, 1)[0].item;
  }

  get size() {
    return this.queue.length;
  }
}
```
