import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TypeScriptLsp, typeScriptProject } from "./code-intelligence.mjs";
import { CoderTask } from "./coder-harness.mjs";
import { CodeContext } from "./code-context.mjs";
import { CODER_CONFIG } from "./coder-harness.mjs";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-ts-intelligence-"));
const a = "export function sum(x:number):number { return x; }\n";
const b = 'import {sum as total} from "./a";\ntotal(2);\n';
let lsp, task;
try {
  fs.writeFileSync(path.join(root, "a.ts"), a);
  fs.writeFileSync(path.join(root, "b.ts"), b);
  fs.writeFileSync(
    path.join(root, "unrelated.ts"),
    "export function sum(x:string):string { return x; }\n",
  );
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["*.ts"],
    }),
  );
  const context = {
    entries: new Map([
      ["a.ts", {}],
      ["b.ts", {}],
      ["tsconfig.json", {}],
    ]),
  };
  const types = typeScriptProject(root, context);
  assert.ok(types);
  assert.deepEqual(types.diagnostics(), []);
  fs.writeFileSync(
    path.join(root, "a.ts"),
    a.replace("return x;", "return String(x);"),
  );
  assert.ok(types.diagnostics().some((d) => d.text.includes("TS2322")));
  fs.writeFileSync(path.join(root, "a.ts"), a);
  lsp = new TypeScriptLsp(root);
  const references = await lsp.lookup(
    { ruta: "a.ts", linea: 1, columna: 17, referencias: true },
    a,
  );
  assert.ok(
    references.some((r) => r.startsWith("b.ts:2:1")),
    JSON.stringify(references),
  );
  assert.ok(
    !references.some((r) => r.startsWith("unrelated.ts")),
    JSON.stringify(references),
  );
  const definition = await lsp.lookup(
    { ruta: "b.ts", linea: 2, columna: 1 },
    b,
  );
  assert.ok(
    definition.some((r) => r.startsWith("a.ts:1:17")),
    JSON.stringify(definition),
  );
  await assert.rejects(lsp.lookup({ ruta: "../outside.ts" }, ""), /outside/);
  task = await new CoderTask({
    root,
    goal: "Corrige sum sin romper el tipo numérico",
  }).start();
  fs.writeFileSync(
    path.join(root, "a.ts"),
    a.replace("return x;", "return String(x);"),
  );
  let check = await task.verify();
  assert.equal(check.ok, false);
  assert.match(check.summary, /TS2322/);
  fs.writeFileSync(path.join(root, "a.ts"), a);
  check = await task.verify();
  assert.equal(check.ok, true, check.summary);
  const lookup = await task.special({
    name: "simbolo",
    arguments: JSON.stringify({
      nombre: "sum",
      ruta: "a.ts",
      referencias: true,
    }),
  });
  assert.match(lookup, /LSP TypeScript/);
  assert.match(lookup, /b\.ts:2:1/);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ type: "module", imports: { "#sum": "./a.ts" } }),
  );
  fs.writeFileSync(path.join(root, "c.ts"), 'export {sum} from "#sum";\n');
  const graph = await new CodeContext(root, CODER_CONFIG).refresh();
  assert.ok(graph.entries.get("c.ts").dependencies.includes("a.ts"));
  fs.writeFileSync(path.join(root, "ambiguous.ts"), "export class A { same() {} }\nexport class B { same() {} }\n");
  const ambiguous = await task.special({ name: "simbolo", arguments: JSON.stringify({ nombre: "same", ruta: "ambiguous.ts", referencias: true }) });
  assert.match(ambiguous, /Varias definiciones/);
  assert.ok(!ambiguous.includes("LSP TypeScript ("));
  fs.writeFileSync(path.join(root, "a.ts"), a.replace("return x;", "return String(x);"));
  const duplicateTask = await new CoderTask({ root, goal: "Preserva errores anteriores y detecta el nuevo" }).start();
  fs.appendFileSync(path.join(root, "a.ts"), "\nexport function another(x: number): number { return String(x); }\n");
  const duplicateCheck = await duplicateTask.verify();
  assert.equal(duplicateCheck.ok, false, "a duplicate type error is still a newly introduced error");
  assert.equal(duplicateTask.state.preexistingErrors.length, 1);
  assert.equal(duplicateTask.state.errors.length, 1);
  duplicateTask.dispose();
  fs.writeFileSync(path.join(root, "a.ts"), Array.from({length: 41}, (_, i) => `export const bad${i}: number = "x";`).join("\n"));
  assert.throws(() => types.diagnostics(), /more than 40 errors/);
  console.log(
    "Real TypeScript compiler and LSP: type errors, aliased source definitions and scoped references verified.",
  );
} finally {
  lsp?.dispose();
  task?.dispose();
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
    throw new Error("Unexpected cleanup root");
  fs.rmSync(root, { recursive: true, force: true });
}
