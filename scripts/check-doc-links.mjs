/**
 * Comprueba que los enlaces relativos de la documentacion activa existan.
 * Ignora URLs http(s), anclas y la carpeta docs/archive (historica).
 *
 * Uso: node scripts/check-doc-links.mjs [--all]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const ALL = process.argv.includes("--all");

/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!ALL && e.name === "archive") continue;
      if (e.name === "node_modules" || e.name === ".git") continue;
      walk(abs, out);
    } else if (e.name.toLowerCase().endsWith(".md")) {
      out.push(abs);
    }
  }
}

const files = [path.join(PROJECT, "README.md"), path.join(PROJECT, "CHANGELOG.md"), path.join(PROJECT, "SECURITY.md")];
walk(path.join(PROJECT, "docs"), files);

let missing = 0;
let checked = 0;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const re = /\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text))) {
    let target = m[1].trim();
    if (/^(https?:|mailto:|#)/i.test(target)) continue;
    target = target.split("#")[0];
    if (!target) continue;
    try { target = decodeURIComponent(target); } catch { /* deja tal cual */ }
    const abs = path.resolve(path.dirname(file), target);
    checked += 1;
    if (!fs.existsSync(abs)) {
      missing += 1;
      console.log(`MISSING ${path.relative(PROJECT, file)} -> ${target}`);
    }
  }
}

console.log(`\n${files.length} documentos, ${checked} enlaces, ${missing} roto(s).`);
process.exitCode = missing ? 1 : 0;
