/** Búsqueda, inspección y cabeceras de Hugging Face y URLs directas. */
import path from "node:path";
import { nombreArchivoSeguro } from "../model-plan.mjs";
import { fetchRemoto, validarUrlRemota } from "../red-segura.mjs";
import { ALLOW_PRIVATE, USER_AGENT } from "./common.mjs";

export async function buscarHuggingFace(q, opciones = {}) {
  const consulta = String(q || "").trim();
  if (!consulta) return [];
  const limite = Math.max(1, Math.min(40, Number(opciones.limit) || 24));
  const url = new URL("https://huggingface.co/api/models");
  url.searchParams.set("search", consulta);
  url.searchParams.set("filter", "gguf");
  url.searchParams.set("sort", "downloads");
  url.searchParams.set("direction", "-1");
  url.searchParams.set("limit", String(limite));
  url.searchParams.set("full", "true");
  const datos = await pedirJson(url.toString());
  if (!Array.isArray(datos)) return [];
  return datos
    .filter((m) => !m.private && (m.tags || []).some((t) => String(t).toLowerCase() === "gguf"))
    .map((m) => ({
      repo: m.id,
      nombre: m.id,
      descargas: Number(m.downloads) || 0,
      likes: Number(m.likes) || 0,
      actualizado: m.lastModified || "",
      licencia: m.cardData?.license || (m.tags || []).find((t) => String(t).startsWith("license:"))?.slice(8) || "",
      etiquetas: m.tags || [],
      tarea: m.pipeline_tag || "",
    }));
}

/**
 * Catálogo online de novedades: los GGUF con más tracción ahora mismo.
 * Es la pestaña "Descubrir"; no descarga nada hasta que el usuario elige.
 * @param {{limit?: number, sort?: string}} [opciones]
 */
export async function descubrirHuggingFace(opciones = {}) {
  const limite = Math.max(1, Math.min(60, Number(opciones.limit) || 30));
  const orden = ["trendingScore", "downloads", "likes", "lastModified"].includes(String(opciones.sort))
    ? String(opciones.sort)
    : "trendingScore";
  const url = new URL("https://huggingface.co/api/models");
  url.searchParams.set("filter", "gguf");
  url.searchParams.set("sort", orden);
  url.searchParams.set("direction", "-1");
  url.searchParams.set("limit", String(limite));
  url.searchParams.set("full", "true");
  const datos = await pedirJson(url.toString());
  if (!Array.isArray(datos)) return [];
  return datos
    .filter((m) => !m.private)
    .map((m) => ({
      repo: m.id,
      nombre: m.id,
      descargas: Number(m.downloads) || 0,
      likes: Number(m.likes) || 0,
      actualizado: m.lastModified || "",
      licencia: m.cardData?.license || (m.tags || []).find((t) => String(t).startsWith("license:"))?.slice(8) || "",
      etiquetas: (m.tags || []).filter((t) => !String(t).startsWith("base_model:") && !String(t).startsWith("license:")),
      tarea: m.pipeline_tag || "",
      vision: (m.tags || []).some((t) => /vision|multimodal|image-text|image-to-text/i.test(String(t))),
      tendencia: Number(m.trendingScore) || 0,
    }));
}

