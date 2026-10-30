import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PriorityQueue } from '../src/priority-queue.mjs';

test('dequeue returns lowest priority first', () => {
  const pq = new PriorityQueue();
  pq.enqueue('c', 3);
  pq.enqueue('a', 1);
  pq.enqueue('b', 2);
  assert.equal(pq.dequeue(), 'a');
  assert.equal(pq.dequeue(), 'b');
  assert.equal(pq.dequeue(), 'c');
  assert.equal(pq.size, 0);
});

test('ties are resolved by FIFO (insertion order)', () => {
  const pq = new PriorityQueue();
  pq.enqueue('first', 5);
  pq.enqueue('second', 5);
  pq.enqueue('third', 5);
  assert.deepEqual([
    pq.dequeue(),
    pq.dequeue(),
    pq.dequeue(),
  ], ['first', 'second', 'third']);
});

test('size tracks the number of elements', () => {
  const pq = new PriorityQueue();
  assert.equal(pq.size, 0);
  pq.enqueue('a', 1);
  pq.enqueue('b', 2);
  assert.equal(pq.size, 2);
  pq.dequeue();
  assert.equal(pq.size, 1);
});

test('dequeue on empty queue throws', () => {
  const pq = new PriorityQueue();
  assert.throws(() => pq.dequeue(), /empty/i);
});
