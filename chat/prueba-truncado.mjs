/**
 * Prueba de regresión de las tool calls TRUNCADAS: "que no vuelva a pasar nunca, y no solo
 * con Python o HTML".
 *
 * Cuando el modelo escribe un archivo grande, la llamada NO cabe en una slice: el servidor
 * corta la generación con finish_reason "length" y los `arguments` (el JSON) se quedan a
 * medias. Antes, cada trozo se apilaba como una llamada DISTINTA, ninguno era JSON válido y
 * la escritura se perdía en silencio (el modelo reintentaba en bucle el mismo archivo).
 *
 * Aquí se comprueba de punta a punta, contra un llama-server FALSO y un ui-server REAL, con
 * contenido de SEIS tecnologías distintas y cortando el JSON por posiciones arbitrarias
 * (incluido en medio de un escape \n, \u o de un par subrogado):
 *   1. un turno que se corta dos veces y a la tercera cabe → el archivo queda EXACTO;
 *   2. la llamada partida en varios frames delta.tool_calls → los trozos se funden;
 *   3. dos llamadas a la vez, troceadas y EN ORDEN CRUZADO → cada trozo va a su archivo;
 *   4. ninguna escritura a medias: lo que hay en disco es el contenido completo o nada.
 *
 *   node chat/prueba-truncado.mjs
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** @type {string[]} */
const failures = [];
/**
 * @param {string} nombre
 * @param {boolean} cond
 * @param {string} [detalle]
 */
const check = (nombre, cond, detalle) => {
  if (!cond) failures.push(detalle ? `${nombre} (${detalle})` : nombre);
};

const PUERTO = 8796;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-truncado-"));
const proyecto = path.join(tmp, "proyecto");
const estado = path.join(tmp, "estado");
const salida = path.join(tmp, "salida");
for (const dir of [proyecto, estado, salida]) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(estado, "ui-workspace.json"), JSON.stringify({ path: proyecto }), "utf8");

// --- Contenido de prueba, uno por tecnología ---------------------------------
/** @param {number} n @param {(i: number) => string} f */
const bloque = (n, f) => Array.from({ length: n }, (_, i) => f(i)).join("\n");

/** @type {Array<{nombre: string, ruta: string, contenido: string}>} */
const CASOS = [
  {
    nombre: "python",
    ruta: "sistema.py",
    contenido:
      '"""Sistema de ejemplo con acentos: acción, ñandú, corazón — y un emoji 🐍."""\n\n' +
      bloque(70, (i) => `def paso_${i}(valor):\n    """Paso ${i}: revisa el valor."""\n    return valor * ${i} + ${i * 7}`),
  },
  {
    nombre: "html",
    ruta: "tablero.html",
    contenido:
      '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<title>Tablero · año</title>\n' +
      '<style>\n  .fila:nth-child(odd) { background: #f6f6f6; }\n  .celda::after { content: "→"; }\n</style>\n' +
      "</head>\n<body>\n" +
      bloque(150, (i) => `  <div class="fila" data-i="${i}"><span class="celda">Fila ${i} — ${i * 3}</span></div>`) +
      "\n</body>\n</html>\n",
  },
  {
    nombre: "json",
    ruta: "datos.json",
    contenido: JSON.stringify(
      {
        titulo: "Informe anual",
        notas: ['comillas "raras"', "barra \\ y salto\nreal", "unicode: \u00e9\u00f1\u00fc \u2192 🎯"],
        filas: Array.from({ length: 120 }, (_, i) => ({ id: i, nombre: `fila ${i}`, valor: i * 1.5, activo: i % 3 === 0 })),
      },
      null,
      2,
    ),
  },
  {
    nombre: "sql",
    ruta: "esquema.sql",
    contenido:
      "-- Esquema de ejemplo\nBEGIN TRANSACTION;\n" +
      bloque(80, (i) => `CREATE TABLE tabla_${i} (id INTEGER PRIMARY KEY, nombre TEXT NOT NULL, nota TEXT DEFAULT 'n/a');`) +
      "\nCOMMIT;\n",
  },
  {
    nombre: "powershell",
    ruta: "tarea.ps1",
    contenido:
      '# Tarea de ejemplo\n$ErrorActionPreference = "Stop"\n' +
      bloque(80, (i) => `function Paso-${i} {\n  param([int]$Valor = ${i})\n  Write-Output "paso ${i}: $Valor"\n}`) +
      "\n",
  },
  {
    nombre: "yaml",
    ruta: "config.yaml",
    contenido:
      "version: 3\nservicios:\n" +
      bloque(90, (i) => `  servicio_${i}:\n    imagen: "app:${i}"\n    puerto: ${8000 + i}\n    notas: "acción ${i} → ok"`),
  },
];

