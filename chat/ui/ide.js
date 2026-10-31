/**
 * Extensiones de la interfaz de Bonsai (se carga después del script principal de index.html).
 * Cada bloque es independiente y solo depende de las funciones globales de index.html que usa.
 */
(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  /**
   * @param {string} tag
   * @param {string} [cls]
   * @param {string} [text]
   * @returns {HTMLElement}
   */
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const fmtGb = (mib) => (mib / 1024).toFixed(1);

  // ------------------------------------------------------------------ medidor de hardware
  (function hardware() {
    const bar = $(".statusbar");
    if (!bar) return;
    bar.querySelectorAll(".pill").forEach((pill) => pill.remove());

    const hud = el("div", "hud");
    hud.id = "hud";
    hud.title = "Clic: detalle del hardware";
    hud.style.cursor = "pointer";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "spark");
    svg.setAttribute("viewBox", "0 0 60 14");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.innerHTML = '<line class="base" x1="0" y1="13.5" x2="60" y2="13.5"></line><polyline points=""></polyline>';
    const cGpu = el("span", "cell");
    const gpuLabel = el("span", "", "GPU");
    const gpuVal = el("b", "", "—");
    cGpu.append(gpuLabel, gpuVal, svg);
    const cVram = el("span", "cell");
    const vramBar = el("span", "hud-bar");
    vramBar.append(el("i"));
    const vramVal = el("b", "", "—");
    const vramFree = el("b", "vram-free", "— MiB libres");
    vramFree.id="vram-free";
    cVram.append(el("span", "", "VRAM"), vramBar, vramVal, vramFree);
    const cTemp = el("span", "cell");
    const tempVal = el("b", "", "—");
    cTemp.append(tempVal);
    const cPow = el("span", "cell");
    const powVal = el("b", "", "—");
    cPow.append(powVal);
    const cTps = el("span", "cell");
    const tpsVal = el("b", "", "—");
    cTps.append(tpsVal);
    const cRam = el("span", "cell");
    const ramVal = el("b", "", "—");
    cRam.append(el("span", "", "RAM"), ramVal);
    hud.append(cGpu, cVram, cTemp, cPow, cTps, cRam);
    bar.prepend(hud);

    // El IDE se abre sin GPU (scripts/open-ide.ps1 añade ?uicpu=1): se dice en la barra.
    try {
      if (new URLSearchParams(location.search).get("uicpu") === "1") {
        const cpu = el("span", "pill");
        cpu.id = "ui-cpu-chip";
        cpu.title = "La interfaz se pinta por software: la NVIDIA queda entera para el modelo.";
        const dot = el("i", "dot");
        cpu.append(dot, el("span", "", "UI · CPU"));
        bar.insertBefore(cpu, hud.nextSibling);
      }
    } catch { /* sin URL válida */ }

    const pop = el("div");
    pop.id = "hud-pop";
    pop.hidden = true;
    document.body.append(pop);

    /** @type {number[]} */
    const hist = [];
    /** @type {Record<string, any> | null} */
    let last = null;

    /**
     * @param {HTMLElement} node
     * @param {"" | "warn" | "hot"} level
     */
    const level = (node, state) => {
      node.classList.remove("warn", "hot");
      if (state) node.classList.add(state);
    };

    /**
     * @param {number[]} values
     * @param {number} w
     * @param {number} h
     */
    const points = (values, w, h) => values.map((v, i) => `${((i * w) / Math.max(1, values.length - 1)).toFixed(1)},${(h - 1 - (Math.min(100, v) / 100) * (h - 3)).toFixed(1)}`).join(" ");

    function paint(g) {
      last = g;
      if (!g || !g.ok) {
        gpuVal.textContent = "sin dato";
        return;
      }
      hist.push(g.util ?? 0);
      if (hist.length > 60) hist.shift();
      gpuLabel.textContent = (g.name || "GPU").replace(/^NVIDIA GeForce /, "").replace(/ Laptop GPU$/, "");
      gpuVal.textContent = `${g.util ?? "—"}%`;
      svg.querySelector("polyline")?.setAttribute("points", points(hist, 60, 14));
      const pct = g.vramTotalMiB ? (g.vramUsedMiB / g.vramTotalMiB) * 100 : 0;
      vramVal.textContent = `${fmtGb(g.vramUsedMiB)}/${fmtGb(g.vramTotalMiB)} GB`;
      const free=g.vramFreeMiB==null?NaN:Number(g.vramFreeMiB);
      vramFree.textContent=Number.isFinite(free)?`${Math.round(free)} MiB libres`:"Libre: sin dato";
      vramFree.classList.toggle("low",Number.isFinite(free)&&free<(g.visionTransientMiB || 64));
      cVram.title="Memoria libre medida por NVIDIA. La comprobación de imágenes usa un margen transitorio medido de 64 MiB.";
      vramBar.firstElementChild.style.width = `${pct.toFixed(0)}%`;
      level(vramBar, pct >= 97 ? "hot" : pct >= 92 ? "warn" : "");
      tempVal.textContent = `${g.temp ?? "—"}°C`;
      level(cTemp, g.temp >= 86 ? "hot" : g.temp >= 78 ? "warn" : "");
      powVal.textContent = `${Math.round(g.watts ?? 0)} W`;
      const limitada = g.util >= 50 && g.wattsDefault > 0 && g.wattsLimit > 0 && g.wattsLimit < g.wattsDefault * 0.5;
      level(cPow, limitada ? "warn" : "");
      cPow.title = limitada ? `Potencia limitada a ${Math.round(g.wattsLimit)} W (habitual ${Math.round(g.wattsDefault)} W). Pulsa para ver detalles.` : "Potencia actual de la GPU";
      const rUsed = g.ramTotalMiB - g.ramFreeMiB;
      ramVal.textContent = `${fmtGb(rUsed)}/${fmtGb(g.ramTotalMiB)} GB`;
      level(cRam, rUsed / g.ramTotalMiB >= 0.93 ? "hot" : rUsed / g.ramTotalMiB >= 0.85 ? "warn" : "");
      const speed = window.lastSpeed;
      tpsVal.textContent = speed && speed.predicted_ps ? `${speed.predicted_ps} t/s` : "— t/s";
      if (!pop.hidden) paintPop();
    }

    function paintPop() {
      const g = last;
      if (!g || !g.ok) return;
      const media = hist.length ? Math.round(hist.reduce((a, b) => a + b, 0) / hist.length) : 0;
      const alto = hist.length ? Math.round((hist.filter((v) => v >= 85).length / hist.length) * 100) : 0;
      const speed = window.lastSpeed;
      const seen = speed ? (speed.prompt_n || 0) + (speed.cache_n || 0) : 0;
      const alLimite = g.wattsLimit && g.watts >= 0.96 * g.wattsLimit && g.util >= 85;
      pop.innerHTML = "";
      pop.append(el("h4", "", "HARDWARE EN VIVO"));
      const dl = el("dl");
      const row = (k, v) => dl.append(el("dt", "", k), el("dd", "", v));
      row("GPU", g.name || "—");
      row("Uso ahora / media 60 s", `${g.util}% / ${media}%`);
      row("Tiempo ≥ 85 % (60 s)", `${alto}%`);
      row("VRAM usada / libre", `${fmtGb(g.vramUsedMiB)} GiB / ${g.vramFreeMiB==null?"sin dato":`${Math.round(g.vramFreeMiB)} MiB`}`);
      row("Margen transitorio de imagen", `${g.visionTransientMiB || 64} MiB`);
      row("Temperatura", `${g.temp}°C`);
      row("Potencia / límite", `${Math.round(g.watts)} / ${Math.round(g.wattsLimit || 0)} W`);
      if (g.wattsDefault > 0) row("Límite habitual", `${Math.round(g.wattsDefault)} W`);
      row("Reloj SM", `${g.mhz} / ${g.mhzMax} MHz`);
      row("RAM libre / total", `${fmtGb(g.ramFreeMiB)} / ${fmtGb(g.ramTotalMiB)} GB`);
      row("Última respuesta", speed && speed.predicted_ps ? `${speed.predicted_ps} t/s · caché ${seen ? Math.round(((speed.cache_n || 0) / seen) * 100) : 0}%` : "—");
      pop.append(dl);
      const big = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      big.setAttribute("class", "spark-big");
      big.setAttribute("viewBox", "0 0 60 14");
      big.setAttribute("preserveAspectRatio", "none");
      big.innerHTML = `<polyline points="${points(hist, 60, 14)}"></polyline>`;
      pop.append(big);
      const limitada = g.util >= 50 && g.wattsDefault > 0 && g.wattsLimit > 0 && g.wattsLimit < g.wattsDefault * 0.5;
      const tip = limitada
        ? `El equipo limita la GPU a ${Math.round(g.wattsLimit)} W frente a ${Math.round(g.wattsDefault)} W habituales. Esto puede ralentizar las respuestas; revisa la alimentación y el modo de rendimiento del equipo.`
        : alLimite
        ? "La GPU está en su límite de potencia: no puede subir más los relojes aunque quede margen térmico."
        : g.util < 50
          ? "Con la GPU libre ahora mismo no se está generando: durante una respuesta debería marcar más del 90 %."
          : "Generando: la GPU trabaja a pleno rendimiento.";
      pop.append(el("p", "tip", tip));
    }

    hud.addEventListener("click", (event) => {
      event.stopPropagation();
      pop.hidden = !pop.hidden;
      if (!pop.hidden) paintPop();
    });
    document.addEventListener("click", (event) => {
      if (!pop.hidden && !(event.target instanceof Node && pop.contains(event.target))) pop.hidden = true;
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !pop.hidden) pop.hidden = true;
    });

    let tickEnCurso = false;
    async function tick() {
      if (tickEnCurso || document.hidden) return;
      tickEnCurso = true;
      try {
        const res = await fetch("/api/gpu", { cache: "no-store" });
        if (res.ok) paint(await res.json());
      } catch {
        /* el servidor de la interfaz no responde: se reintenta */
      } finally {
        tickEnCurso = false;
      }
    }
    tick();
    setInterval(tick, 1500);
    document.addEventListener("visibilitychange", tick);
  })();

  // ------------------------------------------------------------------ copiar código de los bloques
  (function bloques() {
    const log = $("#log");
    if (!log) return;
    log.addEventListener("click", async (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-act='copy']") : null;
      if (!(button instanceof HTMLButtonElement)) return;
      const code = button.closest(".md-code")?.querySelector("pre code")?.textContent || "";
      try {
        await navigator.clipboard.writeText(code);
        button.textContent = "Copiado";
      } catch {
        const area = document.createElement("textarea");
        area.value = code;
        document.body.append(area);
        area.select();
        button.textContent = document.execCommand("copy") ? "Copiado" : "No se pudo";
        area.remove();
      }
      setTimeout(() => { button.textContent = "Copiar"; }, 1400);
    });
  })();

  // ------------------------------------------------------------------ server management panel
