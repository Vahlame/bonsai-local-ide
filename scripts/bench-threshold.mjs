#!/usr/bin/env node
/**
 * Umbral de velocidad antes de gastar tiempo en el benchmark de calidad.
 *
 *   node scripts/bench-threshold.mjs --file models/X.gguf --label "X" \
 *     --ngl 99 --threads 8 --ctx 32768 --kv q4_0 --min-tps 20 --out reports/x.json
 *
 * Mide tg128 con llama-bench (3 repeticiones, temperatura 0). Si la mediana no
 * llega a --min-tps, escribe el informe y NO ejecuta el benchmark de calidad.
 * Si llega, con --clave <clave> encadena `model-lab probe --model <clave>`.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const val = (nombre, def = "") => {
  const i = argv.indexOf(`--${nombre}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : def;
};
const flag = (nombre) => argv.includes(`--${nombre}`);

const archivo = path.resolve(val("file"));
const label = val("label", path.basename(archivo));
const ngl = Math.max(0, Number(val("ngl", "99")) || 0);
const ncmoe = Math.max(0, Number(val("ncmoe", "0")) || 0);
const threads = Math.max(1, Number(val("threads", "8")) || 8);
const ctx = Math.max(4096, Number(val("ctx", "16384")) || 16384);
const kv = val("kv", "q4_0");
const minTps = Math.max(1, Number(val("min-tps", "20")) || 20);
const out = path.resolve(val("out", path.join(ROOT, "reports", `bench-threshold-${Date.now()}.json`)));
const clave = val("clave");
const bin = path.resolve(val("bin", path.join(ROOT, "bin", "llama-bench.exe")));
const repeticiones = Math.max(1, Number(val("repetitions", "3")) || 3);

if (!fs.existsSync(archivo)) throw new Error(`no existe el GGUF: ${archivo}`);
if (!fs.existsSync(bin)) throw new Error(`no existe llama-bench: ${bin}`);
fs.mkdirSync(path.dirname(out), { recursive: true });

const args = [
  "-m", archivo,
  "-ngl", String(ngl),
  "-t", String(threads),
  "-p", "512",
  "-n", "128",
  "-r", String(repeticiones),
  "-ctk", kv,
  "-ctv", kv,
  "-fa", "on",
  "-o", "json",
];
if (ncmoe > 0) args.push("-ncmoe", String(ncmoe));
if (flag("dry-run")) {
  process.stdout.write(`${bin} ${args.join(" ")}\n`);
  process.exit(0);
}

process.stderr.write(`[bench] ${label}: llama-bench ngl=${ngl} ncmoe=${ncmoe} t=${threads} ctx=${ctx} kv=${kv}\n`);
const inicio = Date.now();
const run = spawnSync(bin, args, {
  cwd: ROOT,
  encoding: "utf8",
  timeout: 20 * 60 * 1000,
  windowsHide: true,
  maxBuffer: 20 * 1024 * 1024,
});
const ms = Date.now() - inicio;
if (run.error) throw run.error;
const salida = `${run.stdout || ""}\n${run.stderr || ""}`;
if (run.status !== 0) {
  const detalle = salida.split(/\r?\n/).filter(Boolean).slice(-30).join("\n");
  throw new Error(`llama-bench terminó con código ${run.status}:\n${detalle}`);
}
let filas = [];
try { filas = JSON.parse(run.stdout); } catch {
  const inicioJson = run.stdout.indexOf("[");
  if (inicioJson < 0) throw new Error(`llama-bench no devolvió JSON:\n${salida.slice(-2000)}`);
  filas = JSON.parse(run.stdout.slice(inicioJson));
}
const generacion = filas.filter((f) => Number(f.n_gen) === 128 || String(f.test || "").includes("tg128"));
const valores = generacion.map((f) => Number(f.avg_ts)).filter(Number.isFinite).sort((a, b) => a - b);
if (!valores.length) throw new Error(`llama-bench no devolvió avg_ts de generación:\n${salida.slice(-2000)}`);
const tps = valores[Math.floor(valores.length / 2)];
const informe = {
  etiqueta: label,
  archivo,
  bytes: fs.statSync(archivo).size,
  fecha: new Date().toISOString(),
  comando: { bin, args },
  duracionMs: ms,
  ngl,
  ncmoe,
  threads,
  contextoNominal: "llama-bench no recibe -c; mide -p 512 / -n 128 con su contexto por defecto",
  kv,
  repeticiones,
  generacion: filas,
  tpsMediana: Number(tps.toFixed(2)),
  umbralTps: minTps,
  superaUmbral: tps >= minTps,
  benchmarkCalidad: tps >= minTps,
  motivo: tps >= minTps ? "supera el umbral; se puede ejecutar el benchmark de calidad" : `menos de ${minTps} tok/s: se reporta y NO se ejecuta el benchmark de calidad`,
};
fs.writeFileSync(out, JSON.stringify(informe, null, 2));
process.stdout.write(`${label}: ${informe.tpsMediana} tok/s (${tps >= minTps ? "≥" : "<"} ${minTps}) · ${out}\n`);
if (tps < minTps) {
  process.stderr.write(`[bench] ${label}: ${informe.motivo}\n`);
  process.exitCode = 0;
} else if (clave) {
  process.stderr.write(`[bench] ${label}: umbral superado; ejecutando model-lab probe (${clave})\n`);
  const probe = spawnSync(process.execPath, [path.join(ROOT, "scripts", "model-lab.mjs"), "probe", "--model", clave, "--skip-long", "--sin-vision", "--json"], {
    cwd: ROOT,
    stdio: "inherit",
    timeout: 30 * 60 * 1000,
    windowsHide: true,
  });
  process.exitCode = probe.status || 0;
}
