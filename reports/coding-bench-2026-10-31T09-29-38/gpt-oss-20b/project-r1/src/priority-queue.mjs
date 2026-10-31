export class PriorityQueue {
  constructor() {
    this.heap = [];
    this.order = 0;
  }

  enqueue(item, priority) {
    const node = { item, priority, order: this.order++ };
    this.heap.push(node);
    this._bubbleUp(this.heap.length - 1);
  }

  dequeue() {
    if (this.heap.length === 0) throw new Error('PriorityQueue is empty');
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
    const heap = this.heap;
    while (idx > 0) {
      const parentIdx = (idx - 1) >> 1;
      const parent = heap[parentIdx];
      const node = heap[idx];
      if (
        node.priority < parent.priority ||
        (node.priority === parent.priority && node.order < parent.order)
      ) {
        [heap[parentIdx], heap[idx]] = [heap[idx], heap[parentIdx]];
        idx = parentIdx;
      } else break;
    }
  }

  _bubbleDown(idx) {
    const heap = this.heap;
    const length = heap.length;
    while (true) {
      const left = idx * 2 + 1;
      const right = idx * 2 + 2;
      let smallest = idx;

      if (left < length) {
        const leftNode = heap[left];
        const currNode = heap[smallest];
        if (
          leftNode.priority < currNode.priority ||
          (leftNode.priority === currNode.priority && leftNode.order < currNode.order)
        ) {
          smallest = left;
        }
      }

      if (right < length) {
        const rightNode = heap[right];
        const currNode = heap[smallest];
        if (
          rightNode.priority < currNode.priority ||
          (rightNode.priority === currNode.priority && rightNode.order < currNode.order)
        ) {
          smallest = right;
        }
      }

      if (smallest !== idx) {
        [heap[smallest], heap[idx]] = [heap[idx], heap[smallest]];
        idx = smallest;
      } else break;
    }
  }
}
