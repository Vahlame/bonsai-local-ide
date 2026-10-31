export class PriorityQueue {
  #items = [];

  enqueue(item, priority) {
    this.#items.push({ item, priority, id: this.#items.length });
    this.#items.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.id - b.id;
    });
  }

  dequeue() {
    if (this.#items.length === 0) {
      throw new Error('PriorityQueue is empty');
    }
    const item = this.#items.shift();
    return item.item;
  }

  get size() {
    return this.#items.length;
  }
}
