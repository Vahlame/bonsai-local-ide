// Facts from the running verifier, never guessed from a model's training data.
import * as nodeAssert from "node:assert/strict";
import { isBuiltin } from "node:module";
import { execFileSync } from "node:child_process";
let testExports;
function testApi() {
  // Importing node:test into the IDE installs runner shutdown hooks. Probe in a child.
  return testExports ||= JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", "import * as api from 'node:test'; process.stdout.write(JSON.stringify(Object.keys(api).filter(k=>k!=='default')));"], { windowsHide: true, encoding: "utf8", timeout: 5000 }));
}

export function nodeRuntimeGuide() {
  return `RUNTIME DE VERIFICACIÓN: Node ${process.version}, ${process.platform}. ESM: fileURLToPath y pathToFileURL se importan de node:url, no de node:path. Compara URLs con pathToFileURL(process.argv[1]).href al detectar el archivo principal en Windows. En new URL(relativa, base), una base de directorio termina en / (new URL('./assets/', import.meta.url)); una relativa que empieza por / se resuelve desde la raíz de la URL, no dentro de ese directorio. node:test exporta ${testApi().join(", ")}. Aserciones: importa assert de node:assert/strict; usa assert.equal, assert.deepEqual y assert.rejects. No presupongas globals de Jest/Vitest en node --test.`;
}

export async function runtimeFailureFacts(output) {
  const missing = String(output).match(/module '([^']+)' does not provide an export named '([^']+)'/);
  if (missing && missing[1].startsWith("node:") && isBuiltin(missing[1])) {
    const exports = missing[1] === "node:test" ? testApi() : Object.keys(await import(missing[1])).filter(k => k !== "default");
    return `DATO COMPROBADO EN EL VERIFICADOR: ${missing[1]} no exporta ${missing[2]}. Exportaciones reales: ${exports.join(", ")}. ${missing[1] === "node:test" ? `Para aserciones usa node:assert/strict (${Object.keys(nodeAssert).filter(k => ["equal", "deepEqual", "strictEqual", "rejects", "ok"].includes(k)).join(", ")}); los hooks de este runner son before/after/beforeEach/afterEach.` : missing[2] === "fileURLToPath" ? "fileURLToPath se importa de node:url." : "Corrige la importación según estas exportaciones, no inventes otra API."}`;
  }
  if (/ReferenceError: (?:beforeAll|afterAll|expect) is not defined/.test(output)) return nodeRuntimeGuide();
  return "";
}

/**
 * Facts for a 404 on the root of a small native Node web app. These are
 * observations about the generated source, not an automatic edit: the host
 * only tells the model which URL resolution is wrong.
 */
export function webAppFailureFacts(source) {
  const text = String(source ?? "");
  if (!text) return "";
  const facts = [];
  if (/new URL\(\s*['"]\.\/public['"]\s*,\s*import\.meta\.url\s*\)/.test(text)) {
    facts.push("`new URL('./public', import.meta.url)` omite la barra final: `new URL('index.html', publicDir)` resuelve al directorio padre, no a `public/index.html`. Usa `new URL('./public/', import.meta.url)`.");
  }
  if (/new URL\(\s*(?:pathname|url\.pathname|[A-Za-z_$][\w$]*)\s*,\s*publicDir\s*\)/.test(text)) {
    facts.push("Una ruta que empieza por `/` pasada a `new URL(ruta, publicDir)` se resuelve desde la raíz del disco, no dentro de `public/`. Quita la barra inicial antes de resolver el recurso.");
  }
  return facts.length ? `DATO COMPROBADO EN EL SERVIDOR: ${facts.join(" ")}` : "";
}

/** Recovery evidence only; never applies a fuzzy edit or chooses an ambiguous block. */
export function replacementFailureFacts(source, search) {
  if (!search || search.length > 8000 || source.length > 2_000_000) return "";
  const lines = source.split(/\r?\n/), wanted = search.split(/\r?\n/);
  const normalize = line => line.replace(/^[ \t]*/, "");
  const needle = wanted.map(normalize);
  const matches = [];
  for (let start = 0; start + wanted.length <= lines.length; start++) {
    if (normalize(lines[start]) !== needle[0]) continue;
    if (wanted.every((_, offset) => normalize(lines[start + offset]) === needle[offset])) {
      matches.push(lines.slice(start, start + wanted.length).join(source.includes("\r\n") ? "\r\n" : "\n"));
      if (matches.length > 1) return "";
    }
  }
  if (matches.length !== 1 || source.split(matches[0]).length !== 2) return "";
  return `DATO COMPROBADO: el bloque es único y solo difiere en la sangría inicial. No se aplicó ningún cambio. Usa este valor JSON exacto de buscar (sin aumentar ni reducir sus espacios): ${JSON.stringify(matches[0])}`;
}
