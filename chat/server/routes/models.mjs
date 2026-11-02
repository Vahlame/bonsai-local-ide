/** Rutas de ciclo de vida del modelo, Model Hub y catálogo. */
import { readBody } from "../http.mjs";
import { MODELOS_DIR, catalogoModelos, guardarModeloActivo, modeloGuardadoClave } from "../catalog.mjs";
import { configurationFromMarker, LifecycleError } from "../../lifecycle/managed-server.mjs";
import { ENGINE_PROFILES, configMotor, engineProfile, isNamedEnginePreset, validarTechoModelo } from "../../engine-profiles.mjs";
import { MODELO, presupuestoPensar } from "../../modelo.mjs";
import {
  HUB_FILE,
  borrarModelo,
  buscarHuggingFace,
  catalogoHub,
  crearTrabajo,
  cancelarTrabajo,
  descubrirHuggingFace,
  escanearModelos,
  importarArchivo,
  inspeccionarRepo,
  listarTrabajos,
  planParaModelo,
  resumen as resumenHub,
  vramInfo,
} from "../../model-hub.mjs";

/**
 * @param {Record<string, any>} ctx
 */
export function createModelsRoutes(ctx) {
  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {URL} url
   * @returns {Promise<boolean>}
   */
  return async function handle(req, res, url) {
    // ---------------------------------------------------------------- modelos
    if (req.method === "GET" && ["/api/servidor", "/api/server/state"].includes(url.pathname)) {
      try {
        const state = await ctx.lifecycle.inspect();
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ok: true, ...state, encendido: state.state === "ready" || state.healthy === true, ocupado: ctx.busy || ctx.lifecycle.busy }));
      } catch (err) {
        res.writeHead(err.status || 500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, state: err.state || "error", error: err.message, context: err.context }));
      }
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/server/command") {
      // Devuelve un comando PowerShell listo para pegar, con rutas absolutas.
      const preset = url.searchParams.get("preset") || "8GB-VISION-MAX-Q8-100K";
      const clave = url.searchParams.get("model") || modeloGuardadoClave() || MODELO.modeloPredeterminado;
      const comando = ctx.comandoServidorOptimizado(preset, ctx.args.llamaPort, clave);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ command: comando, preset, model: clave }));
      return true;
    }
    if (req.method === "POST" && ["/api/servidor", "/api/server/start", "/api/server/stop", "/api/server/close"].includes(url.pathname)) {
      let ownsBusy = false;
      try {
        const raw = JSON.parse((await readBody(req)) || "{}");
        const action = url.pathname === "/api/servidor"
          ? ({ encender: "start", apagar: "stop", cerrar: "close" })[raw?.accion]
          : url.pathname.split("/").at(-1);
        if (!action) { res.writeHead(400).end("Acción desconocida"); return true; }
        if ((ctx.busy || ctx.lifecycle.busy) && !(action === "stop" && ctx.lifecycle.busy)) {
          throw new LifecycleError("Hay una operación en curso; espera a que termine", { state: "starting", port: ctx.args.llamaPort }, 409);
        }
        ownsBusy = !ctx.busy;
        if (ownsBusy) ctx.busy = true;
        let result;
        if (action === "stop" || action === "close") {
          const onBeforeStop = (snapshot) => {
            const previous = configurationFromMarker(snapshot.marker);
            if (previous) ctx.configuracionApagada = { clave: previous.model, ...previous.config };
          };
          result = action === "stop" ? await ctx.lifecycle.stop({ onBeforeStop }) : await ctx.lifecycle.closeIde({
            onBeforeStop,
            shutdown: () => ctx.shutdownIde(res),
          });
        } else if (url.pathname === "/api/servidor") {
          const snapshot = await ctx.lifecycle.inspect();
          if (snapshot.state === "ready") result = { ok: true, ...snapshot };
          else {
            const model = ctx.configuracionApagada?.clave || modeloGuardadoClave();
            result = await ctx.lifecycle.start({ model, config: ctx.configuracionApagada, onReady: () => ctx.conectarModelo(model) });
          }
        } else {
          const preset = String(raw?.preset || ctx.leerAjustes().enginePreset || "8GB-VISION-MAX-Q8-100K");
          const modelo = String(raw?.model || modeloGuardadoClave() || MODELO.modeloPredeterminado);
          const item = catalogoModelos().find((m) => m.clave === modelo);
          if (!item) { res.writeHead(400).end(`modelo desconocido: ${modelo}`); return true; }
          if (!item.existe) { res.writeHead(404).end(`falta el GGUF de ${item.nombre} en models\\${item.archivo}`); return true; }
          if (!item.gpuCompleta) { res.writeHead(409).end(`El modelo ${item.nombre} no tiene perfil de GPU completa`); return true; }
          const validPresets = [
            "8GB-VISION-MAX-Q8-100K", "8GB-VISION-MAX-Q8", "8GB-VISION-MAX-Q4", "8GB-VISION-MAX-F16",
            "8GB-VISION-DEFAULT-F16", "8GB-VISION-ULTRA-F16", "8GB-VISION-HIGH",
            "8GB-VISION-BALANCED", "8GB-VISION-SAFE",
            "8GB-CODE-MAX", "8GB-CODE-HIGH", "8GB-CODE-BALANCED", "8GB-CODE-FAST",
            "8GB-RESEARCH", "8GB-VISION-QUALITY", "AUTO", "CUSTOM"
          ];
          if (!validPresets.includes(preset)) {
            res.writeHead(400).end("Preset no válido");
            return true;
          }
          /** @type {{enginePreset: string, contexto?: number, kv?: string, vision?: boolean}} */
          let configuracion = { enginePreset: preset };
          if (preset === "AUTO") {
            const elegido = await planParaModelo(modelo, { vision: raw?.vision !== false });
            if (!elegido.plan.ok) throw new Error(`El plan automático no cabe: ${elegido.plan.motivo}`);
            configuracion = {
              enginePreset: "CUSTOM",
              contexto: elegido.plan.contexto,
              kv: elegido.plan.kv,
              vision: elegido.plan.vision,
              mmprojCPU: elegido.plan.mmprojCPU,
            };
            ctx.chat.note(`plan automático para ${item.nombre}: ${elegido.plan.contexto} tokens · KV ${elegido.plan.kv}${elegido.plan.vision ? (elegido.plan.mmprojCPU ? " · visión CPU" : " · visión GPU") : ""}`);
          } else if (preset === "CUSTOM") {
            const contexto = Number(raw?.contexto);
            if (!Number.isInteger(contexto) || contexto < 4096 || contexto > 131072) { res.writeHead(400).end("Ventana de contexto inválida"); return true; }
            const kv = String(raw?.kv || "q8_0");
            if (!["f16", "bf16", "q8_0", "q4_0"].includes(kv)) { res.writeHead(400).end("KV inválida"); return true; }
            configuracion = { enginePreset: "CUSTOM", contexto, kv, vision: raw?.vision !== false && Boolean(item.vision), mmprojCPU: raw?.mmprojCPU === true };
          }

          const options = { model: modelo, config: { ...configuracion,
            pensar: presupuestoPensar(modelo, Number(raw?.pensar ?? 4096)), dormir: 0, hostIP: "127.0.0.1" },
            onReady: () => ctx.conectarModelo(modelo) };
          const snapshot = await ctx.lifecycle.inspect();
          options.onRestore = () => ctx.conectarModelo(snapshot.marker?.modelo);
          result = snapshot.state === "empty" ? await ctx.lifecycle.start(options) : await ctx.lifecycle.restart(options);
          try { guardarModeloActivo(item); } catch { /* el arranque ya funcionó */ }
          result = { ...result, preset, auto: preset === "AUTO" };
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ ...result, encendido: result.state === "ready" }));
      } catch (err) {
        res.writeHead(err instanceof SyntaxError ? 400 : err.status || 500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, state: err.state || "error", error: err.message, context: err.context }));
      } finally { if (ownsBusy) ctx.busy = false; }
      return true;
    }

    // ================================================================ model hub
    if (req.method === "GET" && url.pathname === "/api/hub/status") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ ...resumenHub(), vram: await vramInfo(), modelosDir: MODELOS_DIR, hubFile: HUB_FILE }));
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/hub/catalog") {
      const libre = Number(url.searchParams.get("libreMiB")) || 0;
      const datos = await catalogoHub(libre > 0 ? { libreMiB: libre } : {});
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(datos));
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/hub/search") {
      const q = (url.searchParams.get("q") || "").trim();
      const datos = q ? await buscarHuggingFace(q, { limit: Number(url.searchParams.get("limit")) || 24 }) : [];
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ q, resultados: datos }));
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/hub/discover") {
      const datos = await descubrirHuggingFace({
        limit: Number(url.searchParams.get("limit")) || 30,
        sort: url.searchParams.get("sort") || "trendingScore",
      });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ resultados: datos, actualizado: new Date().toISOString() }));
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/hub/repo") {
      const repo = url.searchParams.get("repo") || "";
      const datos = await inspeccionarRepo(repo);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(datos));
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/hub/plan") {
      const clave = url.searchParams.get("clave") || "";
      const vision = url.searchParams.get("vision") !== "0";
      const datos = await planParaModelo(clave, { vision, actual: url.searchParams.get("actual") === "1" });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(datos));
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/hub/downloads") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ trabajos: listarTrabajos() }));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/hub/downloads") {
      const raw = JSON.parse(await readBody(req));
      const id = typeof raw?.id === "string" ? raw.id : "";
      if (!id) { res.writeHead(400).end("falta el id de la descarga"); return true; }
      const trabajo = cancelarTrabajo(id);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, trabajo }));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/hub/download") {
      const raw = JSON.parse(await readBody(req));
      if (!raw || typeof raw !== "object") { res.writeHead(400).end("cuerpo no válido"); return true; }
      const trabajo = await crearTrabajo(raw);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, ...trabajo }));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/hub/import") {
      const raw = JSON.parse(await readBody(req));
      if (raw && raw.scan === true) {
        const datos = await escanearModelos({});
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, ...datos }));
        return true;
      }
      const ruta = raw && typeof raw.ruta === "string" ? raw.ruta : "";
      if (!ruta) { res.writeHead(400).end("falta la ruta del .gguf"); return true; }
      const entrada = await importarArchivo(ruta, { nombre: raw.nombre });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, modelo: entrada }));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/hub/delete") {
      const raw = JSON.parse(await readBody(req));
      const clave = raw && typeof raw.clave === "string" ? raw.clave : "";
      if (!clave) { res.writeHead(400).end("falta la clave del modelo"); return true; }
      const datos = borrarModelo(clave, { confirmar: raw.confirmar === true });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, ...datos }));
      return true;
    }

    if (req.method === "GET" && url.pathname === "/api/modelos") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      // `guardado` = el que arrancará la próxima vez; `actual` = el que está cargado ahora.
      let activo = false;
      try { activo = (await fetch(`${ctx.chat.base}/health`, { signal: AbortSignal.timeout(2000) })).ok; } catch { /* servidor apagado */ }
      res.end(JSON.stringify({ actual: activo ? ctx.modeloActualClave() : "", guardado: modeloGuardadoClave(), modelos: catalogoModelos() }));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/modelos") {
      const raw = JSON.parse(await readBody(req));
      const clave = raw && typeof raw.clave === "string" ? raw.clave.trim() : "";
      if (raw.enginePreset !== undefined && raw.enginePreset !== "CUSTOM" && raw.enginePreset !== "" && !isNamedEnginePreset(raw.enginePreset)) {
        res.writeHead(400).end("Perfil de motor desconocido"); return true;
      }
      // CUSTOM: apply the same validations as named presets (context range, KV type, vision boolean).
      if (raw.enginePreset === "CUSTOM") {
        const contexto = Number(raw.contexto ?? raw.context ?? 16384);
        if (!Number.isInteger(contexto) || contexto < 4096 || contexto > 131072) {
          res.writeHead(400).end("Ventana de contexto inválida (4096-131072)"); return true;
        }
        const kv = String(raw.kv ?? "f16");
        if (!["f16", "q8_0", "q4_0"].includes(kv)) {
          res.writeHead(400).end("Tipo de KV inválido (f16, q8_0, q4_0)"); return true;
        }
        if (raw.vision !== undefined && typeof raw.vision !== "boolean") {
          res.writeHead(400).end("vision debe ser booleano"); return true;
        }
      }
      const item = catalogoModelos().find((m) => m.clave === clave);
      if (!item) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end(`modelo desconocido: ${clave}`);
        return true;
      }
      if (item.oculto) {
        res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" }).end(`${item.nombre} es un modelo auxiliar (borrador), no un modelo de chat`);
        return true;
      }
      if (!item.gpuCompleta) {
        res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" }).end(`El modelo ${item.nombre} no tiene un perfil verificado de GPU completa; selecciona Ornith.`);
        return true;
      }
      if (!item.existe) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end(`el GGUF de ${item.nombre} no está entero en models\\${item.archivo}`);
        return true;
      }
      // AUTO: el plan sale del GGUF real (capas, cabezas KV, ventana nativa) y
      // de la VRAM de ESTA máquina. Es el camino por defecto para modelos del Hub.
      if (raw.auto === true || (item.fuente === "hub" && raw.enginePreset === undefined && raw.contexto === undefined && raw.kv === undefined)) {
        const elegido = await planParaModelo(clave, { vision: raw.vision !== false });
        if (!elegido.plan.ok) {
          res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" }).end(`El modelo ${item.nombre} no cabe con la VRAM actual: ${elegido.plan.motivo}`);
          return true;
        }
        raw.enginePreset = "CUSTOM";
        raw.contexto = elegido.plan.contexto;
        raw.kv = elegido.plan.kv;
        raw.vision = elegido.plan.vision;
        raw.mmprojCPU = elegido.plan.mmprojCPU === true;
      }
      // `recargar`: el mismo modelo, reiniciado (p. ej. para encender el razonamiento, que
      // se fija al arrancar llama-server).
      let servidorActivo = false;
      try { servidorActivo = (await fetch(`${ctx.chat.base}/health`, { signal: AbortSignal.timeout(2000) })).ok; } catch { /* servidor apagado */ }
      if (servidorActivo && ctx.modeloActualClave() === clave && raw.recargar !== true && raw.enginePreset === undefined && raw.contexto === undefined) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, cambiado: false, clave, nombre: item.nombre, nCtx: ctx.chat.nCtx, vision: Boolean(ctx.chat.vision) }));
        return true;
      }
      if (ctx.busy) {
        res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" }).end("hay un turno en curso: espera a que termine");
        return true;
      }
      ctx.busy = true;
      try {
        const anterior = await ctx.configuracionAnterior();
        if (anterior?.error) throw new Error(`No se puede cambiar sin una configuración anterior recuperable: ${anterior.error}`);
        const actualAjustes = ctx.leerAjustes();
        const cfg = { ...configMotor(raw, actualAjustes, anterior), mmprojCPU: raw.mmprojCPU === true };
        // Validación temprana del techo del modelo: si no cabe, falla ANTES de parar el servidor.
        const techo = validarTechoModelo(clave, cfg.contexto, cfg.vision);
        if (!techo.ok) throw new Error(`${techo.motivo}. El cambio se rechaza sin apagar el modelo actual.`);
        const presetProfile = cfg.enginePreset && isNamedEnginePreset(cfg.enginePreset) ? engineProfile(cfg.enginePreset) : null;
        const pedidoPensar = raw.pensar ?? actualAjustes.pensar;
        const pensar = presupuestoPensar(clave, Number(pedidoPensar ?? presetProfile?.thinkingTokens));
        const solicitado = {
          enginePreset: cfg.enginePreset, contexto: cfg.contexto,
          contextoExplicito: raw.contexto !== undefined || raw.context !== undefined,
          kv: cfg.kv, vision: cfg.vision, mmprojCPU: cfg.mmprojCPU === true,
          dormir: cfg.dormir, hostIP: cfg.hostIP, pensar,
        };
        await ctx.lifecycle.restart({
          model: clave, config: solicitado, timeoutMs: 90000,
          previous: anterior ? { model: anterior.clave, config: anterior } : null,
          onReady: () => ctx.conectarModelo(clave),
          onRestore: async () => {
            await ctx.conectarModelo(anterior.clave);
            if (ctx.chat.vision !== anterior.vision || ctx.chat.nCtx !== anterior.contexto) throw new Error("El modelo anterior no recuperó su ventana o visión previas");
          },
        });
        const nuevosAjustes = {
          enginePreset: cfg.enginePreset,
          coderContextTokens: cfg.contexto,
          historial: cfg.historial,
          engineKv: cfg.kv,
          engineVision: cfg.vision,
          pensar,
        };
        ctx.aplicarAjustesAlChat(ctx.guardarAjustes(nuevosAjustes));
        // Aquí es donde consta que el modelo nuevo contesta: se guarda la elección para
        // que el próximo arranque (start-ui.ps1, start-chat.ps1 o start-server.ps1) use
        // este y no el predeterminado del catálogo.
        try {
          guardarModeloActivo(item);
        } catch (err) {
          // El cambio ya funcionó: que falle el guardado no puede tumbarlo, pero se dice.
          const message = err instanceof Error ? err.message : String(err);
          ctx.chat.note(`aviso: no se pudo guardar la elección de modelo (${message})`);
          process.stderr.write(`[modelo] no se pudo guardar la elección: ${message}\n`);
        }
        ctx.chat.note(`modelo cargado: ${item.nombre} · ventana ${ctx.chat.nCtx}`);
        ctx.configuracionApagada = null;
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, cambiado: true, clave, nombre: item.nombre, nCtx: ctx.chat.nCtx, vision: Boolean(ctx.chat.vision), pensar: ctx.chat.thinkBudget }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end(`no se pudo cambiar de modelo: ${message}`);
      } finally {
        ctx.busy = false;
      }
      return true;
    }
    return false;
  };
}
