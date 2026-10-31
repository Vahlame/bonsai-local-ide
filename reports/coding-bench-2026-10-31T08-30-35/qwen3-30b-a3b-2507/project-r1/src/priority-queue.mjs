export class PriorityQueue {
  constructor() {
    this._items = [];
  }

  enqueue(item, priority) {
    this._items.push({ item, priority, timestamp: Date.now() });
  }

  dequeue() {
    if (this._items.length === 0) {
      throw new Error('Queue is empty');
    }

    let minIndex = 0;
    for (let i = 1; i < this._items.length; i++) {
      const a = this._items[i];
      const b = this._items[minIndex];

      if (a.priority < b.priority || (a.priority === b.priority && a.timestamp < b.timestamp)) {
        minIndex = i;
      }
    }

    return this._items.splice(minIndex, 1)[0].item;
  }

  get size() {
    return this._items.length;
  }
}