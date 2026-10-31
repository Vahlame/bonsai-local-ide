export class PriorityQueue {
  constructor() {
    this._heap = [];
    this._seq = 0;
  }

  enqueue(item, priority) {
    const node = { item, priority, seq: this._seq++ };
    this._heap.push(node);
    this._siftUp(this._heap.length - 1);
  }

  dequeue() {
    if (this._heap.length === 0) {
      throw new Error('PriorityQueue is empty');
    }
    const root = this._heap[0];
    const last = this._heap.pop();
    if (this._heap.length > 0) {
      this._heap[0] = last;
      this._siftDown(0);
    }
    return last.item;
  }

  get size() {
    return this._heap.length;
  }

  _siftUp(start) {
    const heap = this._heap;
    let i = start;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._compare(heap[i], heap[parent]) < 0) {
        const tmp = heap[i];
        heap[i] = heap[parent];
        heap[parent] = tmp;
        i = parent;
      } else {
        break;
      }
    }
  }

  _siftDown(start) {
    const heap = this._heap;
    const length = heap.length;
    let i = start;
    while (true) {
      let left = 2 * i + 1;
      let right = 2 * i + 2;
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
      const tmp = heap[i];
      heap[i] = heap[smallest];
      heap[smallest] = tmp;
      i = smallest;
    }
  }

  _compare(a, b) {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.seq - b.seq;
  }
}
