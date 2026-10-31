import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buscarEstructural, buscarTexto, LENGUAJES_ESTRUCTURALES } from "./code-search.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-search-"));
try {
  fs.mkdirSync(path.join(tmp, "src"));
  fs.mkdirSync(path.join(tmp, "node_modules", "ignorado"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "src", "a.ts"), "export function suma(a: number, b: number) { return a + b; }\nconsole.log('hola', 1);\n", "utf8");
  fs.writeFileSync(path.join(tmp, "src", "b.js"), "console.log('mundo');\nconst x = 1;\n", "utf8");
  fs.writeFileSync(path.join(tmp, "node_modules", "ignorado", "c.js"), "console.log('no debe salir');\n", "utf8");

  const texto = await buscarTexto(tmp, "console.log", { max: 10 });
  assert.equal(texto.ok, true, texto.error);
  assert.equal(texto.motor, "ripgrep", `motor: ${texto.motor}`);
  assert.ok(texto.resultados.length >= 2, JSON.stringify(texto));
  assert.ok(texto.resultados.every((r) => !r.archivo.includes("node_modules")), "ripgrep respeta .gitignore/node_modules");
  assert.ok(texto.resultados.some((r) => r.archivo === "src/a.ts" && r.linea === 2));

  const estructural = await buscarEstructural(tmp, "console.log($$$ARGS)", "ts");
  assert.equal(estructural.ok, true, estructural.error);
  assert.equal(estructural.motor, "ast-grep");
  assert.ok(estructural.resultados.some((r) => r.archivo === "src/a.ts" && r.texto.includes("hola")));
  const estructuralJs = await buscarEstructural(tmp, "console.log($$$ARGS)", "js");
  assert.equal(estructuralJs.ok, true, estructuralJs.error);
  assert.ok(estructuralJs.resultados.some((r) => r.archivo === "src/b.js" && r.texto.includes("mundo")));

  const noSoportado = await buscarEstructural(tmp, "x", "python");
  assert.equal(noSoportado.ok, false);
  assert.match(noSoportado.error, /lenguaje no soportado/);
  assert.deepEqual([...LENGUAJES_ESTRUCTURALES].sort(), ["css", "html", "js", "jsx", "ts", "tsx"]);

  const sinResultados = await buscarTexto(tmp, "NO_EXISTE_123", { max: 10 });
  assert.equal(sinResultados.ok, true);
  assert.deepEqual(sinResultados.resultados, []);

  console.log("Code search: ripgrep, respeto a node_modules, ast-grep y fallo claro verificados.");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
