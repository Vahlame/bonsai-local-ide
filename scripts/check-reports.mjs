#!/usr/bin/env node
/**
 * Evita que `reports/` vuelva a llenarse de ejecuciones crudas: solo se
 * versionan resúmenes `.md` en la raíz y el índice, con un tope de tamaño.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MAX_ARCHIVOS = 30;
const MAX_BYTES = 8 * 1024 * 1024;

let archivos = [];
try {
  archivos = execFileSync("git", ["ls-files", "reports"], { cwd: RAIZ, encoding: "utf8" })
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter(Boolean);
} catch (err) {
  process.stderr.write(`No se pudo leer git ls-files: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}

const malos = archivos.filter((rel) => !/^reports\/[^/]+\.md$/.test(rel));
const bytes = archivos.reduce((total, rel) => {
  try { return total + fs.statSync(path.join(RAIZ, rel)).size; } catch { return total; }
}, 0);
const problemas = [];
if (archivos.length > MAX_ARCHIVOS) problemas.push(`${archivos.length} archivos versionados (máximo ${MAX_ARCHIVOS})`);
if (malos.length) problemas.push(`rutas no curadas: ${malos.slice(0, 5).join(", ")}`);
if (bytes > MAX_BYTES) problemas.push(`${(bytes / 1024 / 1024).toFixed(2)} MB versionados (máximo ${MAX_BYTES / 1024 / 1024} MB)`);

if (problemas.length) {
  process.stderr.write(`reports/: ${problemas.join("; ")}\n`);
  process.exit(1);
}
process.stdout.write(`reports/: ${archivos.length} resúmenes curados, ${(bytes / 1024).toFixed(0)} KB.\n`);
