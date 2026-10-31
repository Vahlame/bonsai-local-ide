#!/usr/bin/env node
/**
 * Informe del pipeline del agente de coding (coder.mjs) con GPT-OSS.
 * Lee los informe.json de las corridas y genera tabla + SVG.
 *
 *   node scripts/coder-pipeline-report.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const RUNS = [
  { id: "default", nombre: "perfil por defecto", dir: "reports/coder-gptoss-pipeline" },
  { id: "map-off", nombre: "sin repo-map", dir: "reports/coder-gptoss-mapoff" },
  { id: "snippets-off", nombre: "sin snippets", dir: "reports/coder-gptoss-snippetsoff" },
  { id: "moe-profile", nombre: "perfil moe-fast", dir: "reports/coder-gptoss-moeprofile2" },
  { id: "moe-tasks", nombre: "perfil moe-fast (2 tareas)", dir: "reports/coder-gptoss-moeprofile-tasks" },
  { id: "cache-off", nombre: "sin prompt cache", dir: "reports/coder-gptoss-cacheoff" },
  { id: "direct", nombre: "estrategia direct", dir: "reports/coder-gptoss-direct" },
];

const filas = [];
for (const run of RUNS) {
  const p = path.join(PROJECT, run.dir, "informe.json");
  if (!fs.existsSync(p)) continue;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  for (const r of j.results || []) {
    filas.push({
      run: run.nombre,
      id: r.id,
      ok: Boolean(r.ok),
      ms: Number(r.metrics?.completionMs) || 0,
      calls: Number(r.metrics?.llmCalls) || 0,
      prompt: Number(r.metrics?.promptTokens) || 0,
      gen: Number(r.metrics?.generatedTokens) || 0,
      tps: Number(r.metrics?.generationTokensPerSecond) || 0,
      cached: Number(r.metrics?.cachedTokens) || 0,
      tools: Number(r.metrics?.toolCalls) || 0,
    });
  }
}

function svg(filas) {
  const W = 1060, rowH = 38, top = 100, left = 300, chartW = 580;
  const H = top + filas.length * rowH + 70;
  const max = Math.max(1, ...filas.map((f) => f.ms));
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, system-ui, sans-serif">`,
    `<rect width="${W}" height="${H}" fill="#0d100b"/>`,
    `<text x="24" y="34" fill="#e9eee0" font-size="18" font-weight="600">Pipeline del agente: tiempo por tarea</text>`,
    `<text x="24" y="54" fill="#8d9680" font-size="12">GPT-OSS 20B · coder.mjs · PASS en verde, FAIL en rojo</text>`,
  ];
  filas.forEach((f, i) => {
    const y = top + i * rowH;
    const w = Math.round(chartW * (f.ms / max));
    out.push(`<text x="24" y="${y + 20}" fill="#e9eee0" font-size="10">${f.run} · ${f.id}</text>`);
    out.push(`<rect x="${left}" y="${y + 5}" width="${chartW}" height="18" rx="4" fill="#1a2014"/>`);
    out.push(`<rect x="${left}" y="${y + 5}" width="${w}" height="18" rx="4" fill="${f.ok ? "#cde86e" : "#d97878"}"/>`);
    out.push(`<text x="${left + chartW + 10}" y="${y + 19}" fill="#e9eee0" font-size="11" font-weight="700">${(f.ms / 1000).toFixed(1)} s</text>`);
  });
  out.push("</svg>");
  return out.join("\n");
}

const md = [
  "# Pipeline del agente de coding · GPT-OSS 20B",
  "",
  "Medido con `chat/evaluar/coder.mjs` (agente real con herramientas, no one-shot) sobre el mismo modelo GPT-OSS-20B en 8080.",
  "",
  "| Corrida | Tarea | Resultado | Tiempo | Llamadas | Prompt tokens | Cacheados | Herramientas |",
  "|---|---|:--:|---:|---:|---:|---:|---:|",
  ...filas.map((f) => `| ${f.run} | ${f.id} | ${f.ok ? "PASS" : "FAIL"} | ${(f.ms / 1000).toFixed(1)} s | ${f.calls} | ${f.prompt} | ${f.cached} | ${f.tools} |`),
  "",
  "![Pipeline del agente](../docs/graficos/coder-pipeline.svg)",
  "",
  "## Conclusiones",
  "",
  "- **Perfil por defecto: 3/3** tareas (single-bug, cross-file y failing-test), con el bucle de herramientas y verificación real.",
  "- **Quitar snippets** reduce cross-file de **133,6 s a 43,1 s** (3,1×) y failing-test de **66,6 s a 28,9 s** (2,3×), manteniendo PASS. El perfil `chat/coder-profile-moe.json` lo deja activado de forma opt-in.",
  "- **Quitar repo-map** también mejora (68,9 s), pero menos que quitar snippets; para este proyecto los archivos se leen con herramientas y el mapa no aporta.",
  "- **Quitar el prompt cache hace fallar** cross-file (timeout de 180 s). El cache es obligatorio en este hardware.",
  "- **Forzar estrategia direct** hace fallar cross-file (17 llamadas, 77k tokens). La estrategia `auto`/plan es la que funciona.",
  "",
  "## Cómo activar el perfil rápido",
  "",
  "```powershell",
  "$env:BONSAI_CODER_CONFIG = \"chat/coder-profile-moe.json\"",
  "npm run start:ui   # o el arranque habitual del IDE",
  "```",
  "",
  "Sin esa variable se usa `chat/coder-profile.json` (perfil histórico). El perfil rápido baja `snippetTokens` a 0 y mantiene repo-map 600; está pensado para MoE con herramientas y se midió con GPT-OSS.",
  "",
  "Resultados crudos: `reports/coder-gptoss-*`.",
].join("\n");
fs.mkdirSync(path.join(PROJECT, "docs", "graficos"), { recursive: true });
fs.writeFileSync(path.join(PROJECT, "docs", "graficos", "coder-pipeline.svg"), svg(filas), "utf8");
fs.writeFileSync(path.join(PROJECT, "reports", "CODER-PIPELINE-2026-10-31.md"), md, "utf8");
process.stdout.write(`${path.join(PROJECT, "reports", "CODER-PIPELINE-2026-10-31.md")}\n`);

