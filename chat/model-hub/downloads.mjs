/** Descargas reanudables, trabajos, hash e importación de modelos. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { nombreArchivoSeguro } from "../model-plan.mjs";
import { MODELO } from "../modelo.mjs";
import { ALLOW_PRIVATE, HUB_FILE, MAX_PARALELOS, MIB, MODELS_DIR, USER_AGENT, log } from "./common.mjs";
import { existeArchivo, fusionarCatalogo, guardarRegistro, leerCurado, leerRegistro, registrarArchivo, tamanoArchivo } from "./store.mjs";
import { fetchRemoto, validarUrlRemota } from "../red-segura.mjs";
import { archivoHF, archivoUrlDirecta, cabeceraRemota } from "./remote.mjs";
import { abortos, cancelarTrabajo, listarTrabajos, podarTrabajos, publicoTrabajo, trabajos } from "./jobs.mjs";


export async function crearTrabajo(pedido = {}) {
  const activos = [...trabajos.values()].filter((t) => t.estado === "descargando" || t.estado === "verificando" || t.estado === "instalando");
  if (activos.length >= MAX_PARALELOS) throw new Error(`ya hay ${activos.length} descargas en curso; espera o cancela una`);
  /** @type {ArchivoDescarga[]} */
  const archivos = [];
  let origen = String(pedido.origen || "");
  let repo = String(pedido.repo || "");
  let revision = String(pedido.revision || "main");
  let clave = String(pedido.clave || "");
  let nombre = String(pedido.nombre || "");
  let licencia = String(pedido.licencia || "");
  /** Prefijo local para no pisar proyectores homónimos de otros modelos. */
  const localizar = (a, prefijo) => {
    const p = String(prefijo || "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
    return p ? { ...a, archivo: nombreArchivoSeguro(`${p}-${a.archivo}`) } : a;
  };

  if (pedido.url && !pedido.repo) {
    const a = await archivoUrlDirecta(pedido.url, { nombre: pedido.archivo || pedido.nombre, bytes: pedido.bytes, sha256: pedido.sha256 });
    archivos.push({ ...a, tipo: "modelo" });
    origen = origen || "url";
  } else {
    if (!pedido.repo && pedido.clave) {
      const curado = leerCurado().modelos.find((m) => m.clave === pedido.clave || m.id === pedido.clave);
      if (!curado) throw new Error(`la clave ${pedido.clave} no está en el catálogo curado`);
      repo = curado.repo || "";
      revision = curado.revision || "main";
      nombre = nombre || curado.nombre || "";
      licencia = licencia || curado.licencia || "";
      origen = origen || (repo ? `https://huggingface.co/${repo}` : "");
      if (repo && curado.archivo) {
        const a = await archivoHF(repo, curado.archivo, revision);
        archivos.push({ ...localizar(a, curado.clave || clave), bytes: Number(curado.bytes) || a.bytes, sha256: curado.sha256 || a.sha256, tipo: "modelo" });
      }
      if (curado.vision?.archivo) {
        if (curado.vision.url) {
          const a = await archivoUrlDirecta(curado.vision.url, { nombre: curado.vision.archivo, bytes: curado.vision.bytes, sha256: curado.vision.sha256 });
          archivos.push({ ...localizar(a, curado.clave || clave), tipo: "vision" });
        } else if (repo) {
          const a = await archivoHF(repo, curado.vision.archivo, revision);
          archivos.push({ ...localizar(a, curado.clave || clave), bytes: Number(curado.vision.bytes) || a.bytes, sha256: curado.vision.sha256 || a.sha256, tipo: "vision" });
        }
      }
      if (curado.url && !archivos.length) {
        const a = await archivoUrlDirecta(curado.url, { nombre: curado.archivo || curado.nombre, bytes: curado.bytes, sha256: curado.sha256 });
        archivos.push({ ...localizar(a, curado.clave || clave), tipo: "modelo" });
        origen = origen || "url";
      }
    } else {
      if (!repo || !pedido.archivo) throw new Error("faltan repo y archivo para descargar");
      const a = await archivoHF(repo, pedido.archivo, revision);
      const prefijo = String(pedido.clave || repo.split("/").pop() || "modelo");
      archivos.push({ ...localizar(a, prefijo), bytes: Number(pedido.bytes) || a.bytes, sha256: pedido.sha256 || a.sha256, tipo: "modelo" });
      origen = origen || `https://huggingface.co/${repo}`;
      if (pedido.vision?.archivo) {
        const v = await archivoHF(repo, pedido.vision.archivo, revision);
        archivos.push({ ...localizar(v, prefijo), bytes: Number(pedido.vision.bytes) || v.bytes, sha256: pedido.vision.sha256 || v.sha256, tipo: "vision" });
      }
    }
  }
  if (!archivos.length) throw new Error("no hay archivos que descargar");
  for (const a of archivos) {
    if (!a.bytes) throw new Error(`no se pudo saber el tamaño de ${a.archivo}`);
    if (existeArchivo(a.archivo) && tamanoArchivo(a.archivo) === a.bytes) {
      a.url = ""; // ya está entero; se omite la descarga
    }
  }
  const total = archivos.reduce((s, a) => s + (a.url ? a.bytes : 0), 0);
  const id = `dl_${crypto.randomBytes(8).toString("hex")}`;
  /** @type {Trabajo} */
  const trabajo = {
    id,
    clave: clave || "",
    nombre: nombre || archivos[0].archivo.replace(/\.gguf$/i, ""),
    repo,
    origen: origen || (repo ? `https://huggingface.co/${repo}` : "url"),
    archivos,
    estado: total > 0 ? "descargando" : "instalando",
    progreso: total > 0 ? 0 : 100,
    bytesHechos: 0,
    totalBytes: total,
    velocidad: 0,
    eta: 0,
    archivoActual: "",
    error: "",
    inicio: Date.now(),
    fin: 0,
    cancelado: false,
  };
  trabajos.set(id, trabajo);
  podarTrabajos();
  void ejecutarTrabajo(trabajo, pedido).catch((error) => {
    trabajo.estado = "error";
    trabajo.error = error instanceof Error ? error.message : String(error);
    trabajo.fin = Date.now();
    log(`descarga ${id} falló: ${trabajo.error}`);
  });
  return { id, trabajo: publicoTrabajo(trabajo) };
}

