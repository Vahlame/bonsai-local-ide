export class PriorityQueue {
  constructor() {
    this._items = [];
    this._counter = 0; // to preserve FIFO order
  }

  enqueue(item, priority) {
    this._items.push({ item, priority, index: this._counter++ });
  }

  dequeue() {
    if (this._items.length === 0) {
      throw new Error('PriorityQueue is empty');
    }
    let minIdx = 0;
    for (let i = 1; i < this._items.length; i++) {
      const a = this._items[i];
      const b = this._items[minIdx];
      if (a.priority < b.priority || (a.priority === b.priority && a.index < b.index)) {
        minIdx = i;
      }
    }
    const [removed] = this._items.splice(minIdx, 1);
    return removed.item;
  }

  get size() {
    return this._items.length;
  }
}
