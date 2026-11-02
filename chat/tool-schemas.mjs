/**
 * Fachada Zod sobre el registro único de tools.
 *
 * No define esquemas propios: toma el JSON Schema de `tool-registry.mjs` y lo
 * convierte a Zod solo cuando una prueba o una herramienta externa lo pide.
 * La fuente de verdad sigue siendo el registro.
 */
import { z } from "zod";
import { toolPermission, toolSchema, validateToolCall } from "./tool-registry.mjs";

/** @type {Map<string, import("zod").ZodType>} */
const cache = new Map();

/**
 * @param {string} nombre
 * @returns {import("zod").ZodType | null}
 */
export function zodDe(nombre) {
  if (cache.has(nombre)) return cache.get(nombre) || null;
  const json = toolSchema(nombre);
  if (!json) return null;
  const schema = z.fromJSONSchema(json);
  cache.set(nombre, schema);
  return schema;
}

/**
 * @param {string} nombre
 * @param {unknown} args
 * @returns {{ok: true, datos: unknown} | {ok: false, error: string}}
 */
export function validarHerramienta(nombre, args) {
  if (!toolSchema(nombre)) return { ok: false, error: `herramienta desconocida: ${nombre}` };
  const schema = zodDe(nombre);
  const resultado = schema.safeParse(args);
  return resultado.success
    ? { ok: true, datos: resultado.data }
    : { ok: false, error: resultado.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ") };
}

/**
 * Valida con el mismo motor que usa el agente (JSON Schema del registro).
 * @param {string} nombre
 * @param {unknown} args
 */
export function validarComoAgente(nombre, args) {
  return validateToolCall({ name: nombre, arguments: args }, [{ type: "function", function: { name: nombre, parameters: toolSchema(nombre) } }]);
}

/**
 * @param {string} nombre
 * @returns {Record<string, unknown> | null}
 */
export function jsonSchemaDe(nombre) {
  return toolSchema(nombre);
}

/** @param {string} nombre */
export function permisoDe(nombre) {
  return toolPermission(nombre);
}
