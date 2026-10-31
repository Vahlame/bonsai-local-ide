#!/usr/bin/env node
/**
 * Ejecutor de las suites de Bonsai IDE.
 *
 *   node scripts/run-tests.mjs              # suites aisladas (sin GPU, sin llama-server real)
 *   node scripts/run-tests.mjs gpu          # suites que usan el modelo real ya cargado
 *   node scripts/run-tests.mjs gpu-exclusiva # calidad KV: exige la GPU libre y arranca sus servidores
 *   node scripts/run-tests.mjs navegador    # solo las que abren Edge/Chrome
 *   node scripts/run-tests.mjs todo         # las cuatro familias
 *   node scripts/run-tests.mjs --listar     # enseña qué se ejecutaría, sin ejecutar
 *
 * Cada suite se ejecuta en su PROPIO proceso (Node), en secuencia, para que no compartan
 * servidores simulados ni puertos. Se captura su salida: se enseña en verde/rojo solo el
 * resumen, y si una falla se imprimen sus últimas líneas. Código de salida 0 si todo pasa.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TIMEOUT_POR_DEFECTO = 240_000;
/** Líneas de salida de una suite que se enseñan cuando falla. */
const LINEAS_DE_FALLO = 50;

/**
 * @typedef {Object} Suite
 * @property {string} archivo ruta relativa a la raíz del proyecto
 * @property {string[]} [args] argumentos extra
 * @property {number} [timeout] milisegundos
 */

/** Suites aisladas: no necesitan GPU ni modelo real (varias usan un llama-server falso). */
/** @type {Suite[]} */
const AISLADAS = [
  { archivo: "chat/modelo.mjs" },
  { archivo: "chat/model-plan.mjs" },
  { archivo: "chat/prueba-model-hub.mjs", timeout: 180_000 },
  { archivo: "chat/bonsai-chat.mjs", args: ["--self-test"] },
  { archivo: "chat/actions.mjs" },
  { archivo: "chat/prueba-entorno-local.mjs" },
  { archivo: "chat/prueba-investigacion.mjs" },
  { archivo: "chat/prueba-imagenes.mjs", timeout: 120_000 },
  { archivo: "chat/prueba-terminal.mjs", timeout: 120_000 },
  { archivo: "chat/prueba-diagnosticos.mjs", timeout: 180_000 },
  { archivo: "chat/editar.mjs" },
  { archivo: "chat/adaptadores.mjs" },
  { archivo: "chat/prueba-ui.mjs" },
  { archivo: "chat/prueba-editor.mjs" },
  { archivo: "chat/prueba-contexto.mjs" },
  { archivo: "chat/prueba-compactacion.mjs" },
  { archivo: "chat/prueba-memoria-global.mjs" },
  { archivo: "chat/prueba-registros.mjs" },
  { archivo: "chat/prueba-stream.mjs", timeout: 120_000 },
  { archivo: "chat/prueba-lecturas.mjs" },
  { archivo: "chat/prueba-markdown-seguro.mjs" },
  { archivo: "chat/prueba-navegador-rutas.mjs" },
  { archivo: "chat/prueba-archivos-seguros.mjs" },
  { archivo: "chat/prueba-escritura-incremental.mjs" },
  { archivo: "chat/prueba-git-seguro.mjs" },
  { archivo: "chat/prueba-procesos.mjs", timeout: 120_000 },
  { archivo: "chat/prueba-seguridad.mjs" },
  { archivo: "chat/prueba-sin-gpu.mjs" },
  { archivo: "chat/prueba-truncado.mjs", timeout: 120_000 },
  { archivo: "chat/prueba-api.mjs" },
  { archivo: "chat/prueba-agente-limites.mjs", timeout: 180_000 },
  { archivo: "chat/prueba-servidor-estado.mjs" },
  { archivo: "chat/prueba-recuperacion-modelo.mjs" },
  { archivo: "chat/prueba-agente.mjs", timeout: 240_000 },
  { archivo: "chat/prueba-servidor-administrado.mjs", timeout: 120_000 },
  { archivo: "chat/prueba-lanzador.mjs" },
  { archivo: "chat/prueba-perfil-gpu.mjs", timeout: 120_000 },
  { archivo: "chat/prueba-copia-evaluacion.mjs" },
  { archivo: "chat/prueba-small-coder.mjs" },
  { archivo: "chat/prueba-cancelacion-y-cierre.mjs", timeout: 120_000 },
  { archivo: "chat/prueba-benchmark-coder.mjs" },
  { archivo: "chat/prueba-python-coder.mjs" },
  { archivo: "chat/prueba-code-intelligence.mjs" },
];

