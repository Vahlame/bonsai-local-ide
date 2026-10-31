#!/usr/bin/env node
/**
 * Descarga acelerada por rangos para los GGUF del catálogo.
 *
 * El descargador normal usa una conexión y el CDN de Hugging Face limita cada
 * una a ~1,5 MB/s. Este parte el archivo en trozos de 16 MiB, los baja con
 * varias conexiones y los ensambla al final sobre el `.part` existente. El
 * `.part` original se conserva como prefijo, así que también reanuda.
 *
 * No registra el modelo: al terminar llama a `hub.mjs download <clave>`, que
 * verifica tamaño/SHA y escribe el registro con el plan de motor.
 *
 * Uso:
 *   node scripts/fast-download.mjs --models qwen36-35b-a3b,gpt-oss-20b
 *   node scripts/fast-download.mjs --all
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { archivoHF } from "../chat/model-hub.mjs";

const execFileAsync = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const MODELS = path.join(PROJECT, "models");
const args = process.argv.slice(2);
const arg = (n, d = "") => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};
const CHUNK = Math.max(4, Number(arg("chunk", "16")) || 16) * 1024 * 1024;
const CONC = Math.max(1, Math.min(24, Number(arg("concurrency", "10")) || 10));
const TODOS = args.includes("--all");
const PEDIDOS = arg("models", "").split(",").map((s) => s.trim()).filter(Boolean);

const catalogo = JSON.parse(fs.readFileSync(path.join(PROJECT, "config", "model-catalog.json"), "utf8"));
const modelos = catalogo.modelos.filter((m) => (TODOS || PEDIDOS.includes(m.clave)) && m.repo && m.archivo);

/** @param {string} clave @param {string} archivo */
function rutaParte(clave, archivo) {
  const prefijado = path.join(MODELS, `${clave}-${archivo}.part`);
  if (fs.existsSync(prefijado)) return prefijado;
  const exacto = path.join(MODELS, `${archivo}.part`);
  if (fs.existsSync(exacto) && !fs.existsSync(path.join(MODELS, `${clave}-${archivo}`))) return exacto;
  return prefijado;
}

/** @param {string} clave @param {string} archivo @param {number} bytes */
function yaCompleto(clave, archivo, bytes) {
  for (const p of [path.join(MODELS, `${clave}-${archivo}`), path.join(MODELS, archivo)]) {
    try { if (fs.statSync(p).size === bytes) return true; } catch { /* no existe */ }
  }
  return false;
}

const tareas = [];
const archivos = [];
for (const m of modelos) {
  for (const f of [m.archivo, m.vision?.archivo].filter(Boolean)) {
    const esperado = f === m.archivo ? Number(m.bytes) : Number(m.vision?.bytes);
    if (!esperado) continue;
    if (yaCompleto(m.clave, f, esperado)) continue;
    const parte = rutaParte(m.clave, f);
    const prefijo = fs.existsSync(parte) ? fs.statSync(parte).size : 0;
    if (prefijo > esperado) { fs.rmSync(parte, { force: true }); }
    const desde = Math.min(prefijo, esperado);
    const info = await archivoHF(m.repo, f, m.revision || "main");
    const dir = path.join(MODELS, ".fast", m.clave, f);
    fs.mkdirSync(dir, { recursive: true });
    const registro = { clave: m.clave, archivo: f, esperado, desde, parte, dir, url: info.url };
    archivos.push(registro);
    for (let s = desde; s < esperado; s += CHUNK) {
      const e = Math.min(esperado, s + CHUNK) - 1;
      const trozo = path.join(dir, `${s}-${e}.chunk`);
      if (fs.existsSync(trozo) && fs.statSync(trozo).size === e - s + 1) continue;
      tareas.push({ ...registro, inicio: s, fin: e, trozo });
    }
    process.stderr.write(`${m.clave}: ${f} · ${(desde / 1073741824).toFixed(2)}/${(esperado / 1073741824).toFixed(2)} GiB ya presentes · ${Math.ceil((esperado - desde) / CHUNK)} trozos\n`);
  }
}

