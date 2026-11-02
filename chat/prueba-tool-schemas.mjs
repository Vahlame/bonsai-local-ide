import assert from "node:assert/strict";
import { CODER_TOOLS } from "./coder-harness.mjs";
import { jsonSchemaDe, permisoDe, validarHerramienta, zodDe } from "./tool-schemas.mjs";

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
const texto = validarHerramienta("buscar_codigo", { consulta: "TODO", ruta: "src" });
assert.equal(texto.ok, true);
assert.equal(validarHerramienta("buscar_texto", { consulta: "TODO" }).ok, false, "no debe existir una tool duplicada fuera del registro");

const generado = jsonSchemaDe("buscar_estructural");
assert.ok(generado, "el registro debe generar JSON Schema");
assert.equal(generado.type, "object");
assert.ok(generado.properties.patron);
assert.deepEqual([...generado.properties.lenguaje.enum].sort(), ["css", "html", "js", "jsx", "ts", "tsx"]);
assert.deepEqual(generado, schema, "el JSON Schema generado es el que viaja en CODER_TOOLS");
assert.ok(zodDe("buscar_estructural"), "Zod se deriva del JSON Schema del registro");
assert.equal(permisoDe("ejecutar"), "execute");
assert.equal(permisoDe("buscar_estructural"), "read");

console.log("Tool schemas: Zod y JSON Schema salen del registro único y coinciden con CODER_TOOLS.");
