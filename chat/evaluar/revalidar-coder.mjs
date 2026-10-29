/** Re-run independent validators on saved outputs without making model calls. */
import fs from "node:fs";
import path from "node:path";
import { CODER_TAREAS, validarCoder } from "./coder-tareas.mjs";
import { CODER_EXTENDIDAS } from "./coder-extended.mjs";

for (const raw of process.argv.slice(2)) {
  const dir = path.resolve(raw),
    file = path.join(dir, "informe.json"),
    report = JSON.parse(fs.readFileSync(file, "utf8"));
  const results = report.results.map((row) => ({
    ...row,
    ...validarCoder(
      CODER_EXTENDIDAS.find((t) => t.id === row.id),
      path.join(dir, "ws", row.id),
    ),
  }));
  const verified = {
    ...report,
    validationVersion: 3,
    originalReport: file,
    results,
    success: results.filter((r) => r.ok).length,
  };
  fs.writeFileSync(
    path.join(dir, "informe-validado.json"),
    JSON.stringify(verified, null, 2),
  );
  console.log(`${dir}: ${verified.success}/${verified.total}`);
}
