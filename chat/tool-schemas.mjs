/**
 * Schemas Zod de las herramientas nuevas.
 *
 * No se importan desde el servidor para que la copia aislada de evaluación siga
 * arrancando sin `node_modules`; se usan en pruebas y para generar JSON Schema
 * reproducible. La fuente de verdad de las tools sigue siendo `CODER_TOOLS`.
 */
import { z } from "zod";

export const busquedaEstructuralSchema = z.object({
  patron: z.string().min(2).max(500),
  lenguaje: z.enum(["ts", "tsx", "js", "jsx", "html", "css"]),
  max: z.number().int().min(1).max(120).optional(),
});

export const busquedaTextoSchema = z.object({
  consulta: z.string().min(2).max(500),
  max: z.number().int().min(1).max(200).optional(),
  caseSensitive: z.boolean().optional(),
  fixed: z.boolean().optional(),
});

export const schemasHerramientas = Object.freeze({
  buscar_estructural: busquedaEstructuralSchema,
  buscar_texto: busquedaTextoSchema,
});

/**
 * @param {string} nombre
 * @param {unknown} args
 * @returns {{ok: true, datos: unknown} | {ok: false, error: string}}
 */
export function validarHerramienta(nombre, args) {
  const schema = schemasHerramientas[nombre];
  if (!schema) return { ok: false, error: `herramienta desconocida: ${nombre}` };
  const resultado = schema.safeParse(args);
  return resultado.success
    ? { ok: true, datos: resultado.data }
    : { ok: false, error: resultado.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ") };
}

export function jsonSchemaDe(nombre) {
  const schema = schemasHerramientas[nombre];
  if (!schema) return null;
  return z.toJSONSchema(schema, { target: "draft-7" });
}
