/**
 * Pruebas del Model Hub sin Internet, sin GPU y sin cargar tensores.
 *
 *   node chat/prueba-model-hub.mjs
 *
 * Cubre:
 *   · parser GGUF (cabecera sintética) y plan de VRAM;
 *   · nombres seguros y validación de URLs (SSRF básico);
 *   · descarga reanudable contra un HTTP local con Range y SHA-256;
 *   · registro en models/hub-catalog.json y fusión en MODELO.catalogo;
 *   · endpoints /api/hub/* de un ui-server con estado temporal.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.dirname(HERE);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-hub-"));
const modelos = path.join(tmp, "models");
const estado = path.join(tmp, "estado");
const salida = path.join(tmp, "salida");
fs.mkdirSync(modelos, { recursive: true });
fs.mkdirSync(estado, { recursive: true });
fs.mkdirSync(salida, { recursive: true });

// El módulo lee estas rutas al importarse: se definen ANTES del import dinámico.
process.env.BONSAI_MODELS_DIR = modelos;
process.env.BONSAI_HUB_CATALOG = path.join(modelos, "hub-catalog.json");
process.env.BONSAI_HUB_ALLOW_PRIVATE = "1";
process.env.BONSAI_STATE = estado;
process.env.BONSAI_SALIDA = salida;
delete process.env.BONSAI_HUB_SCAN;

const hub = await import("../chat/model-hub.mjs");
const plan = await import("../chat/model-plan.mjs");

/** @type {string[]} */
const fallos = [];
const check = (nombre, cond, detalle = "") => {
  if (cond) process.stdout.write(`ok ${nombre}\n`);
  else {
    fallos.push(`${nombre}${detalle ? `: ${detalle}` : ""}`);
    process.stderr.write(`FALLO ${nombre}${detalle ? `: ${detalle}` : ""}\n`);
  }
};

/** Cabecera GGUF mínima con metadatos; sin tensores. */
function ggufSintetico() {
  const partes = [];
  const str = (s) => {
    const b = Buffer.from(s, "utf8");
    const n = Buffer.alloc(8);
    n.writeBigUInt64LE(BigInt(b.length));
    partes.push(n, b);
  };
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); partes.push(b); };
  const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); partes.push(b); };
  const kvString = (k, v) => { str(k); u32(8); str(v); };
  const kvU32 = (k, v) => { str(k); u32(4); u32(v); };
  partes.push(Buffer.from("GGUF"));
  u32(3);
  u64(0);
  const metadatos = [
    ["general.architecture", "llama"],
    ["general.name", "Modelo Sintético"],
    ["llama.block_count", 32],
    ["llama.context_length", 32768],
    ["llama.embedding_length", 4096],
    ["llama.attention.head_count", 32],
    ["llama.attention.head_count_kv", 8],
    ["llama.attention.key_length", 128],
    ["llama.attention.value_length", 128],
    ["tokenizer.chat_template", "{{ messages }}"],
  ];
  u64(metadatos.length);
  for (const [k, v] of metadatos) {
    if (typeof v === "number") kvU32(k, v);
    else kvString(k, v);
  }
  const cabecera = Buffer.concat(partes);
  // Relleno para que el archivo no sea diminuto; el parser solo lee la cabecera.
  return Buffer.concat([cabecera, Buffer.alloc(1024 * 1024)]);
}

const datos = ggufSintetico();
const sha = crypto.createHash("sha256").update(datos).digest("hex");
const nombre = "Modelo-Sintetico-Q4_K_M.gguf";

