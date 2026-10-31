export class PriorityQueue {
  constructor() {
    this._queue = [];
    this._order = 0;
  }

  enqueue(item, priority) {
    this._queue.push({ item, priority, order: this._order++ });
  }

  dequeue() {
    if (this._queue.length === 0) {
      throw new Error('PriorityQueue is empty');
    }
    let minIndex = 0;
    let min = this._queue[0];
    for (let i = 1; i < this._queue.length; i++) {
      const current = this._queue[i];
      if (
        current.priority < min.priority ||
        (current.priority === min.priority && current.order < min.order)
      ) {
        min = current;
        minIndex = i;
      }
    }
    const [removed] = this._queue.splice(minIndex, 1);
    return removed.item;
  }

  get size() {
    return this._queue.length;
  }

  isEmpty() {
    return this._queue.length === 0;
  }
}