/** Suites que necesitan el modelo real ya cargado y escuchando. No forman parte de `npm test`. */
/** @type {Suite[]} */
const GPU = [
  { archivo: "chat/prueba-gpu-real.mjs", timeout: 600_000 },
  { archivo: "chat/prueba-vision.mjs", timeout: 600_000 },
  { archivo: "chat/prueba-modelos.mjs", args: ["--real"], timeout: 600_000 },
  { archivo: "chat/prueba-observacion.mjs", args: ["--real"], timeout: 600_000 },
];

/**
 * Suites que arrancan sus propios llama-server y exigen la GPU exclusiva: no
 * pueden convivir con el servidor de 8080. Se ejecutan después de detenerlo.
 * @type {Suite[]}
 */
const GPU_EXCLUSIVA = [
  { archivo: "chat/prueba-calidad-kv.mjs", args: ["--real"], timeout: 900_000 },
];

/** Suites que abren un navegador real (Edge/Chrome headless). No forman parte de `npm test`. */
/** @type {Suite[]} */
const NAVEGADOR = [
  { archivo: "chat/prueba-mcp-playwright.mjs", timeout: 120_000 },
  { archivo: "chat/prueba-navegador-desarrollo.mjs", timeout: 120_000 },
  { archivo: "chat/prueba-navegador.mjs", timeout: 180_000 },
  { archivo: "chat/prueba-navegador-aislamiento.mjs", timeout: 180_000 },
  { archivo: "chat/prueba-ui-humo.mjs", timeout: 180_000 },
  { archivo: "chat/prueba-inicio-modelo.mjs", timeout: 180_000 },
];

/** @type {Record<string, Suite[]>} */
const GRUPOS = { aisladas: AISLADAS, gpu: GPU, "gpu-exclusiva": GPU_EXCLUSIVA, navegador: NAVEGADOR };
const NOMBRES = {
  aisladas: "aisladas (sin GPU ni servidor real)",
  gpu: "GPU (modelo real cargado)",
  "gpu-exclusiva": "GPU exclusiva (calidad KV, sin servidor en 8080)",
  navegador: "navegador (Edge/Chrome)",
};
const ALIAS = { todos: "todo", all: "todo", unitarias: "aisladas", "sin-gpu": "aisladas", default: "aisladas", "gpu-exclusivo": "gpu-exclusiva" };

const argv = process.argv.slice(2);
if (argv.includes("--listar")) {
  for (const [clave, suites] of Object.entries(GRUPOS)) {
    process.stdout.write(`\n${NOMBRES[clave]}:\n`);
    for (const suite of suites) process.stdout.write(`  ${suite.archivo}${suite.args ? ` ${suite.args.join(" ")}` : ""}\n`);
  }
  process.exit(0);
}

const pedidos = argv.length ? argv : ["aisladas"];
/** @type {string[]} */
const elegidos = [];
for (const bruto of pedidos) {
  const grupo = ALIAS[bruto] || bruto;
  if (grupo === "todo") {
    for (const nombre of Object.keys(GRUPOS)) if (!elegidos.includes(nombre)) elegidos.push(nombre);
    continue;
  }
  if (!GRUPOS[grupo]) {
    process.stderr.write(`Grupo desconocido: ${bruto}\nGrupos: ${Object.keys(GRUPOS).join(", ")}, todo\n`);
    process.exit(2);
  }
  if (!elegidos.includes(grupo)) elegidos.push(grupo);
}
/** @type {Suite[]} */
const suites = elegidos.flatMap((grupo) => GRUPOS[grupo]);

