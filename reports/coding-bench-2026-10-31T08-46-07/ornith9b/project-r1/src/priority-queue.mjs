export class PriorityQueue {
  constructor() {
    this._heap = [];
    this._seq = 0;
  }

  enqueue(item, priority) {
    const node = { item, priority, seq: this._seq++ };
    this._heap.push(node);
    this._bubbleUp(this._heap.length - 1);
  }

  dequeue() {
    if (this._heap.length === 0) {
      throw new Error('PriorityQueue is empty');
    }
    const root = this._heap[0];
    const last = this._heap.pop();
    if (this._heap.length > 0) {
      this._heap[0] = last;
      this._bubbleDown(0);
    }
    return root.item;
  }

  get size() {
    return this._heap.length;
  }

  _compare(a, b) {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.seq - b.seq;
  }

  _bubbleUp(i) {
    const node = this._heap[i];
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._compare(this._heap[parent], node) <= 0) break;
      [this._heap[parent], this._heap[i]] = [this._heap[i], this._heap[parent]];
      i = parent;
    }
  }

  _bubbleDown(i) {
    const n = this._heap.length;
    const node = this._heap[i];
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this._compare(this._heap[left], node) < 0) smallest = left;
      if (right < n && this._compare(this._heap[right], node) < 0) smallest = right;
      if (smallest === i) break;
      [this._heap[smallest], this._heap[i]] = [this._heap[i], this._heap[smallest]];
      i = smallest;
    }
  }
}
