#!/usr/bin/env node
/**
 * Puerta de sintaxis: `node --check` sobre todo el código fuente. No sustituye
 * a ESLint/TypeScript, pero evita que un error de parseo llegue a CI.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SKIP = new Set(["node_modules", "models", "bin", "reports", "salida", "capturas", "trabajo", "dist", "build", "target", "forks", "kernels", ".git", "vendor"]);
/** @type {string[]} */
const archivos = [];

/**
 * @param {string} dir
 */
function recorrer(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      recorrer(abs);
      continue;
    }
    if (/\.(mjs|js)$/i.test(entry.name)) archivos.push(abs);
  }
}

recorrer(path.join(RAIZ, "chat"));
recorrer(path.join(RAIZ, "scripts"));

/** @type {string[]} */
const fallos = [];
for (const archivo of archivos) {
  const fuente = fs.readFileSync(archivo, "utf8");
  try {
    if (archivo.endsWith(".mjs")) {
      execFileSync(process.execPath, ["--check", archivo], { stdio: "pipe" });
    } else {
      // Los .js de la UI mezclan scripts clásicos y módulos: vale cualquiera de
      // los dos modos, pero debe parsear en al menos uno.
      try {
        execFileSync(process.execPath, ["--input-type=module", "--check"], { input: fuente, stdio: "pipe" });
      } catch {
        execFileSync(process.execPath, ["--check"], { input: fuente, stdio: "pipe" });
      }
    }
  } catch (err) {
    const detalle = err && typeof err === "object" && "stderr" in err ? String(err.stderr) : String(err);
    fallos.push(`${path.relative(RAIZ, archivo)}: ${detalle.split("\n").slice(0, 3).join(" ").trim()}`);
  }
}

if (fallos.length) {
  process.stderr.write(`Sintaxis: ${fallos.length} archivo(s) con error\n`);
  for (const fallo of fallos) process.stderr.write(`  ${fallo}\n`);
  process.exit(1);
}
process.stdout.write(`Sintaxis: ${archivos.length} archivos OK.\n`);
