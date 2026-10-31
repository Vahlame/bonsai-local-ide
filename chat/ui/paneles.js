/**
 * Panel inferior del IDE: terminal integrado (con stdin), problemas (diagnósticos),
 * esquema de símbolos del archivo abierto e «ir a definición».
 *
 * Se carga después de app.js y usa su puente (`window.bonsaiEditor`,
 * `window.bonsaiAbrirLinea`, `window.bonsaiAvisar`) además de los endpoints
 * nuevos de ui-server.mjs: /api/terminal, /api/diag, /api/simbolos y /api/definir.
 * Sin dependencias y sin tocar el resto de la interfaz.
 */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const drawer = $("#drawer");
  const out = $("#term-out");
  const termForm = $("#term-form");
  const termIn = $("#term-in");
  const termMeta = $("#term-fondo");
  const probList = $("#prob-list");
  const outlineList = $("#outline-list");
  const diagCount = $("#diag-count");
  const drawerMeta = $("#drawer-meta");
  const botonCajon = $("#tog-drawer");
  if (!drawer || !out || !termForm || !termIn || !probList || !outlineList) return;

  const avisar = (texto, tipo = "", ms) => {
    if (typeof window.bonsaiAvisar === "function") window.bonsaiAvisar(texto, tipo, ms);
  };

  /** Petición JSON a la API propia. */
  async function api(ruta, opciones = {}) {
    const init = { method: opciones.metodo || "GET", cache: "no-store", signal: AbortSignal.timeout(30000) };
    if (opciones.cuerpo !== undefined) {
      init.method = opciones.metodo || "POST";
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(opciones.cuerpo);
    }
    const res = await fetch(ruta, init);
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  }

  // ================================================================= terminal
  let termId = "";
  /** Offset ya pintado de la salida del terminal. */
  let termDesde = 0;
  let termVivo = false;
  let generacion = 0;
  let termPty = false;
  let lineaXterm = "";
  /** @type {any | null} */
  let xterm = null;

  function limpiarTerminal() {
    lineaXterm = "";
    if (xterm) xterm.reset();
    else out.textContent = "";
  }

  function pintarSalida(texto) {
    if (!texto) return;
    if (xterm) {
      xterm.write(texto);
      return;
    }
    // Fallback sin xterm: <pre> con scroll al final.
    out.textContent += texto;
    out.scrollTop = out.scrollHeight;
  }

  async function enviarDatos(datos) {
    if (!termId || !termVivo) await abrirTerminal();
    if (!termId) return;
    try {
      await api("/api/terminal", { cuerpo: { accion: "escribir", id: termId, datos } });
    } catch (err) {
      pintarSalida(`\n[no se pudo escribir en el terminal: ${err.message}]\n`);
    }
  }

  try {
    if (typeof window.BonsaiTerminal === "function") {
      let resizeTimer = 0;
      xterm = new window.BonsaiTerminal({
        parent: out,
        onResize: (cols, rows) => {
          clearTimeout(resizeTimer);
          resizeTimer = window.setTimeout(() => {
            if (termId && termPty) {
              void api("/api/terminal", { cuerpo: { accion: "resize", id: termId, cols, rows } }).catch(() => {});
            }
          }, 180);
        },
        onData: (datos) => {
          if (termPty) {
            void enviarDatos(datos);
            return;
          }
          // Fallback sin PTY: xterm hace eco local y Enter manda una línea al
          // shell por tuberías. Así sigue siendo usable aunque no haya ConPTY.
          for (const ch of String(datos)) {
            if (ch === "\r") {
              const linea = lineaXterm;
              lineaXterm = "";
              if (linea.trim()) void enviarLinea(linea);
            } else if (ch === "\u007f") {
              if (lineaXterm) {
                lineaXterm = lineaXterm.slice(0, -1);
                xterm?.write("\b \b");
              }
            } else if (ch === "\u0003") {
              void reiniciarTerminal();
            } else if (ch >= " " && ch !== "\u001b") {
              lineaXterm += ch;
              xterm?.write(ch);
            }
          }
        },
      });
      out.classList.add("xterm-host");
    } else {
      out.classList.add("term-fallback");
    }
  } catch {
    xterm = null;
    out.classList.add("term-fallback");
  }

  function pintarEstado() {
    const trozos = [];
    if (termVivo) trozos.push(`terminal ${termId || "?"}`);
    else trozos.push(termId ? `terminal ${termId} (terminado)` : "terminal sin abrir");
    drawerMeta.textContent = trozos.join(" · ");
  }

  function enfocarTerminal() {
    if (xterm) {
      xterm.fit();
      xterm.focus();
    } else {
      termIn.focus();
    }
  }

  async function abrirTerminal() {
    if (termId && termVivo) return;
    try {
      const r = await api("/api/terminal", { cuerpo: { accion: "abrir" } });
      termId = String(r.id || "");
      termDesde = 0;
      termVivo = Boolean(r.vivo);
      termPty = Boolean(r.pty);
      limpiarTerminal();
      pintarSalida(`Bonsai terminal · ${r.shell || "shell"} · ${r.cwd || "carpeta del proyecto"}${termPty ? " · PTY" : ""}\n`);
      pintarEstado();
    } catch (err) {
      pintarSalida(`\n[no se pudo abrir el terminal: ${err.message}]\n`);
    }
  }

  async function reiniciarTerminal() {
    try {
      if (termId) await api("/api/terminal", { cuerpo: { accion: "cerrar", id: termId } });
    } catch {
      /* si ya no estaba, da igual */
    }
    termId = "";
    termVivo = false;
    termDesde = 0;
    termPty = false;
    limpiarTerminal();
    await abrirTerminal();
  }

  async function enviarLinea(texto) {
    if (!termId || !termVivo) await abrirTerminal();
    if (!termId) return;
    try {
      await api("/api/terminal", { cuerpo: { accion: "escribir", id: termId, datos: `${texto}\r\n` } });
    } catch (err) {
      pintarSalida(`\n[no se pudo escribir en el terminal: ${err.message}]\n`);
    }
  }

  /** Sondeo de la salida y de los procesos en segundo plano del agente. */
  let sondeoEnCurso = false;
  async function sondear() {
    if (sondeoEnCurso || document.hidden || drawer.hidden || panelActivo !== "terminal") return;
    sondeoEnCurso = true;
    try {
      await sondearAhora();
    } finally {
      sondeoEnCurso = false;
    }
  }
  async function sondearAhora() {
    const mío = generacion;
    if (termId) {
      try {
        const r = await api("/api/terminal", { cuerpo: { accion: "leer", id: termId, desde: termDesde } });
        if (mío !== generacion) return;
        pintarSalida(String(r.salida || ""));
        termDesde = Number(r.siguiente) || termDesde;
        termVivo = Boolean(r.vivo);
        if (!r.vivo && r.codigo !== null && r.codigo !== undefined) {
          pintarSalida(`\n[el shell terminó con código ${r.codigo}. Usa Reiniciar.]\n`);
        }
        pintarEstado();
      } catch {
        /* el servidor puede estar ocupado: el siguiente sondeo reintenta */
      }
    }
    try {
      const p = await api("/api/procesos");
      const lista = Array.isArray(p.procesos) ? p.procesos : [];
      termMeta.textContent = "";
      if (!lista.length) {
        termMeta.textContent = "ninguno";
      } else {
        lista.slice(0, 6).forEach((proceso) => {
          const boton = document.createElement("button");
          boton.className = "ghost";
          boton.type = "button";
          boton.style.cssText = "font-size:10px;padding:0 4px;margin-left:6px";
          boton.title = "Detener este proceso y sus hijos";
          boton.textContent = "✕";
          boton.addEventListener("click", async () => {
            try {
              await api("/api/procesos", { cuerpo: { accion: "detener", id: proceso.id } });
              avisar(`Proceso ${proceso.id} detenido.`, "ok", 2200);
            } catch (err) {
              avisar(`No se pudo detener: ${err.message}`, "error", 4000);
            }
          });
          const fila = document.createElement("span");
          fila.style.cssText = "display:inline-flex;align-items:center;margin-right:12px";
          fila.append(document.createTextNode(`${proceso.id} · ${String(proceso.comando).slice(0, 40)}`), boton);
          termMeta.append(fila);
        });
      }
    } catch {
      /* sin procesos o servidor ocupado */
    }
  }

  // ==================================================== problemas y esquema
  let ultimoRel = "";
  let ultimoTexto = "";
  let analizando = false;

  function filaVacia(lista, texto) {
    lista.textContent = "";
    const li = document.createElement("li");
    li.textContent = texto;
    li.style.cursor = "default";
    li.style.opacity = ".65";
    lista.append(li);
  }

  function pintarProblemas(diagnosticos) {
    probList.textContent = "";
    if (!diagnosticos.length) {
      filaVacia(probList, "Sin problemas en el archivo abierto.");
      if (diagCount) diagCount.textContent = "";
      return;
    }
    if (diagCount) diagCount.textContent = `(${diagnosticos.length})`;
    for (const d of diagnosticos) {
      const li = document.createElement("li");
      li.className = d.severidad === "error" ? "err" : "warn";
      li.textContent = `${d.archivo ? `${d.archivo}:` : ""}${d.linea}:${d.columna} · ${d.mensaje} (${d.fuente})`;
      li.title = "Ir a esa línea";
      li.addEventListener("click", () => {
        const ed = window.bonsaiEditor?.();
        window.bonsaiAbrirLinea?.(d.archivo || ed?.rel || "", d.linea || 1);
      });
      probList.append(li);
    }
  }

  function pintarEsquema(simbolos) {
    outlineList.textContent = "";
    if (!simbolos.length) {
      filaVacia(outlineList, "No se han encontrado símbolos en el archivo abierto.");
      return;
    }
    for (const s of simbolos) {
      const li = document.createElement("li");
      li.textContent = `${s.tipo} · ${s.nombre}  (línea ${s.linea})`;
      li.title = "Ir a esa línea";
      li.addEventListener("click", () => {
        const ed = window.bonsaiEditor?.();
        window.bonsaiAbrirLinea?.(ed?.rel || "", s.linea || 1);
      });
      outlineList.append(li);
    }
  }

  /** Analiza el archivo abierto. `completo` ejecuta los comprobadores reales (node/python). */
  async function analizar(completo = true) {
    const ed = window.bonsaiEditor?.();
    if (!ed) {
      filaVacia(probList, "Abre un archivo para ver sus diagnósticos.");
      filaVacia(outlineList, "Abre un archivo para ver su esquema.");
      if (diagCount) diagCount.textContent = "";
      return;
    }
    if (analizando) return;
    analizando = true;
    drawerMeta.textContent = ed.rel;
    try {
      if (panelActivo === "esquema") {
        const r = await api(`/api/simbolos?path=${encodeURIComponent(ed.rel)}`);
        pintarEsquema(Array.isArray(r.simbolos) ? r.simbolos : []);
        return;
      }
      let diagnosticos;
      if (completo) {
        const r = await api(`/api/diag?path=${encodeURIComponent(ed.rel)}`);
        diagnosticos = Array.isArray(r.diagnosticos) ? r.diagnosticos : [];
      } else {
        const r = await api("/api/diag", { cuerpo: { path: ed.rel, texto: ed.texto } });
        diagnosticos = Array.isArray(r.diagnosticos) ? r.diagnosticos : [];
      }
      if (panelActivo === "problemas") pintarProblemas(diagnosticos);
      else if (diagCount) diagCount.textContent = diagnosticos.length ? `(${diagnosticos.length})` : "";
    } catch (err) {
      if (panelActivo === "problemas") filaVacia(probList, `No se pudo analizar: ${err.message}`);
    } finally {
      analizando = false;
    }
  }

  // =============================================================== ir a definición
  async function irADefinicion() {
    const ed = window.bonsaiEditor?.();
    if (!ed) {
      avisar("Abre un archivo para buscar una definición.", "warn", 3000);
      return;
    }
    const antes = ed.texto.slice(0, ed.cursor ?? ed.texto.length);
    const m = antes.match(/[\p{L}\p{N}_$]+$/u);
    const palabra = m ? m[0] : "";
    if (!palabra) {
      avisar("Pon el cursor sobre un nombre (función, clase, variable).", "warn", 3000);
      return;
    }
    try {
      const r = await api("/api/definir", { cuerpo: { palabra, path: ed.rel } });
      const d = r && r.definicion;
      if (!d) {
        avisar(`No encontré la definición de «${palabra}».`, "warn", 3200);
        return;
      }
      window.bonsaiAbrirLinea?.(d.archivo, d.linea || 1);
      avisar(`Definición de «${palabra}»: ${d.archivo}:${d.linea} (${d.tipo}).`, "ok", 2600);
    } catch (err) {
      avisar(`No se pudo buscar la definición: ${err.message}`, "error", 4000);
    }
  }

  // ================================================================== pestañas
  let panelActivo = "terminal";

  function mostrarPanel(cual) {
    panelActivo = cual;
    for (const boton of $$("[data-drawer]")) {
      const suyo = boton.dataset.drawer === cual;
      boton.classList.toggle("on", suyo);
      boton.setAttribute("aria-pressed", suyo ? "true" : "false");
    }
    $("#term-panel").hidden = cual !== "terminal";
    $("#prob-panel").hidden = cual !== "problemas";
    $("#outline-panel").hidden = cual !== "esquema";
    if (cual !== "terminal") {
      drawerMeta.textContent = window.bonsaiEditor?.()?.rel || "";
      void analizar(cual === "problemas");
    } else {
      pintarEstado();
      window.setTimeout(() => xterm?.fit(), 0);
    }
  }

  function abrirCajon(cual = panelActivo) {
    drawer.hidden = false;
    if (botonCajon) {
      botonCajon.classList.add("on");
      botonCajon.setAttribute("aria-pressed", "true");
    }
    mostrarPanel(cual);
    if (panelActivo === "terminal") void abrirTerminal();
    else void analizar(true);
    enfocarTerminal();
  }

  function cerrarCajon() {
    drawer.hidden = true;
    if (botonCajon) {
      botonCajon.classList.remove("on");
      botonCajon.setAttribute("aria-pressed", "false");
    }
  }

  botonCajon?.addEventListener("click", () => (drawer.hidden ? abrirCajon() : cerrarCajon()));
  $("#drawer-cerrar")?.addEventListener("click", cerrarCajon);
  $("#drawer-def")?.addEventListener("click", irADefinicion);
  for (const boton of $$("[data-drawer]")) {
    boton.addEventListener("click", () => {
      mostrarPanel(boton.dataset.drawer || "terminal");
      if (panelActivo === "terminal") {
        void abrirTerminal();
        enfocarTerminal();
      } else {
        void analizar(true);
      }
    });
  }

  // ================================================================== atajos
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key === "`") {
      e.preventDefault();
      if (drawer.hidden) abrirCajon();
      else cerrarCajon();
      return;
    }
    if (e.key === "F12" && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      void irADefinicion();
    }
  });

  // ================================================================ formulario
  termForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const texto = termIn.value;
    if (!texto.trim()) return;
    termIn.value = "";
    void enviarLinea(texto);
  });

  // Ctrl+C en el terminal: detiene el proceso actual matando el shell (sin PTY no hay
  // señal real); se reabre solo en el siguiente comando.
  termIn.addEventListener("keydown", (e) => {
    if (e.ctrlKey && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      void reiniciarTerminal();
    }
  });

  $("#term-reiniciar")?.addEventListener("click", () => void reiniciarTerminal());

  // ================================================================ refrescos
  // Al cambiar de archivo o al escribir: los problemas se recalculan solos.
  let timerRefresh = 0;
  function programarRefresh() {
    clearTimeout(timerRefresh);
    timerRefresh = window.setTimeout(() => {
      if (document.hidden || drawer.hidden) return;
      const ed = window.bonsaiEditor?.();
      if (!ed) return;
      const cambioArchivo = ed.rel !== ultimoRel || ed.texto !== ultimoTexto;
      ultimoRel = ed.rel;
      ultimoTexto = ed.texto;
      if (!cambioArchivo) return;
      if (panelActivo === "problemas") {
        // Rápido mientras se escribe (sin lanzar node/python); completo al abrir el panel.
        void analizar(false);
      } else if (panelActivo === "esquema") {
        void analizar(true);
      }
    }, 650);
  }

  const areaEditor = $("#editor textarea");
  areaEditor?.addEventListener("input", programarRefresh);
  // Al abrir un panel o cambiar de pestaña de archivo, refresco completo.
  document.addEventListener("click", (e) => {
    const objetivo = e.target;
    if (objetivo instanceof Element && objetivo.closest("#tree")) programarRefresh();
  });

  window.setInterval(() => void sondear(), 700);
  window.setInterval(() => {
    if (!drawer.hidden && panelActivo !== "terminal") programarRefresh();
  }, 2500);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    programarRefresh();
    void sondear();
  });
})();
