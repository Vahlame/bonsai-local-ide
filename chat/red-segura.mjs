/**
 * Política de red saliente del IDE.
 *
 * Todo fetch a Internet (búsqueda web, Model Hub, MCP) pasa por aquí. La regla
 * es: validar el host, resolver DNS, comprobar TODAS las IPs y revalidar cada
 * redirección. Así no basta con un dominio que resuelve a 127.0.0.1 ni con un
 * 302 hacia la red interna.
 */
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/** Nombres de metadatos de nube: se bloquean siempre, incluso con allowPrivate. */
const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.google.internal.",
  "169.254.169.254",
  "fd00:ec2::254",
  "metadata.azure.com",
]);

/**
 * @param {string} host
 * @returns {boolean}
 */
export function esHostMetadata(host) {
  const limpio = String(host || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  return METADATA_HOSTS.has(limpio);
}

/**
 * ¿La IP es privada, loopback, link-local, reservada o de documentación?
 * @param {string} ip
 * @returns {boolean}
 */
export function esIpPrivada(ip) {
  const limpio = String(ip || "").trim().replace(/^\[|\]$/g, "").toLowerCase();
  const version = net.isIP(limpio);
  if (version === 4) {
    const [a, b, c] = limpio.split(".").map(Number);
    return a === 0
      || a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 192 && b === 0 && (c === 0 || c === 2))
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a >= 224;
  }
  if (version === 6) {
    if (limpio === "::" || limpio === "::1") return true;
    if (/^f[cd][0-9a-f]{2}:/.test(limpio)) return true; // fc00::/7
    if (/^fe[89ab][0-9a-f]:/.test(limpio)) return true; // fe80::/10
    if (/^ff[0-9a-f]{2}:/.test(limpio)) return true; // multicast
    if (/^2001:db8:/.test(limpio)) return true; // documentación
    // IPv4 mapeada: ::ffff:127.0.0.1 y su forma hexadecimal ::ffff:7f00:1.
    const mapped = limpio.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return esIpPrivada(mapped[1]);
    const mappedHex = limpio.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const alto = Number.parseInt(mappedHex[1], 16);
      const bajo = Number.parseInt(mappedHex[2], 16);
      return esIpPrivada(`${alto >> 8}.${alto & 255}.${bajo >> 8}.${bajo & 255}`);
    }
    // IPv4 compatible (obsoleta pero aún aceptada por algunos resolutores).
    const compatible = limpio.match(/^::(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (compatible) return esIpPrivada(compatible[1]);
  }
  return false;
}

/**
 * Resuelve un host a todas sus IPs. Si ya es una IP, no consulta DNS.
 * @param {string} host
 * @param {{resolver?: (host: string, options: {all: true, verbatim: true}) => Promise<Array<{address: string}>>}} [opciones]
 * @returns {Promise<string[]>}
 */
export async function resolverHost(host, { resolver = dns.lookup } = {}) {
  const limpio = String(host || "").trim().replace(/^\[|\]$/g, "");
  if (!limpio) throw new Error("URL sin host");
  if (net.isIP(limpio)) return [limpio];
  const filas = await resolver(limpio, { all: true, verbatim: true });
  const ips = (Array.isArray(filas) ? filas : [filas])
    .map((fila) => (typeof fila === "string" ? fila : fila?.address))
    .filter((ip) => typeof ip === "string" && ip);
  if (!ips.length) throw new Error(`no se pudo resolver el host: ${limpio}`);
  return ips;
}

/**
 * Comprobaciones que no necesitan DNS: credenciales, metadatos, puerto y
 * protocolo. Devuelve el host normalizado para resolverlo después.
 *
 * @param {string | URL} raw
 * @param {{allowPrivate?: boolean, allowHttp?: boolean, blockedPorts?: Array<string | number>}} opciones
 * @returns {{url: URL, host: string, allowPrivate: boolean}}
 */
function validarBasica(raw, opciones) {
  const allowPrivate = opciones.allowPrivate === true;
  const bloqueados = new Set((opciones.blockedPorts || []).map(String));
  let url;
  try {
    url = raw instanceof URL ? new URL(raw.href) : new URL(String(raw));
  } catch {
    throw new Error(`URL no válida: ${raw}`);
  }
  if (url.username || url.password) throw new Error("la URL no puede llevar credenciales");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (esHostMetadata(host)) throw new Error("Endpoint de metadatos de nube no permitido");
  const puerto = url.port || (url.protocol === "https:" ? "443" : "80");
  if (bloqueados.has(puerto)) throw new Error("ese puerto pertenece al IDE o al modelo");
  return { url, host, allowPrivate };
}

/**
 * @param {URL} url
 * @param {boolean} allowHttp
 */
function comprobarProtocolo(url, allowHttp) {
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw new Error("la conexión debe usar HTTPS");
  }
}

