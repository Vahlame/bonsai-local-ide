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
 *  2. Si viene `Origin`, tiene que ser del mismo host que el `Host` aceptado. Los
 *     navegadores la mandan siempre en POST, incluso en peticiones del mismo origen.
 *     Se admiten `http://` y `https://` del MISMO host (BUG-01: un tunel o un proxy
 *     TLS delante del IDE reescribe el esquema, pero no el host ni el puerto).
 *  3. Si el POST lleva cuerpo, `Content-Type` tiene que ser application/json. Un
 *     formulario o un `no-cors` cross-origin solo pueden mandar tipos "simples"
 *     (text/plain, application/x-www-form-urlencoded, multipart/form-data); para
 *     poner application/json haria falta un preflight CORS, que este servidor no
 *     concede. Sin cuerpo (p. ej. POST /api/reset del evaluador) no se exige.
 *
 * BIND COMODIN (`--host 0.0.0.0` / `--host ::`) Y LAN (BUG-01)
 * Con un bind comodin el servidor si escucha en la LAN, pero el cliente real manda
 * en `Host` la IP de la maquina por la que entro (p. ej. 192.168.1.50:8787), no
 * "0.0.0.0". Por eso, SOLO con bind comodin, se aceptan tambien:
 *  - las direcciones IPv4/IPv6 asignadas a las interfaces de esta maquina,
 *  - el nombre de la maquina (para quien entra por `http://mi-pc:8787`),
 * siempre con el MISMO puerto. No se acepta "cualquier dominio con el puerto
 * correcto": eso reabriria justo el DNS rebinding que la regla 1 corta.
 * Con `--host` concreto se acepta ese host (y el loopback, que no estorba).
 *
 * Los clientes de confianza (el evaluador y curl) no mandan `Origin` y no se ven
 * afectados. Los que mandan cuerpo ya usan application/json.
 */

import net from "node:net";
import os from "node:os";

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
 * Da formato de cabecera `Host` a una direccion: IPv6 entre corchetes y sin zona.
 * @param {string} valor
 * @returns {string}
 */
function formatearHost(valor) {
  const limpio = String(valor || "").trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
  return net.isIPv6(limpio) ? `[${limpio}]` : limpio;
}

/**
 * Un bind comodin no identifica un host concreto: escucha en todas las interfaces.
 * @param {string} valor valor de `--host`
 * @returns {boolean}
 */
export function esHostComodin(valor) {
  const host = normalizar(valor);
  return host === "0.0.0.0" || host === "::" || host === "[::]";
}

/**
 * Hosts que identifican a ESTA maquina y que un cliente de la LAN puede poner en
 * `Host`: las direcciones de sus interfaces y su nombre. Se usan solo con bind
 * comodin; nunca se acepta un dominio arbitrario.
 * @param {string} puerto
 * @returns {Set<string>}
 */
function hostsDeLaMaquina(puerto) {
  const out = [];
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const direccion of lista || []) {
      if (!direccion || !direccion.address) continue;
      out.push(`${formatearHost(direccion.address)}:${puerto}`);
    }
  }
  try {
    const nombre = formatearHost(os.hostname());
    if (nombre) out.push(`${nombre}:${puerto}`);
  } catch {
    /* sin nombre de maquina: no pasa nada, quedan las IPs */
  }
  return new Set(out);
}

/**
 * Hosts que aceptamos. Siempre los de loopback; ademas el host configurado si es
 * concreto, o los de la maquina (IPs y nombre) si el bind es comodin. El puerto
 * tiene que coincidir siempre.
 * @param {{host: string, port: number}} args
 * @returns {Set<string>}
 */
export function hostsPermitidos(args) {
  const puerto = String(args.port);
  const out = new Set([`127.0.0.1:${puerto}`, `localhost:${puerto}`, `[::1]:${puerto}`]);
  const host = normalizar(args.host);
  if (!host) return out;
  if (esHostComodin(host)) {
    // El propio valor del flag no es un Host real, pero se acepta por comodidad
    // (curl --header "Host: 0.0.0.0:puerto") y para no romper el comportamiento previo.
    out.add(`${host}:${puerto}`);
    const formateado = formatearHost(host);
    if (formateado) out.add(`${formateado}:${puerto}`);
    for (const permitido of hostsDeLaMaquina(puerto)) out.add(permitido);
    return out;
  }
  out.add(`${formatearHost(host)}:${puerto}`);
  return out;
}

/**
 * Un Origin es valido si es http/https, sin credenciales ni ruta, y su host:puerto
 * coincide EXACTAMENTE con el Host aceptado de la peticion. "null" (iframe en
 * sandbox / file://) y cualquier otro esquema se rechazan.
 * @param {string} origen
 * @param {string} host Host ya normalizado y aceptado
 * @returns {boolean}
 */
function origenPermitido(origen, host) {
  /** @type {URL} */
  let url;
  try {
    url = new URL(String(origen).trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  // La cabecera Origin es solo esquema + host + puerto; nada de rutas ni parametros.
  if (url.pathname !== "/" || url.search || url.hash) return false;
  return url.origin.toLowerCase() === `${url.protocol}//${host}`;
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
    // "null" es un iframe en sandbox o un file://; el resto, una web ajena.
    if (!origenPermitido(origen, host)) return { ok: false, motivo: `Origin no permitido: ${origen}` };
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
