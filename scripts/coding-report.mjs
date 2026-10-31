#!/usr/bin/env node
/**
 * Genera reports/CODING-<fecha>.md y los SVG de coding a partir de las tandas
 * de `bench-coding.mjs`. No ejecuta modelos: solo agrega resultados ya medidos.
 *
 *   node scripts/coding-report.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const FINAL = process.argv.includes("--final")
  ? process.argv[process.argv.indexOf("--final") + 1]
  : "reports/coding-bench-2026-10-31T09-29-38/results.json";
const SINGLES = process.argv.includes("--singles")
  ? process.argv[process.argv.indexOf("--singles") + 1]
  : "reports/coding-bench-2026-10-31T09-44-42/results.json";

const leer = (rel) => JSON.parse(fs.readFileSync(path.join(PROJECT, rel), "utf8"));
const final = leer(FINAL);
const singles = leer(SINGLES);
const filas = [...final.agregados, ...singles.agregados]
  .map((r) => ({
    clave: r.clave,
    nombre: r.nombre,
    global: r.global,
    project: r.project,
    bugfix: r.bugfix,
    reps: Math.max(r.project?.runs || 0, r.bugfix?.runs || 0),
  }))
  .sort((a, b) => b.global - a.global || b.project?.score - a.project?.score);

const fmtPct = (n) => `${Number(n || 0).toFixed(0)}%`;
const fmtT = (ms) => `${Math.round(Number(ms || 0) / 1000)} s`;

function svgBarras(filas) {
  const W = 1120, rowH = 62, top = 118, left = 300, chartW = 620;
  const H = top + filas.length * rowH + 90;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, system-ui, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#0d100b"/>`,
    `<text x="26" y="36" fill="#e9eee0" font-size="19" font-weight="600">Coding real: proyecto multifichero + bugfix</text>`,
    `<text x="26" y="57" fill="#8d9680" font-size="12">Tests ocultos ejecutados con node --test · global = 65% proyecto + 35% bugfix</text>`,
    `<rect x="300" y="78" width="12" height="12" rx="2" fill="#cde86e"/><text x="318" y="89" fill="#b9c2ad" font-size="11">Proyecto</text>`,
    `<rect x="400" y="78" width="12" height="12" rx="2" fill="#6ab7e8"/><text x="418" y="89" fill="#b9c2ad" font-size="11">Bugfix</text>`,
  ];
  filas.forEach((r, i) => {
    const y = top + i * rowH;
    out.push(`<text x="26" y="${y + 25}" fill="#e9eee0" font-size="12" font-weight="600">${r.nombre}</text>`);
    out.push(`<text x="26" y="${y + 42}" fill="#8d9680" font-size="10">${r.reps} rep(s)</text>`);
    const p = Math.round(chartW * (r.project?.score || 0) / 100);
    const b = Math.round(chartW * (r.bugfix?.score || 0) / 100);
    out.push(`<rect x="${left}" y="${y + 6}" width="${chartW}" height="16" rx="4" fill="#1a2014"/>`);
    out.push(`<rect x="${left}" y="${y + 6}" width="${p}" height="16" rx="4" fill="#cde86e"/>`);
    out.push(`<text x="${left + 6}" y="${y + 18}" fill="#0d100b" font-size="9" font-weight="700">${r.project?.pass || 0}/${r.project?.total || 0}</text>`);
    out.push(`<rect x="${left}" y="${y + 28}" width="${chartW}" height="16" rx="4" fill="#1a2014"/>`);
    out.push(`<rect x="${left}" y="${y + 28}" width="${b}" height="16" rx="4" fill="#6ab7e8"/>`);
    out.push(`<text x="${left + 6}" y="${y + 40}" fill="#0d100b" font-size="9" font-weight="700">${r.bugfix?.pass || 0}/${r.bugfix?.total || 0}</text>`);
    out.push(`<text x="${left + chartW + 12}" y="${y + 27}" fill="#e9eee0" font-size="14" font-weight="700">${fmtPct(r.global)}</text>`);
  });
  out.push("</svg>");
  return out.join("\n");
}

function svgDispersion(filas) {
  const W = 980, H = 560, left = 74, right = 30, top = 80, bottom = 70;
  const plotW = W - left - right, plotH = H - top - bottom;
  const maxTps = Math.max(60, ...filas.map((r) => Math.ceil((r.project?.tps || 0) / 10) * 10));
  const x = (tps) => left + plotW * (tps / maxTps);
  const y = (score) => top + plotH * (1 - score / 100);
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, system-ui, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#0d100b"/>`,
    `<text x="24" y="34" fill="#e9eee0" font-size="18" font-weight="600">Coding: calidad frente a velocidad</text>`,
    `<text x="24" y="54" fill="#8d9680" font-size="12">Eje X: tok/s de generación en el proyecto · eje Y: score global</text>`,
  ];
  for (let s = 0; s <= 100; s += 20) {
    out.push(`<line x1="${left}" y1="${y(s)}" x2="${left + plotW}" y2="${y(s)}" stroke="#222a1c" stroke-width="1"/>`);
    out.push(`<text x="${left - 10}" y="${y(s) + 4}" fill="#8d9680" font-size="10" text-anchor="end">${s}%</text>`);
  }
  for (let t = 0; t <= maxTps; t += 10) {
    out.push(`<line x1="${x(t)}" y1="${top}" x2="${x(t)}" y2="${top + plotH}" stroke="#1a2014" stroke-width="1"/>`);
    out.push(`<text x="${x(t)}" y="${top + plotH + 18}" fill="#8d9680" font-size="10" text-anchor="middle">${t}</text>`);
  }
  for (const r of filas) {
    const cx = x(r.project?.tps || 0), cy = y(r.global);
    out.push(`<circle cx="${cx}" cy="${cy}" r="7" fill="${r.global >= 95 ? "#cde86e" : r.global >= 80 ? "#e8c06a" : "#6ab7e8"}" stroke="#0d100b" stroke-width="2"/>`);
    out.push(`<text x="${cx + 11}" y="${cy + 4}" fill="#e9eee0" font-size="11">${r.nombre}</text>`);
  }
  out.push("</svg>");
  return out.join("\n");
}

const dir = path.join(PROJECT, "reports");
fs.mkdirSync(path.join(PROJECT, "docs", "graficos"), { recursive: true });
fs.writeFileSync(path.join(PROJECT, "docs", "graficos", "bench-coding.svg"), svgBarras(filas), "utf8");
fs.writeFileSync(path.join(PROJECT, "docs", "graficos", "bench-coding-speed.svg"), svgDispersion(filas), "utf8");

const md = [
  "# Coding real en Bonsai · 31-oct-2026",
  "",
  "Prueba de proyecto complicado, no preguntas sueltas. Dos tareas con **tests ocultos** que el modelo no escribe; se ejecutan de verdad con `node --test`.",
  "",
  "## Tareas",
  "",
  "| Tarea | Qué pide | Tests ocultos |",
  "|---|---|---:|",
  "| `project` | Proyecto Node ESM multifichero: `PriorityQueue` (min-heap, FIFO en empate) y `Scheduler` (prioridad, concurrencia, reintentos, orden de finalización) | 9 |",
  "| `bugfix` | Corregir un carrito con dos bugs: descuento porcentual y multiplicación por cantidad | 5 |",
  "",
  "El score global es **65 % proyecto + 35 % bugfix**. Un archivo de test que no arranca, un timeout o un archivo que no se puede aplicar cuentan como fallo: el denominador es fijo (9 y 5), no lo que el modelo consiga ejecutar.",
  "",
  "## Ranking",
  "",
  "| # | Modelo | Global | Proyecto | Bugfix | Reps | tok/s | Tiempo proyecto |",
  "|---:|---|---:|---:|---:|---:|---:|---:|",
  ...filas.map((r, i) => `| ${i + 1} | **${r.nombre}** | **${fmtPct(r.global)}** | ${r.project ? `${r.project.pass}/${r.project.total} (${fmtPct(r.project.score)})` : "—"} | ${r.bugfix ? `${r.bugfix.pass}/${r.bugfix.total} (${fmtPct(r.bugfix.score)})` : "—"} | ${r.reps} | ${Math.round(r.project?.tps || r.bugfix?.tps || 0)} | ${fmtT(r.project?.ms)} |`),
  "",
  "![Coding: proyecto y bugfix](../docs/graficos/bench-coding.svg)",
  "",
  "![Coding: calidad frente a velocidad](../docs/graficos/bench-coding-speed.svg)",
  "",
  "## Lectura",
  "",
  "- **GPT-OSS-20B** es el mejor para el proyecto complejo: **18/18 tests en 2 repeticiones** (y 27/27 en una tanda previa de 3). También hace 5/5 en bugfix. Es el recomendado para arquitectura desde cero.",
  "- **Qwen3.6-35B-A3B** queda a un test del líder (17/18) y es perfecto en bugfix (10/10). Además genera a ~39 tok/s, más rápido que GPT-OSS (~30).",
  "- **Qwen3-30B-A3B 2507** es el más rápido de los grandes (~42 tok/s) y hace 14/18 + 10/10; la mejor relación velocidad/calidad si el tiempo importa.",
  "- Los densos pequeños (**Qwen3 4B, Qwen3.5 9B, Qwen2.5 Coder 7B, Ornith 9B**) aprueban el bugfix pero se quedan en 0–4/9 en el proyecto multifichero. Sirven para tareas guiadas y ediciones, no para diseñar un scheduler desde cero.",
  "- **Ornith** está ajustado para el agente del IDE, no para generar un proyecto entero de una sola respuesta; su 0/9 aquí no invalida su uso como agente. Es un aviso de que el benchmark mide generación one-shot, no el bucle de herramientas.",
  "",
  "## Hallazgos de pipeline (lo que cambió el resultado)",
  "",
  "| Problema | Efecto medido | Corrección |",
  "|---|---|---|",
  "| El modelo envuelve el archivo en ```mjs | Qwen3-30B: 2/9 → 5/9 en la primera iteración | `limpiarCuerpo()` quita cercas exteriores |",
  "| El modelo escribe `discount.mjs` sin `src/` | GPT-OSS bugfix: 1/5 → 5/5 | normalización de rutas por nombre base |",
  "| Un scheduler con deadlock cuelga `node --test` | 60 s perdidos y score 0/0 | timeout por test + `taskkill /T` y denominador fijo |",
  "| `max_tokens` corta el proyecto | Qwen3.6: 0/9 → 9/9 al dar 12k | 12k proyecto / 8k bugfix y continuación si `finish=length` |",
  "| Un archivo de test no arranca y `# tests` baja | score inflado (4/5 = 80 %) | denominador fijo 9/5; 4/9 = 44 % |",
  "",
  "Además, el benchmark usa el mismo pipeline que el IDE: plantilla `tokenizer.chat_template`, `/v1/chat/completions` con system+user, `--load-mode none` para los MoE que caben en RAM, 12 hilos y batch 1024/512.",
  "",
  "El **agente real del IDE** con GPT-OSS pasó 3/3 tareas y el perfil `moe-fast` redujo `cross-file` de 133,6 s a 43,1 s. Detalle: [CODER-PIPELINE-2026-10-31.md](CODER-PIPELINE-2026-10-31.md).",
  "",
  "## Reproducir",
  "",
  "```powershell",
  "node scripts/bench-coding.mjs --models gpt-oss-20b,qwen36-35b-a3b,qwen3-30b-a3b-2507 --reps 2",
  "node scripts/bench-coding.mjs --models ornith9b,qwen25-coder-7b,qwen35-9b,qwen3-4b-2507 --reps 1",
  "node scripts/coding-report.mjs",
  "```",
  "",
  "Resultados crudos: `reports/coding-bench-2026-10-31T09-29-38/` (head-to-head) y `reports/coding-bench-2026-10-31T09-44-42/` (densos).",
  "",
  "## Limitaciones",
  "",
  "- 2 repeticiones en los tres grandes y 1 en los densos; no es un ranking estadístico. La varianza medida es real: GPT-OSS hizo 5/5, 5/5 y 1/5 en bugfix antes de normalizar rutas; Qwen3.6 hizo 4/9, 4/9 y 7/9 en proyecto antes de subir el presupuesto.",
  "- El formato `===FILE===` es artificial; el IDE usa herramientas y edición incremental. Un modelo puede rendir mejor en el bucle del agente que en one-shot.",
  "- Solo una máquina (RTX 4060 8 GB, 16 GB RAM).",
].join("\n");
fs.writeFileSync(path.join(dir, "CODING-2026-10-31.md"), md, "utf8");
process.stdout.write(`${path.join(dir, "CODING-2026-10-31.md")}\n${path.join(PROJECT, "docs", "graficos", "bench-coding.svg")}\n`);
