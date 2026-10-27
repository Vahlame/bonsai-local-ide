import assert from "node:assert/strict";
import { cambiarConRecuperacion } from "./cambio-modelo.mjs";

const original = { clave: "anterior", contexto: 16384, kv: "f16", vision: true, pensar: 512, dormir: 300, hostIP: "127.0.0.1" };
let ejecutando = "anterior";
let seleccionGuardada = "anterior";
let liberaciones = 0;
await assert.rejects(cambiarConRecuperacion({
  anterior: original,
  liberar: async (alDetener) => { liberaciones++; ejecutando = null; alDetener(); },
  arrancar: async (config) => {
    if (!config) throw new Error("fallo nuevo");
    assert.deepEqual(config, original);
    ejecutando = config.clave;
  },
}), /fallo nuevo.*Se recuperó el modelo anterior/);
assert.equal(ejecutando, "anterior");
assert.equal(seleccionGuardada, "anterior");
assert.equal(liberaciones, 2);
console.log("OK: fallo al iniciar recupera el modelo y sus ajustes");

let lanzamientos = 0;
await assert.rejects(cambiarConRecuperacion({
  anterior: original,
  liberar: async (alDetener) => { alDetener(); },
  arrancar: async () => { lanzamientos++; throw new Error(lanzamientos === 1 ? "fallo nuevo" : "fallo anterior"); },
}), /fallo nuevo.*No se pudo recuperar el modelo anterior: fallo anterior/);
assert.equal(lanzamientos, 2);
console.log("OK: se informan ambos fallos");

lanzamientos = 0;
await assert.rejects(cambiarConRecuperacion({
  anterior: original,
  liberar: async () => { throw new Error("servidor ajeno"); },
  arrancar: async () => { lanzamientos++; },
}), /servidor ajeno/);
assert.equal(lanzamientos, 0);
console.log("OK: servidor ajeno no se reemplaza ni se inicia recuperación");
