/** Rutas de estado, historial, permisos, procesos, terminal y turno del agente. */
import fs from "node:fs";
import path from "node:path";
import { readBody } from "../http.mjs";
import { readGpu } from "../gpu.mjs";
import { estimateTokens } from "../../context.mjs";
import { MODELO, pensarDe } from "../../modelo.mjs";
import { hiddenTurn } from "../text.mjs";

/**
 * @param {Record<string, any>} ctx
 */
export function createChatRoutes(ctx) {
  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {URL} url
   * @returns {Promise<boolean>}
   */
  return async function handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/state") {
      const files = (ctx.chat.session.files || []).map((file) => ({
        rel: file.rel,
        bytes: file.bytes,
        url: `${fs.existsSync(path.join(ctx.workspaceRoot, file.rel)) ? "/p" : "/salida"}/${file.rel.split("/").map(encodeURIComponent).join("/")}`,
      }));
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      const usage = {
        ...(ctx.chat.usage || {
          prompt: 0,
          generated: 0,
          memory: estimateTokens(ctx.chat.session.memory),
          globalMemory: estimateTokens(ctx.chat.globalMemory),
          globalMemoryEntries: ctx.chat.globalMemoryIds.length,
        }),
        // La ventana y el tope son del servidor ACTUAL, no de la sesión que
        // se cargó con otro modelo. Sin esto el medidor podía seguir
        // mostrando 65536 tras cambiar a un modelo de 32768.
        cap: ctx.chat.historyCap(),
        nCtx: ctx.chat.nCtx,
        folded: ctx.chat.session.folded,
        turns: ctx.chat.session.turns.length,
      };
      res.end(JSON.stringify({
        agentProfile: ctx.chat.agentProfile,
        busy: ctx.busy,
        taskState: ctx.chat.session.taskState || null,
        contextDiagnostics: ctx.chat.contextDiagnostics ? { ...ctx.chat.contextDiagnostics, gpu: await readGpu() } : null,
        nCtx: ctx.chat.nCtx,
        capabilities: { contextWindow: ctx.chat.nCtx, modelContextWindow: MODELO.catalogo?.[ctx.modeloActualClave()]?.ctxNativo ?? null, vision: ctx.chat.vision, reasoning: pensarDe(ctx.modeloActualClave()).compatible, tools: ctx.chat.props?.chat_template_caps?.supports_tools ?? null, template: ctx.chat.props?.chat_template_caps || null, projector: MODELO.catalogo?.[ctx.modeloActualClave()]?.vision?.archivo || null },
        historyCap: ctx.chat.historyCap(),
        // Presupuesto real de contexto: ventana del servidor, tope pedido por el usuario,
        // historial efectivo y reserva de salida. La UI no debe prometer más de lo que hay.
        presupuesto: typeof ctx.chat.presupuestoContexto === "function"
          ? ctx.chat.presupuestoContexto()
          : { ventana: ctx.chat.nCtx, solicitado: ctx.chat.configuredCap, efectivo: ctx.chat.historyCap(), reservaSalida: Math.max(0, ctx.chat.nCtx - ctx.chat.historyCap()) },
        historial: { error: ctx.errorHistorial, carpeta: ctx.historial.chatsDir },
        memoriaGlobal: (() => {
          const ajustesMemoria = ctx.leerAjustes();
          return {
            ...ctx.memoriaGlobal.resumen(),
            activa: ajustesMemoria.memoriaGlobal !== false,
            automatica: ajustesMemoria.memoriaGlobalAuto !== false,
            presupuesto: Number(ajustesMemoria.memoriaGlobalTokens) || 0,
            inyectadasAhora: ctx.chat.globalMemoryIds.length,
            tokensInyectados: estimateTokens(ctx.chat.globalMemory),
          };
        })(),
        usage,
        turns: ctx.chat.session.turns.filter((turn) => !hiddenTurn(turn)).map((turn) => ({
          role: turn.role,
          content: typeof turn.shown === "string" ? turn.shown : turn.content,
          ...(typeof turn.reasoning === "string" ? {reasoning:turn.reasoning} : {}),
          actions: Array.isArray(turn.actions) ? turn.actions : [],
        })),
        files,
      }));
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/agent-trace") {
      const id = String(url.searchParams.get("id") || "");
      if (!/^\d+-[a-f0-9]{8}$/.test(id)) { res.writeHead(400).end("id de tarea inválido"); return true; }
      const abs = path.join(ctx.STATE,"agent-traces",`${id}.jsonl`);
      if (!fs.existsSync(abs)) { res.writeHead(404).end("trace no encontrado"); return true; }
      res.writeHead(200,{"Content-Type":"application/x-ndjson","Cache-Control":"no-store"}); fs.createReadStream(abs).pipe(res); return true;
    }
    if (req.method === "GET" && url.pathname === "/api/stats") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(ctx.buildStats(ctx.chat)));
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/chats") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(ctx.historial.readIndex()));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/chats") {
      if (ctx.busy) {
        res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" }).end("espera a que termine el turno");
        return true;
      }
      const raw = JSON.parse(await readBody(req));
      const op = raw && typeof raw.op === "string" ? raw.op : "";
      const id = raw && typeof raw.id === "string" ? raw.id : "";
      if (op === "new") {
        if (ctx.chat.active) ctx.chat.active.abort();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(ctx.startChat()));
        return true;
      }
      if (op === "open") {
        if (ctx.chat.active) ctx.chat.active.abort();
        ctx.loadChat(id);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(ctx.historial.readIndex()));
        return true;
      }
      if (op === "delete") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(ctx.removeChat(id)));
        return true;
      }
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("operación desconocida");
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/reset") {
      if (ctx.chat.active) ctx.chat.active.abort();
      ctx.chat.session = { memory: "", folded: 0, turns: [], draft: "", files: [] };
      ctx.chat.tighten = 0;
      ctx.chat.saveSession();
      res.writeHead(204).end();
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/permit") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ mode: ctx.permitMode }));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/permit") {
      const raw = JSON.parse(await readBody(req));
      const mode = raw && raw.mode;
      if (mode === "ask" || mode === "all") {
        ctx.setPermitMode(mode);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ mode: ctx.permitMode }));
        return true;
      }
      const id = raw && typeof raw.id === "string" ? raw.id : "";
      const finish = ctx.permits.get(id);
      if (!finish) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("esa pregunta ya no está");
        return true;
      }
      finish(raw.allow === true);
      res.writeHead(204).end();
      return true;
    }
    // ------------------------------------------ procesos en segundo plano
    if (req.method === "GET" && url.pathname === "/api/procesos") {
      if (url.searchParams.has("id")) {
        const id = url.searchParams.get("id");
        const p = ctx.procesosFondoVivos.get(id);
        const estado = p ? { id, ...p.estado() } : ctx.procesosFondoTerminados.get(id);
        if (!estado) { res.writeHead(404).end("ese proceso no existe"); return true; }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify(estado));
        return true;
      }
      const lista = [...ctx.procesosFondoVivos.values()].map((p) => ({ id: p.id, pid: p.pid, comando: p.comando, inicio: p.inicio, segundos: Math.round((Date.now() - p.inicio) / 1000) }));
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ procesos: lista }));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/procesos") {
      const raw = JSON.parse(await readBody(req));
      const accion = raw && typeof raw.accion === "string" ? raw.accion : "";
      if (accion === "detener") {
        const id = raw && typeof raw.id === "string" ? raw.id : "";
        const vivo = ctx.procesosFondoVivos.get(id);
        if (!vivo) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("ese proceso no existe");
          return true;
        }
        try { vivo.parar(); } catch { /* ya terminó */ }
        ctx.procesosFondoVivos.delete(id);
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, id }));
        return true;
      }
      if (accion === "detener-todos") {
        for (const p of ctx.procesosFondoVivos.values()) { try { p.parar(); } catch { /* ya terminó */ } }
        ctx.procesosFondoVivos.clear();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));
        return true;
      }
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("accion desconocida");
      return true;
    }
    // ------------------------------------------ terminal integrado (panel inferior)
    if (url.pathname === "/api/terminal" && (req.method === "GET" || req.method === "POST")) {
      try {
        const t = ctx.sesionesTerminal();
        if (req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify({ terminales: t.listar() }));
          return true;
        }
        const raw = JSON.parse(await readBody(req));
        const accion = raw && typeof raw.accion === "string" ? raw.accion : "";
        if (accion === "abrir") {
          const r = t.abrir({ cwd: raw && typeof raw.cwd === "string" ? raw.cwd : "" });
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ...r, vivo: true }));
          return true;
        }
        if (accion === "listar") {
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ terminales: t.listar() }));
          return true;
        }
        const id = raw && typeof raw.id === "string" ? raw.id : "";
        if (accion === "escribir") {
          const ok = t.escribir(id, raw && typeof raw.datos === "string" ? raw.datos : "");
          res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok }));
          return true;
        }
        if (accion === "leer") {
          const desde = Number(raw && raw.desde) || 0;
          const leido = t.leer(id, desde);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
          res.end(JSON.stringify(leido));
          return true;
        }
        if (accion === "resize") {
          const ok = t.resize(id, Number(raw && raw.cols) || 100, Number(raw && raw.rows) || 30);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok }));
          return true;
        }
        if (accion === "cerrar") {
          const ok = t.cerrar(id);
          res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ ok }));
          return true;
        }
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("accion desconocida");
      } catch (err) {
        const mensaje = err instanceof Error ? err.message : String(err);
        const noExiste = /no existe|desconocid/i.test(mensaje);
        res.writeHead(noExiste ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" }).end(mensaje);
      }
      return true;
    }
    // Cancelación explícita. No depende de que el navegador cierre el socket del
    // stream: el botón Detener llama aquí y el servidor aborta la inferencia, las
    // herramientas y los procesos del turno. Responde aunque no haya turno (idempotente)
    // para que la interfaz pueda usarlo al cambiar de chat o al cerrar la pestaña.
    if (req.method === "POST" && url.pathname === "/api/stop") {
      await readBody(req).catch(() => "");
      const activo = ctx.chat.active;
      if (activo && !activo.signal.aborted) activo.abort(new Error("Cancelado por el usuario"));
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ ok: true, cancelado: Boolean(activo && activo.signal.aborted) }));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      await ctx.agentLoop(req, res);
      return true;
    }
    return false;
  };
}
