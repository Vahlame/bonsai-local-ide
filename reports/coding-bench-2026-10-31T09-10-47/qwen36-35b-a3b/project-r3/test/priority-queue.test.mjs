import test from "node:test";
import assert from "node:assert/strict";
import { PriorityQueue } from "../src/priority-queue.mjs";

const tam = (q) => (typeof q.size === "function" ? q.size() : q.size);

test("sale primero la prioridad menor", () => {
  const q = new PriorityQueue();
  q.enqueue("baja", 10);
  q.enqueue("alta", 1);
  q.enqueue("media", 5);
  assert.equal(q.dequeue(), "alta");
  assert.equal(q.dequeue(), "media");
  assert.equal(q.dequeue(), "baja");
});

test("en empate de prioridad sale primero el que llego antes", () => {
  const q = new PriorityQueue();
  q.enqueue("primero", 3);
  q.enqueue("segundo", 3);
  q.enqueue("tercero", 3);
  assert.equal(q.dequeue(), "primero");
  assert.equal(q.dequeue(), "segundo");
  assert.equal(q.dequeue(), "tercero");
});

test("size refleja los elementos y dequeue en vacio lanza Error", () => {
  const q = new PriorityQueue();
  assert.equal(tam(q), 0);
  q.enqueue("a", 1);
  q.enqueue("b", 2);
  assert.equal(tam(q), 2);
  assert.equal(q.dequeue(), "a");
  assert.equal(tam(q), 1);
  q.dequeue();
  assert.throws(() => q.dequeue(), Error);
});

test("mezcla de prioridades y FIFO estable", () => {
  const q = new PriorityQueue();
  const entradas = [
    ["a", 2], ["b", 1], ["c", 2], ["d", 1], ["e", 3], ["f", 1],
  ];
  for (const [v, p] of entradas) q.enqueue(v, p);
  assert.deepEqual([q.dequeue(), q.dequeue(), q.dequeue(), q.dequeue(), q.dequeue(), q.dequeue()],
    ["b", "d", "f", "a", "c", "e"]);
});
