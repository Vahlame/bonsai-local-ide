import { aplicarDescuento } from "./discount.mjs";

/**
 * Total del carrito. Cada item: { precio, cantidad, descuento? }
 * @param {{precio: number, cantidad?: number, descuento?: number}[]} items
 * @returns {number}
 */
export function totalCarrito(items) {
  let total = 0;
  for (const item of items) {
    const cantidad = item.cantidad ?? 1;
    const descuento = item.descuento ?? 0;
    total += aplicarDescuento(item.precio, descuento) * cantidad;
  }
  return total;
}
