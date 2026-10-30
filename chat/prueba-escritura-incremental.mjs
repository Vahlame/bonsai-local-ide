import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EscrituraIncremental } from "./escritura-incremental.mjs";
import { writeNewOutput } from "./actions.mjs";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-parts-"));
try {
  const root = path.join(temp, "project"), dir = path.join(temp, "staging");
  fs.mkdirSync(root);
  let store = new EscrituraIncremental(root, dir);
  const start = store.iniciar("src/large.txt");
  assert.throws(() => store.continuar(start.id, 2, "incorrecto"), /Offset/);
  const chunks = ["á".repeat(15000), "b".repeat(50000), "終".repeat(10000)];
  let offset = 0;
  for (const chunk of chunks) offset = store.continuar(start.id, offset, chunk).siguiente;
  assert.equal(fs.existsSync(path.join(root, "src/large.txt")), false);
  store = new EscrituraIncremental(root, dir); // reanudar después de reiniciar
  assert.equal(store.estado(start.id).siguiente, offset);
  const staged = store.preparar(start.id, offset);
  assert.equal(staged.contenido, chunks.join(""));
  writeNewOutput(root, staged.rel, staged.contenido);
  assert.throws(() => writeNewOutput(root, staged.rel, "otro"), /EEXIST/);
  assert.throws(() => store.preparar(start.id, offset), /destino apareció/);
  assert.equal(fs.readFileSync(path.join(root, "src/large.txt"), "utf8"), chunks.join(""));
  store.borrar(start.id);
  const cancelado = store.iniciar("descartar.txt");
  store.continuar(cancelado.id, 0, "pendiente");
  assert.equal(store.cancelar(cancelado.id).cancelado, true);
  assert.equal(fs.existsSync(path.join(root,"descartar.txt")), false);
  assert.throws(() => store.estado(cancelado.id));
  assert.throws(() => store.iniciar("../outside.txt"), /ruta/);
  assert.throws(() => store.iniciar("src/large.txt"), /ya existe/);
  console.log("Escritura incremental: OK");
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
