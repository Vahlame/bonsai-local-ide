/**
 * Contratos HTTP del IDE. Zod valida los cuerpos que más riesgo tienen (carpeta,
 * archivos, deshacer, definición) y genera el esquema OpenAPI. La copia aislada
 * de evaluación funciona sin `node_modules`: si Zod no está, se usa un validador
 * mínimo equivalente y el OpenAPI queda con esquemas genéricos.
 *
 * No se impone un envelope nuevo a todas las rutas para no romper a los clientes
 * existentes: los errores de contrato responden 400 con texto claro, como antes.
 */
import { readBody } from "./http.mjs";

export class ContratoError extends Error {
  /**
   * @param {string} message
   * @param {unknown} [detalles]
   */
  constructor(message, detalles) {
    super(message);
    this.name = "ContratoError";
    this.status = 400;
    this.code = "CUERPO_INVALIDO";
    this.detalles = detalles;
  }
}

/** @type {Promise<any> | null} */
let zodPromise = null;

/** Carga Zod una sola vez; `null` si la copia no tiene dependencias. */
function cargarZod() {
  if (!zodPromise) {
    zodPromise = import("zod")
      .then((mod) => mod.z || mod.default?.z || null)
      .catch(() => null);
  }
  return zodPromise;
}

/**
 * @param {any} z
 */
function crearEsquemas(z) {
  return {
    trabajo: z.object({
      path: z.string().optional(),
      pick: z.boolean().optional(),
    }).passthrough(),
    archivo: z.object({
      path: z.string().min(1),
      content: z.string(),
      create: z.boolean().optional(),
      before: z.string().optional(),
    }).passthrough(),
    deshacer: z.object({
      id: z.string().optional(),
      force: z.boolean().optional(),
      turno: z.boolean().optional(),
    }).passthrough(),
    definir: z.object({
      palabra: z.string().max(200).optional(),
      path: z.string().optional(),
    }).passthrough(),
  };
}

/**
 * Validador de respaldo para la copia sin dependencias.
 * @param {string} nombre
 * @param {unknown} raw
 * @returns {{ok: true, data: any} | {ok: false, error: ContratoError}}
 */
function validarSinZod(nombre, raw) {
  const esObjeto = raw && typeof raw === "object" && !Array.isArray(raw);
  const fallo = (mensaje) => ({ ok: false, error: new ContratoError("cuerpo no válido", [{ ruta: "", mensaje }]) });
  if (!esObjeto) return fallo("se esperaba un objeto");
  const obj = /** @type {Record<string, unknown>} */ (raw);
  if (nombre === "trabajo") {
    if (obj.path !== undefined && typeof obj.path !== "string") return fallo("path debe ser texto");
    if (obj.pick !== undefined && typeof obj.pick !== "boolean") return fallo("pick debe ser booleano");
    return { ok: true, data: obj };
  }
  if (nombre === "archivo") {
    if (typeof obj.path !== "string" || !obj.path) return fallo("path debe ser texto no vacío");
    if (typeof obj.content !== "string") return fallo("content debe ser texto");
    if (obj.create !== undefined && typeof obj.create !== "boolean") return fallo("create debe ser booleano");
    if (obj.before !== undefined && typeof obj.before !== "string") return fallo("before debe ser texto");
    return { ok: true, data: obj };
  }
  if (nombre === "deshacer") {
    if (obj.id !== undefined && typeof obj.id !== "string") return fallo("id debe ser texto");
    if (obj.force !== undefined && typeof obj.force !== "boolean") return fallo("force debe ser booleano");
    if (obj.turno !== undefined && typeof obj.turno !== "boolean") return fallo("turno debe ser booleano");
    return { ok: true, data: obj };
  }
  if (nombre === "definir") {
    if (obj.palabra !== undefined && typeof obj.palabra !== "string") return fallo("palabra debe ser texto");
    if (obj.path !== undefined && typeof obj.path !== "string") return fallo("path debe ser texto");
    return { ok: true, data: obj };
  }
  return fallo("contrato desconocido");
}

/**
 * @param {string} nombre
 * @param {unknown} raw
 * @returns {Promise<{ok: true, data: any} | {ok: false, error: ContratoError}>}
 */
