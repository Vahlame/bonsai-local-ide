/**
 * Prueba del CAMBIO DE MODELO en caliente, con el modelo real:
 *   node chat/prueba-modelos.mjs --real [--puerto 8080]
 *
 * Si hay un segundo modelo con perfil de GPU completa, apaga el llama-server,
 * lo carga y comprueba que queda sirviendo ese archivo; al final vuelve al que
 * estaba. Si no lo hay, comprueba que cambiar a un modelo sin perfil se rechaza
 * con 409 y que el servidor actual sigue sirviendo. Necesita el servidor real:
 * si no hay ninguno escuchando, avisa y termina bien (así puede vivir en la
 * suite sin GPU).
 *
 * OJO: con dos modelos GPU reinicia llama-server dos veces (≈40-60 s cada carga).
 */

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
if (!process.argv.includes("--real")) {
  console.log("Cambio de modelo omitido: usa --real explícitamente; reinicia el servidor GPU y no puede correr junto a otras pruebas reales.");
  process.exit(0);
}
const MODELO = JSON.parse(fs.readFileSync(path.join(HERE, "modelo.json"), "utf8"));

/**
 * @param {string[]} argv
 */
function argsDe(argv) {
  const out = { puerto: 8080, ui: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--puerto") out.puerto = Number(argv[++i]);
    else if (argv[i] === "--ui") out.ui = Number(argv[++i]);
  }
  return out;
}

/** @returns {Promise<number>} */
function puertoLibre() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = /** @type {import("node:net").AddressInfo} */ (s.address()).port;
      s.close(() => resolve(p));
    });
  });
}

/**
 * Mata SOLO el ui-server de la prueba (sin /T): el llama-server que él arrancó es
 * independiente y tiene que seguir vivo al terminar, como estaba antes de la prueba.
 * @param {import("node:child_process").ChildProcess} hijo
 */
function matar(hijo) {
  if (!hijo.pid) return;
  try {
    if (process.platform === "win32") execFileSync("taskkill", ["/pid", String(hijo.pid), "/F"], { stdio: "ignore" });
    else hijo.kill("SIGKILL");
  } catch {
    try {
      hijo.kill("SIGKILL");
    } catch {
      /* ya no está */
    }
  }
}

/**
 * @param {string} url
 * @returns {Promise<{status: number, body: string}>}
 */
function pedir(url) {
  return new Promise((resolve) => {
    http
      .get(url, (res) => {
        let texto = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (texto += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: texto }));
      })
      .on("error", (err) => resolve({ status: 0, body: err.message }));
  });
}

/**
 * @param {string} url
 * @param {unknown} cuerpo
 * @returns {Promise<{status: number, body: string}>}
 */
function post(url, cuerpo) {
  const datos = JSON.stringify(cuerpo);
  const u = new URL(url);
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: u.hostname,
        port: Number(u.port),
        method: "POST",
        path: u.pathname,
        headers: { host: u.host, "content-type": "application/json", "content-length": String(Buffer.byteLength(datos)) },
      },
      (res) => {
        let texto = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (texto += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: texto }));
      },
    );
    req.on("error", (err) => resolve({ status: 0, body: err.message }));
    req.write(datos);
    req.end();
  });
}

/**
 * Modelo que está sirviendo el llama-server (por el model_path de /props).
 * @param {number} puerto
 * @returns {Promise<string>}
 */
async function modeloServido(puerto) {
  const r = await pedir(`http://127.0.0.1:${puerto}/props`);
  if (r.status !== 200) return "";
  try {
    const datos = JSON.parse(r.body);
    return path.basename(String(datos.model_path || ""));
  } catch {
    return "";
  }
}

const args = argsDe(process.argv.slice(2));
const antes = await modeloServido(args.puerto);
if (!antes) {
  process.stdout.write(`(no hay llama-server en ${args.puerto}: no se prueba el cambio de modelo)\n`);
  process.exit(0);
}

/** Claves del catálogo con su archivo entero en disco. */
const disponibles = Object.keys(MODELO.catalogo)
  .filter((clave) => !clave.startsWith("_"))
  .map((clave) => ({ clave, ...MODELO.catalogo[clave] }))
  .filter((m) => {
    try {
      return fs.statSync(path.join(HERE, "..", "models", m.archivo)).size === Number(m.bytes);
    } catch {
      return false;
    }
  });
