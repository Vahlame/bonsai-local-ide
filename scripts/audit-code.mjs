#!/usr/bin/env node
/**
 * Auditoría estática del código de Bonsai.
 *
 * No sustituye a las pruebas: detecta los problemas estructurales que hacen
 * crecer un monolito (imports rotos, módulos huérfanos, archivos gigantes y
 * marcadores de deuda técnica). Se puede ejecutar en CI sin GPU ni modelo.
 *
 *   node scripts/audit-code.mjs
 *   node scripts/audit-code.mjs --strict   # falla también por huérfanos/gigantes
 *   node scripts/audit-code.mjs --json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const STRICT = process.argv.includes("--strict");
const JSON_OUT = process.argv.includes("--json");
const BASELINE_FILE = path.join(ROOT, "config", "audit-baseline.json");

/**
 * Baseline explícito de archivos grandes ya conocidos. `--strict` falla solo
 * cuando aparece uno NUEVO: convierte la deuda histórica en una puerta real sin
 * bloquear cada PR por los 23 módulos que ya existían.
 * @returns {{grandes: string[], huerfanos: string[]}}
 */
function leerBaseline() {
  try {
    const raw = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
    return {
      grandes: Array.isArray(raw.grandes) ? raw.grandes.map(String) : [],
      huerfanos: Array.isArray(raw.huerfanos) ? raw.huerfanos.map(String) : [],
    };
  } catch {
    return { grandes: [], huerfanos: [] };
  }
}

/** Carpetas que no son código de la aplicación. */
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".venv", "forks", "models", "logs", "runtime", "salida",
  "recursos", "capturas", "trabajo", "reports", "bench", "kernels", ".cursor",
  "ui-chats", "agent-traces", "salidas-agente", "escrituras-pendientes", "undo",
  "bin", "fixtures",
]);

/** Puntos de entrada legítimos: no se importan desde otro módulo. */
const ENTRY_POINTS = new Set([
  "chat/ui-server.mjs",
  "chat/bonsai-chat.mjs",
  "chat/modelo.mjs",
  "chat/actions.mjs",
  "chat/context.mjs",
  "chat/harmony.mjs",
  "chat/editar.mjs",
  "chat/adaptadores.mjs",
  "chat/verify-node-webapp.mjs",
  "chat/medir-agente.mjs",
  "chat/medir-formato.mjs",
  "chat/medir-stacks.mjs",
  "chat/diagnostics/index-worker.mjs",
  "eslint.config.mjs",
]);

const SOURCE_EXT = new Set([".mjs", ".js", ".cjs"]);
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"]*?\sfrom\s*)?["']([^"']+)["']/g;
const REQUIRE_RE = /\brequire\(\s*["']([^"']+)["']\s*\)/g;

/** @param {string} dir @param {string[]} out */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
      continue;
    }
    if (SOURCE_EXT.has(path.extname(entry.name))) out.push(path.join(dir, entry.name));
  }
  return out;
}

/** @param {string} file */
function rel(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

/** @param {string} file @returns {string[]} */
function importsOf(file) {
  const source = fs.readFileSync(file, "utf8");
  const found = [];
  for (const re of [IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(source))) found.push(match[1]);
  }
  return found;
}

/**
 * Resuelve un import relativo a una ruta real. Devuelve null si no es relativo.
 * @param {string} from
 * @param {string} spec
 * @returns {string | null}
 */
function resolveRelative(from, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), spec);
  const candidates = [base, `${base}.mjs`, `${base}.js`, `${base}.cjs`, path.join(base, "index.mjs"), path.join(base, "index.js")];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || base;
}

/** @param {string} file */
function lineCount(file) {
  return fs.readFileSync(file, "utf8").split("\n").length;
}

const files = walk(ROOT);
const graph = new Map();
const unresolved = [];
for (const file of files) {
  const deps = [];
  for (const spec of importsOf(file)) {
    const resolved = resolveRelative(file, spec);
    if (resolved === null) continue;
    if (!fs.existsSync(resolved)) {
      unresolved.push({ from: rel(file), spec });
      continue;
    }
    deps.push(rel(resolved));
  }
  graph.set(rel(file), deps);
}

const referenced = new Set();
for (const deps of graph.values()) for (const dep of deps) referenced.add(dep);

