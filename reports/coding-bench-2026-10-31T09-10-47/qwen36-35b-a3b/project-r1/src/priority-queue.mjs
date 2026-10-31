export class PriorityQueue {
  constructor() {
    this._items = [];
    this._counter = 0;
  }

  enqueue(item, priority) {
    this._items.push({ item, priority, order: this._counter++ });
  }

  dequeue() {
    if (this._items.length === 0) {
      throw new Error('Queue is empty');
    }

    let minIndex = 0;
    for (let i = 1; i < this._items.length; i++) {
      const current = this._items[i];
      const min = this._items[minIndex];
      if (
        current.priority < min.priority ||
        (current.priority === min.priority && current.order < min.order)
      ) {
        minIndex = i;
      }
    }

    const removed = this._items.splice(minIndex, 1)[0];
    return removed.item;
  }

  get size() {
    return this._items.length;
  }
}
