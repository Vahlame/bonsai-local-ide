import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rutaSegura, escribirAtomico } from "./archivos-seguros.mjs";
import { writeOutputs } from "./actions.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-archivos-"));
try {
  const root = path.join(tmp, "proyecto");
  const outside = path.join(tmp, "externo");
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  const original = path.join(root, "normal.txt");
  fs.writeFileSync(original, "original");
  fs.writeFileSync(path.join(outside, "secreto.txt"), "intacto");
  fs.symlinkSync(outside, path.join(root, "fuera"), process.platform === "win32" ? "junction" : "dir");
  assert.equal(rutaSegura(root, "fuera/secreto.txt"), null);
  assert.equal(rutaSegura(root, "fuera/nueva/cosa.txt"), null);
  assert.throws(() => writeOutputs(root, [{ rel: "fuera/secreto.txt", content: "mal" }]));
  assert.throws(() => writeOutputs(root, [{ rel: "fuera/nueva/cosa.txt", content: "mal" }]));
  assert.equal(fs.readFileSync(path.join(outside, "secreto.txt"), "utf8"), "intacto");
  assert.throws(() => writeOutputs(root, [{ rel: "node_modules/privado.js", content: "mal" }]));
  const rename = fs.renameSync;
  try {
    fs.renameSync = () => { throw Object.assign(new Error("fallo de escritura simulado"), { code: "EIO" }); };
    assert.throws(() => escribirAtomico(original, "nuevo"), /fallo de escritura simulado/);
  } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(original, "utf8"), "original");
  assert.deepEqual(fs.readdirSync(root).filter((n) => n.startsWith(".bonsai-")), []);
  escribirAtomico(original, "nuevo");
  assert.equal(fs.readFileSync(original, "utf8"), "nuevo");
  writeOutputs(root, [{ rel: "sub/codigo.py", content: "print(1)" }]);
  assert.equal(fs.readFileSync(path.join(root, "sub/codigo.py"), "utf8"), "print(1)");
  console.log("prueba archivos seguros ok");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
