/**
 * Aplica un descuento porcentual a un precio.
 * @param {number} precio
 * @param {number} porcentaje 0-100
 * @returns {number}
 */
export function aplicarDescuento(precio, porcentaje) {
  const pct = Math.max(0, Math.min(100, porcentaje));
  return precio * (1 - pct / 100);
}
