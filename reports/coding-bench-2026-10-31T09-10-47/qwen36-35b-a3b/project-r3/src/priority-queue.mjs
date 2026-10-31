export class PriorityQueue {
  constructor() {
    this._items = [];
  }

  enqueue(item, priority) {
    this._items.push({ item, priority, order: this._items.length });
  }

  dequeue() {
    if (this._items.length === 0) {
      throw new Error('Queue is empty');
    }

    let minIdx = 0;
    for (let i = 1; i < this._items.length; i++) {
      const curr = this._items[i];
      const min = this._items[minIdx];
      if (
        curr.priority < min.priority ||
        (curr.priority === min.priority && curr.order < min.order)
      ) {
        minIdx = i;
      }
    }

    return this._items.splice(minIdx, 1)[0].item;
  }

  get size() {
    return this._items.length;
  }
}
