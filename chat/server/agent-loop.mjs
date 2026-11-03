/**
 * Bucle del agente del endpoint /api/chat. Recibe estado y helpers por contexto;
 * no lee globales de ui-server. Los efectos de cada tool call siguen siendo los
 * mismos que antes para no cambiar el comportamiento del producto.
 */
import { readBody } from "./http.mjs";
import { stripFakeToolText } from "../actions.mjs";
import { perfilAgente } from "../modelo.mjs";
import { readGpu, resetGpuCache } from "./gpu.mjs";
import { candidatosDeMemoria } from "../memoria-global.mjs";
import { anunciaAccion, hiddenTurn, pideBusquedaExterna, resumenDeAcciones } from "./text.mjs";
import { parseChatRequest } from "./agent/request.mjs";
import { createAgentHelpers } from "./agent/helpers.mjs";
import { createPromptBuilder } from "./agent/prompt.mjs";
import { present as presentTurn } from "./agent/present.mjs";
import { createVerifyCoder } from "./agent/verify.mjs";
import { createSseSession } from "./agent/sse-session.mjs";

/** @param {Record<string, any>} ctx */
export function createAgentLoop(ctx) {
  const helpers = createAgentHelpers(ctx);
  const promptBuilder = createPromptBuilder(ctx, helpers);

async function agentLoop(req, res) {
        const raw = JSON.parse(await readBody(req));
        const parsed = parseChatRequest(raw, { getSettings: ctx.leerAjustes });
        if (!parsed.ok) {
          res.writeHead(parsed.status).end(parsed.message);
          return;
        }
        const { text, attached, snippets, imagenes, consulta, soloCharla, aclaraPrimero } = parsed;
        // El turno se reclama DESPUÉS de leer el cuerpo y sin ningún await por medio:
        // así dos peticiones no pueden colarse, y desde aquí hasta el finally no hay
        // ninguna salida que pueda dejar `busy` atascado (el bug del zombi: una
        // petición que moría en res.writeHead dejaba el servidor en "turno en curso").
        if (ctx.busy) {
          res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" }).end("ya hay un turno en curso");
          return;
        }
        ctx.busy = true;
        // Empieza un turno nuevo: los puntos de deshacer del agente se apuntan aquí
        // para poder revertir de golpe todo lo que escriba.
        ctx.undoDelTurno = [];
        // Los procesos en segundo plano viven en ctx.procesosFondoVivos y
        // sobreviven al turno a propósito; no hay una lista local que matar.
        const session = createSseSession({ req, res, ctx });
        const ac = session.ac;
        const send = session.send;
        let coderTimer = null;
        let motivoParada = "completed";
        let saltosUsados = 0;
        /** Estado del turno que comparten el bucle y la ejecución de herramientas. */
        let turn = null;
        ctx.chat.coderTask = null;
        try {
          if(imagenes.length&&ctx.chat.vision){
            resetGpuCache();
            const gpu=await readGpu(), transientMiB=64;
            // La validación local midió 46 MiB transitorios por imagen; no se añade
            // una reserva fija de 400 MiB al modelo ya cargado.
            if(gpu.ok && gpu.vramFreeMiB != null && gpu.vramFreeMiB<transientMiB){
              session.finished = true;
              res.writeHead(409,{"Content-Type":"text/plain; charset=utf-8"}).end(`No se puede verificar el margen transitorio de imagen (${transientMiB} MiB); libera VRAM o selecciona un contexto menor.`);
              return;
            }
            if (!gpu.ok || gpu.vramFreeMiB == null) process.stderr.write("[visión] No se pudo medir la VRAM antes de enviar la imagen.\n");
          }
          session.start();
          const { prompt, coderTimer: timerCoder, imagenesData } = await promptBuilder.buildTurnPrompt({
            text, attached, snippets, imagenes, soloCharla, send,
            signal: ac.signal,
            abort: (error) => ac.abort(error),
          });
          coderTimer = timerCoder;
          // Los ids de acción empezaban en "a1" en CADA turno: la interfaz reutilizaba
          // la tarjeta del turno anterior y el nuevo diff se pintaba encima. Con el
          // prefijo del turno, cada tarjeta es única dentro de la conversación.
          const idTurno = `t${(ctx.turno += 1)}`;
          // Pedidos de información externa/actual: un solo empujón si el modelo
          // intenta responder de memoria sin llamar a buscar/leer_web.
          const busquedaExternaPedida = pideBusquedaExterna(text);
          // Cuántos saltos dar y cuántos avisos mandar antes de rendirse lo dice el MODELO
          // cargado (chat\modelo.json → catalogo.<clave>.agente), no una constante igual
          // para todos: bolding_v1 necesita más margen que override6 y se rinde antes.
          const agente = perfilAgente(ctx.modeloActualClave());
          /**
           * Resultados del último present() (UNO por tool call nativa, con el id de SU
           * llamada) que todavía no se le han mandado al modelo. Antes viajaba un solo
           * mensaje con todo y el id de la primera llamada: la segunda quedaba sin respuesta.
           * @type {Array<{toolCallId: string, content: string}> | null}
           */
          /** ¿Falló algo en el último paso? El salto siguiente razona (si está encendido). */
          /** Motivo real por el que termina el turno (viaja en el evento `done`). */
          /** ¿El último paso produjo información o acciones nuevas? (detección de atasco) */
          /** Caché de lecturas del turno: clave → {version, texto}. Permite releer sin bloquear. */
          /** @type {Map<string, {version: string, texto: string}>} */
          // Releer o volver a capturar lo mismo no convierte una tanda en progreso.
          // No bloquea la herramienta: la evidencia sigue llegando al modelo.
          /** Tipo de acción del último paso ("read" | "write" | "cmd" | …), para la fase. */
          /**
           * @typedef {{id: string, kind: string, title: string, state: string, detail: string, code?: number, undo?: string, sinCambios?: boolean}} ActionRow
           */
          /**
           * @param {ActionRow} row
           */
          turn = {
            ctx, ac, text, idTurno, send, agente,
            step: 0,
            nudges: 0,
            navegador: null,
            playwrightMcp: null,
            cacheLecturas: new Map(),
            evidenciasVistas: new Set(),
            busquedaExternaPedida,
            busquedaIntentada: false,
            avisoBusquedaDado: false,
            xmlTold: false,
            ultimoFallo: false,
            resultadosPendientes: null,
            progresoPaso: false,
            accionPaso: "",
            verifyCoder: null,
          };
          turn.verifyCoder = createVerifyCoder({ ctx, ac, idTurno, send, nextStep: () => ++turn.step });
          /** @type {{texto: string, resultados: Array<{toolCallId: string, content: string}> | null}} */
          let siguiente = { texto: prompt, resultados: null };
          /**
           * Manda al modelo lo que toca (resultados como role "tool" y/o texto) y genera.
           * @param {{texto: string, resultados: Array<{toolCallId: string, content: string}> | null}} paso
           * @param {string[]} [imagenes]
           */
          const enviar = async (paso, imagenes = []) => {
            turn.resultadosPendientes = null;
            ctx.chat.entornoAgente = { root: ctx.workspaceRoot, permiso: ctx.permitMode, timeoutMs: ctx.comandoTimeoutMs };
            await ctx.chat.runTurn(paso.texto, ac.signal, [...imagenes, ...(paso.imagenes || [])], paso.resultados ? { resultados: paso.resultados } : {});
          };
          // Pregunta de conversación pura («explica qué es…», sin archivos ni nada que hacer):
          // un solo salto SIN herramientas (tool_choice "none": siguen definidas, así que el
          // prompt y la caché no cambian). El modelo abliterado creaba y ejecutaba archivos
          // para explicar una closure (tarea solo-chat del evaluador, corridas 2 y 6).
          if (soloCharla) {
            ctx.chat.faseSalto = "charla";
            ctx.chat.consultation = true;
            ctx.chat.toolChoice = "none";
            ctx.chat.pensarEsteSalto = true;
            try {
              await enviar(siguiente, imagenesData);
            } finally {
              ctx.chat.consultation = false;
              ctx.chat.toolChoice = "auto";
            }
            const respuesta = ctx.chat.session.turns[ctx.chat.session.turns.length - 1];
            if (respuesta?.role === "assistant") {
              // Con tool_choice "none" puede escribir igualmente una llamada como XML: se quita.
              const limpio = stripFakeToolText(String(respuesta.content || "")).trim() || "No tengo una respuesta para eso.";
              respuesta.content = limpio;
              respuesta.shown = limpio;
              delete respuesta.toolCalls;
              ctx.chat.saveSession();
              send({ type: "replace", text: limpio });
            }
          }
          // Tandas de saltos: el límite POR TANDA deja margen para tareas que necesitan más
          // pasos (leer 6+ archivos, corregir, probar). Se encadenan tandas MIENTRAS el
          // trabajo avance; si una tanda entera no produce nada nuevo se declara atasco en
          // vez de fingir que terminó. El tope global sigue existiendo (contra bucles).
          const saltosTanda = Math.max(8, agente.saltos);
          const saltosMaximos = ctx.chat.coderTask ? Math.min(ctx.chat.coderTask.config.maxSteps,ctx.saltosTope) : Math.max(saltosTanda, Math.min(agente.saltos * 8, ctx.saltosTope));
          // Procesos del agente en segundo plano: viven fuera del turno (no se matan al cerrarlo).
          // Se listan y se paran desde el panel Terminal o con `proceso` del propio agente.
          let pasosSinEvidencia = 0;
          // Tras una verificación correcta y sin escrituras nuevas, el agente debe cerrar.
          // Antes podía encadenar lecturas/búsquedas en VERIFY durante minutos (una traza
          // real llegó a ~70 peticiones y 8 verificaciones correctas). Se toleran unas
          // pocas consultas de evidencia y después se fuerza el resumen final.
          let pasosTrasVerificacion = 0;
          const PASOS_MAX_TRAS_VERIFICAR = 3;
          /** @type {{texto: string, resultados: Array<{toolCallId: string, content: string}> | null} | null} */
          let pendienteCierre = null;
          try {
            while (!soloCharla && saltosUsados < saltosMaximos) {
              let progresoTanda = false;
              const finTanda = Math.min(saltosUsados + saltosTanda, saltosMaximos);
              while (saltosUsados < finTanda) {
                // Razonar (si está encendido y el modelo lo admite) al planificar y cuando algo
                // acaba de fallar; en los saltos rutinarios, no: costaba ~75 s por salto.
                // Fase para la reserva de salida adaptativa (la calcula el chat). Tras leer,
                // el siguiente paso suele actuar; se usa la reserva de PLAN (mantiene ~3k tokens
                // de salida y NO desplaza la evidencia leída a la mitad, que era el fallo 16).
                // Tras escribir/ejecutar lo normal es volver a leer: reserva de lectura.
                ctx.chat.faseSalto = saltosUsados === 0 || turn.accionPaso === "read" ? "plan" : "lectura";
                // Primer turno de un pedido de plan/preguntas: sin herramientas.
                ctx.chat.toolChoice = aclaraPrimero && saltosUsados === 0 ? "none" : "auto";
                ctx.chat.pensarEsteSalto = ctx.chat.thinkBudget < 0 || saltosUsados === 0 || turn.ultimoFallo;
                // Las imágenes solo viajan en el primer salto del turno.
                await enviar(siguiente, saltosUsados === 0 ? imagenesData : []);
                ctx.chat.toolChoice = "auto";
                saltosUsados += 1;
                const current = ctx.chat.session.turns[ctx.chat.session.turns.length - 1];
                if (current?.role !== "assistant") {
                  pendienteCierre = null;
                  break;
                }
                const next = await presentTurn(turn, current, true);
                if (ctx.chat.coderTask?.stopped) motivoParada = ctx.chat.coderTask.stopped;
                if (turn.progresoPaso) progresoTanda = true;
                pasosSinEvidencia = turn.progresoPaso ? 0 : pasosSinEvidencia + 1;
                if (!next) {
                  pendienteCierre = null;
                  break;
                }
                siguiente = next;
                pendienteCierre = next;
                const coderAhora = ctx.chat.coderTask;
                const verificadoSinCambios = Boolean(coderAhora
                  && coderAhora.state.phase === "VERIFY"
                  && !coderAhora.state.errors.length
                  && !turn.ultimoFallo && !current.cortadas?.length
                  && coderAhora.lastVerified
                  && coderAhora.lastVerified === coderAhora.revision());
                pasosTrasVerificacion = verificadoSinCambios && turn.accionPaso !== "write" ? pasosTrasVerificacion + 1 : 0;
                if (pasosTrasVerificacion > PASOS_MAX_TRAS_VERIFICAR) {
                  const verification = await turn.verifyCoder(coderAhora, true, current.actions ||= []);
                  coderAhora.state.actions = current.actions.map(a => ({ kind: a.kind, title: a.title, state: a.state, code: a.code }));
                  ctx.chat.session.taskState = coderAhora.state;
                  ctx.chat.saveSession();
                  if (verification.ok) {
                    coderAhora.state.phase = "DONE";
                    coderAhora.trace("done", { tests: coderAhora.state.tests });
                    motivoParada = "verified";
                    pendienteCierre = null;
                    break;
                  }
                  if (coderAhora.stopped) { motivoParada = coderAhora.stopped; pendienteCierre = null; break; }
                  siguiente = { ...next, texto: `Sigue con lo que pedí. La verificación final falló; corrige el fallo antes de terminar:\n${verification.summary}` };
                  pendienteCierre = siguiente;
                  turn.ultimoFallo = true;
                  pasosTrasVerificacion = 0;
                }
                if (pasosSinEvidencia >= 8) { motivoParada = "stalled"; break; }
              }
              if (!pendienteCierre) break;
              if (motivoParada === "stalled") break;
              if (!progresoTanda) {
                motivoParada = "stalled";
                break;
              }
              if (saltosUsados >= saltosMaximos) {
                motivoParada = "step_limit";
                break;
              }
              // Quedan acciones pendientes y la tanda avanzó: seguir con otra tanda.
            }
            // Pending tool results go through the single final-summary path below.
            // A step/stall limit must not run one more generation with tools enabled.
          } finally {
            ctx.chat.pensarEsteSalto = true;
          }
          // Si terminó sin llamada y la última prosa solo ANUNCIA una acción futura, no se
          // puede presentar como trabajo terminado: se marca como atasco y se avisa.
          if (motivoParada === "completed" && !soloCharla && ctx.chat.coderTask?.state.phase !== "DONE") {
            const ultimo = ctx.chat.session.turns[ctx.chat.session.turns.length - 1];
            const dicho = String(ultimo?.content || "").trim();
            const anuncia = anunciaAccion(dicho);
            if (anuncia) motivoParada = "stalled";
          }
          // Si la última intervención quedó sin texto, o el turno paró por límite/atasco, se
          // le pide cerrar con un resumen HONESTO. Las herramientas siguen definidas con
          // tool_choice "none": el prompt no cambia y la caché sirve. Los resultados que
          // quedaron sin mandar van delante: ninguna llamada se queda sin respuesta.
          const motivoTexto = motivoParada === "step_limit"
            ? `Se alcanzó el límite de ${saltosUsados} pasos y la tarea puede quedar incompleta.`
            : motivoParada === "stalled"
              ? "El turno se atascó: los últimos pasos no produjeron progreso y puede quedar trabajo pendiente."
              : motivoParada === "verified"
                ? "La verificación automática pasó y no hubo cambios nuevos; no hace falta seguir consultando archivos."
                : "";
          const lastTurn = ctx.chat.session.turns[ctx.chat.session.turns.length - 1];
          const lastAssistant = [...ctx.chat.session.turns].reverse().find((t) => t.role === "assistant");
          // Solo se fuerza un turno de cierre si NO hay una respuesta útil. Antes
          // también se lanzaba cuando el motivo era `stalled`/`step_limit` aunque el
          // modelo ya hubiera respondido: el resumen sustituía la respuesta buena y
          // el usuario no podía contestar a sus preguntas. Un anuncio corto ("voy a
          // leer…") tampoco es una respuesta final y sí se cierra.
          const ultimoTexto = String(lastAssistant?.content || "").trim();
          const esAnuncio = anunciaAccion(ultimoTexto);
          if (!ac.signal.aborted && (!ultimoTexto || esAnuncio)) {
            ctx.chat.faseSalto = "final";
            ctx.chat.toolChoice = "none";
            // El cierre también razona si el modelo lo tiene activado. GPT-OSS, sin
            // canal de análisis, volcaba todo su monólogo interno en `content` y la
            // respuesta final era un "We need to..." en inglés.
            ctx.chat.pensarEsteSalto = ctx.chat.thinkBudget > 0;
            try {
              await enviar({
                // El prefijo «Sigue con lo que pedí» es el que `turnoInterno` reconoce:
                // así este mensaje interno no se pinta como si lo hubiera escrito el
                // usuario ni se toma como «el pedido» al resumir el cierre.
                texto: `Sigue con lo que pedí. Cierra el turno. ${motivoTexto ? `${motivoTexto} ` : ""}Ya no hagas más acciones: responde al usuario con un resumen breve de lo que hiciste y del resultado. Si algo sigue fallando, no lo comprobaste o no lo terminaste, dilo claramente y explica qué falta; no lo des por terminado ni prometas acciones futuras. `,
                resultados: Array.isArray(lastTurn.toolCalls) && lastTurn.toolCalls.length ? turn.resultadosPendientes : null,
              });
            } finally {
              ctx.chat.toolChoice = "auto";
              ctx.chat.pensarEsteSalto = true;
            }
            // Con tool_choice "none" el servidor no parsea llamadas, pero el modelo (entrenado
            // a responder en XML) a veces escribe igualmente un <tool_call> como texto. Esa
            // respuesta no pasa por present(), así que se guardaba y se le enseñaba al usuario
            // tal cual. Se limpia aquí; si no queda nada, se cierra con lo que sí se hizo.
            // Cierra con el último assistant, no con el último mensaje (puede ser
            // un resultado de tool). Así nunca queda una respuesta vacía.
            const cierre = [...ctx.chat.session.turns].reverse().find((t) => t.role === "assistant");
            if (!ac.signal.aborted && cierre) {
              const bruto = String(cierre.content || "");
              const limpio = stripFakeToolText(bruto).trim();
              const texto = limpio || resumenDeAcciones(ctx.chat.session.turns);
              if (texto !== bruto || cierre.toolCalls) {
                cierre.content = texto;
                cierre.shown = texto;
                delete cierre.toolCalls;
                ctx.chat.saveSession();
                send({ type: "replace", text: texto });
              }
            }
          }
          // Aviso honesto: si el ÚLTIMO comando de este pedido falló y la respuesta final no lo
          // dice, se añade. Medido en la corrida 5 (node-esm): los tests seguían en rojo y el
          // modelo cerró con «He creado… con 10 tests» como si todo funcionara.
          const final = ctx.chat.session.turns[ctx.chat.session.turns.length - 1];
          if (!ac.signal.aborted && final?.role === "assistant") {
            let desde = 0;
            for (let i = ctx.chat.session.turns.length - 1; i >= 0; i -= 1) {
              if (ctx.chat.session.turns[i].role === "user" && !hiddenTurn(ctx.chat.session.turns[i])) {
                desde = i;
                break;
              }
            }
            const ultimoCmd = ctx.chat.session.turns.slice(desde).flatMap((turn) => turn.actions || []).filter((a) => a.kind === "cmd" && a.state === "done" && typeof a.code === "number").pop();
            const dicho = String(final.content || "");
            if (ultimoCmd && ultimoCmd.code !== 0 && !/fall|error|no pas|no funciona|no se pudo|pendiente|código\s*[1-9]|rojo/i.test(dicho)) {
              const titulo = String(ultimoCmd.title || "").split("\n")[0].slice(0, 80);
              const texto = `${dicho.trim()}\n\n> ⚠️ Ojo: el último comando (\`${titulo}\`) terminó con código ${ultimoCmd.code}, así que no está comprobado que funcione.`.trim();
              final.content = texto;
              final.shown = texto;
              ctx.chat.saveSession();
              send({ type: "replace", text: texto });
            }
          }
          // Y si el turno paró por límite o atasco, la respuesta final lo dice SIEMPRE (no
          // puede quedar como una promesa de acción futura ni como una finalización limpia).
          if (!ac.signal.aborted && (motivoParada === "step_limit" || motivoParada === "stalled") && final?.role === "assistant") {
            const dicho = String(final.content || "");
            if (!dicho.includes("⚠️")) {
              const marca = motivoParada === "step_limit" ? `límite de ${saltosUsados} pasos` : "falta de progreso";
              const texto = `${dicho.trim()}\n\n> ⚠️ El turno se detuvo por ${marca}: el trabajo puede estar incompleto.`.trim();
              final.content = texto;
              final.shown = texto;
              ctx.chat.saveSession();
              send({ type: "replace", text: texto });
            }
          }
          // El motivo real de la parada viaja a la interfaz: antes un `done` sin más no
          // distinguía una tarea terminada de una que se quedó sin pasos.
          if (ac.signal.aborted) motivoParada = "cancelled";
          const completo = !ac.signal.aborted && (motivoParada === "completed" || motivoParada === "verified");
          ctx.chat.session.lastStop = { motivo: motivoParada, saltos: saltosUsados, completo, ts: Date.now() };
          if (ctx.chat.coderTask) { ctx.chat.session.taskState = ctx.chat.coderTask.state; ctx.chat.saveSession(); }
          // Captura conservadora para la memoria global: solo frases del pedido con
          // señales de preferencia/decisión duradera y solo en turnos completos.
          // Un fallo aquí no puede tumbar el turno ni el guardado de la conversación.
          try {
            const ajustesMemoria = ctx.leerAjustes();
            if (completo && !ac.signal.aborted && ajustesMemoria.memoriaGlobal !== false && ajustesMemoria.memoriaGlobalAuto !== false) {
              const nuevas = [];
              for (const candidato of candidatosDeMemoria(text, { limite: 2 })) {
                try {
                  const entrada = ctx.memoriaGlobal.agregar(candidato, {
                    origen: { tipo: "auto", chatId: ctx.historial.readIndex().active, turno: ctx.chat.session.turns.length },
                  });
                  if (!entrada.duplicada) nuevas.push(entrada);
                } catch (err) {
                  process.stderr.write(`[memoria-global] no se guardó una nota automática: ${err instanceof Error ? err.message : String(err)}\n`);
                }
              }
              if (nuevas.length) {
                send({ type: "memory", agregadas: nuevas.map((entrada) => ({ id: entrada.id, texto: entrada.texto })) });
                ctx.chat.note(`memoria global: ${nuevas.length} nota(s) nueva(s); revísalas o bórralas en Ajustes`);
              }
            }
          } catch (err) {
            process.stderr.write(`[memoria-global] captura automática omitida: ${err instanceof Error ? err.message : String(err)}\n`);
          }
          send({ type: "done", motivo: motivoParada, saltos: saltosUsados, incompleto: !completo });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          motivoParada = ac.signal.aborted ? "cancelled" : "error";
          if (ctx.chat.coderTask) ctx.chat.session.taskState = ctx.chat.coderTask.state;
          ctx.chat.session.lastStop = {motivo:motivoParada,saltos:saltosUsados,completo:false,ts:Date.now()};
          let falloGuardado = "";
          try { ctx.chat.saveSession(); } catch (saveErr) { falloGuardado = ` No se pudo guardar el estado: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}.`; }
          const oom = /out of memory|cuda.*(?:memory|alloc)|cuda_error_out_of_memory|cublas_status_alloc_failed/i.test(message);
          send({ type: "error", text: `${message}${oom ? " Posible falta de memoria de GPU. La tarea queda incompleta; revisa el estado antes de reanudar y no repitas operaciones inciertas." : ""}${falloGuardado}` });
          if (!res.writableEnded) send({ type: "done", motivo: motivoParada, saltos: saltosUsados, incompleto: true });
        } finally {
          session.finished = true;
          session.stopHeartbeat();
          if (coderTimer) clearTimeout(coderTimer);
          ctx.chat.coderTask?.dispose();
          ctx.chat.coderTask = null;
          ctx.chat.turnImages = null;
          ctx.chat.pendingImageTokens = 0;
          // La memoria global es por turno: no queda pegada al siguiente si este no
          // la selecciona. Los ids se conservan hasta que el diagnóstico se lea.
          ctx.chat.globalMemory = "";
          ctx.chat.globalMemoryIds = [];
          ctx.chat.globalMemoryBudget = 0;
          await turn?.navegador?.close().catch(() => {});
          await turn?.playwrightMcp?.close().catch(() => {});
          ctx.busy = false;
          session.finish();
        }
        return;
      }

  return agentLoop;
}