// --- llama-server de mentira -------------------------------------------------
/** @type {Array<{deltas: Array<Record<string, any>>, reason: string}>} */
let pasos = [];
/** @type {Array<Record<string, any>>} */
const peticiones = [];

/**
 * Un frame delta con una llamada nativa.
 * @param {string} nombre
 * @param {string} args
 * @param {{id?: string, index?: number}} [extra]
 */
const llamada = (nombre, args, extra = {}) => ({
  tool_calls: [
    {
      index: extra.index ?? 0,
      ...(extra.id ? { id: extra.id, type: "function" } : {}),
      function: { name: nombre, arguments: args },
    },
  ],
});

const falsoLlama = http.createServer((req, res) => {
  const url = req.url || "";
  const json = (body) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url === "/health") return json({ status: "ok" });
  if (url === "/props") return json({ default_generation_settings: { n_ctx: 32768 }, modalities: { vision: false } });
  if (url === "/v1/models") return json({ data: [{ id: "falso" }] });
  let raw = "";
  req.on("data", (p) => (raw += p));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    if (url === "/v1/chat/completions/input_tokens") return json({ input_tokens: Math.ceil(JSON.stringify(body.messages || "").length / 4) });
    if (url !== "/v1/chat/completions") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }
    if (!body.stream) return json({ choices: [{ message: { content: "resumen" } }] });
    peticiones.push({ max_tokens: body.max_tokens, continue_final_message: Boolean(body.continue_final_message), messages: body.messages || [] });
    const paso = pasos.shift();
    if (!paso) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "el guion se quedó sin pasos" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const delta of paso.deltas) res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: paso.reason }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 5 }, timings: { cache_n: 10, prompt_n: 40, predicted_per_second: 28 } })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
});
await new Promise((resolve) => falsoLlama.listen(0, "127.0.0.1", () => resolve(undefined)));
const puertoLlama = /** @type {import("node:net").AddressInfo} */ (falsoLlama.address()).port;

const hijo = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(PUERTO), "--llama-port", String(puertoLlama)], {
  cwd: HERE,
  env: { ...process.env, BONSAI_STATE: estado, BONSAI_SALIDA: salida },
  stdio: "ignore",
});

/**
 * @param {string} metodo
 * @param {string} ruta
 * @param {unknown} [cuerpo]
 * @returns {Promise<{status: number, body: string}>}
 */
function pedir(metodo, ruta, cuerpo) {
  const datos = cuerpo === undefined ? "" : JSON.stringify(cuerpo);
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PUERTO,
        method: metodo,
        path: ruta,
        headers: {
          host: `127.0.0.1:${PUERTO}`,
          ...(datos ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(datos)) } : {}),
        },
      },
      (res) => {
        let texto = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (texto += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: texto }));
      },
    );
    req.on("error", (err) => resolve({ status: 0, body: `conexion cortada: ${err.message}` }));
    if (datos) req.write(datos);
    req.end();
  });
}

/**
 * Manda un turno de chat y devuelve todos los eventos SSE.
 * @param {string} texto
 * @returns {Promise<Array<Record<string, any>>>}
 */
