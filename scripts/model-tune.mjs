#!/usr/bin/env node
/**
 * Optimización de motor por modelo con llama-bench.
 *
 * Prueba, para cada GGUF, las palancas que de verdad cambian el rendimiento en
 * una RTX 4060 8 GB: un/batch (prompt), hilos de CPU y tipo de KV. Elige la
 * variante con mejor generación (tok/s) y guarda el resultado en el registro
 * del Model Hub (`servidor.ubatch`, `servidor.threads`, `optimizacion`).
 *
 * Uso:
 *   node scripts/model-tune.mjs --model qwen3-4b-2507
 *   node scripts/model-tune.mjs --all
 *   node scripts/model-tune.mjs --all --quick
 *
 * Requiere la GPU libre: llama-bench carga el modelo entero. No usa el puerto
 * 8080 ni servidores HTTP.
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MODELO } from "../chat/modelo.mjs";
import { listarInstalados, leerRegistro, guardarRegistro, planParaModelo, vramInfo } from "../chat/model-hub.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const args = process.argv.slice(2);
const arg = (nombre, def = "") => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : def;
};
const bandera = (nombre) => args.includes(`--${nombre}`);
const QUICK = bandera("quick");
const BIN = path.join(PROJECT, "bin", "llama-bench.exe");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function candidatos() {
  const out = listarInstalados().filter((m) => m.existe && !m.oculto);
  const vistos = new Set(out.map((m) => m.archivo));
  for (const [clave, e] of Object.entries(MODELO.catalogo || {})) {
    if (!e || typeof e.archivo !== "string" || vistos.has(e.archivo) || e.oculto) continue;
    if (e.servidor?.tipo !== "gpu-completa") continue;
    let bytes = 0;
    try { bytes = fs.statSync(path.join(PROJECT, "models", e.archivo)).size; } catch { bytes = 0; }
    if (!bytes) continue;
    out.push({ clave, nombre: e.nombre || clave, archivo: e.archivo, bytes, existe: true, oculto: false });
    vistos.add(e.archivo);
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/** @param {string[]} argv */
function bench(argv) {
  return new Promise((resolve) => {
    execFile(BIN, argv, { cwd: PROJECT, windowsHide: true, timeout: 300000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, error: String(stderr || error.message).split(/\r?\n/).slice(-6).join("\n"), rows: [] });
        return;
      }
      try {
        const rows = JSON.parse(String(stdout || "[]"));
        resolve({ ok: true, rows: Array.isArray(rows) ? rows : [rows], error: "" });
      } catch (e) {
        resolve({ ok: false, error: `JSON inválido: ${e.message}`, rows: [] });
      }
    });
  });
}

function medir(rows) {
  const pp = rows.find((r) => Number(r.n_prompt) > 0 && Number(r.n_gen) === 0);
  const tg = rows.find((r) => Number(r.n_prompt) === 0 && Number(r.n_gen) > 0);
  return { pp: Number(pp?.avg_ts) || 0, tg: Number(tg?.avg_ts) || 0 };
}

