#!/usr/bin/env node
/**
 * Matriz de visión: prueba cada modelo multimodal CON y SIN proyector.
 *
 * Para cada modelo instalado con visión:
 *   1. arranca con el proyector (plan normal) y ejecuta las sondas + visión;
 *   2. arranca sin `--mmproj` y repite las sondas de texto;
 *   3. compara contexto, VRAM, arranque y resultado de visión.
 *
 * Uso:
 *   node scripts/vision-matrix.mjs
 *   node scripts/vision-matrix.mjs --full       # incluye retrieval a 8k
 *   node scripts/vision-matrix.mjs --model gemma3-4b
 *
 * Escribe reports/vision-matrix-<fecha>/{results.json,summary.md}. La pasada
 * "sin visión" NO actualiza el registro del Hub.
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MODELO } from "../chat/modelo.mjs";
import { listarInstalados, leerRegistro } from "../chat/model-hub.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const args = process.argv.slice(2);
const bandera = (n) => args.includes(`--${n}`);
const arg = (n, d = "") => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d; };
const FULL = bandera("full");
const PUERTO = arg("port", "8097");

const candidatos = listarInstalados()
  .filter((m) => m.existe && !m.oculto && m.vision)
  .map((m) => ({ clave: m.clave, entrada: MODELO.catalogo?.[m.clave], registro: leerRegistro().modelos[m.clave] }))
  .filter((m) => m.entrada?.vision?.archivo && fs.existsSync(path.join(PROJECT, "models", m.entrada.vision.archivo)));

const pedido = arg("model", "");
const lista = pedido ? candidatos.filter((m) => m.clave === pedido) : candidatos;
if (!lista.length) {
  process.stderr.write("No hay modelos con visión instalados (o no coincide --model).\n");
  process.exit(0);
}

function ejecutar(extra) {
  return new Promise((resolve) => {
    const argv = [path.join(HERE, "model-lab.mjs"), "probe", "--model", extra.clave, "--port", PUERTO, ...(FULL ? [] : ["--skip-long"]), ...(extra.sinVision ? ["--sin-vision"] : [])];
    execFile(process.execPath, argv, { cwd: PROJECT, windowsHide: true, timeout: 900000, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) { resolve({ ok: false, error: `${error.message}\n${String(stderr || "").slice(-1600)}` }); return; }
      const inicio = String(stdout).indexOf("{");
      try { resolve({ ok: true, datos: JSON.parse(String(stdout).slice(inicio)) }); } catch (e) { resolve({ ok: false, error: `JSON: ${e.message}` }); }
    });
  });
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = path.join(PROJECT, "reports", `vision-matrix-${stamp}`);
fs.mkdirSync(dir, { recursive: true });
const filas = [];
for (const item of lista) {
  process.stderr.write(`\n=== ${item.clave} ===\n`);
  const con = await ejecutar({ clave: item.clave, sinVision: false });
  process.stderr.write("  con visión: listo\n");
  const sin = await ejecutar({ clave: item.clave, sinVision: true });
  process.stderr.write("  sin visión: listo\n");
  const a = con.ok ? con.datos.resultados?.[0] : null;
  const b = sin.ok ? sin.datos.resultados?.[0] : null;
  const fila = {
    clave: item.clave,
    nombre: item.entrada.nombre,
    visionArchivo: item.entrada.vision.archivo,
    conVision: a ? { ok: true, ctx: a.plan?.contexto, kv: a.plan?.kv, vram: a.vramPicoMiB, ms: a.arranqueMs, pruebas: a.pruebas, resumen: a.resumen } : { ok: false, error: con.error },
    sinVision: b ? { ok: true, ctx: b.plan?.contexto, kv: b.plan?.kv, vram: b.vramPicoMiB, ms: b.arranqueMs, pruebas: b.pruebas, resumen: b.resumen } : { ok: false, error: sin.error },
    diferencia: a && b ? { contexto: (b.plan?.contexto || 0) - (a.plan?.contexto || 0), vram: (b.vramPicoMiB || 0) - (a.vramPicoMiB || 0) } : null,
  };
  filas.push(fila);
  process.stderr.write(`  ctx con/sin: ${fila.conVision.ctx ?? "-"} / ${fila.sinVision.ctx ?? "-"} · VRAM: ${fila.conVision.vram ?? "-"} / ${fila.sinVision.vram ?? "-"}\n`);
}

fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify(filas, null, 2), "utf8");
const md = [
  `# Matriz de visión · ${stamp}`,
  "",
  "Mismo modelo, mismo prompt y mismo plan de KV. «Sin visión» arranca sin `--mmproj`: sirve para medir cuánto contexto/VRAM cuesta el proyector y si el modelo sigue siendo útil como texto.",
  "",
  "| Modelo | Contexto con visión | Contexto sin visión | Δ contexto | VRAM con | VRAM sin | Visión |",
  "|---|---:|---:|---:|---:|---:|:--:|",
  ...filas.map((f) => `| ${f.clave} | ${f.conVision.ctx ?? "FALLO"} | ${f.sinVision.ctx ?? "FALLO"} | ${f.diferencia ? (f.diferencia.contexto >= 0 ? "+" : "") + f.diferencia.contexto : "-"} | ${f.conVision.vram ?? "-"} MiB | ${f.sinVision.vram ?? "-"} MiB | ${f.conVision.ok ? "sí" : "no"} |`),
  "",
  ...filas.flatMap((f) => [`## ${f.clave}`, "", `- Con visión: ${f.conVision.resumen || f.conVision.error || "-"}`, `- Sin visión: ${f.sinVision.resumen || f.sinVision.error || "-"}`, ""]),
].join("\n");
fs.writeFileSync(path.join(dir, "summary.md"), md, "utf8");
process.stdout.write(`${JSON.stringify({ dir, resultados: filas }, null, 2)}\n`);
process.exitCode = filas.some((f) => !f.conVision.ok || !f.sinVision.ok) ? 1 : 0;
