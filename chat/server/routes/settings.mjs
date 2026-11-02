/** Rutas de reglas del proyecto, ajustes y memoria global. */
import { readBody } from "../http.mjs";
import { RULES_CAP_TOKENS } from "../../context.mjs";
import { ENGINE_PROFILES, isNamedEnginePreset } from "../../engine-profiles.mjs";

/**
 * @param {Record<string, any>} ctx
 */
export function createSettingsRoutes(ctx) {
  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {URL} url
   * @returns {Promise<boolean>}
   */
  return async function handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/rules") {
      const { fuentes, texto } = ctx.leerReglas();
      const aplicado = ctx.leerAjustes().reglas !== false && Boolean(texto.trim());
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ fuentes, texto, aplicado, topeTokens: RULES_CAP_TOKENS }));
      return true;
    }
    // --------------------------------------------------------------- ajustes
    if (req.method === "GET" && url.pathname === "/api/settings") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ ...ctx.leerAjustes(), pensarInfo: ctx.infoPensar(), engineProfiles: ENGINE_PROFILES }));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/settings") {
      const raw = JSON.parse(await readBody(req));
      if (!raw || typeof raw !== "object") {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("cuerpo no valido");
        return true;
      }
      const permitidas = ["tema", "perfil", "pensar", "verPensamiento", "reglas", "historial", "continuarAuto", "saltosTope", "comandoSegundos", "agentePerfil", "coderContextTokens", "modoRespuesta", "enginePreset", "engineKv", "engineVision", "memoriaGlobal", "memoriaGlobalAuto", "memoriaGlobalTokens", "editorModerno"];
      /** @type {Record<string, unknown>} */
      const limpio = {};
      for (const k of permitidas) if (k in raw) limpio[k] = raw[k];
      if ("tema" in limpio && !ctx.uiThemeIds.has(limpio.tema)) {res.writeHead(400).end("Tema inválido");return true;}
      if ("verPensamiento" in limpio && typeof limpio.verPensamiento!=="boolean") {res.writeHead(400).end("Preferencia de pensamiento inválida");return true;}
      if ("editorModerno" in limpio && typeof limpio.editorModerno !== "boolean") {res.writeHead(400).end("Preferencia de editor inválida");return true;}
      if ("engineVision" in limpio && typeof limpio.engineVision!=="boolean") {res.writeHead(400).end("Visión inválida");return true;}
      if ("engineKv" in limpio && !["f16","q8_0","q4_0"].includes(limpio.engineKv)) {res.writeHead(400).end("KV inválida");return true;}
      if ("memoriaGlobal" in limpio && typeof limpio.memoriaGlobal !== "boolean") {res.writeHead(400).end("Preferencia de memoria global inválida");return true;}
      if ("memoriaGlobalAuto" in limpio && typeof limpio.memoriaGlobalAuto !== "boolean") {res.writeHead(400).end("Preferencia de captura automática inválida");return true;}
      if ("memoriaGlobalTokens" in limpio) {
        const n = Number(limpio.memoriaGlobalTokens);
        if (!Number.isFinite(n) || n < 0 || n > 2000) {res.writeHead(400).end("Presupuesto de memoria global inválido");return true;}
        limpio.memoriaGlobalTokens = Math.round(n);
      }
      if ("modoRespuesta" in limpio && !["agente","consulta"].includes(limpio.modoRespuesta)) {
        res.writeHead(400).end("Modo de respuesta inválido"); return true;
      }
      if ("coderContextTokens" in limpio) {
        const n = Number(limpio.coderContextTokens);
        if (!Number.isInteger(n) || n < 4096 || n > 131072) { res.writeHead(400).end("Contexto coding inválido (4096-131072)"); return true; }
        limpio.coderContextTokens = n;
      }
      if ("enginePreset" in limpio && limpio.enginePreset !== "CUSTOM" && limpio.enginePreset !== "" && !isNamedEnginePreset(limpio.enginePreset)) {
        res.writeHead(400).end("Perfil de motor inválido"); return true;
      }
      if ("agentePerfil" in limpio && !["legacy", "small-local-coder"].includes(limpio.agentePerfil)) {
        res.writeHead(400).end("agentePerfil debe ser legacy o small-local-coder"); return true;
      }
      if ("saltosTope" in limpio) limpio.saltosTope = Math.max(24, Math.min(400, Math.round(Number(limpio.saltosTope) || 192)));
      if ("comandoSegundos" in limpio) limpio.comandoSegundos = Math.max(10, Math.min(1800, Math.round(Number(limpio.comandoSegundos) || 180)));
      const mezcla = ctx.guardarAjustes(limpio);
      // Y SE APLICAN: antes se guardaban y no los leía nadie, así que elegir "Modo
      // razonamiento" o "Perfil de muestreo" no cambiaba nada y la interfaz decía que sí.
      ctx.aplicarAjustesAlChat(mezcla);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ...mezcla, pensarInfo: ctx.infoPensar() }));
      return true;
    }
    // ------------------------------------------------------- memoria global
    // Inspección, edición y borrado de la memoria que se comparte entre chats.
    // El archivo vive en STATE (fuera del proyecto y de Git); aquí solo se expone
    // lo necesario para revisarlo. No se inyecta nada desde este endpoint.
    if (req.method === "GET" && url.pathname === "/api/memoria") {
      ctx.memoriaGlobal.recargar();
      const ajustesMemoria = ctx.leerAjustes();
      const presupuesto = Math.max(0, Math.min(2000, Math.round(Number(ajustesMemoria.memoriaGlobalTokens) || 0)));
      const consulta = (url.searchParams.get("q") || "").trim();
      const seleccion = consulta
        ? ctx.memoriaGlobal.seleccionar(consulta, { presupuesto })
        : null;
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({
        ...ctx.memoriaGlobal.resumen(),
        config: {
          activa: ajustesMemoria.memoriaGlobal !== false,
          automatica: ajustesMemoria.memoriaGlobalAuto !== false,
          presupuesto,
          maxPresupuesto: 2000,
        },
        entradas: ctx.memoriaGlobal.listar(),
        seleccion,
      }));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/memoria") {
      const raw = JSON.parse(await readBody(req));
      if (!raw || typeof raw !== "object") {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("cuerpo no válido");
        return true;
      }
      const op = typeof raw.op === "string" ? raw.op : "";
      const tags = Array.isArray(raw.tags) ? raw.tags : typeof raw.tags === "string" ? raw.tags.split(",") : [];
      try {
        if (op === "add") {
          const entrada = ctx.memoriaGlobal.agregar(raw.texto, {
            tags,
            fijada: raw.fijada === true,
            importancia: raw.importancia,
            origen: { tipo: "manual", fecha: new Date().toISOString() },
          });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, entrada, ...ctx.memoriaGlobal.resumen() }));
          return true;
        }
        if (op === "edit") {
          const entrada = ctx.memoriaGlobal.editar(String(raw.id || ""), {
            ...(raw.texto !== undefined ? { texto: raw.texto } : {}),
            ...(raw.tags !== undefined ? { tags } : {}),
            ...(raw.fijada !== undefined ? { fijada: raw.fijada } : {}),
            ...(raw.importancia !== undefined ? { importancia: raw.importancia } : {}),
          });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, entrada, ...ctx.memoriaGlobal.resumen() }));
          return true;
        }
        if (op === "delete") {
          const borrada = ctx.memoriaGlobal.borrar(String(raw.id || ""));
          if (!borrada) {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("esa nota no existe");
            return true;
          }
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, ...ctx.memoriaGlobal.resumen() }));
          return true;
        }
        if (op === "clear") {
          if (raw.confirm !== true) {
            res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("falta confirmar el borrado de toda la memoria global");
            return true;
          }
          const borradas = ctx.memoriaGlobal.vaciar();
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok: true, borradas, ...ctx.memoriaGlobal.resumen() }));
          return true;
        }
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("operación de memoria desconocida");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end(message);
      }
      return true;
    }
    return false;
  };
}
