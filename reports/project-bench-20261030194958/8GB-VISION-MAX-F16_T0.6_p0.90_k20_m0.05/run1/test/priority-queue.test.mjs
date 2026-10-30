import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PriorityQueue } from '../src/priority-queue.mjs';

test('dequeue returns items in priority order', () => {
  const pq = new PriorityQueue();
  pq.enqueue('c', 3);
  pq.enqueue('a', 1);
  pq.enqueue('b', 2);

  assert.equal(pq.dequeue(), 'a');
  assert.equal(pq.dequeue(), 'b');
  assert.equal(pq.dequeue(), 'c');
  assert.equal(pq.size, 0);
});

test('FIFO order on priority tie', () => {
  const pq = new PriorityQueue();
  pq.enqueue('first', 5);
  pq.enqueue('second', 5);
  pq.enqueue('third', 5);

  assert.equal(pq.dequeue(), 'first');
  assert.equal(pq.dequeue(), 'second');
  assert.equal(pq.dequeue(), 'third');
});

test('size reflects number of enqueued items', () => {
  const pq = new PriorityQueue();
  assert.equal(pq.size, 0);
  pq.enqueue('a', 1);
  pq.enqueue('b', 2);
  assert.equal(pq.size, 2);
  pq.dequeue();
  assert.equal(pq.size, 1);
});

test('dequeue on empty throws Error', () => {
  const pq = new PriorityQueue();
  assert.throws(() => pq.dequeue(), Error);
});