const actual = disponibles.find((m) => m.archivo === antes);
const otroGpu = disponibles.find((m) => m.archivo !== antes && m.servidor?.tipo === "gpu-completa");
const sinPerfil = disponibles.find((m) => m.archivo !== antes && m.servidor?.tipo !== "gpu-completa");
if (!actual) {
  process.stdout.write(`(el modelo servido ${antes} no está entero en el catálogo; no se prueba el cambio)\n`);
  process.exit(0);
}
if (!otroGpu && !sinPerfil) {
  process.stdout.write(`(el catálogo no tiene otro modelo con el GGUF entero; cargado: ${antes})\n`);
  process.exit(0);
}

args.ui = args.ui || (await puertoLibre());
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-modelos-"));
const proyecto = path.join(tmp, "proyecto");
fs.mkdirSync(proyecto, { recursive: true });
const hijo = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(args.ui), "--llama-port", String(args.puerto)], {
  cwd: HERE,
  env: { ...process.env, BONSAI_STATE: path.join(tmp, "estado"), BONSAI_SALIDA: path.join(tmp, "salida") },
  stdio: "ignore",
});

/** @type {string[]} */
const fallos = [];
/**
 * @param {string} clave
 * @param {string} esperado
 * @param {string} etiqueta
 */
async function cambiar(clave, esperado, etiqueta) {
  const t0 = Date.now();
  const r = await post(`http://127.0.0.1:${args.ui}/api/modelos`, { clave });
  const segundos = ((Date.now() - t0) / 1000).toFixed(1);
  if (r.status !== 200) {
    fallos.push(`${etiqueta}: HTTP ${r.status} ${r.body.slice(0, 160)}`);
    return;
  }
  const servido = await modeloServido(args.puerto);
  if (servido !== esperado) fallos.push(`${etiqueta}: el servidor sirve ${servido}, se esperaba ${esperado}`);
  else process.stdout.write(`${etiqueta}: ${esperado} en ${segundos} s\n`);
}

try {
  let listo = false;
  for (let i = 0; i < 60; i += 1) {
    const r = await pedir(`http://127.0.0.1:${args.ui}/api/state`);
    if (r.status === 200) {
      listo = true;
      break;
    }
    await new Promise((r2) => setTimeout(r2, 250));
  }
  if (!listo) throw new Error("el ui-server no arrancó");
  const catalogo = JSON.parse((await pedir(`http://127.0.0.1:${args.ui}/api/modelos`)).body);
  const claveActual = catalogo.actual;
  if (claveActual !== actual.clave) fallos.push(`el catálogo dice que está cargado ${claveActual}, y el servidor sirve ${antes}`);

  if (otroGpu) {
    await cambiar(otroGpu.clave, otroGpu.archivo, `cambio a ${otroGpu.clave}`);
    await cambiar(actual.clave, actual.archivo, `vuelta a ${actual.clave}`);
  } else {
    // Solo hay un modelo con perfil GPU completa. El cambio a otro modelo sin
    // perfil debe rechazarse antes de tocar el servidor que ya funciona.
    const r = await post(`http://127.0.0.1:${args.ui}/api/modelos`, { clave: sinPerfil.clave });
    if (r.status !== 409) {
      fallos.push(`el cambio a ${sinPerfil.clave} (sin perfil GPU) debía rechazarse con 409, respondió ${r.status}: ${r.body.slice(0, 160)}`);
    } else {
      process.stdout.write(`rechazo correcto de ${sinPerfil.clave} sin perfil GPU (409)\n`);
      const servido = await modeloServido(args.puerto);
      if (servido !== antes) fallos.push(`tras rechazar ${sinPerfil.clave}, el servidor sirve ${servido} y se esperaba ${antes}`);
      else process.stdout.write(`el servidor sigue sirviendo ${antes} tras el rechazo\n`);
      const estado = await pedir(`http://127.0.0.1:${args.ui}/api/state`);
      if (estado.status !== 200) fallos.push(`/api/state no responde tras el rechazo: HTTP ${estado.status}`);
    }
  }
} catch (err) {
  fallos.push(err instanceof Error ? err.message : String(err));
} finally {
  matar(hijo);
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* da igual */
  }
}

if (fallos.length) {
  process.stderr.write(`FALLÓ:\n- ${fallos.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write("prueba modelos ok\n");
process.exit(0);
