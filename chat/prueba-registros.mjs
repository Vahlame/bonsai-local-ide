import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { consultarRegistro } from "./registros.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(),"bonsai-registros-"));
const id = "a".repeat(32), file = path.join(dir,`${id}.log`);
try {
  const fd = fs.openSync(file,"wx");
  try {
    const block = Buffer.alloc(1024*1024,"x");
    for (let i=0;i<63;i++) fs.writeSync(fd,block);
    fs.writeSync(fd,Buffer.from("ñAGUJA\n" + Array.from({length:100},(_,i)=>`linea ${i}\n`).join(""),"utf8"));
  } finally { fs.closeSync(fd); }
  const found = await consultarRegistro(dir,id,1,"ñaguja");
  assert.match(found,/^Registro .*1: x/m);
  assert.ok(found.length < 2000, "una línea enorme no se devuelve completa");
  const page = await consultarRegistro(dir,id,2,"");
  assert.match(page,/2: linea 0/);
  assert.match(page,/81: linea 79/);
  assert.match(page,/desde 82/);
  const next = await consultarRegistro(dir,id,82,"");
  assert.match(next,/82: linea 80/);
  await assert.rejects(()=>consultarRegistro(dir,"../mal"),/inválido/);
  console.log("Registros: lectura acotada, Unicode y paginación sobre 63 MiB OK");
} finally {
  if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir())) throw new Error("ruta temporal inesperada");
  fs.rmSync(dir,{recursive:true,force:true});
}
