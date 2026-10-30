export class PriorityQueue {
  #heap = [];
  #counter = 0;

  enqueue(item, priority) {
    this.#heap.push({ item, priority, order: this.#counter++ });
    this.#siftUp(this.#heap.length - 1);
  }

  get size() {
    return this.#heap.length;
  }

  dequeue() {
    if (this.#heap.length === 0) {
      throw new Error('PriorityQueue is empty');
    }
    const result = this.#heap[0].item;
    const last = this.#heap.pop();
    if (this.#heap.length > 0) {
      this.#heap[0] = last;
      this.#siftDown(0);
    }
    return result;
  }

  #less(a, b) {
    if (a.priority !== b.priority) return a.priority < b.priority;
    return a.order < b.order;
  }

  #siftUp(start) {
    const heap = this.#heap;
    let i = start;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.#less(heap[i], heap[parent])) {
        [heap[i], heap[parent]] = [heap[parent], heap[i]];
        i = parent;
      } else {
        break;
      }
    }
  }

  #siftDown(start) {
    const heap = this.#heap;
    let i = start;
    while (true) {
      const length = heap.length;
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < length && this.#less(heap[left], heap[smallest])) {
        smallest = left;
      }
      if (right < length && this.#less(heap[right], heap[smallest])) {
        smallest = right;
      }
      if (smallest === i) break;
      [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
      i = smallest;
    }
  }
}
