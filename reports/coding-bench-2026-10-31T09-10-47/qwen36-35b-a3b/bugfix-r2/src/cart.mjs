import { aplicarDescuento } from "./discount.mjs";

/**
 * Total del carrito. Cada item: { precio, cantidad, descuento? }
 * @param {{precio: number, cantidad: number, descuento?: number}[]} items
 * @returns {number}
 */
export function totalCarrito(items) {
  let total = 0;
  for (const item of items) {
    total += aplicarDescuento(item.precio * item.cantidad, item.descuento || 0);
  }
  return total;
}