async function tunear(item) {
  const planResp = await planParaModelo(item.clave, { vision: false });
  const plan = planResp.plan;
  if (!plan.ok) throw new Error(`no cabe: ${plan.motivo}`);
  const vr = await vramInfo();
  if (vr.libreMiB < plan.totalMiB) throw new Error(`GPU ocupada: ${vr.libreMiB} MiB libres, el plan pide ~${plan.totalMiB} MiB`);
  const modelo = path.join(PROJECT, "models", item.archivo);
  const kv = plan.kv;
  const base = ["-m", modelo, "-ngl", "99", "-pg", "512,128", "-r", "2", "-b", "512", "-fa", "on", "-o", "json"];
  /** @type {any[]} */
  const variantes = [];
  const correr = async (etiqueta, extra, kvUsado = kv) => {
    const argv = [...base, "-ctk", kvUsado, "-ctv", kvUsado, ...extra];
    const r = await bench(argv);
    if (!r.ok) {
      variantes.push({ etiqueta, ok: false, error: r.error });
      process.stderr.write(`  FALLO ${etiqueta}: ${r.error.split("\n").pop()}\n`);
      return null;
    }
    const m = medir(r.rows);
    variantes.push({ etiqueta, ok: true, ...m });
    process.stderr.write(`  ${etiqueta}: pp ${m.pp.toFixed(1)} t/s · tg ${m.tg.toFixed(2)} t/s\n`);
    return m;
  };

  process.stderr.write(`\n=== ${item.clave} · ${plan.contexto} tok · KV ${kv} ===\n`);
  for (const ub of QUICK ? [256, 512] : [128, 256, 512]) {
    await correr(`ub=${ub} t=4`, ["-ub", String(ub), "-t", "4"]);
  }
  const mejorUb = [...variantes].filter((v) => v.ok).sort((a, b) => b.tg - a.tg || b.pp - a.pp)[0]?.etiqueta?.match(/ub=(\d+)/)?.[1] || "256";
  if (!QUICK) {
    for (const t of [8, 12]) await correr(`ub=${mejorUb} t=${t}`, ["-ub", mejorUb, "-t", String(t)]);
    for (const b of [256, 1024]) await correr(`ub=${mejorUb} t=4 b=${b}`, ["-ub", mejorUb, "-t", "4", "-b", String(b)]);
    for (const kvAlt of ["f16", "q8_0", "q4_0"].filter((k) => k !== kv)) {
      await correr(`ub=${mejorUb} t=4 kv=${kvAlt}`, ["-ub", mejorUb, "-t", "4"], kvAlt);
    }
  }
  const exitosas = variantes.filter((v) => v.ok);
  if (!exitosas.length) throw new Error("ninguna variante de llama-bench arrancó");
  // Para elegir ub/batch/hilos se usan las variantes con el KV del PLAN. Las de
  // otros KV son informativas: cambiar el KV cambiaría el contexto disponible.
  const baseVariants = exitosas.filter((v) => !/kv=/.test(v.etiqueta) || v.etiqueta.endsWith(`kv=${kv}`));
  const puntuar = (v) => v.tg + v.pp / 200;
  const ganadora = (baseVariants.length ? baseVariants : exitosas).sort((a, b) => puntuar(b) - puntuar(a))[0];
  const ub = Number(ganadora.etiqueta.match(/ub=(\d+)/)?.[1] || 256);
  const threads = Number(ganadora.etiqueta.match(/t=(\d+)/)?.[1] || 4);
  const batch = Number(ganadora.etiqueta.match(/(?:^|\s)b=(\d+)/)?.[1] || 512);
  // El KV de la variante ganadora no se guarda como plan: el plan de contexto
  // manda. Solo se anota para que quede la medida.
  const kvMedido = ganadora.etiqueta.match(/kv=(\w+)/)?.[1] || kv;
  const entrada = leerRegistro().modelos[item.clave];
  if (entrada) {
    if (!entrada.servidor) entrada.servidor = {};
    entrada.servidor.ubatch = ub;
    entrada.servidor.threads = threads;
    entrada.servidor.batch = batch;
    entrada.optimizacion = {
      fecha: new Date().toISOString(),
      bin: BIN,
      kvPlan: kv,
      kvMedido,
      elegido: { ubatch: ub, threads, batch, tg: ganadora.tg, pp: ganadora.pp },
      motivo: `mejor generación medida (${ganadora.tg.toFixed(2)} t/s) entre ${exitosas.length} variantes`,
      variantes,
    };
    guardarRegistro();
  }
  return { clave: item.clave, plan, elegido: { ubatch: ub, threads, batch, tg: ganadora.tg, pp: ganadora.pp }, variantes };
}

const objetivo = arg("model", "");
let lista;
if (bandera("all")) lista = candidatos();
else {
  if (!objetivo) throw new Error("falta --model <clave> o --all");
  const item = candidatos().find((m) => m.clave === objetivo);
  if (!item) throw new Error(`modelo no instalado: ${objetivo}`);
  lista = [item];
}
if (!fs.existsSync(BIN)) throw new Error(`falta ${BIN}`);
if (!lista.length) throw new Error("no hay modelos que optimizar");

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = path.join(PROJECT, "reports", `model-tune-${stamp}`);
fs.mkdirSync(dir, { recursive: true });
const resultados = [];
for (const item of lista) {
  try {
    const r = await tunear(item);
    resultados.push(r);
  } catch (error) {
    const r = { clave: item.clave, error: error instanceof Error ? error.message : String(error) };
    resultados.push(r);
    process.stderr.write(`FALLO ${item.clave}: ${r.error}\n`);
  }
}
fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(resultados, null, 2), "utf8");
const md = [
  `# Optimización por modelo · ${stamp}`,
  "",
  "| Modelo | Elegido | tg t/s | pp t/s | Variantes |",
  "|---|---|---:|---:|---:|",
  ...resultados.map((r) => r.error
    ? `| ${r.clave} | error | - | - | - |`
    : `| ${r.clave} | ub ${r.elegido.ubatch} · t ${r.elegido.threads} · b ${r.elegido.batch} | ${r.elegido.tg.toFixed(2)} | ${r.elegido.pp.toFixed(0)} | ${r.variantes.length} |`),
  "",
  ...resultados.flatMap((r) => r.error ? [`## ${r.clave}\n\n${r.error}\n`] : [`## ${r.clave}\n`, ...r.variantes.map((v) => `- ${v.etiqueta}: ${v.ok ? `pp ${v.pp.toFixed(1)} · tg ${v.tg.toFixed(2)}` : `FALLO ${v.error.split("\n").pop()}`}`), ""]),
].join("\n");
fs.writeFileSync(path.join(dir, "summary.md"), md, "utf8");
process.stdout.write(`${JSON.stringify({ dir, resultados }, null, 2)}\n`);
process.exitCode = resultados.some((r) => r.error) ? 1 : 0;
