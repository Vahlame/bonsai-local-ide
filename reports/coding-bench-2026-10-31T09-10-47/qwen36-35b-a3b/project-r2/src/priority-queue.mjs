export class PriorityQueue {
  constructor() {
    this._items = [];
    this._index = 0;
  }

  enqueue(item, priority) {
    this._items.push({ item, priority, index: this._index++ });
  }

  dequeue() {
    if (this._items.length === 0) {
      throw new Error('Priority queue is empty');
    }
    let minIdx = 0;
    for (let i = 1; i < this._items.length; i++) {
      const curr = this._items[i];
      const min = this._items[minIdx];
      if (curr.priority < min.priority || (curr.priority === min.priority && curr.index < min.index)) {
        minIdx = i;
      }
    }
    const removed = this._items.splice(minIdx, 1)[0];
    return removed.item;
  }

  get size() {
    return this._items.length;
  }
}