/** @param {string} repo */
export async function inspeccionarRepo(repo) {
  const id = String(repo || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new Error(`repo de Hugging Face no válido: ${repo}`);
  const datos = await pedirJson(`https://huggingface.co/api/models/${id}?blobs=true`);
  if (!datos || !Array.isArray(datos.siblings)) throw new Error(`no se pudo leer el repo ${id}`);
  const archivos = datos.siblings
    .filter((s) => /\.gguf$/i.test(String(s.rfilename || "")))
    .map((s) => {
      const nombre = String(s.rfilename);
      return {
        archivo: nombre,
        bytes: Number(s.size) || 0,
        quant: (nombre.match(/(?:^|[-_.])((?:IQ|Q|UD-Q|UD-IQ)\d[^./]*|f16|bf16|q8_0|q4_0)/i) || [])[1] || "",
        vision: /^mmproj/i.test(nombre) || /mmproj/i.test(nombre),
        lfs: s.lfs?.oid || "",
      };
    })
    .sort((a, b) => Number(a.vision) - Number(b.vision) || a.bytes - b.bytes);
  return {
    repo: id,
    revision: datos.sha || "main",
    nombre: id,
    descargas: Number(datos.downloads) || 0,
    likes: Number(datos.likes) || 0,
    licencia: datos.cardData?.license || "",
    actualizado: datos.lastModified || "",
    gated: Boolean(datos.gated),
    archivos,
    principales: archivos.filter((a) => !a.vision),
    proyectores: archivos.filter((a) => a.vision),
  };
}

/**
 * @param {string} url
 * @param {number} [timeout]
 */
async function pedirJson(url, timeout = 20000) {
  const res = await fetch(url, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al leer ${url}`);
  return res.json();
}

/**
 * Valida una URL de descarga. Solo HTTPS; por defecto rechaza hosts privados.
 * @param {string} url
 * @param {{allowPrivate?: boolean}} [opciones]
 * @returns {URL}
 */
export function validarUrl(url, opciones = {}) {
  const permitirPrivado = opciones.allowPrivate ?? ALLOW_PRIVATE;
  let u;
  try {
    u = new URL(String(url));
  } catch {
    throw new Error(`URL no válida: ${url}`);
  }
  if (u.username || u.password) throw new Error("la URL no puede llevar credenciales");
  if (u.protocol === "https:") return comprobarHost(u, permitirPrivado);
  if (permitirPrivado && u.protocol === "http:") return comprobarHost(u, permitirPrivado);
  throw new Error("la descarga debe usar HTTPS");
}

/** @param {URL} u @param {boolean} permitirPrivado */
function comprobarHost(u, permitirPrivado) {
  if (permitirPrivado) return u;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const privado = host === "localhost" || host === "::1" || host.endsWith(".local") ||
    host === "metadata.google.internal" || host === "metadata.azure.com" ||
    /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^0\.0\.0\.0$/.test(host) || /^fc|^fd|^fe80/i.test(host);
  if (privado) throw new Error(`host privado no permitido para descargas: ${host}`);
  return u;
}

/**
 * Convierte `hf://owner/repo/archivo.gguf`, una URL de Hugging Face
 * (`/resolve/` o `/blob/`) o un `repo/archivo` explícito en un pedido de Hub.
 * No descarga ni valida el destino: eso lo hace `archivoHF` con la política de
 * red. Devuelve null si el texto no parece un origen de Hugging Face.
 * @param {string} texto
 * @returns {{repo: string, archivo: string, revision: string} | null}
 */
export function parsearOrigenHf(texto) {
  const crudo = String(texto || "").trim();
  if (!crudo) return null;
  // hf://owner/repo/archivo.gguf  |  hf://owner/repo@revision/archivo.gguf
  if (/^hf:\/\//i.test(crudo)) {
    const resto = crudo.replace(/^hf:\/\//i, "");
    const partes = resto.split("/").filter(Boolean);
    if (partes.length < 3) return null;
    let revision = "main";
    let nombreRepo = partes[1];
    const conRevision = nombreRepo.match(/^(.+)@([A-Za-z0-9._-]+)$/);
    if (conRevision) {
      nombreRepo = conRevision[1];
      revision = conRevision[2];
    }
    const repo = `${partes[0]}/${nombreRepo}`;
    const archivo = partes.slice(2).join("/");
    if (!archivo || !/\.gguf$/i.test(archivo)) return null;
    return { repo, archivo, revision };
  }
  let u;
  try { u = new URL(crudo); } catch { return null; }
  if (u.hostname !== "huggingface.co" && u.hostname !== "www.huggingface.co") return null;
  const partes = u.pathname.split("/").filter(Boolean);
  if (partes.length < 4) return null;
  const repo = `${partes[0]}/${partes[1]}`;
  const marcador = partes[2];
  if (marcador === "resolve" || marcador === "blob") {
    const revision = partes[3] || "main";
    const archivo = partes.slice(4).join("/");
    if (!archivo || !/\.gguf$/i.test(archivo)) return null;
    return { repo, archivo, revision };
  }
  return null;
}


/**
 * Lee tamaño y SHA-256 de un archivo remoto sin descargarlo. HF expone
 * `x-linked-etag` con el SHA-256 del blob; si no, se usa ETag o el valor
 * aportado por el catálogo curado.
 *
 * Las opciones (`allowPrivate`, `fetcher`, `resolver`) existen para pruebas y
 * para el escape explícito del Hub; nunca se reenvían desde una tool call.
 * @param {string} url
 * @param {{allowPrivate?: boolean, allowHttp?: boolean, fetcher?: typeof fetch, resolver?: (host: string, options: {all: true, verbatim: true}) => Promise<Array<{address: string}>>}} [opciones]
 * @returns {Promise<{bytes: number, sha256: string, aceptaRangos: boolean}>}
 */
export async function cabeceraRemota(url, opciones = {}) {
  const permitirPrivado = opciones.allowPrivate ?? ALLOW_PRIVATE;
  const red = { allowPrivate: permitirPrivado, allowHttp: opciones.allowHttp ?? permitirPrivado, fetcher: opciones.fetcher, resolver: opciones.resolver };
  const u = await validarUrlRemota(url, red);
  // HF responde 302 hacia su CDN y el SHA-256 del blob viaja en la cabecera
  // `x-linked-etag` DE LA REDIRECCIÓN. Con redirect:"follow" se pierde, así
  // que se pide manualmente y después se completa el tamaño en el destino.
  try {
    const res = await (opciones.fetcher || fetch)(u, { method: "HEAD", redirect: "manual", headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(25000) });
    if (res.status >= 300 && res.status < 400) {
      const cab = leerCabecera(res);
      const destino = res.headers.get("location");
      if (destino) {
        try {
          const destinoUrl = new URL(destino, u);
          await validarUrlRemota(destinoUrl, red);
          const final = await fetchRemoto(destinoUrl, { method: "HEAD", headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(25000) }, red);
          if (final.ok) {
            const tam = Number(final.headers.get("content-length") || 0) || 0;
            if (!cab.bytes && tam) cab.bytes = tam;
          }
        } catch { /* el tamaño puede venir de x-linked-size */ }
      }
      if (cab.bytes) return cab;
    } else if (res.ok) {
      return leerCabecera(res);
    }
  } catch {
    /* algunos CDN no admiten HEAD; se prueba un GET de 1 byte */
  }
  // También aquí redirect:"manual" + revalidación de cada Location. Un CDN
  // comprometido no puede convertir el fallback en un SSRF.
  const res = await fetchRemoto(u, { headers: { "user-agent": USER_AGENT, range: "bytes=0-0" }, signal: AbortSignal.timeout(25000) }, red);
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} al inspeccionar ${url}`);
  const cab = leerCabecera(res);
  const rango = String(res.headers.get("content-range") || "");
  const m = rango.match(/bytes\s+\d+-\d+\/(\d+)/i);
  if (!cab.bytes && m) cab.bytes = Number(m[1]);
  if (res.body) {
    try { await res.body.cancel(); } catch { /* el cuerpo de 1 byte da igual */ }
  }
  return cab;
}

/** @param {Response} res */
function leerCabecera(res) {
  const h = res.headers;
  const etag = String(h.get("x-linked-etag") || h.get("etag") || "").replace(/^W\//, "").replace(/^"|"$/g, "");
  const sha = /^[a-f0-9]{64}$/i.test(etag) ? etag.toLowerCase() : "";
  const bytes = Number(h.get("x-linked-size") || h.get("content-length") || 0) || 0;
  return { bytes, sha256: sha, aceptaRangos: String(h.get("accept-ranges") || "").toLowerCase().includes("bytes") };
}

/**
 * Inspecciona un archivo de un repo de Hugging Face y devuelve la URL fijada a
 * la revisión (commit), no a `main`, para que la descarga sea reproducible.
 * @param {string} repo
 * @param {string} archivo
 * @param {string} [revision]
 */
export async function archivoHF(repo, archivo, revision = "main") {
  const id = String(repo || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new Error(`repo no válido: ${repo}`);
  const limpio = String(archivo || "").replace(/\\/g, "/");
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._()+@/-]*\.gguf$/i.test(limpio) || limpio.includes("..")) {
    throw new Error(`archivo no válido: ${archivo}`);
  }
  const nombre = nombreArchivoSeguro(path.basename(limpio));
  const rev = String(revision || "main");
  if (!/^[A-Za-z0-9._-]+$/.test(rev)) throw new Error(`revisión no válida: ${revision}`);
  const ruta = limpio.split("/").map((s) => encodeURIComponent(s)).join("/");
  const url = `https://huggingface.co/${id}/resolve/${rev}/${ruta}`;
  const cab = await cabeceraRemota(url);
  return { url, archivo: nombre, bytes: cab.bytes, sha256: cab.sha256, revision: rev, repo: id };
}

/**
 * @param {unknown} url
 * @param {{nombre?: string, bytes?: number, sha256?: string}} [datos]
 */
export async function archivoUrlDirecta(url, datos = {}) {
  const u = await validarUrlRemota(String(url), { allowPrivate: ALLOW_PRIVATE, allowHttp: ALLOW_PRIVATE });
  const nombre = nombreArchivoSeguro(datos.nombre || decodeURIComponent(path.basename(u.pathname)));
  const cab = await cabeceraRemota(u.toString());
  return {
    url: u.toString(),
    archivo: nombre,
    bytes: Number(datos.bytes) || cab.bytes,
    sha256: String(datos.sha256 || cab.sha256 || "").toLowerCase(),
    revision: "",
    repo: "",
  };
}

/**
 * Crea un trabajo de descarga. No espera a que termine.
 * @param {{
 *   clave?: string, nombre?: string, repo?: string, revision?: string,
 *   archivo?: string, url?: string, bytes?: number, sha256?: string,
 *   vision?: {archivo: string, bytes?: number, sha256?: string, url?: string},
 *   rol?: string, uso?: string, licencia?: string, origen?: string,
 *   pensar?: any, muestreo?: any, agente?: any, toolcalls?: string,
 * }} pedido
 */
