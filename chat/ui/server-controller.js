/* One lifecycle controller for the panel and Close IDE. No model-specific paths. */
window.BonsaiServerController = function ({ api, confirmar, avisar, dirtyCount, onChange = async () => {} }) {
  const $ = (id) => document.getElementById(id);
  const start = $("server-start"), stop = $("server-stop"), close = $("cerrar-bonsai");
  const preset = $("server-preset"), status = $("server-status"), terminal = $("server-terminal");
  let servidor = { state: "starting", ocupado: true }, operation = false, polling = false, closed = false, revision = 0;
  const labels = { empty: "IA detenida", starting: "Iniciando IA…", ready: "IA lista", stopping: "Deteniendo IA…", foreign: "Puerto de otro proceso", error: "Error del servidor" };

  function paint() {
    const running = ["ready", "starting", "stopping"].includes(servidor.state) || !!servidor.serverPid || !!servidor.wrapperPid;
    const blocked = operation || servidor.ocupado || ["starting", "stopping"].includes(servidor.state);
    if (start) { start.hidden = running; start.disabled = blocked || servidor.state === "foreign"; }
    if (stop) { stop.hidden = !running; stop.disabled = blocked || servidor.state === "foreign"; }
    if (close) close.disabled = blocked;
    if (preset) preset.disabled = blocked || running;
    if (status) {
      status.querySelector("span").textContent = labels[servidor.state] || servidor.state;
      status.querySelector(".dot")?.classList.toggle("rtx", servidor.state === "ready");
      status.title = servidor.lastError || servidor.error || `Puerto ${servidor.port || 8080}`;
    }
  }

  async function refresh() {
    if (polling || operation || closed || document.hidden) return;
    polling = true;
    const version = revision;
    try {
      const next = await api("/api/server/state");
      if (version === revision) servidor = next;
    } catch (err) {
      if (version === revision) servidor = { ...servidor, state: "error", ocupado: false, error: err.message };
    } finally { polling = false; if (!closed) paint(); }
  }

  async function control(action) {
    if (operation || closed) return;
    if (action === "close") {
      const dirty = dirtyCount();
      if (!await confirmar("Cerrar IDE e IA", dirty ? `Hay ${dirty} archivo(s) con cambios sin guardar. Se perderán al cerrar.` : "Se apagará la IA y se cerrará el servidor del IDE.", "Cerrar ambos")) return;
      if (operation) return;
    }
    revision++;
    operation = true;
    paint();
    try {
      let body = {};
      if (action === "start") {
        const models = await api("/api/modelos");
        body = { model: models.guardado || models.actual, preset: preset?.value || "AUTO", pensar: 4096 };
        if (body.preset === "CUSTOM") {
          const settings = await api("/api/settings");
          body = { ...body, contexto: settings.coderContextTokens, kv: settings.engineKv, vision: settings.engineVision };
        }
      }
      servidor = await api(`/api/server/${action}`, { cuerpo: body });
      if (action === "close") {
        closed = true;
        clearInterval(timer);
        document.body.innerHTML = "<main style='padding:2rem;font-family:sans-serif'>IDE e IA cerrados. Puedes cerrar esta pestaña.</main>";
        try { window.close(); } catch { /* The browser may require the user to close its tab. */ }
        return;
      }
      avisar(action === "start" ? "Servidor de IA listo" : "Servidor de IA detenido", "ok");
      await onChange();
    } catch (err) {
      servidor = { ...servidor, ocupado: false };
      avisar(`No se pudo completar la operación: ${err.message}`, "error", 10000);
    } finally {
      operation = false;
      if (!closed) { paint(); void refresh(); }
    }
  }

  async function copyCommand() {
    try {
      const models = await api("/api/modelos");
      const data = await api(`/api/server/command?preset=${encodeURIComponent(preset?.value || "AUTO")}&model=${encodeURIComponent(models.guardado || models.actual || "")}`);
      await navigator.clipboard.writeText(data.command);
      avisar("Comando copiado. Pégalo en PowerShell.", "ok");
    } catch (err) { avisar(`No se pudo copiar el comando: ${err.message}`, "error"); }
  }

  start?.addEventListener("click", () => void control("start"));
  stop?.addEventListener("click", () => void control("stop"));
  close?.addEventListener("click", () => void control("close"));
  terminal?.addEventListener("click", () => void copyCommand());
  preset?.addEventListener("change", () => { preset.title = `${preset.options[preset.selectedIndex]?.text || ""}\n${preset.value}`; });
  const timer = setInterval(() => void refresh(), 10000);
  document.addEventListener("visibilitychange", () => void refresh());
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
  void (async () => {
    try {
      const settings = await api("/api/settings");
      if (preset && [...preset.options].some((option) => option.value === settings.enginePreset)) preset.value = settings.enginePreset;
    } catch { /* State polling still reports connection errors. */ }
    await refresh();
  })();
  return { refresh, control, get state() { return servidor; }, get closed() { return closed; } };
};
