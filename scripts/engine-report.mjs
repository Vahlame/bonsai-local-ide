#!/usr/bin/env node
/** Informe de tuning del motor a partir de las tandas de moe-bench. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const FUENTES = [
  "reports/moe-bench-2026-10-31T14-20-20/results.json",
  "reports/moe-bench-2026-10-31T14-28-39/results.json",
  "reports/moe-bench-2026-10-31T14-30-00/results.json",
  "reports/moe-bench-2026-10-31T14-31-28/results.json",
  "reports/moe-bench-2026-10-31T14-32-01/results.json",
];
const vistos = new Map();
for (const rel of FUENTES) {
  const p = path.join(PROJECT, rel);
  if (!fs.existsSync(p)) continue;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  const lista = Array.isArray(j) ? j : (j.filas || []);
  for (const r of lista) {
    if (!vistos.has(r.variante)) vistos.set(r.variante, r);
  }
}
const filas = [...vistos.values()].sort((a, b) => (b.generacion?.tokPorSegundo || 0) - (a.generacion?.tokPorSegundo || 0));

// Curva de contexto de GPT-OSS (misma tanda de moe-bench).
const ctxPath = path.join(PROJECT, "reports/moe-bench-2026-10-31T15-00-51/results.json");
let ctxGpt = [];
if (fs.existsSync(ctxPath)) {
  const raw = JSON.parse(fs.readFileSync(ctxPath, "utf8"));
  const lista = Array.isArray(raw) ? raw : (raw.filas || []);
  ctxGpt = lista.filter((r) => r.modelo === "gpt-oss-20b").map((r) => ({
    variante: r.variante,
    ctx: r.ctx,
    kv: r.variante.includes("q4") ? "q4_0" : "q8_0",
    nCpuMoe: r.nCpuMoe,
    gen: r.generacion?.tokPorSegundo || 0,
    prompt: r.promptLargo?.tokPorSegundo || 0,
    vram: r.vramPicoMiB || 0,
    ram: r.ramPicoMiB || 0,
  }));
}

function svgCtx(rows) {
  const W = 980, rowH = 42, top = 96, left = 280, chartW = 560;
  const H = top + rows.length * rowH + 60;
  const max = Math.max(1, ...rows.map((r) => r.gen));
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, system-ui, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#0d100b"/>`,
    `<text x="24" y="34" fill="#e9eee0" font-size="18" font-weight="600">GPT-OSS-20B: contexto frente a velocidad</text>`,
    `<text x="24" y="54" fill="#8d9680" font-size="12">Más contexto = menos capas de expertos en GPU · q8_0 salvo indicación</text>`,
  ];
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const w = Math.round(chartW * r.gen / max);
    out.push(`<text x="24" y="${y + 20}" fill="#e9eee0" font-size="11">${(r.ctx / 1024).toFixed(0)}k · ${r.kv} · ${r.nCpuMoe} CPU</text>`);
    out.push(`<rect x="${left}" y="${y + 6}" width="${chartW}" height="18" rx="4" fill="#1a2014"/>`);
    out.push(`<rect x="${left}" y="${y + 6}" width="${w}" height="18" rx="4" fill="#cde86e"/>`);
    out.push(`<text x="${left + chartW + 10}" y="${y + 20}" fill="#e9eee0" font-size="11" font-weight="700">${r.gen.toFixed(1)} tok/s</text>`);
  });
  out.push("</svg>");
  return out.join("\n");
}

function svg(rows) {
  const W = 1040, rowH = 38, top = 100, left = 300, chartW = 580;
  const H = top + rows.length * rowH + 60;
  const max = Math.max(1, ...rows.map((r) => r.generacion?.tokPorSegundo || 0));
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, system-ui, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#0d100b"/>`,
    `<text x="24" y="34" fill="#e9eee0" font-size="18" font-weight="600">Tuning del motor · Qwen3-30B-A3B</text>`,
    `<text x="24" y="54" fill="#8d9680" font-size="12">Generación en tok/s · misma máquina, mismo GGUF</text>`,
  ];
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const v = r.generacion?.tokPorSegundo || 0;
    const w = Math.round(chartW * v / max);
    out.push(`<text x="24" y="${y + 18}" fill="#e9eee0" font-size="10">${r.variante}</text>`);
    out.push(`<rect x="${left}" y="${y + 5}" width="${chartW}" height="16" rx="4" fill="#1a2014"/>`);
    out.push(`<rect x="${left}" y="${y + 5}" width="${w}" height="16" rx="4" fill="${r.ok ? "#cde86e" : "#d97878"}"/>`);
    out.push(`<text x="${left + chartW + 10}" y="${y + 18}" fill="#e9eee0" font-size="11" font-weight="700">${r.ok ? `${v.toFixed(1)}` : "FALLO"}</text>`);
  });
  out.push("</svg>");
  return out.join("\n");
}

const md = [
  "# Tuning del motor · Qwen3-30B-A3B · 31-oct-2026",
  "",
  "Mismo GGUF, mismo plan (32k, q8_0, 19/48 capas GPU), misma máquina. Variante base: `--load-mode none`, 12 hilos, batch 1024/512.",
  "",
  "| Variante | Generación | Chat | Prompt | VRAM | Resultado |",
  "|---|---:|---:|---:|---:|---|",
  ...filas.map((r) => `| ${r.variante} | ${r.ok ? `${r.generacion.tokPorSegundo} tok/s` : "—"} | ${r.ok ? `${r.chat?.tokPorSegundo ?? "—"} tok/s` : "—"} | ${r.ok ? `${r.promptLargo.tokPorSegundo} tok/s` : "—"} | ${r.vramPicoMiB || "—"} MiB | ${r.ok ? "OK" : "OOM/fallo"} |`),
  "",
  "![Tuning del motor](../docs/graficos/engine-tuning.svg)",
  "",
  "## Qué funciona",
  "",
  "- **`--load-mode none` + 12 hilos + batch 1024/512** sigue siendo la base: 44,3 tok/s y 1.012 tok/s de prompt.",
  "- **3 capas más de expertos en GPU** (`gpu-3`): **46,4 tok/s** (+4,7 %) y 1.056 tok/s de prompt, con 7.537 MiB de VRAM. 4 capas ya producen OOM.",
  "- **`ngram-simple`**: 71,6 tok/s en generación cruda (+62 %), pero **44,5 tok/s en chat real**, igual que la base. La ganancia viene de texto repetido del prompt, no del uso conversacional. No se integra por defecto.",
  "- **`batch 2048/1024`**: 1.343 tok/s de prompt (+33 %), pero generación baja a 36,2 tok/s (-18 %). Útil para prefill/RAG, no para chat.",
  "",
  "## GPT-OSS: contexto y muestreo oficial",
  "",
  "GPT-OSS usa Harmony y recomienda `temp 1.0`, `top_p 1.0`, `top_k 0`, `min_p ~0.01`. Con 8 GB, el contexto máximo se paga en capas de expertos que pasan a CPU:",
  "",
  "| Contexto | KV | Capas CPU | Generación | Prompt | VRAM | RAM |",
  "|---:|---|---:|---:|---:|---:|---:|",
  ...ctxGpt.map((r) => `| ${(r.ctx / 1024).toFixed(0)}k | ${r.kv} | ${r.nCpuMoe} | ${r.gen.toFixed(1)} tok/s | ${r.prompt.toFixed(0)} tok/s | ${r.vram} MiB | ${r.ram} MiB |`),
  "",
  "![GPT-OSS: contexto y velocidad](../docs/graficos/gptoss-context.svg)",
  "",
  "64k es el equilibrio (29,2 tok/s, 7,7 GiB RAM); 128k funciona a 22,5 tok/s y deja 9,4 GiB de RAM. El modo 128k + KV q4 sube a 25,6 tok/s, pero q4 puede degradar calidad. Aguja a 61.070 tokens: respuesta correcta QX-7419, prefill 777 tok/s.",
  "",
  "## Qué no funciona",
  "",
  "- **Draft Qwen3 0.6B**: 37,9 tok/s con 16k y KV q4; 19,7 tok/s en CPU. No compensa el coste de VRAM/RAM.",
  "- **`prio2`, `poll0`, `tb16`, `norepack`, `mask12`**: neutros o peores (41–44 tok/s).",
  "- **KV q4_0** y **contexto 16k**: misma generación (43–44 tok/s); solo ahorran VRAM.",
  "- **Bloquear relojes a 2800 MHz**: 45,7 tok/s, dentro del ruido; no se justifica el riesgo térmico.",
  "- **Power plan**: ya estaba en High performance; no hay margen.",
  "",
  "## Recomendación",
  "",
  "Mantener la base. Si el usuario quiere exprimir 5 % más y acepta menos margen de VRAM, usar `-GpuExtra 3` en el lanzador (o `--n-cpu-moe` tres capas por debajo del plan; medido como `gpu-3`). No usar ngram/draft como mejora de chat con estos datos.",
  "",
  "Resultados crudos: `reports/moe-bench-2026-10-31T14-*`.",
].join("\n");
fs.mkdirSync(path.join(PROJECT, "docs", "graficos"), { recursive: true });
fs.writeFileSync(path.join(PROJECT, "docs", "graficos", "engine-tuning.svg"), svg(filas), "utf8");
if (ctxGpt.length) fs.writeFileSync(path.join(PROJECT, "docs", "graficos", "gptoss-context.svg"), svgCtx(ctxGpt), "utf8");
fs.writeFileSync(path.join(PROJECT, "reports", "ENGINE-2026-10-31.md"), md, "utf8");
process.stdout.write(`${path.join(PROJECT, "reports", "ENGINE-2026-10-31.md")}\n`);