/**
 * @param {Suite} suite
 * @returns {Promise<{ok: boolean, codigo: number | null, senal: NodeJS.Signals | null, ms: number, salida: string}>}
 */
function ejecutarSuite(suite) {
  const timeout = suite.timeout || TIMEOUT_POR_DEFECTO;
  const inicio = Date.now();
  return new Promise((resolver) => {
    const hijo = spawn(process.execPath, [suite.archivo, ...(suite.args || [])], {
      cwd: RAIZ,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let salida = "";
    let cortada = false;
    let temporizador = null;
    const acumular = (trozo) => {
      if (cortada) return;
      salida += trozo;
      if (salida.length > 4_000_000) {
        salida = salida.slice(-2_000_000);
        cortada = true;
      }
    };
    hijo.stdout.on("data", acumular);
    hijo.stderr.on("data", acumular);
    temporizador = setTimeout(() => {
      salida += `\n[run-tests] tiempo agotado (${Math.round(timeout / 1000)} s): se detiene la suite.\n`;
      hijo.kill();
    }, timeout);
    hijo.on("error", (error) => {
      clearTimeout(temporizador);
      resolver({ ok: false, codigo: null, senal: null, ms: Date.now() - inicio, salida: `${salida}\n[run-tests] no se pudo lanzar: ${error.message}` });
    });
    hijo.on("close", (codigo, senal) => {
      clearTimeout(temporizador);
      resolver({ ok: codigo === 0 && !senal, codigo, senal, ms: Date.now() - inicio, salida });
    });
  });
}

/**
 * Últimas líneas de una salida para diagnosticar un fallo.
 * @param {string} salida
 * @returns {string}
 */
function colaDeFallo(salida) {
  const lineas = salida.replace(/\r\n/g, "\n").split("\n");
  const limpias = lineas.filter((linea, i) => !(i === lineas.length - 1 && !linea));
  if (limpias.length <= LINEAS_DE_FALLO) return limpias.join("\n");
  return `[…${limpias.length - LINEAS_DE_FALLO} líneas anteriores omitidas…]\n${limpias.slice(-LINEAS_DE_FALLO).join("\n")}`;
}

process.stdout.write(`Bonsai IDE · ${suites.length} suite(s) · grupos: ${elegidos.join(", ")}\n`);
const inicioTotal = Date.now();
/** @type {string[]} */
const fallos = [];
let indice = 0;
for (const suite of suites) {
  indice += 1;
  const nombre = `${suite.archivo}${suite.args ? ` ${suite.args.join(" ")}` : ""}`;
  process.stdout.write(`\n▶ ${indice}/${suites.length} ${nombre}\n`);
  const resultado = await ejecutarSuite(suite);
  const segundos = (resultado.ms / 1000).toFixed(1);
  if (resultado.ok) {
    process.stdout.write(`OK   ${nombre} (${segundos} s)\n`);
  } else {
    const detalle = resultado.senal ? `señal ${resultado.senal}` : `código ${resultado.codigo}`;
    process.stdout.write(`FALLO ${nombre} (${detalle}, ${segundos} s)\n`);
    const cola = colaDeFallo(resultado.salida);
    if (cola.trim()) process.stdout.write(`----- salida de ${nombre} -----\n${cola}\n-------------------------------\n`);
    fallos.push(nombre);
  }
}
const total = ((Date.now() - inicioTotal) / 1000).toFixed(1);
process.stdout.write(`\n${suites.length - fallos.length}/${suites.length} OK · ${fallos.length} FALLO · ${total} s\n`);
if (fallos.length) {
  process.stdout.write(`Fallaron:\n${fallos.map((nombre) => `  - ${nombre}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Todo en verde.\n");
  process.exitCode = 0;
}