async function chat(texto) {
  const res = await fetch(`http://127.0.0.1:${PUERTO}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: texto }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const lector = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  /** @type {Array<Record<string, any>>} */
  const eventos = [];
  while (true) {
    const { done, value } = await lector.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl !== -1) {
      const linea = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
      if (linea.startsWith("data:")) {
        try {
          eventos.push(JSON.parse(linea.slice(5)));
        } catch {
          /* trozo incompleto */
        }
      }
    }
  }
  return eventos;
}

/** Espera a que el ui-server conteste. */
async function esperarServidor() {
  for (let i = 0; i < 60; i += 1) {
    const r = await pedir("GET", "/api/workspace");
    if (r.status === 200) return true;
    await new Promise((r2) => setTimeout(r2, 250));
  }
  return false;
}

/**
 * Compara el archivo con lo que el modelo quiso escribir.
 * @param {string} ruta
 * @param {string} esperado
 * @param {string} etiqueta
 */
function comprobarArchivo(ruta, esperado, etiqueta) {
  const abs = path.join(proyecto, ruta);
  if (!fs.existsSync(abs)) {
    check(`${etiqueta}: el archivo se escribió`, false, `${ruta} no existe: la llamada truncada se perdió`);
    return;
  }
  const real = fs.readFileSync(abs, "utf8");
  check(
    `${etiqueta}: el contenido quedó EXACTO`,
    real === esperado,
    `esperado ${esperado.length} car., en disco ${real.length} car.${real === esperado.slice(0, real.length) ? " (cortado)" : ""}`,
  );
}

try {
  check("el ui-server arrancó", await esperarServidor());
  check("fija la carpeta de trabajo", (await pedir("POST", "/api/workspace", { path: proyecto })).status === 200);

  // --- 1, 2 y 4: cada tecnología, cortada dos veces --------------------------
  for (const caso of CASOS) {
    const args = JSON.stringify({ ruta: caso.ruta, contenido: caso.contenido });
    const corte1 = Math.floor(args.length * 0.34);
    const corte2 = Math.floor(args.length * 0.72);
    pasos = [
      // Se queda a medias (finish_reason "length") sin haber escrito nada.
      { deltas: [llamada("archivo", args.slice(0, corte1), { id: "call_a", index: 0 })], reason: "length" },
      // El intento repetido con más hueco se vuelve a quedar cortado, más tarde.
      { deltas: [llamada("archivo", args.slice(0, corte2), { id: "call_a", index: 0 })], reason: "length" },
      // A la tercera cabe: y encima llega PARTIDA en dos frames, el segundo sin id ni nombre.
      {
        deltas: [llamada("archivo", args.slice(0, 30), { id: "call_a", index: 0 }), { tool_calls: [{ index: 0, function: { arguments: args.slice(30) } }] }],
        reason: "tool_calls",
      },
      { deltas: [{ content: "listo" }], reason: "stop" },
    ];
    const eventos = await chat(`escribe ${caso.ruta}, es un archivo de ${caso.nombre} y es largo`);
    comprobarArchivo(caso.ruta, caso.contenido, caso.nombre);
    check(
      `${caso.nombre}: el turno avisó de que la llamada no cabía`,
      JSON.stringify(eventos).includes("no cabía"),
      "no apareció la nota del reintento (¿se perdió la llamada en silencio?)",
    );
    check(`${caso.nombre}: no se quedaron pasos sin usar`, pasos.length === 0, `sobraron ${pasos.length}`);
  }

  // --- 3: dos llamadas a la vez, troceadas y en orden cruzado ----------------
  const casoA = { ruta: "cruzado_a.py", contenido: bloque(60, (i) => `a_${i} = ${i}  # ñandú ${i}`) };
  const casoB = { ruta: "cruzado_b.html", contenido: bloque(120, (i) => `<p class="b-${i}">línea ${i} → ok</p>`) };
  const argsA = JSON.stringify({ ruta: casoA.ruta, contenido: casoA.contenido });
  const argsB = JSON.stringify({ ruta: casoB.ruta, contenido: casoB.contenido });
  pasos = [
    // El modelo empieza a escribir DOS archivos y se queda sin hueco con los dos a medias:
    // las llamadas van nombradas pero con JSON inválido, y como además hay texto visible el
    // cliente CONTINÚA la generación (continue_final_message) en vez de empezar de cero.
    {
      deltas: [
        { content: "Escribo los dos archivos:\n" },
        { tool_calls: [{ index: 0, id: "c0", type: "function", function: { name: "archivo", arguments: argsA.slice(0, 60) } }] },
        { tool_calls: [{ index: 1, id: "c1", type: "function", function: { name: "archivo", arguments: argsB.slice(0, 60) } }] },
      ],
      reason: "length",
    },
    // Lo que hace el llama-server REAL al continuar: en el prefill solo viaja el texto ("Escribo
    // los dos archivos:"), no las llamadas a medias, así que el modelo las vuelve a escribir
    // ENTERAS. Antes esta prueba suponía que el servidor retomaba el JSON donde se cortó (no
    // puede) y el cliente fundía trozo viejo + llamada nueva en un JSON inválido. Los trozos
    // llegan además CRUZADOS y los segundos sin nombre ni id: si se emparejaran por orden de
    // llegada en vez de por `index`, cada archivo acabaría con el contenido del otro.
    {
      deltas: [
        { tool_calls: [{ index: 1, id: "c1b", type: "function", function: { name: "archivo", arguments: argsB.slice(0, 40) } }] },
        { tool_calls: [{ index: 0, id: "c0b", type: "function", function: { name: "archivo", arguments: argsA.slice(0, 40) } }] },
        { tool_calls: [{ index: 1, function: { arguments: argsB.slice(40) } }] },
        { tool_calls: [{ index: 0, function: { arguments: argsA.slice(40) } }] },
      ],
      reason: "tool_calls",
    },
    { deltas: [{ content: "hechos los dos" }], reason: "stop" },
  ];
  await chat("escribe dos archivos a la vez, uno de python y otro de html");
  comprobarArchivo(casoA.ruta, casoA.contenido, "cruzado python");
  comprobarArchivo(casoB.ruta, casoB.contenido, "cruzado html");
  check(
    "cruzado: la continuación se pidió como continuación",
    peticiones.some((p) => p.continue_final_message),
    "el cliente no mandó continue_final_message: el texto ya escrito se perdería",
  );
  check("cruzado: dos llamadas en el mismo turno", peticiones.length >= 3, `peticiones al modelo: ${peticiones.length}`);

  // --- 3b: dos llamadas, la PRIMERA entera y la segunda cortada ---------------
  // Antes se tiraban las dos y se repetía todo con más hueco: un archivo bueno de miles de
  // tokens a la basura. Ahora la entera se ejecuta y al modelo se le avisa de la cortada.
  const casoC = { ruta: "entero_c.py", contenido: bloque(40, (i) => `c_${i} = ${i}  # acción ${i}`) };
  const casoD = { ruta: "cortado_d.html", contenido: bloque(200, (i) => `<li>${i}</li>`) };
  const argsC = JSON.stringify({ ruta: casoC.ruta, contenido: casoC.contenido });
  const argsD = JSON.stringify({ contenido: casoD.contenido, ruta: casoD.ruta });
  const antesC = peticiones.length;
  pasos = [
    {
      deltas: [
        { tool_calls: [{ index: 0, id: "e0", type: "function", function: { name: "archivo", arguments: argsC } }] },
        { tool_calls: [{ index: 1, id: "e1", type: "function", function: { name: "archivo", arguments: argsD.slice(0, 300) } }] },
      ],
      reason: "length",
    },
    { deltas: [{ content: "vale, repito el otro" }], reason: "stop" },
  ];
  await chat("escribe un python y un html grandes");
  comprobarArchivo(casoC.ruta, casoC.contenido, "entero + cortado: el entero");
  check("entero + cortado: el cortado NO se escribe a medias", !fs.existsSync(path.join(proyecto, casoD.ruta)));
  check("entero + cortado: no se repitió la generación entera", peticiones.length - antesC === 2, `peticiones: ${peticiones.length - antesC}`);
  const trasCorte = peticiones[peticiones.length - 1]?.messages || [];
  const avisoCorte = trasCorte.find((m) => m.role === "tool" && m.tool_call_id === "e0");
  check("entero + cortado: el modelo sabe que la otra llamada se cortó", /se cortó/.test(String(avisoCorte?.content || "")) && /Guardado entero_c\.py/.test(String(avisoCorte?.content || "")), String(avisoCorte?.content || "").slice(0, 200));
  check("entero + cortado: la llamada cortada no queda en el historial", !trasCorte.some((m) => Array.isArray(m.tool_calls) && m.tool_calls.some((tc) => tc.id === "e1")));

  // --- 4: ninguna escritura a medias ----------------------------------------
  /** @type {string[]} */
  const sobrantes = [];
  for (const caso of [...CASOS, casoA, casoB, casoC]) {
    const abs = path.join(proyecto, caso.ruta);
    if (!fs.existsSync(abs)) continue;
    const real = fs.readFileSync(abs, "utf8");
    if (real !== caso.contenido) sobrantes.push(`${caso.ruta} (${real.length}/${caso.contenido.length})`);
  }
  check("ningún archivo quedó a medias en disco", sobrantes.length === 0, sobrantes.join(", "));
} finally {
  hijo.kill();
  falsoLlama.close();
  await new Promise((r) => setTimeout(r, 300));
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* la carpeta temporal se queda: no es un fallo de la prueba */
  }
}

if (failures.length) {
  process.stdout.write(`prueba-truncado: ${failures.length} fallo(s)\n`);
  for (const f of failures) process.stdout.write(`  - ${f}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`prueba-truncado: OK (${CASOS.length + 3} archivos, 6 tecnologías, 2 reintentos, 2 llamadas cruzadas y 1 entera + 1 cortada)\n`);
}
