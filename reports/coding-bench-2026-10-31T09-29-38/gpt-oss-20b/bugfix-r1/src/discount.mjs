/**
 * Aplica un descuento porcentual a un precio.
 * @param {number} precio
 * @param {number} porcentaje 0-100
 * @returns {number}
 */
export function aplicarDescuento(precio, porcentaje) {
  // Aseguramos que el porcentaje esté dentro del rango 0-100
  const pct = Math.max(0, Math.min(100, porcentaje));
  return precio - (precio * pct) / 100;
}