if (!tareas.length) {
  process.stderr.write("Nada que descargar.\n");
  process.exit(0);
}

let hechos = 0;
const totalBytes = tareas.reduce((s, t) => s + (t.fin - t.inicio + 1), 0);
const inicio = Date.now();
const tick = setInterval(() => {
  const s = (Date.now() - inicio) / 1000;
  const mbs = hechos / 1048576 / Math.max(1, s);
  const restante = (totalBytes - hechos) / 1048576 / Math.max(0.01, mbs);
  process.stderr.write(`  ${(hechos / 1073741824).toFixed(2)}/${(totalBytes / 1073741824).toFixed(2)} GiB · ${mbs.toFixed(1)} MiB/s · ETA ${Math.ceil(restante / 60)} min\n`);
}, 8000);

async function bajar(t) {
  for (let intento = 1; intento <= 4; intento += 1) {
    try {
      const res = await fetch(t.url, {
        headers: { range: `bytes=${t.inicio}-${t.fin}`, "user-agent": "BonsaiLocalIDE/1.8" },
        redirect: "follow",
        signal: AbortSignal.timeout(180000),
      });
      if (res.status !== 206) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length !== t.fin - t.inicio + 1) throw new Error(`rango corto: ${buf.length}`);
      const tmp = `${t.trozo}.tmp`;
      await fs.promises.writeFile(tmp, buf);
      await fs.promises.rename(tmp, t.trozo);
      return buf.length;
    } catch (error) {
      if (intento === 4) throw error;
      await new Promise((r) => setTimeout(r, 800 * intento));
    }
  }
  return 0;
}

let siguiente = 0;
let errorGlobal = null;
async function trabajador() {
  while (!errorGlobal) {
    const i = siguiente;
    siguiente += 1;
    if (i >= tareas.length) return;
    try {
      const n = await bajar(tareas[i]);
      hechos += n;
    } catch (error) {
      errorGlobal = error;
      return;
    }
  }
}
await Promise.all(Array.from({ length: CONC }, () => trabajador()));
clearInterval(tick);
if (errorGlobal) {
  process.stderr.write(`\nError: ${errorGlobal.message}\n`);
  process.exit(1);
}

// Ensamblar: prefijo existente + trozos en orden.
for (const a of archivos) {
  const partes = fs.readdirSync(a.dir).filter((f) => f.endsWith(".chunk"));
  if (!partes.length && fs.existsSync(a.parte) && fs.statSync(a.parte).size === a.esperado) continue;
  const salida = fs.createWriteStream(a.parte, { flags: "a" });
  const orden = [];
  for (let s = a.desde; s < a.esperado; s += CHUNK) {
    const e = Math.min(a.esperado, s + CHUNK) - 1;
    orden.push(path.join(a.dir, `${s}-${e}.chunk`));
  }
  for (const trozo of orden) {
    if (!fs.existsSync(trozo)) throw new Error(`falta el trozo ${trozo}`);
    await new Promise((resolve, reject) => {
      const leer = fs.createReadStream(trozo);
      leer.on("error", reject);
      leer.on("end", resolve);
      leer.pipe(salida, { end: false });
    });
    fs.rmSync(trozo, { force: true });
  }
  await new Promise((resolve) => salida.end(resolve));
  const talla = fs.statSync(a.parte).size;
  if (talla !== a.esperado) throw new Error(`${a.archivo}: ${talla}/${a.esperado} bytes tras ensamblar`);
  fs.rmSync(a.dir, { recursive: true, force: true });
  process.stderr.write(`ensamblado ${a.clave}/${a.archivo} (${(talla / 1073741824).toFixed(2)} GiB)\n`);
}

for (const clave of [...new Set(archivos.map((a) => a.clave))]) {
  process.stderr.write(`registrando ${clave}…\n`);
  await execFileAsync(process.execPath, [path.join(HERE, "hub.mjs"), "download", clave], {
    cwd: PROJECT, timeout: 1800000, maxBuffer: 32 * 1024 * 1024,
  });
}
process.stderr.write("listo\n");
