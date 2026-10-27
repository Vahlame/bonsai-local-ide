/**
 * Guardia anti-CSRF y anti-DNS-rebinding para el servidor local de la interfaz.
 *
 * PROBLEMA QUE RESUELVE
 * `ui-server.mjs` escucha en 127.0.0.1 y su API no pide autenticacion. Eso NO lo
 * protege: cualquier pagina web abierta en el navegador del usuario puede hacer
 *   fetch("http://127.0.0.1:8787/api/chat", {method:"POST", mode:"no-cors", body:...})
 * El navegador manda la peticion (no puede leer la respuesta, pero no le hace falta)
 * y, con el permiso en "all", el modelo acaba ejecutando comandos en el PC. El mismo
 * agujero sirve para DNS rebinding: un dominio del atacante que resuelve a 127.0.0.1
 * queda como "mismo origen" para el navegador.
 *
 * DEFENSA (tres reglas, todas necesarias)
 *  1. `Host` tiene que ser uno de los nuestros. Corta el DNS rebinding: aunque el
 *     navegador crea que habla con "evil.com", la cabecera Host lleva evil.com.
 *  2. Si viene `Origin`, tiene que ser exactamente el nuestro. Los navegadores la
 *     mandan siempre en POST, incluso en peticiones del mismo origen.
 *  3. Si el POST lleva cuerpo, `Content-Type` tiene que ser application/json. Un
 *     formulario o un `no-cors` cross-origin solo pueden mandar tipos "simples"
 *     (text/plain, application/x-www-form-urlencoded, multipart/form-data); para
 *     poner application/json haria falta un preflight CORS, que este servidor no
 *     concede. Sin cuerpo (p. ej. POST /api/reset del evaluador) no se exige.
 *
 * Los clientes de confianza (el evaluador y curl) no mandan `Origin` y no se ven
 * afectados. Los que mandan cuerpo ya usan application/json.
 */

/** Tipos "simples" que un formulario o un no-cors puede enviar sin preflight. */
const JSON = /^application\/(?:[\w.+-]+\+)?json\s*(?:;|$)/i;

/**
 * Normaliza un Host/Origin para comparar: minusculas y sin el punto final
 * ("localhost.:8787" y "LOCALHOST:8787" son el mismo sitio).
 * @param {string} valor
 * @returns {string}
 */
function normalizar(valor) {
  return String(valor || "").trim().toLowerCase().replace(/\.(?=:\d+$)|\.$/, "");
}

/**
 * Hosts que aceptamos. Siempre los de loopback; ademas el host configurado si no es
 * loopback (para no romper a quien arranque con --host 0.0.0.0 a proposito).
 * @param {{host: string, port: number}} args
 * @returns {Set<string>}
 */
export function hostsPermitidos(args) {
  const puerto = String(args.port);
  const out = new Set([`127.0.0.1:${puerto}`, `localhost:${puerto}`, `[::1]:${puerto}`]);
  const host = normalizar(args.host);
  if (host && host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && host !== "[::1]") {
    out.add(`${host}:${puerto}`);
    // Un bind comodin (0.0.0.0 / ::) no es un Host valido por si mismo, pero deja
    // pasar a quien entre por la IP de la maquina.
  }
  return out;
}

/**
 * Decide si una peticion puede tocar la API.
 * @param {{method?: string, headers: Record<string, string | string[] | undefined>}} req
 * @param {{host: string, port: number}} args
 * @returns {{ok: true} | {ok: false, motivo: string}}
 */
export function revisarPeticion(req, args) {
  const cabeceras = req.headers || {};
  const metodo = String(req.method || "GET").toUpperCase();

  const host = normalizar(/** @type {string} */ (cabeceras.host));
  if (!host) return { ok: false, motivo: "falta la cabecera Host" };
  if (!hostsPermitidos(args).has(host)) return { ok: false, motivo: `Host no permitido: ${host}` };

  const origen = /** @type {string | undefined} */ (cabeceras.origin);
  if (origen !== undefined && origen !== "") {
    // Los navegadores mandan el origen exacto (esquema + host + puerto). Cualquier
    // otra cosa es una web ajena; "null" es un iframe en sandbox o un file://.
    if (normalizar(origen) !== `http://${host}`) {
      return { ok: false, motivo: `Origin no permitido: ${origen}` };
    }
  }

  if (metodo !== "GET" && metodo !== "HEAD") {
    const largo = Number(cabeceras["content-length"] || 0);
    const conCuerpo = (Number.isFinite(largo) && largo > 0) || Boolean(cabeceras["transfer-encoding"]);
    if (conCuerpo) {
      const tipo = String(cabeceras["content-type"] || "");
      if (!JSON.test(tipo)) {
        return { ok: false, motivo: `Content-Type no permitido en ${metodo}: ${tipo || "(vacio)"}` };
      }
    }
  }

  return { ok: true };
}
