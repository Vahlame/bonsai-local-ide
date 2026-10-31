export class PriorityQueue {
  constructor() {
    this.heap = [];
    this._seq = 0;
  }

  enqueue(item, priority) {
    const node = { item, priority, seq: this._seq++ };
    this.heap.push(node);
    this._bubbleUp(this.heap.length - 1);
  }

  dequeue() {
    if (this.heap.length === 0) {
      throw new Error('PriorityQueue is empty');
    }
    const root = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._bubbleDown(0);
    }
    return last.item;
  }

  get size() {
    return this.heap.length;
  }

  _bubbleUp(start) {
    let i = start;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._less(this.heap[i], this.heap[parent])) {
        [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
        i = parent;
      } else {
        break;
      }
    }
  }

  _bubbleDown(start) {
    const length = this.heap.length;
    let i = start;
    while (true) {
      let left = 2 * i + 1;
      let right = 2 * i + 2;
      let smallest = i;
      if (left < length && this._less(this.heap[left], this.heap[smallest])) {
        smallest = left;
      }
      if (right < length && this._less(this.heap[right], this.heap[smallest])) {
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

  _less(a, b) {
    if (a.priority !== b.priority) {
      return a.priority < b.priority;
    }
    return a.seq < b.seq;
  }
}