/**
 * @param {Trabajo} trabajo
 * @param {Record<string, any>} pedido
 */
async function ejecutarTrabajo(trabajo, pedido) {
  try {
    for (const archivo of trabajo.archivos) {
      if (!archivo.url) continue;
      if (trabajo.cancelado) throw new Error("descarga cancelada");
      trabajo.archivoActual = archivo.archivo;
      const antes = trabajo.bytesHechos;
      await descargarArchivo(trabajo, archivo);
      trabajo.bytesHechos = antes + archivo.bytes;
    }
    if (trabajo.cancelado) throw new Error("descarga cancelada");
    trabajo.estado = "verificando";
    trabajo.progreso = 100;
    const principal = trabajo.archivos.find((a) => a.tipo === "modelo");
    const proyector = trabajo.archivos.find((a) => a.tipo === "vision");
    if (!principal) throw new Error("no hay archivo principal");
    if (!existeArchivo(principal.archivo) || (principal.bytes && tamanoArchivo(principal.archivo) !== principal.bytes)) {
      throw new Error(`el archivo principal no quedó entero: ${principal.archivo}`);
    }
    trabajo.estado = "instalando";
    const curado = leerCurado().modelos.find((m) => m.clave === pedido.clave || (pedido.repo && m.repo === pedido.repo));
    const vision = proyector && existeArchivo(proyector.archivo)
      ? { archivo: proyector.archivo, bytes: proyector.bytes, sha256: proyector.sha256 }
      : null;
    const entrada = await registrarArchivo(principal.archivo, {
      clave: pedido.clave || trabajo.clave || curado?.clave || curado?.id || "",
      nombre: pedido.nombre || curado?.nombre || trabajo.nombre,
      rol: pedido.rol || curado?.rol || "modelo descargado",
      uso: pedido.uso || curado?.uso || "Modelo descargado desde el catálogo. El plan se calcula con su GGUF real.",
      origen: trabajo.origen,
      revision: pedido.revision || curado?.revision || "",
      licencia: pedido.licencia || curado?.licencia || "",
      vision,
      pensar: pedido.pensar || curado?.pensar,
      muestreo: pedido.muestreo || curado?.muestreo,
      agente: pedido.agente || curado?.agente,
      toolcalls: pedido.toolcalls || curado?.toolcalls,
      oculto: Boolean(pedido.oculto || curado?.oculto),
      draftPara: pedido.draftPara || curado?.draftPara,
      draft: pedido.draft || curado?.draft,
      fuente: "hub",
    });
    trabajo.clave = entrada.clave;
    trabajo.nombre = entrada.nombre;
    trabajo.estado = "listo";
    trabajo.fin = Date.now();
    trabajo.progreso = 100;
    fusionarCatalogo();
    log(`instalado ${entrada.clave} (${entrada.archivo})`);
  } catch (error) {
    trabajo.estado = trabajo.cancelado ? "cancelado" : "error";
    trabajo.error = error instanceof Error ? error.message : String(error);
    trabajo.fin = Date.now();
  } finally {
    abortos.delete(trabajo.id);
  }
}

