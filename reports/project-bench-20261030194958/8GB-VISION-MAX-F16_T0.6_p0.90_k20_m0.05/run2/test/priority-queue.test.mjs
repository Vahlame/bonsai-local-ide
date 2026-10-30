import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PriorityQueue } from '../src/priority-queue.mjs';

test('dequeue returns items ordered by priority (min first)', () => {
  const pq = new PriorityQueue();
  pq.enqueue('c', 3);
  pq.enqueue('a', 1);
  pq.enqueue('b', 2);
  pq.enqueue('d', 1);
  assert.deepEqual(pq.dequeue(), 'a');
  assert.deepEqual(pq.dequeue(), 'd');
  assert.deepEqual(pq.dequeue(), 'b');
  assert.deepEqual(pq.dequeue(), 'c');
});

test('FIFO order on equal priority', () => {
  const pq = new PriorityQueue();
  for (let i = 1; i <= 5; i++) {
    pq.enqueue(i, 2);
  }
  const out = [];
  while (pq.size > 0) {
    out.push(pq.dequeue());
  }
  assert.deepEqual(out, [1, 2, 3, 4, 5]);
});

test('dequeue on empty queue throws Error', () => {
  const pq = new PriorityQueue();
  assert.throws(() => pq.dequeue(), (err) => err instanceof Error);
});

test('size reflects number of enqueued items', () => {
  const pq = new PriorityQueue();
  assert.equal(pq.size, 0);
  pq.enqueue('x', 0);
  pq.enqueue('y', 0);
  assert.equal(pq.size, 2);
});