/**
 * @param {string} host
 * @param {string[]} ips
 */
function comprobarPrivadas(host, ips) {
  const privada = ips.find((ip) => esIpPrivada(ip));
  if (!privada) return;
  const etiqueta = privada.includes(":") || host.includes(":")
    ? "IPv6 privada/loopback/metadatos no permitida"
    : "Dirección privada/loopback/metadatos no permitida";
  throw new Error(`${etiqueta}: ${host} -> ${privada}. Usa allowPrivate=true solo en tests.`);
}

/**
 * Valida una URL saliente sin fijar la IP. Lanza un Error con motivo si no es
 * segura. Se mantiene para los llamadores que solo quieren comprobar la URL.
 *
 * @param {string | URL} raw
 * @param {{
 *   allowPrivate?: boolean,
 *   allowHttp?: boolean,
 *   resolver?: (host: string, options: {all: true, verbatim: true}) => Promise<Array<{address: string}>>,
 *   blockedPorts?: Array<string | number>,
 * }} [opciones]
 * @returns {Promise<URL>}
 */
export async function validarUrlRemota(raw, opciones = {}) {
  const { url, host, allowPrivate } = validarBasica(raw, opciones);
  if (!allowPrivate) {
    const ips = await resolverHost(host, { resolver: opciones.resolver });
    comprobarPrivadas(host, ips);
  }
  comprobarProtocolo(url, opciones.allowHttp === true);
  return url;
}

/**
 * Valida y devuelve también las IPs resueltas. `fetchFijado` usa la primera
 * para conectar a la IP comprobada y evitar el rebinding entre DNS y TCP.
 *
 * @param {string | URL} raw
 * @param {{
 *   allowPrivate?: boolean,
 *   allowHttp?: boolean,
 *   resolver?: (host: string, options: {all: true, verbatim: true}) => Promise<Array<{address: string}>>,
 *   blockedPorts?: Array<string | number>,
 * }} [opciones]
 * @returns {Promise<{url: URL, ips: string[]}>}
 */
export async function validarDestinoRemoto(raw, opciones = {}) {
  const { url, host, allowPrivate } = validarBasica(raw, opciones);
  const ips = await resolverHost(host, { resolver: opciones.resolver });
  if (!allowPrivate) comprobarPrivadas(host, ips);
  comprobarProtocolo(url, opciones.allowHttp === true);
  return { url, ips };
}

/**
 * Convierte la respuesta de `http` en un ReadableStream que no se cierra hasta
 * que el socket terminó de cerrarse. Así el llamador que lee hasta `done` no
 * deja un handle de libuv a medio cerrar al salir del proceso.
 *
 * @param {import("node:http").IncomingMessage} res
 * @returns {ReadableStream<Uint8Array>}
 */
function cuerpoWeb(res) {
  return new ReadableStream({
    start(controller) {
      let terminado = false;
      const cerrar = () => {
        if (terminado) return;
        terminado = true;
        try { controller.close(); } catch { /* ya cerrado */ }
      };
      const fallar = (err) => {
        if (terminado) return;
        terminado = true;
        try { controller.error(err); } catch { /* ya cerrado */ }
      };
      res.on("data", (trozo) => {
        if (terminado) return;
        try { controller.enqueue(new Uint8Array(trozo)); } catch { res.destroy(); }
      });
      res.on("end", () => {
        const socket = res.socket;
        if (!socket || socket.destroyed) cerrar();
        else socket.once("close", cerrar);
      });
      res.on("error", fallar);
      res.on("aborted", () => fallar(new Error("respuesta interrumpida")));
    },
    cancel() {
      if (!res.destroyed) res.destroy();
    },
  });
}

