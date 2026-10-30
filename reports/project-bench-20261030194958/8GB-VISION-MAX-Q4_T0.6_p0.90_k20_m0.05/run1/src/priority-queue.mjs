export class PriorityQueue {
  #heap = [];
  #counter = 0;

  enqueue(item, priority) {
    this.#heap.push({ item, priority, seq: this.#counter++ });
    const start = this.#heap.length - 1;
    this.#bubbleUp(start);
  }

  dequeue() {
    if (this.#heap.length === 0) {
      throw new Error('PriorityQueue is empty');
    }
    const [first] = this.#heap;
    const last = this.#heap.pop();
    if (this.#heap.length > 0) {
      this.#heap[0] = last;
      this.#bubbleDown(0);
    }
    return last.item;
  }

  get size() {
    return this.#heap.length;
  }

  #bubbleUp(start) {
    let i = start;
    const value = this.#heap[i];
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.#compare(value, this.#heap[parent]) < 0) {
        this.#heap[i] = this.#heap[parent];
        i = parent;
      } else {
        break;
      }
    }
    this.#heap[i] = value;
  }

  #bubbleDown(start) {
    const length = this.#heap.length;
    const value = this.#heap[start];
    while (true) {
      const left = (start << 1) + 1;
      const right = left + 1;
      let swap = -1;
      if (left < length && this.#compare(value, this.#heap[left]) > 0) {
        swap = left;
      }
      if (right < length && this.#compare(value, this.#heap[right]) > 0) {
        swap = right;
      }
      if (swap === -1) break;
      this.#heap[start] = this.#heap[swap];
      start = swap;
    }
    this.#heap[start] = value;
  }

  #compare(a, b) {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.seq - b.seq;
  }
}
