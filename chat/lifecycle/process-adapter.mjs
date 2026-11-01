import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { execFile, spawn } from "node:child_process";
import { LifecycleError } from "./managed-server.mjs";

function tcpOpen(port) { return new Promise((resolve, reject) => {
      const socket = net.connect({ host: "127.0.0.1", port });
      const finish = (v) => { socket.destroy(); resolve(v); };
      socket.setTimeout(1000, () => { socket.destroy(); reject(new Error(`No se pudo comprobar el puerto ${port}`)); });
      socket.once("connect", () => finish(true));
      socket.once("error", (err) => { if (err.code === "ECONNREFUSED") finish(false); else { socket.destroy(); reject(err); } });
    });
}

export function createProcessAdapter({ root: PROJECT, catalog: MODELO, getSettings: leerAjustes, isNamedEnginePreset, engineProfile, mmprojDisponible, presupuestoPensar, onThinking = () => {} }) {
  let output = "", launchOutput = "", lastPort = 8080;
  async function helper({ port, check = false, timeoutMs = 35000 }) {
    lastPort = port;
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(PROJECT, "scripts", "stop-managed-server.ps1"), "-Port", String(port), "-Json", "-TimeoutMs", String(timeoutMs)];
    if (check) args.push("-CheckOnly");
    else args.push("-AllowStarting");
    return new Promise((resolve, reject) => execFile("powershell.exe", args, { windowsHide: true, timeout: timeoutMs + 15000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      output = String(stdout || stderr || err?.message || "").trim().slice(-16000);
      let result;
      try { result = JSON.parse(String(stdout).trim().replace(/^\uFEFF/, "")); }
      catch { reject(new LifecycleError("El helper no devolvió JSON válido", { state: "error", port, lastOutput: output })); return; }
      if (err || result.ok === false) reject(new LifecycleError(result.error || err?.message || "Falló el helper", { ...result, lastOutput: output }, result.state === "foreign" ? 409 : 500));
      else resolve(result);
    }));
  }
  function launch({ model: clave, config: configuracion = null, port: puerto }) {
    lastPort = puerto;
    launchOutput = "";
    const logArranque = process.env.BONSAI_LOG_ARRANQUE || path.join(PROJECT, "logs", "arranque-modelo.log");
    const preset = configuracion ? configuracion.enginePreset || "" : leerAjustes().enginePreset || "";
    // Presets optimizados RTX 4060 -> lanzador dedicado con binario sm89.
    const item = MODELO.catalogo?.[clave];
    const optimizado = /^(8GB-VISION-MAX-Q8-100K|8GB-VISION-MAX-Q8|8GB-VISION-MAX-Q4|8GB-VISION-MAX-F16|8GB-VISION-DEFAULT-F16|8GB-VISION-ULTRA-F16|8GB-VISION-HIGH|8GB-VISION-BALANCED|8GB-VISION-SAFE|8GB-CODE-MAX|8GB-CODE-HIGH|8GB-CODE-BALANCED|8GB-CODE-FAST|8GB-RESEARCH|8GB-VISION-QUALITY|8GB-VISION-ULTRA|CUSTOM|AUTO)$/.test(preset) ||
      Boolean(item && item.fuente === "hub");
    const script = path.join(PROJECT, "scripts", optimizado ? "start-gpu-model-rtx4060-optimized.ps1" : "start-server.ps1");
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-ManagedByIDE", "-Json", "-Modelo", clave, "-Port", String(puerto)];
    try {
      fs.mkdirSync(path.dirname(logArranque), { recursive: true });
      args.push("-Log", logArranque);
    } catch {
      /* sin registro: se lanza igual */
    }
    if (preset && isNamedEnginePreset(preset) && item?.servidor?.tipo !== "moe-hibrido") {
      args.push("-EnginePreset", preset);
    } else if (preset === "CUSTOM" || preset === "AUTO") {
      // En MoE el lanzador aplica el plan del modelo; no se le pasa un preset
      // denso que sobreescriba contexto/KV.
      args.push("-EnginePreset", "CUSTOM");
    }
    const conVision = configuracion && typeof configuracion.vision === "boolean"
      ? configuracion.vision
      : (preset && isNamedEnginePreset(preset)) ? Boolean(engineProfile(preset).vision)
      : typeof leerAjustes().engineVision === "boolean" ? leerAjustes().engineVision
      : mmprojDisponible(clave);
    if (conVision) args.push("-Vision");
    else if (!optimizado) args.push("-SinVision");
    // Un MoE que cabe en RAM arranca mucho más rápido si las páginas ya están
    // en la page cache; el lanzador omite la precarga si el GGUF no cabe.
    if (item?.servidor?.tipo === "moe-hibrido") args.push("-Precargar");
    if (configuracion) {
      // Solo se pasan contexto/KV si vienen definidos; si no, manda el preset.
      if (configuracion.contexto !== undefined && configuracion.contexto !== null) args.push("-ContextSize", String(configuracion.contexto));
      if (optimizado && configuracion.contextoExplicito === true) args.push("-ContextoExplicito");
      if (configuracion.kv) args.push("-KVCacheType", configuracion.kv);
      if (configuracion.mmprojCPU === true) args.push("-MmprojCPU");
      if (configuracion.draftModel) args.push("-DraftModel", String(configuracion.draftModel));
      if (configuracion.draftTokens) args.push("-DraftTokens", String(configuracion.draftTokens));
      if ("dormir" in configuracion) args.push("-DormirSeg", String(configuracion.dormir));
      if (configuracion.hostIP) args.push("-HostIP", configuracion.hostIP);
    } else {
      const aj = leerAjustes();
      // En MoE manda el plan (32k por defecto): pasar la ventana global de 110k
      // dejaría casi toda la VRAM en KV y muy pocos expertos en la GPU.
      if (aj.coderContextTokens && item?.servidor?.tipo !== "moe-hibrido") args.push("-ContextSize", String(aj.coderContextTokens));
      if (preset === "CUSTOM") args.push("-KVCacheType", ["f16", "bf16", "q8_0", "q4_0"].includes(aj.engineKv) ? aj.engineKv : "f16");
    }
    // Siempre explícito: el razonamiento que pidió el usuario si ESE modelo lo admite, o 0.
    const pensar = configuracion ? configuracion.pensar : presupuestoPensar(clave, Number(leerAjustes().pensar));
    args.push("-Pensar", String(pensar));
    onThinking(pensar);
    const effort = String(configuracion?.pensarNivel || leerAjustes().engineEffort || "default");
    if (effort && effort !== "default") args.push("-PensarNivel", effort);
    // OJO: nada de `detached: true`. En Windows deja al hijo SIN consola y PowerShell
    // 5.1 sale con código 0 sin ejecutar ni una línea (costó media tarde averiguarlo:
    // el servidor nunca arrancaba y no había ni un mensaje de error). Con `windowsHide`
    // el hijo recibe una consola oculta y funciona; el proceso sigue vivo aunque el
    // ui-server muera, que es lo que hace falta.
    const hijo = spawn("powershell.exe", args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, cwd: PROJECT });
    let jsonBuffer = "";
    hijo.stdout.on("data", (chunk) => {
      launchOutput = (launchOutput + chunk).slice(-16000);
      jsonBuffer += chunk;
      let newline;
      while ((newline = jsonBuffer.indexOf("\n")) >= 0) {
        const line = jsonBuffer.slice(0, newline).trim().replace(/^\uFEFF/, "");
        jsonBuffer = jsonBuffer.slice(newline + 1);
        if (!line) continue;
        try {
          const result = JSON.parse(line);
          if (result.ok === false) hijo.errorArranque = new LifecycleError(result.error, { ...result, lastOutput: launchOutput });
          else if (result.state === "starting" && Number.isInteger(result.serverPid) && result.binId && result.exe) hijo.launchInfo = result;
          else throw new Error("Contrato JSON de arranque inválido");
        } catch (err) { hijo.errorArranque = new LifecycleError(`El lanzador no devolvió JSON válido: ${err.message}`, { port: puerto, state: "error", lastOutput: launchOutput }); }
      }
      if (jsonBuffer.length > 65536) hijo.errorArranque = new LifecycleError("Salida del lanzador demasiado larga", { state: "error", port: puerto });
    });
    hijo.stderr.on("data", (chunk) => { launchOutput = (launchOutput + chunk).slice(-16000); });
    hijo.on("error", (err) => { hijo.errorArranque = err; });
    hijo.unref();
    return hijo;
  }


  return {
    requiresLaunchAck: true,
    inspect: async (options) => {
      // Evaluation bundles omit launch scripts and never own the model process.
      const hasHelper = fs.existsSync(path.join(PROJECT, "scripts", "stop-managed-server.ps1"));
      const state = hasHelper ? await helper({ ...options, check: true }) : {
        ok: true, state: await tcpOpen(options.port) ? "foreign" : "empty", port: options.port, marker: null, managementAvailable: false,
      };
      if (state.state === "ready" || state.state === "foreign") {
        try {
          state.healthy = (await fetch(`http://127.0.0.1:${options.port}/health`, { signal: AbortSignal.timeout(1500) })).ok;
        } catch { state.healthy = false; }
        if (state.state === "ready" && !state.healthy) state.state = "starting";
      }
      return state;
    },
    stop: async (options) => {
      if (fs.existsSync(path.join(PROJECT, "scripts", "stop-managed-server.ps1"))) return helper(options);
      if (await tcpOpen(options.port)) throw new LifecycleError("El puerto pertenece a un proceso que esta interfaz no administra", { state: "foreign", port: options.port }, 409);
      const markerPath = path.join(PROJECT, "logs", `servidor-administrado-${options.port}.json`);
      if (fs.existsSync(markerPath)) throw new LifecycleError("Falta el adaptador para validar el marcador", { state: "error", port: options.port, markerPath });
      return { ok: true, state: "empty", stoppedPids: [], portClosed: true, markerRemoved: true };
    },
    launch,
    cancelLaunch: (child) => new Promise((resolve, reject) => {
      if (!child?.pid || child.exitCode !== null) { resolve(); return; }
      execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 10000 }, (err) => {
        if (err && child.exitCode === null) reject(err); else resolve();
      });
    }),
    lastOutput: () => {
      let tail = "";
      for (const file of ["arranque-modelo.log", `llama-server-${lastPort}.err.log`]) {
        try { const f = path.join(PROJECT, "logs", file); const fd = fs.openSync(f, "r"); try { const size = fs.fstatSync(fd).size; const bytes = Buffer.alloc(Math.min(4096, size)); fs.readSync(fd, bytes, 0, bytes.length, Math.max(0, size - bytes.length)); tail += bytes.toString("utf8"); } finally { fs.closeSync(fd); } } catch { }
      }
      return (output + "\n" + tail + "\n" + launchOutput).slice(-16000);
    },
    markerExists: async (port) => fs.existsSync(path.join(PROJECT, "logs", `servidor-administrado-${port}.json`)),
    isAlive: async (pid) => { try { process.kill(pid, 0); return true; } catch (err) { if (err.code === "ESRCH") return false; throw err; } },
    portOpen: tcpOpen,
    ready: async ({ port }) => { try { return (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } },
    vramFree: () => new Promise((resolve) => execFile("nvidia-smi", ["--query-gpu=memory.free", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      const n = Number.parseInt(String(stdout).trim(), 10);
      resolve(!err && Number.isFinite(n) ? n : null);
    })),
  };
}
