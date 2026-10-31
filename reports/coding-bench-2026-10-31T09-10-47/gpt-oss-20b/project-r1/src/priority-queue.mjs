export class PriorityQueue {
  constructor() {
    this._heap = [];
    this._order = 0;
  }

  enqueue(item, priority) {
    const node = { item, priority, order: this._order++ };
    this._heap.push(node);
    this._siftUp(this._heap.length - 1);
  }

  dequeue() {
    if (this._heap.length === 0) throw new Error('PriorityQueue is empty');
    const min = this._heap[0];
    const last = this._heap.pop();
    if (this._heap.length > 0) {
      this._heap[0] = last;
      this._siftDown(0);
    }
    return min.item;
  }

  get size() {
    return this._heap.length;
  }

  _siftUp(idx) {
    const heap = this._heap;
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this._compare(heap[idx], heap[parent]) < 0) {
        [heap[idx], heap[parent]] = [heap[parent], heap[idx]];
        idx = parent;
      } else break;
    }
  }

  _siftDown(idx) {
    const heap = this._heap;
    const length = heap.length;
    while (true) {
      let left = idx * 2 + 1;
      let right = idx * 2 + 2;
      let smallest = idx;

      if (left < length && this._compare(heap[left], heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < length && this._compare(heap[right], heap[smallest]) < 0) {
        smallest = right;
      }
      if (smallest !== idx) {
        [heap[idx], heap[smallest]] = [heap[smallest], heap[idx]];
        idx = smallest;
      } else break;
    }
  }

  _compare(a, b) {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.order - b.order;
  }
}