/**
 * Descarga un archivo con reanudación. Si el servidor ignora el Range, reinicia
 * el .part desde cero (nunca concatena bytes en el orden equivocado).
 * @param {Trabajo} trabajo
 * @param {ArchivoDescarga} archivo
 */
async function descargarArchivo(trabajo, archivo) {
  const destino = path.join(MODELS_DIR, nombreArchivoSeguro(archivo.archivo));
  const parte = `${destino}.part`;
  if (existeArchivo(archivo.archivo) && tamanoArchivo(archivo.archivo) === archivo.bytes) {
    if (archivo.sha256) {
      const sha = await sha256Archivo(destino);
      if (sha !== archivo.sha256.toLowerCase()) throw new Error(`SHA-256 no coincide para ${archivo.archivo} (¿archivo ya existente distinto?)`);
    }
    return;
  }
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  let offset = fs.existsSync(parte) ? fs.statSync(parte).size : 0;
  if (offset > archivo.bytes) {
    fs.rmSync(parte, { force: true });
    offset = 0;
  }
  const control = new AbortController();
  abortos.set(trabajo.id, control);
  const url = await validarUrlRemota(archivo.url, { allowPrivate: ALLOW_PRIVATE, allowHttp: ALLOW_PRIVATE });
  const headers = { "user-agent": USER_AGENT };
  if (offset > 0) headers.range = `bytes=${offset}-`;
  const res = await fetchRemoto(url, { headers, signal: control.signal }, { allowPrivate: ALLOW_PRIVATE, allowHttp: ALLOW_PRIVATE });
  if (res.status === 416 && offset === archivo.bytes) {
    await finalizarParte(parte, destino, archivo);
    return;
  }
  if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} al descargar ${archivo.archivo}`);
  // Si se pidió un rango y el servidor responde 200, está mandando el archivo
  // completo desde el byte 0: se reescribe el .part, no se añade.
  const desdeCero = offset > 0 && res.status !== 206;
  if (desdeCero || !res.body) {
    if (!res.body) throw new Error(`respuesta sin cuerpo para ${archivo.archivo}`);
    offset = 0;
  }
  const salida = fs.createWriteStream(parte, { flags: desdeCero || offset === 0 ? "w" : "a" });
  const reader = res.body.getReader();
  let hechos = offset;
  const previos = trabajoBytesPrevios(trabajo, archivo);
  let ultimo = Date.now();
  let bytesVentana = 0;
  let completado = false;
  try {
    while (true) {
      if (trabajo.cancelado) throw new Error("descarga cancelada");
      const { done, value } = await reader.read();
      if (done) { completado = true; break; }
      if (!value) continue;
      await new Promise((resolve, reject) => {
        salida.write(Buffer.from(value), (err) => (err ? reject(err) : resolve(undefined)));
      });
      hechos += value.byteLength;
      bytesVentana += value.byteLength;
      trabajo.bytesHechos = previos + hechos;
      const ahora = Date.now();
      if (ahora - ultimo >= 500) {
        const segundos = (ahora - ultimo) / 1000;
        trabajo.velocidad = bytesVentana / segundos;
        trabajo.eta = trabajo.velocidad > 0 ? Math.max(0, (archivo.bytes - hechos) / trabajo.velocidad) : 0;
        trabajo.progreso = trabajo.totalBytes > 0 ? Math.min(99, ((previos + hechos) / trabajo.totalBytes) * 100) : 0;
        ultimo = ahora;
        bytesVentana = 0;
      }
    }
  } finally {
    await new Promise((resolve) => salida.end(resolve));
    // Cancelar un lector ya terminado puede destruir un socket que libuv está
    // cerrando; solo se cancela si la lectura quedó a medias.
    if (!completado) {
      try { await reader.cancel(); } catch { /* ya terminó */ }
    }
  }
  const talla = fs.statSync(parte).size;
  if (talla !== archivo.bytes) throw new Error(`descarga incompleta de ${archivo.archivo}: ${talla}/${archivo.bytes} bytes (se conserva el .part para reanudar)`);
  await finalizarParte(parte, destino, archivo);
  trabajo.bytesHechos = previos + talla;
}

/** @param {Trabajo} t @param {ArchivoDescarga} a */
function trabajoBytesPrevios(t, a) {
  let total = 0;
  for (const x of t.archivos) {
    if (x === a) break;
    total += x.bytes;
  }
  return total;
}

/** @param {string} parte @param {string} destino @param {ArchivoDescarga} archivo */
async function finalizarParte(parte, destino, archivo) {
  if (archivo.sha256) {
    const sha = await sha256Archivo(parte);
    if (sha !== archivo.sha256.toLowerCase()) {
      throw new Error(`SHA-256 no coincide para ${archivo.archivo}: esperado ${archivo.sha256}, obtenido ${sha}`);
    }
  }
  if (fs.existsSync(destino)) fs.rmSync(destino, { force: true });
  fs.renameSync(parte, destino);
}

/** @param {string} ruta */
export function sha256Archivo(ruta) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(ruta);
    stream.on("error", reject);
    stream.on("data", (c) => hash.update(c));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Borra un modelo instalado y sus archivos (solo dentro de models/).
 * @param {string} clave
 * @param {{confirmar?: boolean}} [opciones]
 */
export function borrarModelo(clave, opciones = {}) {
  if (opciones.confirmar !== true) throw new Error("falta confirmar el borrado del modelo");
  let registro;
  try {
    // Se lee del disco, no de la caché: así se respeta lo que otro proceso acaba
    // de añadir o quitar y el borrado no resucita entradas antiguas.
    registro = JSON.parse(fs.readFileSync(HUB_FILE, "utf8"));
  } catch {
    registro = leerRegistro();
  }
  if (!registro || typeof registro.modelos !== "object") registro = { version: 1, actualizado: "", modelos: {} };
  const entrada = registro.modelos[clave];
  if (!entrada) throw new Error(`modelo no instalado: ${clave}`);
  const archivos = [entrada.archivo, entrada.vision?.archivo].filter(Boolean);
  for (const archivo of archivos) {
    const seguro = nombreArchivoSeguro(archivo);
    const usado = Object.entries(registro.modelos).some(([k, m]) => k !== clave && (m.archivo === seguro || m.vision?.archivo === seguro));
    if (usado) continue;
    const ruta = path.join(MODELS_DIR, seguro);
    if (fs.existsSync(ruta)) fs.rmSync(ruta, { force: true });
    const parte = `${ruta}.part`;
    if (fs.existsSync(parte)) fs.rmSync(parte, { force: true });
  }
  delete registro.modelos[clave];
  guardarRegistro(registro, { merge: false });
  if (MODELO.catalogo?.[clave]?.fuente === "hub") delete MODELO.catalogo[clave];
  return { ok: true, clave, borrados: archivos };
}

/**
 * Importa un .gguf de fuera de models/ copiándolo al almacén del IDE.
 * @param {string} rutaOriginal
 * @param {{nombre?: string}} [opciones]
 */
export async function importarArchivo(rutaOriginal, opciones = {}) {
  const origen = path.resolve(String(rutaOriginal || ""));
  if (!fs.existsSync(origen) || !fs.statSync(origen).isFile()) throw new Error(`no existe el archivo: ${origen}`);
  const nombre = nombreArchivoSeguro(opciones.nombre || path.basename(origen));
  const destino = path.join(MODELS_DIR, nombre);
  if (path.resolve(destino) === origen) return registrarArchivo(nombre, { fuente: "local" });
  if (fs.existsSync(destino)) throw new Error(`ya existe models/${nombre}; no se sobrescribe`);
  fs.mkdirSync(MODELS_DIR, { recursive: true });
  fs.copyFileSync(origen, destino);
  return registrarArchivo(nombre, { fuente: "local" });
}

/** @returns {{modelos: number, descargasActivas: number, modelosDir: string, hubFile: string}} */
export function resumen() {
  const activas = [...trabajos.values()].filter((t) => ["descargando", "verificando", "instalando"].includes(t.estado));
  return {
    modelos: Object.keys(leerRegistro().modelos).length,
    descargasActivas: activas.length,
    modelosDir: MODELS_DIR,
    hubFile: HUB_FILE,
  };
}
