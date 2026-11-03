/**
 * Validación y clasificación de una petición de /api/chat. Separar esto del
 * bucle permite probar los modos (agente/consulta) sin arrancar SSE.
 */
import { esCharla, pideAclaraciones } from "../../actions.mjs";

/**
 * @param {unknown} raw
 * @param {{getSettings: () => Record<string, any>}} ctx
 * @returns {{ok: true, text: string, attached: unknown[], snippets: unknown[], imagenes: unknown[], consulta: boolean, soloCharla: boolean, aclaraPrimero: boolean} | {ok: false, status: number, message: string}}
 */
export function parseChatRequest(raw, ctx) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, status: 400, message: "cuerpo no válido" };
  }
  const body = /** @type {Record<string, unknown>} */ (raw);
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const attached = Array.isArray(body.files) ? body.files : [];
  const snippets = Array.isArray(body.snippets) ? body.snippets : [];
  const imagenes = Array.isArray(body.imagenes) ? body.imagenes : [];
  if (body.modo !== undefined && !["agente", "consulta"].includes(/** @type {string} */ (body.modo))) {
    return { ok: false, status: 400, message: "Modo inválido" };
  }
  if (!text) return { ok: false, status: 400, message: "falta el texto" };
  const consulta = (body.modo || ctx.getSettings().modoRespuesta) === "consulta";
  const soloCharla = consulta || (!attached.length && !snippets.length && esCharla(text));
  // Un pedido de plan/preguntas no debe empezar inspeccionando el proyecto:
  // el primer turno responde sin herramientas y espera las respuestas.
  const aclaraPrimero = !consulta && !attached.length && !snippets.length && pideAclaraciones(text);
  return { ok: true, text, attached, snippets, imagenes, consulta, soloCharla, aclaraPrimero };
}
