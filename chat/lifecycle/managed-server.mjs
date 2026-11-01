const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class LifecycleError extends Error {
  constructor(message, context = {}, status = 500) {
    super(message);
    this.name = "LifecycleError";
    this.context = context;
    this.state = context.state || "error";
    this.status = status;
  }
}

/** One mutex for all model mutations. Repeated stop calls share the pending stop. */
export function createManagedServer({ adapter, port = 8080, pollMs = 200, vramToleranceMiB = 256, log = (entry) => process.stderr.write(`[lifecycle] ${JSON.stringify(entry)}\n`) }) {
  let operation = null, pending = null, failure = null, closing = false, incompleteStop = null;
  let last = { state: "empty", port, marker: null };
  const context = (extra = {}) => ({ ...last, port, operation, lastOutput: adapter.lastOutput?.() || "", ...extra });
  const error = (err, extra = {}) => {
    if (err instanceof LifecycleError) { err.context = { ...context(), ...err.context, ...extra }; return err; }
    return new LifecycleError(err.message || String(err), context({ state: "error", ...extra }));
  };

  async function inspect() {
    try {
      if (operation) return { ...last, state: operation === "stop" || operation === "close" ? "stopping" : "starting", operation };
      last = { ...await adapter.inspect({ port }), port };
      return { ...last, actualState: last.state, vramFreeMiB: await adapter.vramFree(), state: operation === "stop" || operation === "close" ? "stopping" : operation ? "starting" : failure && last.state !== "foreign" ? "error" : last.state,
        operation, ...(failure ? { lastError: failure.message } : {}) };
    } catch (err) { throw error(err); }
  }

  function exclusive(name, fn) {
    if (operation || closing) {
      if (name === "stop" && operation === "stop") return pending;
      return Promise.reject(new LifecycleError("Hay una operación de servidor en curso", context(), 409));
    }
    operation = name;
    failure = null;
    log({ event: "begin", operation, port });
    pending = Promise.resolve().then(fn).catch((err) => {
      failure = error(err);
      log({ event: "error", message: failure.message, ...failure.context });
      throw failure;
    }).finally(() => { log({ event: "end", operation, port }); operation = null; pending = null; });
    return pending;
  }

  async function stopInternal({ timeoutMs = 35000, verifyVram = true, vramThresholdMiB, onBeforeStop } = {}) {
    const deadline = Date.now() + timeoutMs;
    const actual = { ...await adapter.inspect({ port }), port };
    const before = incompleteStop && actual.state === "empty" ? incompleteStop : actual;
    last = before;
    if (before.state === "foreign") throw new LifecycleError("El puerto pertenece a un proceso que esta interfaz no administra", context({ state: "foreign" }), 409);
    await onBeforeStop?.(before);
    const telemetryAvailable = before.vramTelemetryAvailable || (verifyVram && await adapter.vramFree() !== null);
    before.vramTelemetryAvailable = telemetryAvailable;
    incompleteStop = before;
    const threshold = vramThresholdMiB ?? (Number(before.marker?.vramBeforeMiB) > 0 ? before.marker.vramBeforeMiB - vramToleranceMiB : 6500);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new LifecycleError("Se agotó el plazo antes de detener el modelo", context({ ...before, state: "error" }));
    const result = await adapter.stop({ port, timeoutMs: remaining });
    const pids = [...new Set([before.serverPid, before.wrapperPid, ...(result.stoppedPids || [])].filter((p) => Number.isInteger(p) && p > 0))];
    let vramFreeMiB = null, alive = [], portClosed = false, markerRemoved = false;
    do {
      alive = [];
      for (const pid of pids) if (await adapter.isAlive(pid)) alive.push(pid);
      portClosed = !await adapter.portOpen(port);
      markerRemoved = !await adapter.markerExists(port);
      vramFreeMiB = verifyVram ? await adapter.vramFree() : null;
      // An already empty server needs no GPU allocation released. Missing telemetry is explicit.
      const vramReleased = !verifyVram || before.state === "empty" ||
        (vramFreeMiB === null ? !telemetryAvailable : vramFreeMiB >= threshold);
      if (!alive.length && portClosed && markerRemoved && vramReleased) {
        incompleteStop = null;
        last = { state: "empty", port, marker: null };
        return { ok: true, ...last, stoppedPids: pids, portClosed, markerRemoved, vramFreeMiB,
          vramVerified: verifyVram && vramFreeMiB !== null && before.state !== "empty", vramThresholdMiB: threshold };
      }
      await wait(pollMs);
    } while (Date.now() < deadline);
    throw new LifecycleError(`No se confirmó la parada: PID(s) ${alive.join(",") || "ninguno"}; puerto cerrado=${portClosed}; marcador borrado=${markerRemoved}; VRAM libre=${vramFreeMiB} MiB (umbral ${threshold})`,
      context({ ...before, state: "error", alive, portClosed, markerRemoved, vramFreeMiB, vramThresholdMiB: threshold }));
  }

  async function startInternal(options = {}) {
    const before = await adapter.inspect({ port });
    last = { ...before, port };
    if (before.state !== "empty") throw new LifecycleError("El servidor debe estar vacío antes de arrancar", context(), 409);
    if (before.marker) await stopInternal({ verifyVram: false }); // remove a stale marker
    let child;
    try {
      child = await adapter.launch({ ...options, port });
      const deadline = Date.now() + (options.timeoutMs ?? 240000);
      do {
        if (child?.errorArranque) throw child.errorArranque;
        if (child && child.exitCode !== null) throw new Error(`El lanzador terminó con código ${child.exitCode}`);
        if ((!adapter.requiresLaunchAck || child?.launchInfo) && await adapter.ready({ port })) {
          last = { ...await adapter.inspect({ port }), port };
          if (last.state !== "ready" || !last.serverPid) throw new Error("El listener no coincide con un marcador administrado listo");
          if (child?.launchInfo && child.launchInfo.serverPid !== last.serverPid) throw new Error("El PID listo no coincide con el del lanzador");
          await options.onReady?.();
          return { ok: true, ...last, pid: last.serverPid, model: last.marker?.modelo || options.model };
        }
        await wait(Math.max(100, pollMs));
      } while (Date.now() < deadline);
      throw new Error("El modelo no arrancó dentro del plazo");
    } catch (err) {
      let cleanupError;
      const failedState = { ...last, ...child?.launchInfo };
      try {
        const launched = await adapter.inspect({ port });
        if (launched.serverPid || launched.wrapperPid) incompleteStop = launched;
        // Also cancels preflight/precaching before the launch marker exists.
        await adapter.cancelLaunch?.(child);
        await stopInternal();
      } catch (cleanup) { cleanupError = cleanup.message; }
      throw error(err, { ...failedState, state: "error", cleanupError, lastOutput: adapter.lastOutput?.() || "" });
    }
  }

  async function restartInternal(options = {}) {
    const before = await adapter.inspect({ port });
    const previous = options.previous || configurationFromMarker(before.marker);
    await stopInternal(options);
    await options.onStopped?.();
    try { return await startInternal(options); }
    catch (err) {
      if (options.rollback !== false && previous?.model) {
        try {
          await startInternal({ model: previous.model, config: previous.config, onReady: options.onRestore || options.onReady });
          err.context = { ...err.context, restored: true };
        } catch (restore) { err.context = { ...err.context, restored: false, restoreError: restore.message }; }
      }
      throw err;
    }
  }

  return {
    inspect,
    get busy() { return !!operation || closing; },
    start: (options) => exclusive("start", () => startInternal(options)),
    stop: (options) => exclusive("stop", () => stopInternal(options)),
    restart: (options) => exclusive("restart", () => restartInternal(options)),
    closeIde: (options = {}) => exclusive("close", async () => {
      const result = await stopInternal(options);
      // shutdown can defer HTTP teardown until the close response is flushed.
      if (options.shutdown) await options.shutdown();
      else if (options.server) await closeHttpServer(options.server, { timeoutMs: options.httpTimeoutMs ?? 3000 });
      closing = true;
      return { ...result, ideClosing: true };
    }),
  };
}

