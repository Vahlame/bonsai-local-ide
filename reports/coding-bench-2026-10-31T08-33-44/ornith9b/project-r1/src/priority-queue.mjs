export class PriorityQueue {
  constructor() {
    this._items = [];
  }

  enqueue(item, priority) {
    this._items.push({ item, priority });
  }

  dequeue() {
    if (this._items.length === 0) {
      throw new Error('PriorityQueue is empty');
    }
    let idx = 0;
    for (let i = 1; i < this._items.length; i++) {
      if (this._items[i].priority < this._items[idx].priority) {
        idx = i;
      }
    }
    const { item } = this._items.splice(idx, 1)[0];
    return item;
  }

  get size() {
    return this._items.length;
  }
}
