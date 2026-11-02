/**
 * Cliente JSON de la API del IDE. Mantiene el contrato anterior: siempre JSON,
 * `204` devuelve null y el estado HTTP viaja en `error.status`.
 */

/**
 * @param {{
 *   fetchImpl?: typeof fetch,
 *   timeoutPorDefecto?: number,
 *   timeoutDeRuta?: (ruta: string) => number | undefined,
 * }} [opciones]
 * @returns {(ruta: string, opciones?: {metodo?: string, cuerpo?: unknown, timeout?: number}) => Promise<any>}
 */
export function crearApi({ fetchImpl = globalThis.fetch, timeoutPorDefecto = 15000, timeoutDeRuta } = {}) {
  return async function api(ruta, opciones = {}) {
    const timeout = opciones.timeout ?? timeoutDeRuta?.(ruta) ?? timeoutPorDefecto;
    const init = { method: opciones.metodo || "GET", cache: "no-store", signal: AbortSignal.timeout(timeout) };
    if (opciones.cuerpo !== undefined) {
      init.method = opciones.metodo || "POST";
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(opciones.cuerpo);
    }
    const res = await fetchImpl(ruta, init);
    if (!res.ok) {
      let detalle = (await res.text()) || `HTTP ${res.status}`;
      try { detalle = JSON.parse(detalle).error || detalle; } catch { /* respuesta de texto */ }
      const error = new Error(detalle);
      // El estado HTTP importa para distinguir un 409 (el archivo cambió en disco y no
      // hay que pisarlo) de un fallo genérico del servidor.
      error.status = res.status;
      throw error;
    }
    return res.status === 204 ? null : res.json();
  };
}