export function configurationFromMarker(m) {
  if (!m?.modelo || !Number.isInteger(m.contexto) || m.contexto < 4096 ||
      !["f16", "bf16", "q8_0", "q4_0"].includes(m.kv) || typeof m.vision !== "boolean" ||
      !Number.isInteger(m.pensar) || m.pensar < 0 || m.pensar > 65536 ||
      !Number.isInteger(m.dormir) || m.dormir < 0 || m.dormir > 86400 || !["127.0.0.1", "localhost", "::1"].includes(m.hostIP)) return null;
  return { model: m.modelo, config: { contexto: m.contexto, contextoExplicito: true, kv: m.kv, vision: m.vision,
    mmprojCPU: m.mmprojCPU === true, pensar: m.pensar, dormir: m.dormir, hostIP: m.hostIP, enginePreset: m.enginePreset || "" } };
}

/** Stop accepting sockets, then destroy SSE/keep-alive. Deadline also covers upgraded sockets. */
export function closeHttpServer(server, { timeoutMs = 3000, exit } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`El servidor HTTP no cerró en ${timeoutMs} ms`);
      if (exit) exit(1);
      reject(err);
    }, timeoutMs);
    server.close((err) => {
      clearTimeout(timer);
      if (err) { if (exit) exit(1); reject(err); return; }
      resolve();
      if (exit) exit(0);
    });
    server.closeAllConnections();
  });
}
