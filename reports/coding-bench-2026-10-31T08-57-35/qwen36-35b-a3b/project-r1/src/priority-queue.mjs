export class PriorityQueue {
  constructor() {
    this._items = [];
  }

  enqueue(item, priority) {
    this._items.push({ item, priority });
  }

  dequeue() {
    if (this._items.length === 0) {
      throw new Error('Queue is empty');
    }
    let minIdx = 0;
    let minPriority = this._items[0].priority;
    for (let i = 1; i < this._items.length; i++) {
      if (this._items[i].priority < minPriority) {
        minPriority = this._items[i].priority;
        minIdx = i;
      }
    }
    return this._items.splice(minIdx, 1)[0].item;
  }

  get size() {
    return this._items.length;
  }
}