(function serverPanel() {
  "use strict";
  
  const startBtn = document.getElementById("server-start");
  const stopBtn = document.getElementById("server-stop");
  const presetSelect = document.getElementById("server-preset");
  const statusEl = document.getElementById("server-status");
  
  if (!startBtn || !presetSelect) return;
  
  const BIN_PATH = ".local\\opt\\bonsai-inference\\build-RTX4060-Opt-sm89\\bin\\llama-server.exe";
  const MODEL_PATH = "models\\Ornith-1.5-9B-Q4_K_M.gguf";
  const PROJ_PATH = "models\\mmproj-Ornith-1.5-9B-BF16.gguf";
  const TEMPLATE_PATH = "logs\\chat_template_8080.jinja";
  let MODEL_KEY = "ornith9b";

  async function cargarModeloActivo() {
    try {
      const res = await fetch("/api/modelos", { cache: "no-store" });
      if (!res.ok) return;
      const datos = await res.json();
      MODEL_KEY = datos.guardado || datos.actual || MODEL_KEY;
    } catch { /* se queda el predeterminado */ }
  }
  void cargarModeloActivo();

  async function copyServerCommand() {
    const preset = presetSelect.value;
    const btn = document.getElementById("server-terminal");
    const originalText = btn.querySelector("span").textContent;
    try {
      // El comando lo construye el servidor con rutas absolutas reales.
      const res = await fetch(`/api/server/command?preset=${encodeURIComponent(preset)}&model=${encodeURIComponent(MODEL_KEY)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("No se pudo generar el comando");
      const data = await res.json();
      await navigator.clipboard.writeText(data.command);
      btn.querySelector("span").textContent = "¡Copiado!";
      btn.style.background = "var(--accent-soft)";
      aviso("ok", "Comando copiado. Abre PowerShell y pégalo (Ctrl+V).");
    } catch (err) {
      btn.querySelector("span").textContent = "Error";
      aviso("error", "No se pudo copiar el comando: " + err.message);
    } finally {
      setTimeout(() => { btn.querySelector("span").textContent = originalText; btn.style.background = ""; }, 2200);
    }
  }
  
  function aviso(tipo, texto) {
    const cont = document.getElementById("avisos") || document.body;
    const toast = document.createElement("div");
    toast.className = "aviso " + tipo;
    toast.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg><span class="a-txt"></span>`;
    toast.querySelector(".a-txt").textContent = texto;
    cont.appendChild(toast);
    setTimeout(() => { toast.classList.add("sale"); setTimeout(() => toast.remove(), 300); }, 3200);
  }
  
  let serverProcess = null;
  let statusPoll = null;
  
  function updateStatus(connected, message) {
    if (!statusEl) return;
    const dot = statusEl.querySelector(".dot");
    const text = statusEl.querySelector("span");
    if (connected) {
      dot.classList.add("rtx");
      dot.classList.remove("warn");
      text.textContent = message || "Conectado";
    } else {
      dot.classList.remove("rtx");
      dot.classList.add("warn");
      text.textContent = message || "Desconectado";
    }
  }
  
  async function checkServerHealth() {
    try {
      const res = await fetch("/api/servidor", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data.encendido) {
          const preset = presetSelect.value;
          const presetLabel = presetSelect.options[presetSelect.selectedIndex]?.text || preset;
          updateStatus(true, `Conectado - ${presetLabel}`);
          startBtn.hidden = true;
          stopBtn.hidden = false;
          presetSelect.disabled = true;
          return true;
        }
      }
    } catch (e) {
      // UI no responde
    }
    updateStatus(false, "Desconectado");
    startBtn.hidden = false;
    stopBtn.hidden = true;
    presetSelect.disabled = false;
    return false;
  }
  
  async function startServer() {
    const preset = presetSelect.value;
    
    startBtn.disabled = true;
    startBtn.querySelector("span").textContent = "Iniciando...";
    updateStatus(false, `Iniciando ${preset}...`);
    
    try {
      // El endpoint arranca el binario optimizado con el preset elegido; el preset
      // decide contexto, KV y visión. AUTO calcula el plan con el GGUF real.
      await cargarModeloActivo();
      const res = await fetch("/api/server/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset, model: MODEL_KEY, pensar: 4096 })
      });
      
      if (!res.ok) throw new Error((await res.text()) || "No se pudo iniciar el servidor");
      
      updateStatus(false, "Cargando modelo...");
      for (let i = 0; i < 90; i++) {
        await new Promise(r => setTimeout(r, 2000));
        if (await checkServerHealth()) {
          startBtn.hidden = true;
          stopBtn.hidden = false;
          presetSelect.disabled = true;
          aviso("ok", "Servidor listo. El modelo ya responde.");
          return;
        }
      }
      throw new Error("El modelo no terminó de cargar a tiempo");
    } catch (err) {
      console.error("Start server error:", err);
      updateStatus(false, "Error");
      aviso("error", "No se pudo iniciar: " + err.message);
      startBtn.disabled = false;
      startBtn.querySelector("span").textContent = "Iniciar";
    }
  }
  
  async function stopServer() {
    stopBtn.disabled = true;
    stopBtn.querySelector("span").textContent = "Deteniendo...";
    updateStatus(false, "Deteniendo...");
    
    try {
      const res = await fetch("/api/server/stop", { method: "POST" });
      if (!res.ok) throw new Error("Failed to stop server");
    } catch (err) {
      console.error("Stop server error:", err);
    }
    
    await new Promise(r => setTimeout(r, 1000));
    if (!(await checkServerHealth())) {
      startBtn.hidden = false;
      stopBtn.hidden = true;
      presetSelect.disabled = false;
      startBtn.disabled = false;
      startBtn.querySelector("span").textContent = "Iniciar";
    }
  }
  
  // Initial health check
  checkServerHealth();
  
  // Poll status
  statusPoll = setInterval(checkServerHealth, 10000);
  
  // Event listeners
  startBtn.addEventListener("click", startServer);
  stopBtn.addEventListener("click", stopServer);
  document.getElementById("server-terminal").addEventListener("click", copyServerCommand);

  // La etiqueta corta del selector se acompaña del preset completo en el tooltip:
  // en la barra cabe "110k · q8_0 · visión CPU" y al pasar el ratón se ve el detalle.
  const sincronizarTituloPreset = () => {
    const texto = presetSelect.options[presetSelect.selectedIndex]?.text || presetSelect.value;
    presetSelect.title = `${texto}\n${presetSelect.value}`;
  };
  presetSelect.addEventListener("change", sincronizarTituloPreset);
  sincronizarTituloPreset();

  // Ventana sin GPU (scripts/open-ide.ps1 añade ?uicpu=1): el aviso vive en la barra de
  // estado, dentro del HUD de hardware (ide.js), que es quien reconstruye esa zona.

  // Cleanup on page unload
  window.addEventListener("beforeunload", () => {
    if (statusPoll) clearInterval(statusPoll);
  });
})();
})();
