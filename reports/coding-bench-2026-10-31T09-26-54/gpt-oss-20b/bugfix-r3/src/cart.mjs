import { aplicarDescuento } from "./discount.mjs";

/**
 * Total del carrito. Cada item: { precio, cantidad, descuento? }
 * @param {{precio: number, cantidad: number, descuento?: number}[]} items
 * @returns {number}
 */
export function totalCarrito(items) {
  return items.reduce((total, item) => {
    const precioConDescuento = aplicarDescuento(item.precio, item.descuento ?? 0);
    return total + precioConDescuento * (item.cantidad ?? 1);
  }, 0);
}