export async function validarCuerpo(nombre, raw) {
  const z = await cargarZod();
  if (!z) return validarSinZod(nombre, raw);
  const esquemas = crearEsquemas(z);
  const esquema = esquemas[nombre];
  if (!esquema) return { ok: false, error: new ContratoError("contrato desconocido") };
  const resultado = esquema.safeParse(raw);
  if (resultado.success) return { ok: true, data: resultado.data };
  return {
    ok: false,
    error: new ContratoError("cuerpo no válido", resultado.error.issues.map((issue) => ({
      ruta: issue.path.join("."),
      mensaje: issue.message,
    }))),
  };
}

/**
 * Lee el cuerpo JSON, lo valida y lanza `ContratoError` si no cumple.
 * @param {import("node:http").IncomingMessage} req
 * @param {"trabajo" | "archivo" | "deshacer" | "definir"} nombre
 * @param {number} [limite]
 * @returns {Promise<any>}
 */
export async function leerJson(req, nombre, limite) {
  const raw = JSON.parse(await readBody(req, limite));
  const resultado = await validarCuerpo(nombre, raw);
  if (!resultado.ok) throw resultado.error;
  return resultado.data;
}

/**
 * @param {string} version
 */
export async function construirOpenApi(version) {
  const z = await cargarZod();
  const esquemas = z ? crearEsquemas(z) : null;
  /** @param {string} nombre */
  const json = (nombre) => esquemas ? z.toJSONSchema(esquemas[nombre]) : { type: "object", additionalProperties: true };
  const respuestaJson = { description: "Respuesta JSON" };
  return {
    openapi: "3.1.0",
    info: {
      title: "Bonsai Local IDE API",
      version,
      description: "API local del IDE. Los endpoints de escritura validan el cuerpo con Zod.",
    },
    servers: [{ url: "http://127.0.0.1:8787" }],
    paths: {
      "/api/health": {
        get: { summary: "Estado barato del servidor", responses: { 200: respuestaJson } },
      },
      "/api/workspace": {
        get: { summary: "Carpeta y archivos visibles", responses: { 200: respuestaJson } },
        post: {
          summary: "Cambia o elige la carpeta de trabajo",
          requestBody: { required: true, content: { "application/json": { schema: json("trabajo") } } },
          responses: { 200: respuestaJson, 400: { description: "Cuerpo no válido" }, 409: { description: "Turno en curso" } },
        },
      },
      "/api/file": {
        get: {
          summary: "Lee un archivo (con ETag y límite de 2 MB)",
          parameters: [{ name: "path", in: "query", required: true, schema: { type: "string" } }],
          responses: { 200: { description: "Texto plano" }, 304: { description: "Sin cambios" }, 404: { description: "No existe" } },
        },
        post: {
          summary: "Guarda un archivo con comprobación de versión",
          requestBody: { required: true, content: { "application/json": { schema: json("archivo") } } },
          responses: { 200: respuestaJson, 400: { description: "Cuerpo no válido" }, 409: { description: "Cambió en disco" }, 413: { description: "Demasiado grande" } },
        },
      },
      "/api/undo": {
        post: {
          summary: "Deshace una escritura o todo el turno",
          requestBody: { required: true, content: { "application/json": { schema: json("deshacer") } } },
          responses: { 200: respuestaJson, 409: { description: "Conflicto" } },
        },
      },
      "/api/definir": {
        post: {
          summary: "Busca una definición en el índice de símbolos",
          requestBody: { required: true, content: { "application/json": { schema: json("definir") } } },
          responses: { 200: respuestaJson },
        },
      },
      "/api/terminal/stream": {
        get: {
          summary: "Salida del terminal por SSE",
          parameters: [
            { name: "id", in: "query", required: true, schema: { type: "string" } },
            { name: "desde", in: "query", required: false, schema: { type: "integer", minimum: 0 } },
          ],
          responses: { 200: { description: "text/event-stream" }, 404: { description: "Terminal no encontrado" } },
        },
      },
      "/api/openapi.json": {
        get: { summary: "Este documento", responses: { 200: respuestaJson } },
      },
    },
  };
}