/**
 * @param {URL} url
 * @param {string[]} ips
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
function fetchFijadoConDestino(url, ips, init = {}) {
  // Preferir IPv4 cuando exista: muchos servicios locales escuchan solo en
  // 127.0.0.1 aunque `localhost` resuelva primero a ::1.
  const ip = ips.find((direccion) => net.isIP(direccion) === 4) || ips[0];
  if (!ip) return Promise.reject(new Error("no se pudo fijar la IP del destino"));
  const esHttps = url.protocol === "https:";
  const lib = esHttps ? https : http;
  /** @type {Record<string, string>} */
  const headers = {};
  if (init.headers instanceof Headers) init.headers.forEach((valor, clave) => { headers[clave] = valor; });
  else Object.assign(headers, init.headers || {});
  if (!Object.keys(headers).some((clave) => clave.toLowerCase() === "host")) headers.host = url.host;
  return new Promise((resolve, reject) => {
    const req = lib.request({
      protocol: url.protocol,
      hostname: ip,
      port: url.port || (esHttps ? "443" : "80"),
      path: `${url.pathname}${url.search}`,
      method: init.method || "GET",
      headers,
      servername: esHttps ? url.hostname.replace(/^\[|\]$/g, "") : undefined,
      lookup: (_hostname, _opciones, callback) => callback(null, ip, net.isIP(ip) === 6 ? 6 : 4),
      signal: init.signal,
      // Sin keep-alive: una descarga no reutiliza el socket y así no quedan
      // conexiones vivas al cerrar el proceso o cancelar un trabajo.
      agent: false,
    }, (res) => {
      const cabeceras = new Headers();
      for (const [clave, valor] of Object.entries(res.headers)) {
        if (Array.isArray(valor)) for (const item of valor) cabeceras.append(clave, item);
        else if (valor !== undefined) cabeceras.set(clave, String(valor));
      }
      const metodo = String(init.method || "GET").toUpperCase();
      const sinCuerpo = metodo === "HEAD" || res.statusCode === 204 || res.statusCode === 304;
      // Sin cuerpo hay que drenar la respuesta: si se deja pausada, el socket
      // queda abierto y el proceso puede terminar con handles a medio cerrar.
      if (sinCuerpo) res.resume();
      const cuerpo = sinCuerpo ? null : cuerpoWeb(res);
      const response = new Response(cuerpo, {
        status: res.statusCode || 0,
        statusText: res.statusMessage || "",
        headers: cabeceras,
      });
      try {
        Object.defineProperty(response, "url", { value: url.href, configurable: true });
      } catch {
        /* Response.url es de solo lectura en algunos runtimes */
      }
      if (sinCuerpo) {
        // Esperar al cierre real del socket antes de entregar la respuesta:
        // un HEAD/304 no tiene cuerpo que consuma el llamador.
        let entregado = false;
        const entregar = () => {
          if (entregado) return;
          entregado = true;
          resolve(response);
        };
        if (res.readableEnded || res.destroyed) {
          entregar();
          return;
        }
        res.once("end", () => {
          const socket = res.socket;
          if (!socket || socket.destroyed) entregar();
          else socket.once("close", entregar);
        });
        res.once("close", entregar);
        res.resume();
        return;
      }
      resolve(response);
    });
    req.on("error", reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

/**
 * Fetch que conecta a la IP ya comprobada, no a lo que el DNS devuelva en el
 * último momento. Mantiene el `Host` y el SNI originales.
 *
 * @param {string | URL} raw
 * @param {RequestInit} [init]
 * @param {{
 *   allowPrivate?: boolean,
 *   allowHttp?: boolean,
 *   resolver?: (host: string, options: {all: true, verbatim: true}) => Promise<Array<{address: string}>>,
 *   blockedPorts?: Array<string | number>,
 * }} [opciones]
 * @returns {Promise<Response>}
 */
export async function fetchFijado(raw, init = {}, opciones = {}) {
  const { url, ips } = await validarDestinoRemoto(raw, opciones);
  return fetchFijadoConDestino(url, ips, init);
}

/**
 * Fetch con redirecciones manuales y revalidación en cada salto. Por defecto
 * fija la IP resuelta; `fetcher` queda solo para pruebas con respuestas falsas.
 *
 * @param {string | URL} raw
 * @param {RequestInit} [init]
 * @param {{
 *   allowPrivate?: boolean,
 *   allowHttp?: boolean,
 *   resolver?: (host: string, options: {all: true, verbatim: true}) => Promise<Array<{address: string}>>,
 *   blockedPorts?: Array<string | number>,
 *   maxRedirects?: number,
 *   fetcher?: typeof fetch,
 * }} [opciones]
 * @returns {Promise<Response>}
 */
export async function fetchRemoto(raw, init = {}, opciones = {}) {
  const fetcher = opciones.fetcher;
  const maxRedirects = opciones.maxRedirects ?? 5;
  let actual = raw instanceof URL ? raw.href : String(raw);
  for (let salto = 0; salto <= maxRedirects; salto += 1) {
    let url;
    let ips;
    if (fetcher) {
      url = await validarUrlRemota(actual, opciones);
    } else {
      const destino = await validarDestinoRemoto(actual, opciones);
      url = destino.url;
      ips = destino.ips;
    }
    const res = fetcher
      ? await fetcher(url, { ...init, redirect: "manual" })
      : await fetchFijadoConDestino(url, ips, init);
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!location) throw new Error(`redirección sin Location: ${url.href}`);
      actual = new URL(location, url).href;
      continue;
    }
    return res;
  }
  throw new Error("demasiadas redirecciones (máximo 5)");
}
