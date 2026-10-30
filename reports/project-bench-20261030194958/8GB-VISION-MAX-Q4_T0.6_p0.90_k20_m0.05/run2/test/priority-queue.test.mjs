import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PriorityQueue } from '../src/priority-queue.mjs';

test('orders by priority (min-heap)', () => {
  const pq = new PriorityQueue();
  pq.enqueue('c', 3);
  pq.enqueue('a', 1);
  pq.enqueue('b', 2);

  assert.equal(pq.dequeue(), 'a');
  assert.equal(pq.dequeue(), 'b');
  assert.equal(pq.dequeue(), 'c');
});

test('breaks ties FIFO by arrival order', () => {
  const pq = new PriorityQueue();
  pq.enqueue('first', 5);
  pq.enqueue('second', 5);
  pq.enqueue('third', 5);

  assert.equal(pq.dequeue(), 'first');
  assert.equal(pq.dequeue(), 'second');
  assert.equal(pq.dequeue(), 'third');
});

test('mixes priority ordering with FIFO within same priority', () => {
  const pq = new PriorityQueue();
  pq.enqueue('low-early', 1);
  pq.enqueue('high', 5);
  pq.enqueue('low-late', 1);

  assert.equal(pq.dequeue(), 'low-early');
  assert.equal(pq.dequeue(), 'low-late');
  assert.equal(pq.dequeue(), 'high');
});

test('size reflects contents', () => {
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
  assert.throws(() => pq.dequeue(), (err) => err instanceof Error);
});
