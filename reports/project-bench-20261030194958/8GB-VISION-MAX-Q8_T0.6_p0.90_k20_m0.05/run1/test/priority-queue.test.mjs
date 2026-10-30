import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PriorityQueue } from '../src/priority-queue.mjs';

test('dequeue returns items in priority order', () => {
  const pq = new PriorityQueue();
  pq.enqueue('low', 10);
  pq.enqueue('high', 1);
  pq.enqueue('mid', 5);

  assert.equal(pq.dequeue(), 'high');
  assert.equal(pq.dequeue(), 'mid');
  assert.equal(pq.dequeue(), 'low');
});

test('equal priority is FIFO (earlier item comes out first)', () => {
  const pq = new PriorityQueue();
  pq.enqueue('first', 2);
  pq.enqueue('second', 2);
  pq.enqueue('third', 2);

  assert.deepEqual([pq.dequeue(), pq.dequeue(), pq.dequeue()], [
    'first',
    'second',
    'third',
  ]);
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

test('dequeue on empty queue throws Error', () => {
  const pq = new PriorityQueue();
  assert.throws(() => pq.dequeue(), Error);
});
