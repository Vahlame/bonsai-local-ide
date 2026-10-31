/**
 * Aplica un descuento porcentual a un precio.
 * @param {number} precio
 * @param {number} porcentaje 0-100
 * @returns {number}
 */
export function aplicarDescuento(precio, porcentaje = 0) {
  // Convertir el porcentaje a fracción (0-1) antes de aplicar el descuento
  const factor = porcentaje / 100;
  return precio - precio * factor;
}
