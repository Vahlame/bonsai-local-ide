/**
 * Hallazgo 3: el servidor de archivos del navegador no debe servir zonas privadas a
 * traves de enlaces/aliases (simbolicos o junctions) creados DENTRO del proyecto.
 *
 *   node chat/prueba-navegador-rutas.mjs
 *
 * El fallo original comprobaba `SKIP` solo sobre el nombre SOLICITADO: un junction
 * `publico` -> `.git` dejaba pedir `publico/config`. La correccion valida la ruta REAL
 * componente a componente, tambien despues de resolver `index.html` de un directorio.
 *
 * Usa una carpeta temporal de verdad (junctions reales de Windows); no toca el
 * proyecto, ni la GPU, ni el navegador del usuario.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { NavegadorLocal } from "./navegador.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-browser-rutas-"));
const root = path.join(tmp, "proyecto");
const output = path.join(tmp, "capturas");
fs.mkdirSync(root);

/** @type {string[]} */
const avisos = [];
const avisar = (texto) => {
  avisos.push(texto);
  console.warn(`aviso: ${texto}`);
};

/** Escribe un archivo del proyecto de prueba (creando subcarpetas). */
function escribir(rel, contenido) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contenido);
  return abs;
}

// Contenido publico normal (debe seguir sirviendose).
escribir("index.html", "<!doctype html><title>inicio</title>inicio normal");
escribir("publico.html", "<!doctype html><title>publico</title>publico normal");
escribir("sub/index.html", "<!doctype html><title>sub</title>sub normal");
escribir("sub/estilo.css", "body{}");
// Zonas que el servidor de archivos nunca debe exponer.
escribir(".git/config", "SECRETO_GIT");
escribir(".git/index.html", "SECRETO_GIT_HTML");
escribir(".env", "SECRETO_ENV");
escribir(".env.local", "SECRETO_ENV_LOCAL");
escribir(".env-store/secreto.txt", "SECRETO_ENV_DIR");
escribir("node_modules/paquete/index.js", "SECRETO_NODE_MODULES");
escribir("models/modelo.gguf", "SECRETO_MODELO");
escribir("bin/herramienta.exe", "SECRETO_BIN");

/**
 * Crea un alias de directorio -> destino. En Windows es un junction (no requiere
 * privilegios); en otros sistemas, un enlace simbolico de directorio.
 * @param {string} destino
 * @param {string} enlace
 * @returns {boolean} true si se creo
 */
function enlazarDirectorio(destino, enlace) {
  try {
    fs.symlinkSync(destino, enlace, process.platform === "win32" ? "junction" : "dir");
    return true;
  } catch (error) {
    avisar(`no se pudo crear el alias de directorio ${path.basename(enlace)} (${error.code})`);
    return false;
  }
}

/**
 * Crea un enlace simbolico de archivo. En Windows sin modo desarrollador ni admin
 * puede dar EPERM: entonces se avisa y se omite solo ese caso.
 * @param {string} destino
 * @param {string} enlace
 * @returns {boolean} true si se creo
 */
function enlazarArchivo(destino, enlace) {
  try {
    fs.symlinkSync(destino, enlace, "file");
    return true;
  } catch (error) {
    avisar(`se omite el caso de enlace de archivo (${error.code}: ${path.basename(enlace)})`);
    return false;
  }
}

const alias = {
  git: enlazarDirectorio(path.join(root, ".git"), path.join(root, "alias-git")),
  modulos: enlazarDirectorio(path.join(root, "node_modules"), path.join(root, "alias-npm")),
  modelos: enlazarDirectorio(path.join(root, "models"), path.join(root, "alias-modelos")),
  bin: enlazarDirectorio(path.join(root, "bin"), path.join(root, "alias-bin")),
  envDir: enlazarDirectorio(path.join(root, ".env-store"), path.join(root, "alias-env-dir")),
};
const envArchivo = enlazarArchivo(path.join(root, ".env"), path.join(root, "alias-env"));

// index.html enlazado a una zona privada: se resuelve DENTRO de un directorio normal.
const sitio = path.join(root, "sitio");
fs.mkdirSync(sitio);
const indexEnlazado = enlazarArchivo(path.join(root, ".env"), path.join(sitio, "index.html"));