// ---------------------------------------------------------------- parser/plan
const ruta = path.join(modelos, nombre);
fs.writeFileSync(ruta, datos);
const meta = plan.leerMetadatosGGUF(ruta);
check("lee la arquitectura del GGUF", meta.metadata["general.architecture"] === "llama");
check("lee el nombre", meta.metadata["general.name"] === "Modelo Sintético");
const arq = plan.arquitecturaDesdeGGUF(meta.metadata, { archivo: ruta });
check("calcula 32 capas de atención", arq.capasAtencionCompleta === 32);
check("calcula 128 KiB de KV f16 por token", arq.kvF16BytesPorToken === 131072);
const p = plan.planAuto({ bytes: datos.length, kvF16BytesPorToken: arq.kvF16BytesPorToken, ctxNativo: 32768 }, { libreMiB: 7956 });
check("plan cabe y usa un KV válido", p.ok && ["f16", "q8_0"].includes(p.kv));
check("plan no supera la VRAM", p.totalMiB <= 7956);

check("rechaza path traversal", (() => { try { plan.nombreArchivoSeguro("..\\x.gguf"); return false; } catch { return true; } })());
check("rechaza .exe", (() => { try { plan.nombreArchivoSeguro("x.exe"); return false; } catch { return true; } })());
check("acepta nombre normal", plan.nombreArchivoSeguro("Qwen3-4B-Q4_K_M.gguf") === "Qwen3-4B-Q4_K_M.gguf");
check("rechaza URL privada sin permiso explícito", (() => {
  try { hub.validarUrl("http://127.0.0.1/x.gguf", { allowPrivate: false }); return false; } catch { return true; }
})());
check("rechaza HTTP cuando no está permitido", (() => {
  try { hub.validarUrl("http://example.com/x.gguf", { allowPrivate: false }); return false; } catch { return true; }
})());

// ------------------------------------------------------------ descarga local
const servidor = http.createServer((req, res) => {
  const rango = String(req.headers.range || "");
  if (req.method === "HEAD") {
    res.writeHead(200, {
      "content-length": String(datos.length),
      etag: `"${sha}"`,
      "accept-ranges": "bytes",
    });
    res.end();
    return;
  }
  const m = rango.match(/bytes=(\d+)-(\d*)/);
  let desde = 0;
  let hasta = datos.length - 1;
  if (m) {
    desde = Number(m[1]);
    hasta = m[2] ? Number(m[2]) : datos.length - 1;
    res.writeHead(206, {
      "content-length": String(hasta - desde + 1),
      "content-range": `bytes ${desde}-${hasta}/${datos.length}`,
      "accept-ranges": "bytes",
      "content-type": "application/octet-stream",
    });
    res.end(datos.subarray(desde, hasta + 1));
    return;
  }
  res.writeHead(200, { "content-length": String(datos.length), etag: `"${sha}"`, "accept-ranges": "bytes" });
  res.end(datos);
});
await new Promise((r) => servidor.listen(0, "127.0.0.1", r));
const puerto = /** @type {import("node:net").AddressInfo} */ (servidor.address()).port;
const url = `http://127.0.0.1:${puerto}/${nombre}`;

// El archivo final del test del parser se retira: aquí se prueba la descarga real.
fs.rmSync(ruta, { force: true });

// Se simula una descarga ya empezada: los primeros 300 KiB en .part.
const parte = path.join(modelos, `${nombre}.part`);
fs.writeFileSync(parte, datos.subarray(0, 300 * 1024));

const creado = await hub.crearTrabajo({ url, nombre, bytes: datos.length, sha256: sha });
let fin = null;
for (let i = 0; i < 120; i += 1) {
  const t = hub.listarTrabajos().find((x) => x.id === creado.id);
  if (t && ["listo", "error", "cancelado"].includes(t.estado)) { fin = t; break; }
  await new Promise((r) => setTimeout(r, 100));
}
check("descarga reanudada termina", Boolean(fin), fin?.error || "sin estado");
check("descarga reanudada queda lista", fin?.estado === "listo", fin?.error || fin?.estado);
check("el .part desaparece", !fs.existsSync(parte));
check("el archivo final existe y mide lo esperado", fs.existsSync(path.join(modelos, nombre)) && fs.statSync(path.join(modelos, nombre)).size === datos.length);
const shaFinal = await hub.sha256Archivo(path.join(modelos, nombre));
check("SHA-256 verificado", shaFinal === sha);
const registro = hub.leerRegistro();
check("se registró el modelo", Object.keys(registro.modelos).length === 1);
const clave = Object.keys(registro.modelos)[0];
check("el registro apunta al archivo", registro.modelos[clave].archivo === nombre);
check("el plan quedó guardado", Number(registro.modelos[clave].plan?.contexto) >= 4096);

