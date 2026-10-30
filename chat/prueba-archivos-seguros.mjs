import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { rutaSegura, escribirAtomico, escribirAtomicoCondicional, escribirAtomicoNuevo } from "./archivos-seguros.mjs";
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
  assert.throws(() => writeOutputs(root, [{ rel: ".git/config", content: "mal" }]));
  writeOutputs(root, [{ rel: "node_modules/paquete/local.js", content: "// parche local" }]);

  // Hallazgo 7: lo que rutaSegura SI garantiza es rechazar enlaces en CUALQUIER
  // componente (junction anidado, enlace colgante) y dejar pasar rutas normales.
  // La comprobacion sigue siendo best-effort (lstat + uso posterior): no se promete
  // una barrera TOCTOU, solo se fija la semantica actual con pruebas.
  fs.mkdirSync(path.join(root, "sub"), { recursive: true });
  fs.symlinkSync(outside, path.join(root, "sub", "enlace-anidado"), process.platform === "win32" ? "junction" : "dir");
  assert.equal(rutaSegura(root, "sub/enlace-anidado/secreto.txt"), null, "junction en un componente intermedio");
  assert.equal(rutaSegura(root, "sub/enlace-anidado"), null, "el propio junction se rechaza");
  assert.throws(() => writeOutputs(root, [{ rel: "sub/enlace-anidado/secreto2.txt", content: "mal" }]));
  assert.equal(fs.readFileSync(path.join(outside, "secreto.txt"), "utf8"), "intacto");
  try {
    fs.symlinkSync(path.join(tmp, "no-existe-todavia"), path.join(root, "colgante"), process.platform === "win32" ? "junction" : "dir");
    assert.equal(rutaSegura(root, "colgante/algo.txt"), null, "un enlace colgante tambien se rechaza");
  } catch (error) {
    console.warn(`aviso: sin permisos para crear el enlace colgante (${error.code}); caso omitido`);
  }
  fs.mkdirSync(path.join(root, "sub", "carpeta"), { recursive: true });
  assert.equal(rutaSegura(root, "sub/carpeta/normal.txt"), path.join(root, "sub/carpeta/normal.txt"), "una ruta normal se acepta");
  // Contrato actual: la RAIZ elegida puede ser un enlace; sus descendientes no.
  const rootEnlace = path.join(tmp, "proyecto-enlazado");
  fs.symlinkSync(root, rootEnlace, process.platform === "win32" ? "junction" : "dir");
  assert.equal(rutaSegura(rootEnlace, "normal.txt"), path.join(rootEnlace, "normal.txt"), "la raiz elegida puede ser un enlace");
  const rename = fs.renameSync;
  try {
    fs.renameSync = () => { throw Object.assign(new Error("fallo de escritura simulado"), { code: "EIO" }); };
    assert.throws(() => escribirAtomico(original, "nuevo"), /fallo de escritura simulado/);
  } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(original, "utf8"), "original");
  assert.deepEqual(fs.readdirSync(root).filter((n) => n.startsWith(".bonsai-")), []);
  escribirAtomico(original, "nuevo");
  assert.equal(fs.readFileSync(original, "utf8"), "nuevo");
  await assert.rejects(() => escribirAtomicoCondicional(root, "normal.txt", "original", "otro"), /cambió en disco/);
  assert.equal(fs.readFileSync(original, "utf8"), "nuevo");
  fs.writeFileSync(path.join(root, "paralelo.txt"), "antes");
  await Promise.all([
    escribirAtomicoCondicional(root, "normal.txt", "nuevo", "final"),
    escribirAtomicoCondicional(root, "paralelo.txt", "antes", "después"),
  ]);
  assert.equal(fs.readFileSync(original, "utf8"), "final");
  assert.equal(fs.readFileSync(path.join(root,"paralelo.txt"), "utf8"), "después");
  await Promise.all([escribirAtomicoNuevo(root,"nuevo/uno.txt","uno"),escribirAtomicoNuevo(root,"nuevo/dos.txt","dos")]);
  await assert.rejects(()=>escribirAtomicoNuevo(root,"nuevo/uno.txt","sobrescrito"),/EEXIST/);
  assert.equal(fs.readFileSync(path.join(root,"nuevo/uno.txt"),"utf8"),"uno");
  writeOutputs(root, [{ rel: "sub/codigo.py", content: "print(1)" }]);
  assert.equal(fs.readFileSync(path.join(root, "sub/codigo.py"), "utf8"), "print(1)");
  console.log("prueba archivos seguros ok");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
