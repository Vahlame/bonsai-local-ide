export class PriorityQueue {
  constructor() {
    this.heap = [];
    this.counter = 0; // to preserve FIFO on equal priority
  }

  enqueue(item, priority) {
    const node = { item, priority, index: this.counter++ };
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
    return root.item;
  }

  get size() {
    return this.heap.length;
  }

  _bubbleUp(idx) {
    const node = this.heap[idx];
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      const parent = this.heap[parentIdx];
      if (
        node.priority < parent.priority ||
        (node.priority === parent.priority && node.index < parent.index)
      ) {
        this.heap[idx] = parent;
        idx = parentIdx;
      } else {
        break;
      }
    }
    this.heap[idx] = node;
  }

  _bubbleDown(idx) {
    const length = this.heap.length;
    const node = this.heap[idx];
    while (true) {
      let leftIdx = (idx << 1) + 1;
      let rightIdx = leftIdx + 1;
      let smallestIdx = idx;

      if (
        leftIdx < length &&
        (this.heap[leftIdx].priority < this.heap[smallestIdx].priority ||
          (this.heap[leftIdx].priority === this.heap[smallestIdx].priority &&
            this.heap[leftIdx].index < this.heap[smallestIdx].index))
      ) {
        smallestIdx = leftIdx;
      }

      if (
        rightIdx < length &&
        (this.heap[rightIdx].priority < this.heap[smallestIdx].priority ||
          (this.heap[rightIdx].priority === this.heap[smallestIdx].priority &&
            this.heap[rightIdx].index < this.heap[smallestIdx].index))
      ) {
        smallestIdx = rightIdx;
      }

      if (smallestIdx === idx) break;

      this.heap[idx] = this.heap[smallestIdx];
      idx = smallestIdx;
    }
    this.heap[idx] = node;
  }
}
