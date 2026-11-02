/** Pruebas del registro único de tools: esquema, validación, permisos y dispatch. */
import assert from "node:assert/strict";
import { CODER_TOOLS, PC_TOOLS, toolDefinition, toolNames, toolPermission, toolSchema, validateToolCall } from "./tool-registry.mjs";
import { nativeToolEffects } from "./actions.mjs";

const pc = PC_TOOLS.map((t) => t.function.name);
const coder = CODER_TOOLS.map((t) => t.function.name);
assert.deepEqual(pc, toolNames("pc"));
assert.deepEqual(coder, toolNames("coder"));
assert.ok(pc.includes("archivo") && pc.includes("navegador"));
assert.ok(coder.includes("buscar_estructural") && coder.includes("git_diff"));
assert.ok(!pc.includes("buscar_estructural"), "las tools de coder no se cuelan en el perfil PC");

for (const tool of [...PC_TOOLS, ...CODER_TOOLS]) {
  const def = toolDefinition(tool.function.name);
  assert.ok(def, `falta la definición de ${tool.function.name}`);
  assert.ok(tool.function.description.length > 10, `descripción vacía en ${tool.function.name}`);
  assert.equal(typeof tool.function.parameters, "object");
  assert.equal(typeof toolPermission(tool.function.name), "string");
}
assert.notEqual(toolPermission("ejecutar"), "read");
assert.equal(toolPermission("archivo"), "write");
assert.equal(toolPermission("borrar"), "delete");

assert.equal(toolSchema("ejecutar", "pc").additionalProperties, undefined);
assert.equal(toolSchema("ejecutar", "coder").additionalProperties, false);
assert.equal(validateToolCall({ name: "leer", arguments: '{"ruta":"a","unexpected":1}' }, CODER_TOOLS).ok, true);
assert.equal(validateToolCall({ name: "leer", arguments: '{"ruta":"a"' }, CODER_TOOLS).ok, false);
assert.match(validateToolCall({ name: "no_existe", arguments: "{}" }, CODER_TOOLS).error, /desconocida/);

const effects = nativeToolEffects([
  { id: "c1", name: "ejecutar", arguments: JSON.stringify({ comando: "npm test" }) },
  { id: "c2", name: "archivo", arguments: JSON.stringify({ ruta: "a.txt", contenido: "hola" }) },
  { id: "c3", name: "plan", arguments: JSON.stringify({ pasos: ["uno", "dos"], hechos: [1] }) },
  { id: "c4", name: "no_existe", arguments: "{}" },
]);
assert.deepEqual(effects.commands, ["npm test"]);
assert.equal(effects.writes[0].rel, "a.txt");
assert.deepEqual(effects.plan, { pasos: ["uno", "dos"], hechos: [1] });
assert.match(effects.notes.join("\n"), /función desconocida/);

console.log("Tool registry: esquemas, validación, permisos y despacho únicos verificados.");
