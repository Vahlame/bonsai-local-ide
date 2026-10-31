#!/usr/bin/env node
/** Informe de web app a partir de las tandas de bench-webapp.mjs. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const FUENTES = [
  "reports/webapp-bench-2026-10-31T14-33-20/results.json",
  "reports/webapp-bench-2026-10-31T14-35-37/results.json",
];
const filas = [];
for (const rel of FUENTES) {
  const p = path.join(PROJECT, rel);
  if (!fs.existsSync(p)) continue;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const a of j.agregados || []) {
    const runs = (j.resultados || []).filter((r) => r.clave === a.clave);
    filas.push({
      ...a,
      fallos: runs.flatMap((r) => [
        ...(r.api || []).filter((x) => !x.ok).map((x) => `API ${x.id}: ${x.detalle}`),
        ...(r.ui || []).filter((x) => !x.ok).map((x) => `UI ${x.id}: ${x.detalle}`),
      ]),
    });
  }
}
filas.sort((a, b) => b.score - a.score);

function svg(rows) {
  const W = 1040, rowH = 64, top = 112, left = 300, chartW = 580;
  const H = top + rows.length * rowH + 70;
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, system-ui, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#0d100b"/>`,
    `<text x="24" y="34" fill="#e9eee0" font-size="18" font-weight="600">Web app real: Taskboard full-stack</text>`,
    `<text x="24" y="54" fill="#8d9680" font-size="12">API oculta + UI Playwright · global = 70% API + 30% UI</text>`,
    `<rect x="300" y="78" width="12" height="12" rx="2" fill="#cde86e"/><text x="318" y="89" fill="#b9c2ad" font-size="11">API</text>`,
    `<rect x="380" y="78" width="12" height="12" rx="2" fill="#6ab7e8"/><text x="398" y="89" fill="#b9c2ad" font-size="11">UI</text>`,
  ];
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    out.push(`<text x="24" y="${y + 24}" fill="#e9eee0" font-size="12" font-weight="600">${r.nombre}</text>`);
    const api = Math.round(chartW * (r.apiPass / Math.max(1, r.totalApi)));
    const ui = Math.round(chartW * (r.uiPass / Math.max(1, r.totalUi)));
    out.push(`<rect x="${left}" y="${y + 6}" width="${chartW}" height="14" rx="4" fill="#1a2014"/>`);
    out.push(`<rect x="${left}" y="${y + 6}" width="${api}" height="14" rx="4" fill="#cde86e"/>`);
    out.push(`<text x="${left + 6}" y="${y + 17}" fill="#0d100b" font-size="9" font-weight="700">${r.apiPass}/${r.totalApi} API</text>`);
    out.push(`<rect x="${left}" y="${y + 26}" width="${chartW}" height="14" rx="4" fill="#1a2014"/>`);
    out.push(`<rect x="${left}" y="${y + 26}" width="${ui}" height="14" rx="4" fill="#6ab7e8"/>`);
    out.push(`<text x="${left + 6}" y="${y + 37}" fill="#0d100b" font-size="9" font-weight="700">${r.uiPass}/${r.totalUi} UI</text>`);
    out.push(`<text x="${left + chartW + 12}" y="${y + 26}" fill="#e9eee0" font-size="14" font-weight="700">${r.score.toFixed(0)}%</text>`);
  });
  out.push("</svg>");
  return out.join("\n");
}

// Copiar capturas a docs/graficos para que el informe sea autocontenido.
for (const r of filas) {
  if (!r.screenshot) continue;
  const src = path.join(PROJECT, r.screenshot);
  if (!fs.existsSync(src)) continue;
  const dst = path.join(PROJECT, "docs", "graficos", `webapp-${r.clave}.png`);
  fs.copyFileSync(src, dst);
  r.captura = `../docs/graficos/webapp-${r.clave}.png`;
}

const md = [
  "# Web app real · 31-oct-2026",
  "",
  "Tarea: construir una **Taskboard full-stack** Node ESM sin dependencias: API CRUD + stats, persistencia `data.json`, HTML/CSS/JS y UI de tablero.",
  "",
  "Tests ocultos: **8 de API** con fetch (crear, listar, cambiar estado, stats, borrar, estáticos) y **3 de UI** con Playwright/Edge (input, botón y tarea visible). El modelo no escribe tests.",
  "",
  "| # | Modelo | Global | API | UI | Tiempo | tok/s | Captura |",
  "|---:|---|---:|---:|---:|---:|---:|---|",
  ...filas.map((r, i) => `| ${i + 1} | **${r.nombre}** | **${r.score.toFixed(0)}%** | ${r.apiPass}/${r.totalApi} | ${r.uiPass}/${r.totalUi} | ${(r.ms / 1000).toFixed(0)} s | ${r.tps} | ${r.captura ? `[ver](${r.captura})` : "—"} |`),
  "",
  "![Web app benchmark](../docs/graficos/bench-webapp.svg)",
  "",
  "## Qué pasó",
  "",
  "- **GPT-OSS-20B: 100 %.** API completa, estáticos correctos y UI funcional; la captura lo confirma.",
  "- **Qwen3.6-35B-A3B: 91 %.** La API y la UI funcionan, pero inlinó JS/CSS y no sirvió `app.js`/`styles.css` como archivos separados.",
  "- **Qwen3-30B-A3B: 55 %.** Bug real en `PATCH`/`DELETE`: `path.slice(13)` corta dos caracteres del id y devuelve 404; además no sirve los estáticos y la UI no añade tareas.",
  "",
  "## Fallos concretos",
  "",
  ...filas.flatMap((r) => [
    `### ${r.nombre}`,
    "",
    ...(r.fallos.length ? r.fallos.map((f) => `- ${f}`) : ["- Sin fallos: 8/8 API y 3/3 UI."]),
    "",
  ]),
  "## Lectura",
  "",
  "Para una web app completa, **GPT-OSS-20B** es el que mejor sigue el contrato de archivos y API. **Qwen3.6** está muy cerca y es más rápido generando, pero tiende a simplificar la estructura. **Qwen3-30B** es rápido, pero un error de una línea en el parseo del id tumba PATCH/DELETE.",
  "",
  "## Reproducir",
  "",
  "```powershell",
  "node scripts/bench-webapp.mjs --models gpt-oss-20b,qwen36-35b-a3b,qwen3-30b-a3b-2507 --reps 1",
  "```",
  "",
  "Resultados crudos: `reports/webapp-bench-*`.",
].join("\n");
fs.mkdirSync(path.join(PROJECT, "docs", "graficos"), { recursive: true });
fs.writeFileSync(path.join(PROJECT, "docs", "graficos", "bench-webapp.svg"), svg(filas), "utf8");
fs.writeFileSync(path.join(PROJECT, "reports", "WEBAPP-2026-10-31.md"), md, "utf8");
process.stdout.write(`${path.join(PROJECT, "reports", "WEBAPP-2026-10-31.md")}\n`);
