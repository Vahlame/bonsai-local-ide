export class PriorityQueue {
  constructor() {
    this.heap = [];
    this.count = 0;
  }

  enqueue(item, priority) {
    this.heap.push({ item, priority, seq: this.count++ });
    this._bubbleUp(this.heap.length - 1);
  }

  dequeue() {
    if (this.heap.length === 0) {
      throw new Error('PriorityQueue is empty');
    }
    const first = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._sinkDown(0);
    }
    return first.item;
  }

  get size() {
    return this.heap.length;
  }

  _compare(a, b) {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.seq - b.seq;
  }

  _bubbleUp(start) {
    const length = this.heap.length;
    let i = start;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._compare(this.heap[i], this.heap[parent]) >= 0) {
        break;
      }
      [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
      i = parent;
    }
  }

  _sinkDown(start) {
    const length = this.heap.length;
    let i = start;
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < length && this._compare(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < length && this._compare(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === i) {
        break;
      }
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}