const isTest = (file) => /(^|\/)prueba-/.test(file) || file.includes("/evaluar/");
const isScript = (file) => file.startsWith("scripts/");
/** La UI se carga desde index.html con <script>, no con imports estáticos. */
const isUiEntry = (file) => file.startsWith("chat/ui/") && !file.includes("/core/") && !file.includes("/editor/") && !file.includes("/workspace/");
const orphans = [...graph.keys()].filter((file) => {
  if (referenced.has(file) || ENTRY_POINTS.has(file) || isTest(file) || isScript(file) || isUiEntry(file)) return false;
  return true;
});

const LARGE_LINES = 500;
const large = [...graph.keys()]
  .map((file) => ({ file, lines: lineCount(path.join(ROOT, file)) }))
  .filter((row) => row.lines > LARGE_LINES)
  .sort((a, b) => b.lines - a.lines);

const TODO_RE = /\b(TODO|FIXME|HACK|XXX)\b/g;
const debt = [];
for (const file of graph.keys()) {
  if (file === "scripts/audit-code.mjs") continue; // sus propias expresiones no son deuda
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  const count = (source.match(TODO_RE) || []).length;
  if (count) debt.push({ file, count });
}

const trackedBak = [];
try {
  const { execFileSync } = await import("node:child_process");
  const out = execFileSync("git", ["ls-files", "*.bak"], { cwd: ROOT, encoding: "utf8" }).trim();
  if (out) trackedBak.push(...out.split(/\r?\n/));
} catch {
  /* sin git o sin archivos .bak */
}

const report = {
  files: graph.size,
  imports: [...graph.values()].reduce((sum, deps) => sum + deps.length, 0),
  unresolved,
  orphans,
  large,
  debt: debt.sort((a, b) => b.count - a.count),
  trackedBak,
};

const baseline = leerBaseline();
const grandesNuevos = large.filter((row) => !baseline.grandes.includes(row.file));
const huerfanosNuevos = orphans.filter((file) => !baseline.huerfanos.includes(file));
report.baseline = { grandes: baseline.grandes.length, huerfanos: baseline.huerfanos.length };
report.grandesNuevos = grandesNuevos;
report.huerfanosNuevos = huerfanosNuevos;

if (JSON_OUT) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const line = (title) => process.stdout.write(`\n${title}\n`);
  line("Bonsai · auditoría de código");
  process.stdout.write(`  módulos analizados: ${report.files}\n`);
  process.stdout.write(`  imports relativos:  ${report.imports}\n`);

  line(`Imports rotos (${unresolved.length})`);
  for (const row of unresolved) process.stdout.write(`  ${row.from} -> ${row.spec}\n`);
  if (!unresolved.length) process.stdout.write("  ninguno\n");

  line(`Módulos huérfanos (${orphans.length})`);
  for (const file of orphans) process.stdout.write(`  ${file}\n`);
  if (!orphans.length) process.stdout.write("  ninguno\n");

  line(`Archivos grandes > ${LARGE_LINES} líneas (${large.length})`);
  for (const row of large) process.stdout.write(`  ${String(row.lines).padStart(5)}  ${row.file}${grandesNuevos.includes(row) ? "  [NUEVO]" : ""}\n`);
  if (!large.length) process.stdout.write("  ninguno\n");
  if (STRICT) {
    line(`Fuera del baseline (grandes ${grandesNuevos.length}, huérfanos ${huerfanosNuevos.length})`);
    for (const row of grandesNuevos) process.stdout.write(`  ${String(row.lines).padStart(5)}  ${row.file}\n`);
    for (const file of huerfanosNuevos) process.stdout.write(`  ${file}\n`);
    if (!grandesNuevos.length && !huerfanosNuevos.length) process.stdout.write("  ninguno\n");
  }

  line(`Deuda técnica marcada (${debt.reduce((sum, row) => sum + row.count, 0)})`);
  for (const row of debt.slice(0, 20)) process.stdout.write(`  ${String(row.count).padStart(4)}  ${row.file}\n`);
  if (!debt.length) process.stdout.write("  ninguna\n");

  line(`Copias .bak versionadas (${trackedBak.length})`);
  for (const file of trackedBak) process.stdout.write(`  ${file}\n`);
  if (!trackedBak.length) process.stdout.write("  ninguna\n");
}

const hardFailure = unresolved.length > 0 || (STRICT && (huerfanosNuevos.length > 0 || grandesNuevos.length > 0));
process.exitCode = hardFailure ? 1 : 0;
