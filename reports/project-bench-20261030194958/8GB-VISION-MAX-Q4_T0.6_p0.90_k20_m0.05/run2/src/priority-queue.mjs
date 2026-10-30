export class PriorityQueue {
  /**
   * Binary min-heap backed priority queue.
   * Ordering: smallest priority first; ties broken by arrival order (FIFO).
   */
  constructor() {
    this.heap = [];
    this.seq = 0;
  }

  enqueue(item, priority) {
    this.seq += 1;
    const node = { item, priority, seq: this.seq };
    this.heap.push(node);
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
      this._bubbleDown(0);
    }
    return first.item;
  }

  get size() {
    return this.heap.length;
  }

  _less(a, b) {
    if (a.priority !== b.priority) {
      return a.priority < b.priority;
    }
    return a.seq < b.seq;
  }

  _bubbleUp(i) {
    const node = this.heap[i];
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._less(node, this.heap[parent])) {
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
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this._less(this.heap[left], this.heap[smallest])) {
        smallest = left;
      }
      if (right < n && this._less(this.heap[right], this.heap[smallest])) {
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
