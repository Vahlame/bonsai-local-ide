export class PriorityQueue {
  constructor() {
    this._queue = [];
  }

  enqueue(item, priority) {
    this._queue.push({ item, priority, timestamp: Date.now() });
  }

  dequeue() {
    if (this._queue.length === 0) {
      throw new Error('Queue is empty');
    }

    let minIndex = 0;
    for (let i = 1; i < this._queue.length; i++) {
      const a = this._queue[i];
      const b = this._queue[minIndex];

      if (a.priority < b.priority || (a.priority === b.priority && a.timestamp < b.timestamp)) {
        minIndex = i;
      }
    }

    return this._queue.splice(minIndex, 1)[0].item;
  }

  get size() {
    return this._queue.length;
  }
}