export class PriorityQueue {
  constructor() {
    this.heap = [];
    this.counter = 0;
  }

  enqueue(item, priority) {
    const index = this.counter++;
    const node = { priority, index, item };
    this.heap.push(node);
    this._siftUp(this.heap.length - 1);
  }

  dequeue() {
    if (this.heap.length === 0) {
      throw new Error('PriorityQueue is empty');
    }
    const root = this.heap[0];
    this.heap[0] = this.heap.pop();
    this._siftDown(0);
    return root.item;
  }

  get size() {
    return this.heap.length;
  }

  _siftUp(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this._compare(this.heap[index], this.heap[parent]) < 0) {
        this._swap(index, parent);
        index = parent;
      } else {
        break;
      }
    }
  }

  _siftDown(index) {
    while (true) {
      const left = 2 * index + 1;
      const right = 2 * index + 2;
      let smallest = index;

      if (left < this.heap.length && this._compare(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < this.heap.length && this._compare(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right;
      }

      if (smallest !== index) {
        this._swap(index, smallest);
        index = smallest;
      } else {
        break;
      }
    }
  }

  _swap(i, j) {
    [this.heap[i], this.heap[j]] = [this.heap[j], this.heap[i]];
  }

  _compare(a, b) {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }
    return a.index - b.index;
  }
}
