export class PriorityQueue {
  constructor() {
    this._queue = [];
    this._counter = 0;
  }

  enqueue(item, priority) {
    this._queue.push({
      item,
      priority,
      order: this._counter++,
    });
  }

  dequeue() {
    if (this._queue.length === 0) {
      throw new Error('PriorityQueue is empty');
    }
    this._queue.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.order - b.order;
    });
    return this._queue.shift().item;
  }

  get size() {
    return this._queue.length;
  }
}
