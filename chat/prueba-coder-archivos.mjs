/** La verificación del coder debe ver archivos nuevos aunque no estén en el índice de código. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CoderTask } from "./coder-harness.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-coder-archivos-"));
try {
  const tarea = new CoderTask({ root: dir, goal: "crear una nota y un archivo de código" });
  await tarea.start();
  fs.writeFileSync(path.join(dir, "nota.txt"), "hola mundo");
  tarea.noteWritten("nota.txt");
  fs.writeFileSync(path.join(dir, "app.js"), "export const ok = true;\n");
  tarea.noteWritten("app.js");

  const resultado = await tarea.verify({
    final: true,
    run: async () => ({ ok: true, errors: [], summary: "stub" }),
  });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.changed, true);
  assert.ok(tarea.state.modified.includes("nota.txt"), "un .txt nuevo debe contar como cambio");
  assert.ok(tarea.state.modified.includes("app.js"), "un .js nuevo debe contar como cambio");
  assert.ok(!/No se modificó/i.test(resultado.summary), resultado.summary);

  // Un archivo solo inspeccionado no debe convertirse en modificación.
  tarea.noteWritten("");
  assert.ok(tarea.state.modified.every((rel) => typeof rel === "string" && rel.length > 0));
  console.log("Coder: archivos nuevos fuera del índice (.txt) y de código (.js) cuentan para verificar.");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