/**
 * Pide una ruta al servidor de archivos del navegador y devuelve estado + cuerpo.
 * @param {string} url
 * @returns {Promise<{status: number, body: string}>}
 */
function pedir(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (trozo) => (body += trozo));
        res.on("end", () => resolve({ status: res.statusCode || 0, body }));
      })
      .on("error", reject);
  });
}

const nav = new NavegadorLocal({ root, output });
try {
  // fileUrl() lanza el servidor estatico interno y devuelve la URL del HTML pedido.
  const inicio = await nav.fileUrl("index.html");
  const origen = new URL(inicio).origin;

  assert.equal((await pedir(`${origen}/index.html`)).status, 200, "index.html normal se sirve");
  const publico = await pedir(`${origen}/publico.html`);
  assert.equal(publico.status, 200);
  assert.match(publico.body, /publico normal/);
  assert.equal((await pedir(`${origen}/sub/estilo.css`)).status, 200, "recursos publicos se sirven");
  const sub = await pedir(`${origen}/sub/`);
  assert.equal(sub.status, 200, "un directorio publico resuelve su index.html");
  assert.match(sub.body, /sub normal/);

  // `ruta` del navegador tambien valida la ruta real, no solo la pedida.
  await assert.rejects(() => nav.fileUrl(".git/index.html"), /no pública|fuera del proyecto|pública/i, "fileUrl rechaza .git");
  await assert.rejects(() => nav.fileUrl("alias-git/index.html"), /no pública|fuera del proyecto|pública/i, "fileUrl rechaza un alias a .git");
  await assert.rejects(() => nav.fileUrl("node_modules/x.html"), /no pública|fuera del proyecto|pública/i, "fileUrl rechaza node_modules");
  assert.ok(await nav.fileUrl("publico.html"), "fileUrl sigue aceptando HTML publico normal");

  /** @type {Array<{nombre: string, url: string}>} */
  const privadas = [];
  if (alias.git) privadas.push({ nombre: "alias -> .git", url: `${origen}/alias-git/config` });
  if (alias.git) privadas.push({ nombre: "alias -> .git/index.html", url: `${origen}/alias-git/index.html` });
  if (alias.modulos) privadas.push({ nombre: "alias -> node_modules", url: `${origen}/alias-npm/paquete/index.js` });
  if (alias.modelos) privadas.push({ nombre: "alias -> models", url: `${origen}/alias-modelos/modelo.gguf` });
  if (alias.bin) privadas.push({ nombre: "alias -> bin", url: `${origen}/alias-bin/herramienta.exe` });
  if (alias.envDir) privadas.push({ nombre: "alias -> .env-store", url: `${origen}/alias-env-dir/secreto.txt` });
  if (envArchivo) privadas.push({ nombre: "enlace de archivo a .env", url: `${origen}/alias-env` });
  if (indexEnlazado) privadas.push({ nombre: "index.html enlazado a .env", url: `${origen}/sitio/` });
  if (!privadas.length) avisar("no se pudo crear ningun enlace real: solo se probaron rutas directas");

  for (const caso of privadas) {
    const respuesta = await pedir(caso.url);
    assert.equal(respuesta.status, 404, `${caso.nombre} debe dar 404, no contenido privado`);
    assert.doesNotMatch(respuesta.body, /SECRETO/, `${caso.nombre} no puede filtrar contenido privado`);
  }

  // Rutas privadas directas (sin enlace) siguen bloqueadas, y el intento de salir de
  // la raiz con .. codificado tampoco sirve.
  for (const ruta of ["/.git/config", "/.env", "/node_modules/paquete/index.js", "/models/modelo.gguf", "/bin/herramienta.exe", "/..%2f.git/config"]) {
    const respuesta = await pedir(`${origen}${ruta}`);
    assert.equal(respuesta.status, 404, `${ruta} debe dar 404`);
    assert.doesNotMatch(respuesta.body, /SECRETO/, `${ruta} no puede filtrar contenido privado`);
  }

  const casosConAlias = Object.values(alias).filter(Boolean).length + (envArchivo ? 1 : 0) + (indexEnlazado ? 1 : 0);
  console.log(`prueba navegador rutas ok (${casosConAlias} enlaces reales probados${avisos.length ? `, ${avisos.length} aviso(s)` : ""})`);
} finally {
  await nav.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
