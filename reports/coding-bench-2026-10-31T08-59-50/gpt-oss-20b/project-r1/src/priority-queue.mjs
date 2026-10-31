export class PriorityQueue {
  constructor() {
    this._heap = [];
    this._counter = 0; // to preserve FIFO for equal priority
  }

  enqueue(item, priority) {
    const node = { item, priority, counter: this._counter++ };
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
    return root.item;
  }

  get size() {
    return this._heap.length;
  }

  _siftUp(idx) {
    const node = this._heap[idx];
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      const parent = this._heap[parentIdx];
      if (node.priority < parent.priority ||
          (node.priority === parent.priority && node.counter < parent.counter)) {
        this._heap[idx] = parent;
        idx = parentIdx;
      } else {
        break;
      }
    }
    this._heap[idx] = node;
  }

  _siftDown(idx) {
    const length = this._heap.length;
    const node = this._heap[idx];
    while (true) {
      let leftIdx = (idx << 1) + 1;
      let rightIdx = leftIdx + 1;
      let smallestIdx = idx;

      if (leftIdx < length) {
        const left = this._heap[leftIdx];
        if (left.priority < node.priority ||
            (left.priority === node.priority && left.counter < node.counter)) {
          smallestIdx = leftIdx;
        }
      }

      if (rightIdx < length) {
        const right = this._heap[rightIdx];
        const smallest = this._heap[smallestIdx];
        if (right.priority < smallest.priority ||
            (right.priority === smallest.priority && right.counter < smallest.counter)) {
          smallestIdx = rightIdx;
        }
      }

      if (smallestIdx === idx) break;

      this._heap[idx] = this._heap[smallestIdx];
      idx = smallestIdx;
    }
    this._heap[idx] = node;
  }
}
