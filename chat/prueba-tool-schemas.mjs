import assert from "node:assert/strict";
import { CODER_TOOLS } from "./coder-harness.mjs";
import { jsonSchemaDe, validarHerramienta } from "./tool-schemas.mjs";

const tool = CODER_TOOLS.find((t) => t.function.name === "buscar_estructural");
assert.ok(tool, "buscar_estructural debe estar en CODER_TOOLS");
const schema = tool.function.parameters;
assert.deepEqual(schema.required.sort(), ["lenguaje", "patron"]);
assert.ok(schema.properties.patron);
assert.deepEqual([...schema.properties.lenguaje.enum].sort(), ["css", "html", "js", "jsx", "ts", "tsx"]);

const valido = validarHerramienta("buscar_estructural", { patron: "console.log($$$ARGS)", lenguaje: "ts", max: 10 });
assert.equal(valido.ok, true);
const invalido = validarHerramienta("buscar_estructural", { patron: "x", lenguaje: "python" });
assert.equal(invalido.ok, false);
assert.match(invalido.error, /lenguaje/);
const texto = validarHerramienta("buscar_texto", { consulta: "TODO", max: 20, caseSensitive: true });
assert.equal(texto.ok, true);

const generado = jsonSchemaDe("buscar_estructural");
assert.ok(generado, "Zod debe generar JSON Schema");
assert.equal(generado.type, "object");
assert.ok(generado.properties.patron);
assert.deepEqual([...generado.properties.lenguaje.enum].sort(), ["css", "html", "js", "jsx", "ts", "tsx"]);

console.log("Tool schemas: Zod valida, genera JSON Schema y coincide con CODER_TOOLS.");
