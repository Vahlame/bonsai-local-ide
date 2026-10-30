export class PriorityQueue {
  constructor() {
    this.heap = [];
    this.counter = 0;
    this.size = 0;
  }

  enqueue(item, priority) {
    const entry = { item, priority, order: this.counter++ };
    this.heap.push(entry);
    this.size += 1;
    this._bubbleUp(this.heap.length - 1);
  }

  dequeue() {
    if (this.size === 0) {
      throw new Error('PriorityQueue is empty');
    }
    const heap = this.heap;
    const first = heap[0].item;
    const last = heap.pop();
    this.size -= 1;
    if (this.size > 0) {
      heap[0] = last;
      this._sinkDown(0);
    }
    return first;
  }

  _bubbleUp(i) {
    const heap = this.heap;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._compare(heap[i], heap[parent]) < 0) {
        [heap[i], heap[parent]] = [heap[parent], heap[i]];
        i = parent;
      } else {
        break;
      }
    }
  }

  _sinkDown(i) {
    const heap = this.heap;
    const length = heap.length;
    while (true) {
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      let smallest = i;
      if (left < length && this._compare(heap[left], heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < length && this._compare(heap[right], heap[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === i) {
        break;
      }
      [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
      i = smallest;
    }
  }

  _compare(a, b) {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.order - b.order;
  }
}
