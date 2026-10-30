/** Ejecuta un cambio y recupera el servidor anterior si ya fue detenido. */
export async function cambiarConRecuperacion({ anterior, liberar, arrancar }) {
  let detenido = false;
  try {
    await liberar(() => { detenido = true; });
    await arrancar();
  } catch (error) {
    const motivo = error instanceof Error ? error.message : String(error);
    if (!detenido || !anterior) throw new Error(motivo);
    try {
      // La misma verificación de propiedad se aplica también al intento fallido.
      await liberar(() => {});
      await arrancar(anterior);
    } catch (recuperacion) {
      const detalle = recuperacion instanceof Error ? recuperacion.message : String(recuperacion);
      throw new Error(`${motivo}. No se pudo recuperar el modelo anterior: ${detalle}. La selección guardada anterior se conserva.`);
    }
    throw new Error(`${motivo}. Se recuperó el modelo anterior con su configuración. La selección guardada anterior se conserva.`);
  }
}
