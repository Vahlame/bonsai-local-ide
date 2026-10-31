export class PriorityQueue {
  #items = [];

  constructor() {
    this.#items = [];
  }

  enqueue(item, priority) {
    const entry = { item, priority, timestamp: Date.now() };
    this.#items.push(entry);
    this.#heapifyUp(this.#items.length - 1);
  }

  dequeue() {
    if (this.#items.length === 0) {
      throw new Error('PriorityQueue is empty');
    }

    const minIndex = this.#findMinIndex();
    const minEntry = this.#items[minIndex];
    this.#items.splice(minIndex, 1);
    this.#heapifyDown(0);

    return minEntry.item;
  }

  get size() {
    return this.#items.length;
  }

  #findMinIndex() {
    let minIndex = 0;
    for (let i = 1; i < this.#items.length; i++) {
      const current = this.#items[i];
      const min = this.#items[minIndex];
      if (current.priority < min.priority ||
          (current.priority === min.priority && current.timestamp < min.timestamp)) {
        minIndex = i;
      }
    }
    return minIndex;
  }

  #heapifyUp(index) {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      const parent = this.#items[parentIndex];
      const child = this.#items[index];

      if (child.priority < parent.priority ||
          (child.priority === parent.priority && child.timestamp < parent.timestamp)) {
        this.#swap(index, parentIndex);
        index = parentIndex;
      } else {
        break;
      }
    }
  }

  #heapifyDown(index) {
    while (true) {
      let smallest = index;
      const left = 2 * index + 1;
      const right = 2 * index + 2;

      if (left < this.#items.length) {
        const leftEntry = this.#items[left];
        const smallestEntry = this.#items[smallest];
        if (leftEntry.priority < smallestEntry.priority ||
            (leftEntry.priority === smallestEntry.priority && leftEntry.timestamp < smallestEntry.timestamp)) {
          smallest = left;
        }
      }

      if (right < this.#items.length) {
        const rightEntry = this.#items[right];
        const smallestEntry = this.#items[smallest];
        if (rightEntry.priority < smallestEntry.priority ||
            (rightEntry.priority === smallestEntry.priority && rightEntry.timestamp < smallestEntry.timestamp)) {
          smallest = right;
        }
      }

      if (smallest !== index) {
        this.#swap(index, smallest);
        index = smallest;
      } else {
        break;
      }
    }
  }

  #swap(i, j) {
    [this.#items[i], this.#items[j]] = [this.#items[j], this.#items[i]];
  }
}