// Lectura-modificación-escritura: una copia vieja no debe borrar una entrada
// que otro proceso (otra descarga, model-lab, model-tune) acaba de añadir.
const viejo = JSON.parse(JSON.stringify(hub.leerRegistro()));
const actual = JSON.parse(fs.readFileSync(path.join(modelos, "hub-catalog.json"), "utf8"));
actual.modelos["otro-proceso"] = { clave: "otro-proceso", archivo: "otro.gguf", nombre: "Otro", fuente: "hub" };
fs.writeFileSync(path.join(modelos, "hub-catalog.json"), JSON.stringify(actual, null, 2));
hub.guardarRegistro(viejo);
const mezclado = JSON.parse(fs.readFileSync(path.join(modelos, "hub-catalog.json"), "utf8"));
check("guardarRegistro conserva entradas de otro proceso", Boolean(mezclado.modelos["otro-proceso"]) && Boolean(mezclado.modelos[clave]));
delete mezclado.modelos["otro-proceso"];
fs.writeFileSync(path.join(modelos, "hub-catalog.json"), JSON.stringify(mezclado, null, 2));

// Borrado seguro.
hub.borrarModelo(clave, { confirmar: true });
check("borra el archivo", !fs.existsSync(path.join(modelos, nombre)));
check("borra la entrada", Object.keys(hub.leerRegistro().modelos).length === 0);

// -------------------------------------------------------- endpoints del IDE
// Se vuelve a crear el archivo y se registra para probar /api/hub/catalog.
fs.writeFileSync(ruta, datos);
await hub.registrarArchivo(nombre, { fuente: "local" });
const uiPort = 19000 + Math.floor(Math.random() * 500);
const ui = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(uiPort), "--llama-port", "18080"], {
  cwd: RAIZ,
  env: { ...process.env, BONSAI_STATE: estado, BONSAI_SALIDA: salida, BONSAI_MODELS_DIR: modelos, BONSAI_HUB_CATALOG: path.join(modelos, "hub-catalog.json"), BONSAI_HUB_DISABLE_SCAN: "1" },
  stdio: "ignore",
});
const esperar = async (ms) => new Promise((r) => setTimeout(r, ms));
let listo = false;
for (let i = 0; i < 80; i += 1) {
  try {
    const r = await fetch(`http://127.0.0.1:${uiPort}/api/hub/status`, { signal: AbortSignal.timeout(1000) });
    if (r.ok) { listo = true; break; }
  } catch { /* aún arranca */ }
  await esperar(250);
}
check("ui-server arranca para el Hub", listo);
if (listo) {
  const cat = await (await fetch(`http://127.0.0.1:${uiPort}/api/hub/catalog`)).json();
  check("el catálogo del Hub incluye el modelo local", cat.instalados.some((m) => m.archivo === nombre));
  const modelosApi = await (await fetch(`http://127.0.0.1:${uiPort}/api/modelos`)).json();
  check("/api/modelos ve el modelo importado", modelosApi.modelos.some((m) => m.archivo === nombre));
  const planApi = await (await fetch(`http://127.0.0.1:${uiPort}/api/hub/plan?clave=${encodeURIComponent(Object.keys(hub.leerRegistro().modelos)[0])}`)).json();
  check("/api/hub/plan devuelve un plan", Number(planApi.plan?.contexto) >= 4096);
}
try { ui.kill(); } catch { /* ya */ }
servidor.close();
fs.rmSync(tmp, { recursive: true, force: true });

if (fallos.length) {
  process.stderr.write(`\nFALLÓ:\n- ${fallos.join("\n- ")}\n`);
  process.exit(1);
}
process.stdout.write("\nprueba model hub ok\n");
process.exit(0);
