export class PriorityQueue {
  /**
   * Min-heap priority queue.
   * Smallest priority is dequeued first. On equal priority, FIFO order
   * (earlier enqueued item comes out first) is preserved.
   */
  constructor() {
    this.heap = [];
    this._counter = 0;
  }

  get size() {
    return this.heap.length;
  }

  enqueue(item, priority) {
    const node = { priority, seq: this._counter++, item };
    this.heap.push(node);
    this._bubbleUp(this.heap.length - 1);
  }

  dequeue() {
    if (this.heap.length === 0) {
      throw new Error('PriorityQueue is empty');
    }
    const [root] = this.heap;
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._bubbleDown(0);
    }
    return last.item;
  }

  _less(a, b) {
    if (a.priority !== b.priority) {
      return a.priority < b.priority;
    }
    return a.seq < b.seq;
  }

  _bubbleUp(idx) {
    const node = this.heap[idx];
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this._less(node, this.heap[parent])) {
        [this.heap[idx], this.heap[parent]] = [this.heap[parent], this.heap[idx]];
        idx = parent;
      } else {
        break;
      }
    }
  }

  _bubbleDown(idx) {
    const node = this.heap[idx];
    const length = this.heap.length;
    while (true) {
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      let smallest = idx;
      if (left < length && this._less(this.heap[left], node)) {
        smallest = left;
      }
      if (right < length && this._less(this.heap[right], node)) {
        smallest = right;
      }
      if (smallest === idx) {
        break;
      }
      [this.heap[idx], this.heap[smallest]] = [this.heap[smallest], this.heap[idx]];
      idx = smallest;
    }
  }
}
