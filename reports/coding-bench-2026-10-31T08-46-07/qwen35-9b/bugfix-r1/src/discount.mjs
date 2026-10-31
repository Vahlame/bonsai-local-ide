/**
 * Aplica un descuento porcentual a un precio.
 * @param {number} precio
 * @param {number} porcentaje 0-100
 * @returns {number}
 */
export function aplicarDescuento(precio, porcentaje) {
  return precio - precio * (porcentaje / 100);
}
