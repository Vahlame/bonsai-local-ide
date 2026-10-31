import test from "node:test";
import assert from "node:assert/strict";
import { aplicarDescuento } from "../src/discount.mjs";
import { totalCarrito } from "../src/cart.mjs";

test("descuento del 10% sobre 100", () => {
  assert.equal(aplicarDescuento(100, 10), 90);
});

test("descuento del 0% no cambia el precio", () => {
  assert.equal(aplicarDescuento(50, 0), 50);
});

test("descuento del 25% sobre 80", () => {
  assert.equal(aplicarDescuento(80, 25), 60);
});

test("el total multiplica por cantidad", () => {
  assert.equal(totalCarrito([{ precio: 100, cantidad: 2, descuento: 10 }]), 180);
});

test("el total suma varios items con y sin descuento", () => {
  assert.equal(totalCarrito([
    { precio: 100, cantidad: 2, descuento: 10 },
    { precio: 50, cantidad: 1 },
    { precio: 20, cantidad: 3, descuento: 50 },
  ]), 180 + 50 + 30);
});
