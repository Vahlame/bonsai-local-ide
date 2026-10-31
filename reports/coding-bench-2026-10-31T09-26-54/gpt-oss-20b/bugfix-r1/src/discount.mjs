export function aplicarDescuento(precio, porcentaje) {
  // porcentaje es un valor entre 0 y 100
  return precio * (1 - porcentaje / 100);
}
