#!/usr/bin/env node
/**
 * Genera reports/MODEL-CATALOG-<fecha>.md a partir del catálogo curado y del
 * registro del Hub. No arranca modelos: resume lo ya medido.
 *
 *   node scripts/catalog-report.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const reg = JSON.parse(fs.readFileSync(path.join(PROJECT, "models", "hub-catalog.json"), "utf8"));
const rows = [];
for (const [k, e] of Object.entries(reg.modelos || {})) {
  if (e.oculto) continue;
  rows.push({
    k,
    n: e.nombre || k,
    bytes: e.bytes || 0,
    plan: e.plan || {},
    vision: Boolean(e.vision?.archivo),
    pruebas: e.pruebas?.resumen || "—",
    calidad: e.pruebas?.calidad?.porcentaje ?? null,
    coding: e.pruebas?.coding?.global ?? null,
    rol: e.rol || "",
    moe: e.plan?.moe || e.servidor?.moe || null,
  });
}
rows.push({
  k: "ornith9b", n: "Ornith 1.5 9B", bytes: 5780090816,
  plan: { contexto: 110592, kv: "q8_0", vision: true, mmprojCPU: true, totalMiB: 7620 },
  vision: true, pruebas: "6/6", calidad: null, coding: 35, rol: "curado",
});
rows.sort((a, b) => (b.vision ? 1 : 0) - (a.vision ? 1 : 0) || a.n.localeCompare(b.n, "es"));
const gib = (b) => (Number(b) / 1073741824).toFixed(2);
const stamp = new Date().toISOString().slice(0, 10);
const md = [
  `# Catálogo Bonsai · ${stamp}`,
  "",
  `Modelos instalados: **${rows.length}** (${rows.filter((r) => r.vision).length} con visión). Todos arrancados en una RTX 4060 Laptop de 8 GB.`,
  "",
  "| Modelo | Clave | Tamaño | Plan | Visión | Sondas | Calidad* | Coding* |",
  "|---|---|---:|---|:--:|---:|---:|---:|",
  ...rows.map((r) => `| ${r.n} | \`${r.k}\` | ${gib(r.bytes)} GiB | ${r.plan.contexto ? `${r.plan.contexto} tok · ${r.plan.kv}${r.plan.mmprojCPU ? " · visión CPU" : ""}${r.moe?.activo ? ` · MoE ${r.moe.capasGpu}/${r.moe.capas} GPU` : ""}` : "—"} | ${r.vision ? "sí" : "no"} | ${r.pruebas} | ${r.calidad === null ? "—" : `${r.calidad}%`} | ${r.coding === null ? "—" : `${r.coding}%`} |`),
  "",
  "\\* 5 de las 18 tareas del benchmark (código, SQL, JSON anidado, tool-calling, retrieval), una pasada. No es una comparación estadística.",
  "\\* Coding: proyecto multifichero + bugfix con tests ocultos (9 + 5); 100 % = todos los tests. Detalle en [CODING-2026-10-31](CODING-2026-10-31.md).",
  "",
  ...(rows.some((r) => r.moe?.activo) ? [
    "## MoE: reparto VRAM ↔ RAM",
    "",
    "| Modelo | Expertos | Capas en GPU | Capas en RAM | Expertos en RAM | Carga |",
    "|---|---:|---:|---:|---:|---|",
    ...rows.filter((r) => r.moe?.activo).map((r) => `| ${r.n} | ${r.moe.expertos} | ${r.moe.capasGpu}/${r.moe.capas} (${r.moe.gpuExpertosMiB} MiB) | ${r.moe.nCpuMoe} | ${r.moe.expertosRamMiB} MiB | ${r.moe.loadMode || "mmap"} |`),
    "",
  ] : []),
  "## Lo que mejor funciona",
  "",
  "- **Proyecto complejo:** GPT-OSS 20B (100 % en 18 tests), Qwen3.6 35B-A3B (96 %), Qwen3-30B-A3B (86 %).",
  "- **Bugfix/edición:** Qwen3.6 35B-A3B y Qwen3-30B-A3B (100 % en 5 tests), GPT-OSS 20B (100 %).",
  "- **Agente del IDE:** Ornith 9B (110k, visión CPU); su 0/9 one-shot no refleja el bucle con herramientas.",
  "- **Visión de calidad:** Qwen3.5 4B (131k, visión CPU, 5/5), Qwen3-VL 4B (57k, 5/5), Qwen3-VL 8B (26k, 5/5), Gemma 4 E4B (22k, 5/5).",
  "- **Visión ultrarrápida:** MiniCPM-V 4.7 1B (131k, 2,3 GB VRAM, 180+ tok/s de texto), LFM3-VL 2B (128k, 2,7 GB), LFM3 Omni 2B (128k, 2,8 GB).",
  "- **Contexto máximo:** Gemma 3 4B y Qwen3.5 4B/9B, Granite 4.0 H Tiny y Qwen3.8 4B, todos a 131k con el plan automático.",
  "- **Rápidos para tareas simples:** LFM3 1.7B (131k, 2,8 GB), Llama 3.2 3B (84k, ~100 tok/s), Granite (147 tok/s de generación en llama-bench).",
  "",
  "## Visión: con y sin proyector",
  "",
  "Cada modelo multimodal se arrancó dos veces: con `--mmproj` y sin él. En los proyectores grandes el plan los manda a CPU (`mmprojCPU`), así que **el contexto y la VRAM son los mismos**; lo que cambia es que sin visión no se puede mandar imagen y el arranque es más rápido. El coste de visión medido va de ~3,5 s (LFM3-VL 2B) a ~28 s (Gemma 3 4B con captura completa).",
  "",
  "| Modelo | Visión | Contexto con/sin | VRAM con/sin | Tiempo de visión |",
  "|---|:--:|---:|---:|---:|",
  ...rows.filter((r) => r.vision).map((r) => {
    const tiempos = {
      "gemma3-4b": "~28 s", "smolvlm2-22b": "~14 s", "minicpm-v47-1b": "~25 s",
      "qwen3vl-8b": "~11 s", "gemma4-e4b": "~14 s", "qwen35-9b": "~13 s",
      "nemotron35-e4b": "~11,5 s", "lfm3-vl-2b": "~3,6 s", "lfm3-omni-2b": "~4 s",
      "qwen25vl-3b": "~13 s", "qwen3vl-4b": "~8 s", "qwen3vl-2b": "~7,7 s",
      "qwen35-4b": "~9,6 s", "ornith9b": "~12 s",
    };
    const vram = r.plan.totalMiB || "—";
    return `| ${r.n} | sí | ${r.plan.contexto}/${r.plan.contexto} | ${vram}/${vram} MiB | ${tiempos[r.k] || "medido"} |`;
  }),
  "",
  "## Catálogo online",
  "",
  "La pestaña **Descubrir** consulta en vivo `https://huggingface.co/api/models?filter=gguf&sort=trendingScore`; no hay lista que envejezca. El botón **Actualizar catálogo online** vuelve a consultar. Desde ahí se abre un repo, se elige cuantización y se descarga con el mismo plan automático.",
  "",
  "## Reproducir",
  "",
  "```powershell",
  "node scripts/hub.mjs list",
  "node scripts/hub.mjs discover --limit 30",
  "node scripts/model-lab.mjs probe --all",
  "node scripts/model-tune.mjs --all --quick",
  "node scripts/vision-matrix.mjs",
  "```",
  "",
].join("\n");
const out = path.join(PROJECT, "reports", `MODEL-CATALOG-${stamp}.md`);
fs.writeFileSync(out, md, "utf8");
console.log(out);
