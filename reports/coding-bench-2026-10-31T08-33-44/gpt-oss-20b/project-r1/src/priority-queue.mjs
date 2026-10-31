export class PriorityQueue {
  constructor() {
    this.heap = [];
    this.counter = 0;
  }

  get size() {
    return this.heap.length;
  }

  isEmpty() {
    return this.size === 0;
  }

  enqueue(item, priority) {
    const node = { item, priority, index: this.counter++ };
    this.heap.push(node);
    this._bubbleUp(this.heap.length - 1);
  }

  dequeue() {
    if (this.isEmpty()) {
      throw new Error('PriorityQueue is empty');
    }
    const root = this.heap[0];
    const last = this.heap.pop();
    if (!this.isEmpty()) {
      this.heap[0] = last;
      this._bubbleDown(0);
    }
    return root.item;
  }

  _compare(a, b) {
    if (a.priority < b.priority) return true;
    if (a.priority > b.priority) return false;
    return a.index < b.index;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._compare(this.heap[i], this.heap[parent])) {
        [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
        i = parent;
      } else {
        break;
      }
    }
  }

  _bubbleDown(i) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = (i << 1) + 1;
      const right = left + 1;
      if (left < n && this._compare(this.heap[left], this.heap[smallest])) {
        smallest = left;
      }
      if (right < n && this._compare(this.heap[right], this.heap[smallest])) {
        smallest = right;
      }
      if (smallest !== i) {
        [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
        i = smallest;
      } else {
        break;
      }
    }
  }
}
