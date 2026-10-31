/**
 * Model Hub (interfaz). Se carga antes que app.js y expone window.bonsaiHub.
 *
 * No tiene dependencias: habla con /api/hub/* y pinta el catálogo, la búsqueda
 * en Hugging Face, las descargas con progreso y los modelos instalados.
 * app.js solo abre este diálogo desde el menú de modelo y desde el botón Modelos.
 */
(() => {
  "use strict";

  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const el = (tag, cls, texto) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (texto !== undefined) n.textContent = texto;
    return n;
  };
  const ico = (nombre, tam = 16) => {
    const span = el("span", "hub-ico");
    if (typeof ICO !== "undefined" && ICO[nombre]) span.innerHTML = ICO[nombre]({ tam });
    return span;
  };
  const avisar = (texto, tipo = "", ms = 4000) => {
    if (typeof window.bonsaiAvisar === "function") window.bonsaiAvisar(texto, tipo, ms);
    else console.log(`[hub] ${texto}`);
  };
  const confirmar = async (titulo, texto, ok = "Aceptar") => {
    if (typeof window.bonsaiConfirmar === "function") return window.bonsaiConfirmar(titulo, texto, ok);
    return window.confirm(`${titulo}\n\n${texto}`);
  };
  const fmtBytes = (n) => {
    const v = Number(n) || 0;
    if (v >= 1024 ** 3) return `${(v / 1024 ** 3).toFixed(2)} GiB`;
    if (v >= 1024 ** 2) return `${(v / 1024 ** 2).toFixed(0)} MiB`;
    if (v >= 1024) return `${(v / 1024).toFixed(0)} KiB`;
    return `${v} B`;
  };
  const fmtEta = (s) => {
    const n = Math.max(0, Math.round(Number(s) || 0));
    if (n < 60) return `${n}s`;
    if (n < 3600) return `${Math.floor(n / 60)}m ${n % 60}s`;
    return `${Math.floor(n / 3600)}h ${Math.floor((n % 3600) / 60)}m`;
  };
  const kvTexto = (kv) => ({ f16: "f16", q8_0: "q8_0", q4_0: "q4_0" }[kv] || kv);
  const planTexto = (plan) => {
    if (!plan) return "plan pendiente";
    if (!plan.ok && plan.ok !== undefined) return "no cabe";
    const moe = plan.moe?.activo ? ` · MoE ${plan.moe.capasGpu}/${plan.moe.capas} GPU · ${plan.moe.loadMode}` : "";
    return `${Number(plan.contexto || 0).toLocaleString("es-ES")} tok · ${kvTexto(plan.kv)}${plan.vision ? (plan.mmprojCPU ? " · visión CPU" : " · visión GPU") : " · sin visión"}${moe}`;
  };

  /**
   * Logo del proveedor del modelo. Los SVG viven en /ui/iconos/modelos/ y se
   * sirven localmente; si no reconocemos la familia, usamos la marca Bonsai.
   * @param {Record<string, any>} m
   * @returns {HTMLImageElement}
   */
  function logoModelo(m) {
    const texto = [m?.clave, m?.nombre, m?.repo, m?.archivo].filter(Boolean).join(" ").toLowerCase();
    const reglas = [
      [/qwen|alibaba/, "qwen-color.svg", false],
      [/gpt-oss|openai/, "openai.svg", true],
      [/nemotron|nvidia/, "nvidia-color.svg", false],
      [/granite|\bibm\b/, "ibm.svg", true],
      [/gemma|google/, "gemma-color.svg", false],
      [/llama|\bmeta\b/, "meta-color.svg", false],
      [/mistral|devstral|magistral/, "mistral-color.svg", false],
      [/deepseek/, "deepseek-color.svg", false],
      [/glm|zhipu/, "zhipu.svg", false],
      [/kimi|moonshot/, "kimi-color.svg", false],
      [/lfm|liquid/, "liquid.svg", true],
      [/smol|huggingface|unsloth/, "huggingface-color.svg", false],
      [/phi|microsoft/, "microsoft-color.svg", false],
      [/spark/, "spark-color.svg", false],
    ];
    const encontrada = reglas.find(([re]) => re.test(texto));
    const archivo = encontrada?.[1] || "bonsai.svg";
    const mono = Boolean(encontrada?.[2]);
    const img = document.createElement("img");
    img.className = `hub-logo${mono ? " hub-logo-mono" : ""}`;
    img.src = `/ui/iconos/modelos/${archivo}`;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.loading = "lazy";
    img.decoding = "async";
    return img;
  }

  let capa = null;
  let temporizador = null;
  let estado = {
    catalogo: null,
    trabajos: [],
    pestana: "instalados",
    busqueda: "",
    resultados: [],
    descubiertos: [],
    descubriendo: false,
    descubrirError: "",
    repo: null,
    cargando: false,
    error: "",
    ultimoListo: "",
  };

  const api = async (ruta, opciones = {}) => {
    const timeout = Number(opciones.timeout) || 30000;
    const init = { method: opciones.metodo || "GET", cache: "no-store", signal: AbortSignal.timeout(timeout) };
    if (opciones.cuerpo !== undefined) {
      init.method = opciones.metodo || "POST";
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(opciones.cuerpo);
    }
    const res = await fetch(ruta, init);
    if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  };

  function cabecera() {
    const h = el("div", "hub-head");
    const titulo = el("div");
    titulo.append(el("h2", "", "Model Hub"), el("p", "hub-sub", "Busca, descarga y prueba modelos GGUF. El plan de motor se calcula con la arquitectura real de cada archivo y la VRAM de esta máquina."));
    const cerrar = el("button", "ghost hub-cerrar", "Cerrar");
    cerrar.type = "button";
    cerrar.addEventListener("click", cerrarHub);
    h.append(titulo, cerrar);
    return h;
  }

  function barraPestanas() {
    const barra = el("div", "hub-tabs");
    const tabs = [
      ["instalados", "Instalados"],
      ["recomendados", "Recomendados"],
      ["descubrir", "Descubrir"],
      ["buscar", "Buscar en Hugging Face"],
      ["url", "Desde URL"],
      ["importar", "Importar / escanear"],
    ];
    for (const [id, texto] of tabs) {
      const b = el("button", `hub-tab${estado.pestana === id ? " on" : ""}`, texto);
      b.type = "button";
      b.addEventListener("click", () => {
        estado.pestana = id;
        if (id === "descubrir" && !estado.descubiertos.length) {
          void cargarDescubrir();
          return;
        }
        pintar();
      });
      barra.append(b);
    }
    return barra;
  }

  function barraDescargas() {
    const activos = estado.trabajos.filter((t) => ["descargando", "verificando", "instalando"].includes(t.estado));
    const recientes = estado.trabajos.filter((t) => !["descargando", "verificando", "instalando"].includes(t.estado)).slice(0, 3);
    const lista = [...activos, ...recientes];
    if (!lista.length) return null;
    const caja = el("div", "hub-jobs");
    for (const t of lista) {
      const fila = el("div", `hub-job ${t.estado}`);
      const info = el("div", "hub-job-info");
      const nombre = el("strong", "", t.nombre || t.archivoActual || t.id);
      const detalle = el("span", "hub-job-detalle");
      if (t.estado === "descargando") {
        detalle.textContent = `${fmtBytes(t.bytesHechos)} / ${fmtBytes(t.totalBytes)} · ${(t.velocidad / 1048576).toFixed(2)} MiB/s · ETA ${fmtEta(t.eta)}`;
      } else if (t.estado === "verificando") detalle.textContent = "verificando SHA-256…";
      else if (t.estado === "instalando") detalle.textContent = "registrando el modelo…";
      else if (t.estado === "listo") detalle.textContent = "instalado y listo";
      else detalle.textContent = t.error || t.estado;
      info.append(nombre, detalle);
      const barra = el("div", "hub-progress");
      const relleno = el("i");
      relleno.style.width = `${Math.max(2, Math.min(100, Number(t.progreso) || 0))}%`;
      barra.append(relleno);
      fila.append(info, barra);
      if (["descargando", "verificando", "instalando"].includes(t.estado)) {
        const cancelar = el("button", "ghost hub-mini", "Cancelar");
        cancelar.type = "button";
        cancelar.addEventListener("click", async () => {
          try {
            await api("/api/hub/downloads", { cuerpo: { id: t.id } });
            await refrescar();
          } catch (err) { avisar(`No se pudo cancelar: ${err.message}`, "error"); }
        });
        fila.append(cancelar);
      }
      caja.append(fila);
    }
    return caja;
  }

  function tarjetaCurada(m) {
    const card = el("article", "hub-card");
    const top = el("div", "hub-card-top");
    const nombre = el("div", "hub-name");
    const textoNombre = el("div", "hub-name-text");
    textoNombre.append(el("h3", "", m.nombre || m.clave), el("p", "hub-repo", m.repo || "origen directo"));
    nombre.append(logoModelo(m), textoNombre);
    const estadoModelo = el("span", `hub-badge${m.instalado ? " ok" : ""}`, m.instalado ? "instalado" : "disponible");
    top.append(nombre, estadoModelo);
    card.append(top);
    const meta = el("div", "hub-meta");
    meta.append(...[
      el("span", "", `📦 ${fmtBytes(m.tamanoTotalBytes || m.bytes)}`),
      el("span", "", `🧠 ${planTexto(m.plan)}`),
      m.visionIncluida ? el("span", "", "👁 incluye visión") : null,
      m.licencia ? el("span", "", `© ${m.licencia}`) : null,
    ].filter(Boolean));
    card.append(meta);
    if (m.uso) card.append(el("p", "hub-uso", m.uso));
    const etiquetas = el("div", "hub-tags");
    for (const t of m.etiquetas || []) etiquetas.append(el("span", "hub-tag", t));
    card.append(etiquetas);
    const acciones = el("div", "hub-actions");
    if (m.instalado) {
      const usar = el("button", "primary hub-mini", "Usar ahora");
      usar.type = "button";
      usar.addEventListener("click", () => void usarModelo(m.claveInstalada || m.clave, m.nombre));
      acciones.append(usar);
    } else {
      const bajar = el("button", "primary hub-mini", m.visionIncluida ? "Descargar + visión" : "Descargar");
      bajar.type = "button";
      bajar.addEventListener("click", () => void descargar({ clave: m.clave }, bajar));
      acciones.append(bajar);
    }
    card.append(acciones);
    return card;
  }

  function tarjetaInstalada(m) {
    const card = el("article", "hub-card");
    card.dataset.busqueda = [m.nombre, m.clave, m.rol, ...(m.capacidades || []), ...(m.etiquetas || [])].filter(Boolean).join(" ").toLowerCase();
    const top = el("div", "hub-card-top");
    const nombre = el("div", "hub-name");
    const textoNombre = el("div", "hub-name-text");
    textoNombre.append(el("h3", "", m.nombre || m.clave), el("p", "hub-repo", m.archivo || ""));
    nombre.append(logoModelo(m), textoNombre);
    top.append(nombre, el("span", `hub-badge${m.existe ? " ok" : " bad"}`, m.existe ? "ok" : "falta el GGUF"));
    card.append(top);
    const meta = el("div", "hub-meta");
    meta.append(...[
      el("span", "", `📦 ${fmtBytes(m.bytes || m.esperado)}`),
      el("span", "", `🧠 ${planTexto(m.plan)}`),
      m.vision ? el("span", "", "👁 visión") : null,
      el("span", "", m.fuente === "local" ? "importado" : "hub"),
      m.rol ? el("span", "", m.rol) : null,
    ].filter(Boolean));
    card.append(meta);
    const etiquetas = el("div", "hub-tags");
    if (m.pruebas?.coding?.rank === 1) etiquetas.append(el("span", "hub-tag best", "★ #1 coding"));
    if (m.pruebas?.webapp?.global >= 100) etiquetas.append(el("span", "hub-tag best", "★ web app 100%"));
    for (const c of (m.capacidades || [])) etiquetas.append(el("span", "hub-tag", c));
    if (etiquetas.children.length) card.append(etiquetas);
    if (m.pruebas?.resumen) card.append(el("p", "hub-uso", `Pruebas: ${m.pruebas.resumen}`));
    if (m.pruebas?.coding || m.pruebas?.webapp) {
      const kpis = el("div", "hub-kpis");
      const c = m.pruebas.coding;
      if (c) {
        kpis.append(
          el("span", "hub-kpi strong", `Coding${c.rank ? ` #${c.rank}` : ""} · ${c.global}%`),
          el("span", "hub-kpi", `Proyecto ${c.project?.pass ?? 0}/${c.project?.total ?? 0}`),
          el("span", "hub-kpi", `Bugfix ${c.bugfix?.pass ?? 0}/${c.bugfix?.total ?? 0}`),
        );
      }
      const w = m.pruebas.webapp;
      if (w) {
        kpis.append(
          el("span", "hub-kpi strong", `Web app · ${w.global}%`),
          el("span", "hub-kpi", `API ${w.api}/${w.apiTotal}`),
          el("span", "hub-kpi", `UI ${w.ui}/${w.uiTotal}`),
        );
      }
      card.append(kpis);
    }
    if (Array.isArray(m.contextos) && m.contextos.length) {
      const fila = el("div", "hub-contextos");
      fila.append(el("span", "hub-contextos-label", "Contexto"));
      for (const c of m.contextos) {
        const b = el("button", "ghost hub-mini", `${Math.round(c / 1024)}k`);
        b.type = "button";
        b.disabled = !m.existe;
        b.title = `Arrancar con ${c.toLocaleString("es-ES")} tokens`;
        if (Number(m.plan?.contexto) === Number(c)) b.classList.add("on");
        b.addEventListener("click", () => void usarModelo(m.clave, m.nombre, { contexto: c, kv: "q8_0", vision: Boolean(m.vision) }));
        fila.append(b);
      }
      card.append(fila);
    }
    const acciones = el("div", "hub-actions");
    const usar = el("button", "primary hub-mini", m.oculto ? "Auxiliar" : "Usar ahora");
    usar.type = "button";
    usar.disabled = !m.existe || m.oculto;
    usar.addEventListener("click", () => void usarModelo(m.clave, m.nombre));
    const plan = el("button", "ghost hub-mini", "Ver plan");
    plan.type = "button";
    plan.addEventListener("click", () => void verPlan(m.clave));
    const probar = el("button", "ghost hub-mini", "Copiar prueba");
    probar.type = "button";
    probar.addEventListener("click", async () => {
      const comando = `node scripts/model-lab.mjs probe --model ${m.clave}`;
      try {
        await navigator.clipboard.writeText(comando);
        avisar("Comando de prueba copiado. Pégalo en PowerShell.", "ok");
      } catch {
        avisar(`Ejecuta: ${comando}`, "", 9000);
      }
    });
    const borrar = el("button", "ghost hub-mini hub-danger", "Borrar");
    borrar.type = "button";
    borrar.addEventListener("click", async () => {
      if (!(await confirmar("Borrar modelo", `Se borrarán ${m.archivo} y su proyector de visión (si lo tiene) de models/. No se puede deshacer.`, "Borrar"))) return;
      try {
        await api("/api/hub/delete", { cuerpo: { clave: m.clave, confirmar: true } });
        avisar(`${m.nombre} borrado`, "ok");
        await refrescar();
        window.dispatchEvent(new CustomEvent("bonsai:modelos-cambiados"));
      } catch (err) { avisar(`No se pudo borrar: ${err.message}`, "error"); }
    });
    acciones.append(usar, plan, probar, borrar);
    card.append(acciones);
    return card;
  }

  function vistaRecomendados() {
    const caja = el("div", "hub-grid");
    const modelos = (estado.catalogo?.modelos || []).filter((m) => !m.oculto);
    const instalados = new Set((estado.catalogo?.instalados || []).map((m) => m.clave));
    for (const m of modelos) {
      if (!m.instalado && instalados.has(m.clave)) m.instalado = true;
      caja.append(tarjetaCurada(m));
    }
    if (!modelos.length) caja.append(el("p", "hub-vacio", "No se pudo leer el catálogo curado."));
    return caja;
  }

  function vistaInstalados() {
    const modelos = estado.catalogo?.instalados || [];
    if (!modelos.length) {
      const caja = el("div", "hub-grid");
      caja.append(el("p", "hub-vacio", "Todavía no hay modelos del Hub. Descarga uno en «Recomendados» o importa un .gguf."));
      return caja;
    }
    const visible = modelos.filter((m) => !m.oculto);
    const mejor = [...visible].sort((a, b) =>
      (Number(b.pruebas?.coding?.global) || 0) - (Number(a.pruebas?.coding?.global) || 0) ||
      (Number(b.pruebas?.webapp?.global) || 0) - (Number(a.pruebas?.webapp?.global) || 0))[0];
    const vista = el("div", "hub-vista");
    const barra = el("div", "hub-barra");
    const filtro = el("input", "hub-filtro");
    filtro.type = "search";
    filtro.placeholder = "Filtrar por nombre, capacidad o rol…";
    filtro.setAttribute("aria-label", "Filtrar modelos instalados");
    barra.append(filtro);
    vista.append(barra);
    if (mejor) {
      const resumen = el("div", "hub-resumen");
      const info = el("div", "hub-resumen-info");
      info.append(
        el("span", "hub-resumen-kicker", "Recomendado para coding"),
        el("strong", "", mejor.nombre),
        el("span", "hub-resumen-meta", `${mejor.pruebas?.coding?.global ?? "—"}% coding · ${mejor.pruebas?.webapp?.global ?? "—"}% web app · ${Math.round(Number(mejor.plan?.contexto || 0) / 1024)}k por defecto`),
      );
      resumen.append(info);
      const acciones = el("div", "hub-resumen-acciones");
      for (const c of (mejor.contextos || []).slice(0, 4)) {
        const b = el("button", c === Number(mejor.plan?.contexto) ? "primary hub-mini" : "ghost hub-mini", `${Math.round(c / 1024)}k`);
        b.type = "button";
        b.addEventListener("click", () => void usarModelo(mejor.clave, mejor.nombre, { contexto: c, kv: "q8_0", vision: Boolean(mejor.vision) }));
        acciones.append(b);
      }
      resumen.append(acciones);
      vista.append(resumen);
    }
    const caja = el("div", "hub-grid");
    for (const m of modelos) caja.append(tarjetaInstalada(m));
    vista.append(caja);
    filtro.addEventListener("input", () => {
      const q = filtro.value.trim().toLowerCase();
      for (const card of caja.querySelectorAll(".hub-card")) {
        card.hidden = Boolean(q) && !String(card.dataset.busqueda || "").includes(q);
      }
    });
    return vista;
  }

  function filaResultado(m) {
    const fila = el("button", "hub-result");
    fila.type = "button";
    const info = el("span");
    info.append(el("strong", "", m.repo), el("small", "", `${m.descargas.toLocaleString("es-ES")} descargas · ${m.licencia || "licencia ?"}`));
    fila.append(info, ico("flechaDerecha", 14));
    fila.addEventListener("click", () => void abrirRepo(m.repo));
    return fila;
  }

  async function cargarDescubrir() {
    if (estado.descubriendo) return;
    estado.descubriendo = true;
    estado.descubrirError = "";
    pintar();
    try {
      const r = await api("/api/hub/discover?limit=30&sort=trendingScore", { timeout: 60000 });
      estado.descubiertos = r.resultados || [];
    } catch (err) {
      estado.descubrirError = err.message;
    } finally {
      estado.descubriendo = false;
      pintar();
    }
  }

  function vistaDescubrir() {
    const caja = el("div", "hub-buscar");
    const cab = el("div", "hub-descubrir-head");
    cab.append(
      el("h3", "", "Novedades en Hugging Face"),
      el("p", "hub-uso", "Modelos GGUF con más tracción ahora mismo. Al abrir uno ves sus archivos, cuantizaciones y si trae proyector de visión; el plan de VRAM se calcula al descargarlo."),
    );
    caja.append(cab);
    if (estado.descubriendo) {
      caja.append(el("p", "hub-vacio", "Consultando el catálogo online…"));
      return caja;
    }
    if (estado.descubrirError) {
      caja.append(el("p", "hub-vacio", `No se pudo consultar: ${estado.descubrirError}`));
      const reintentar = el("button", "primary hub-mini", "Reintentar");
      reintentar.type = "button";
      reintentar.addEventListener("click", () => void cargarDescubrir());
      caja.append(reintentar);
      return caja;
    }
    if (!estado.descubiertos.length) {
      const cargar = el("button", "primary hub-mini", "Cargar catálogo online");
      cargar.type = "button";
      cargar.addEventListener("click", () => void cargarDescubrir());
      caja.append(cargar);
      return caja;
    }
    const lista = el("div", "hub-results");
    for (const m of estado.descubiertos) {
      const fila = el("button", "hub-result");
      fila.type = "button";
      const info = el("span");
      const meta = [m.vision ? "👁 visión" : "", m.descargas ? `${m.descargas.toLocaleString("es-ES")} descargas` : "", m.licencia ? `© ${m.licencia}` : ""].filter(Boolean).join(" · ");
      info.append(el("strong", "", m.repo), el("small", "", meta));
      fila.append(info, ico("flechaDerecha", 14));
      fila.addEventListener("click", () => void abrirRepo(m.repo));
      lista.append(fila);
    }
    caja.append(lista);
    const recargar = el("button", "ghost hub-mini", "Actualizar catálogo online");
    recargar.type = "button";
    recargar.addEventListener("click", () => { estado.descubiertos = []; void cargarDescubrir(); });
    caja.append(recargar);
    return caja;
  }

  function vistaBuscar() {
    const caja = el("div", "hub-buscar");
    const barra = el("div", "hub-searchbar");
    const input = el("input");
    input.type = "search";
    input.placeholder = "qwen3 coder, gemma 3, llama 3.2…";
    input.value = estado.busqueda;
    input.setAttribute("aria-label", "Buscar modelos en Hugging Face");
    const boton = el("button", "primary hub-mini", "Buscar");
    boton.type = "button";
    const lanzar = async () => {
      estado.busqueda = input.value.trim();
      if (!estado.busqueda) return;
      estado.cargando = true;
      estado.resultados = [];
      pintar();
      try {
        const r = await api(`/api/hub/search?q=${encodeURIComponent(estado.busqueda)}`);
        estado.resultados = r.resultados || [];
      } catch (err) { estado.error = err.message; }
      finally { estado.cargando = false; pintar(); }
    };
    boton.addEventListener("click", () => void lanzar());
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") void lanzar(); });
    barra.append(input, boton);
    caja.append(barra);
    if (estado.cargando) caja.append(el("p", "hub-vacio", "Buscando en Hugging Face…"));
    else if (estado.error) caja.append(el("p", "hub-vacio", estado.error));
    else if (estado.resultados.length) {
      const lista = el("div", "hub-results");
      for (const m of estado.resultados) lista.append(filaResultado(m));
      caja.append(lista);
    } else if (estado.busqueda) caja.append(el("p", "hub-vacio", "Sin resultados. Prueba con el nombre del repo."));
    return caja;
  }

  async function abrirRepo(repo) {
    estado.repo = { repo, datos: null, error: "", seleccion: "" };
    pintar();
    try {
      const datos = await api(`/api/hub/repo?repo=${encodeURIComponent(repo)}`);
      estado.repo.datos = datos;
      const principales = (datos.principales || []).filter((a) => !a.vision);
      // Preferencia: Q4_K_M -> Q4_0 -> cualquier Q4 -> el más pequeño no absurdo.
      const preferido = principales.find((a) => /Q4_K_M/i.test(a.archivo)) || principales.find((a) => /Q4_0/i.test(a.archivo)) || principales.find((a) => /Q4/i.test(a.archivo)) || principales[Math.min(1, principales.length - 1)];
      estado.repo.seleccion = preferido?.archivo || principales[0]?.archivo || "";
    } catch (err) { estado.repo.error = err.message; }
    pintar();
  }

  function vistaRepo() {
    const caja = el("div", "hub-repo-vista");
    const volver = el("button", "ghost hub-mini", "← Volver a la búsqueda");
    volver.type = "button";
    volver.addEventListener("click", () => { estado.repo = null; pintar(); });
    caja.append(volver);
    const r = estado.repo;
    if (!r) return caja;
    if (r.error) { caja.append(el("p", "hub-vacio", r.error)); return caja; }
    if (!r.datos) { caja.append(el("p", "hub-vacio", "Leyendo el repo…")); return caja; }
    const d = r.datos;
    const head = el("div", "hub-repo-head");
    const titulo = el("div");
    titulo.append(el("h3", "", d.repo), el("p", "hub-sub", `${d.descargas.toLocaleString("es-ES")} descargas · ${d.licencia || "licencia ?"} · revisión ${String(d.revision).slice(0, 10)}`));
    head.append(titulo, el("span", "hub-badge", "Hugging Face"));
    caja.append(head);
    const principales = (d.principales || []).filter((a) => !a.vision);
    const proyectores = d.proyectores || [];
    if (!principales.length) { caja.append(el("p", "hub-vacio", "Este repo no tiene GGUF.")); return caja; }
    const selector = el("div", "hub-files");
    for (const a of principales) {
      const fila = el("label", "hub-file");
      const radio = el("input");
      radio.type = "radio";
      radio.name = "hub-archivo";
      radio.value = a.archivo;
      radio.checked = a.archivo === r.seleccion;
      radio.addEventListener("change", () => { r.seleccion = a.archivo; });
      const info = el("span");
      info.append(el("strong", "", a.archivo), el("small", "", `${fmtBytes(a.bytes)}${a.quant ? ` · ${a.quant}` : ""}`));
      fila.append(radio, info);
      selector.append(fila);
    }
    caja.append(selector);
    let proyector = "";
    if (proyectores.length) {
      const vision = el("div", "hub-vision");
      vision.append(el("p", "hub-uso", "Proyector de visión (opcional):"));
      const sel = el("select");
      const no = el("option", "", "Sin visión");
      no.value = "";
      sel.append(no);
      for (const p of proyectores) {
        const o = el("option", "", `${p.archivo} · ${fmtBytes(p.bytes)}`);
        o.value = p.archivo;
        sel.append(o);
      }
      sel.addEventListener("change", () => { proyector = sel.value; });
      vision.append(sel);
      caja.append(vision);
    }
    const acciones = el("div", "hub-actions");
    const bajar = el("button", "primary hub-mini", "Descargar seleccionado");
    bajar.type = "button";
    bajar.addEventListener("click", () => {
      const archivo = r.seleccion;
      if (!archivo) return;
      void descargar({ repo: d.repo, archivo, revision: d.revision, vision: proyector ? { archivo: proyector } : undefined, nombre: archivo.replace(/\.gguf$/i, "") }, bajar);
    });
    acciones.append(bajar);
    caja.append(acciones);
    return caja;
  }

  function vistaUrl() {
    const caja = el("div", "hub-url");
    caja.append(el("p", "hub-uso", "Cualquier .gguf por HTTPS. Si no indicas SHA-256, se calcula al terminar y se guarda en el registro. Se rechazan hosts privados."));
    const url = el("input");
    url.type = "url";
    url.placeholder = "https://…/modelo-Q4_K_M.gguf";
    const nombre = el("input");
    nombre.type = "text";
    nombre.placeholder = "nombre local opcional (debe acabar en .gguf)";
    const sha = el("input");
    sha.type = "text";
    sha.placeholder = "SHA-256 opcional";
    for (const i of [url, nombre, sha]) caja.append(i);
    const bajar = el("button", "primary hub-mini", "Descargar URL");
    bajar.type = "button";
    bajar.addEventListener("click", () => void descargar({ url: url.value.trim(), nombre: nombre.value.trim() || undefined, sha256: sha.value.trim() || undefined }, bajar));
    caja.append(bajar);
    return caja;
  }

  function vistaImportar() {
    const caja = el("div", "hub-url");
    caja.append(el("p", "hub-uso", "Registra GGUF que ya estén en models/ o copia uno de otra carpeta. El archivo se lee sin cargar tensores: solo su cabecera."));
    const escanear = el("button", "primary hub-mini", "Escanear models/");
    escanear.type = "button";
    escanear.addEventListener("click", async () => {
      try {
        const r = await api("/api/hub/import", { cuerpo: { scan: true } });
        avisar(`Escaneo: ${r.registrados.length} nuevos, ${r.errores.length} errores`, r.errores.length ? "warn" : "ok");
        await refrescar();
        window.dispatchEvent(new CustomEvent("bonsai:modelos-cambiados"));
      } catch (err) { avisar(`No se pudo escanear: ${err.message}`, "error"); }
    });
    const ruta = el("input");
    ruta.type = "text";
    ruta.placeholder = "C:\\ruta\\modelo.gguf";
    const importar = el("button", "primary hub-mini", "Copiar e importar");
    importar.type = "button";
    importar.addEventListener("click", async () => {
      if (!ruta.value.trim()) return;
      importar.disabled = true;
      try {
        const r = await api("/api/hub/import", { cuerpo: { ruta: ruta.value.trim() }, timeout: 300000 });
        avisar(`${r.modelo.nombre} registrado`, "ok");
        await refrescar();
        window.dispatchEvent(new CustomEvent("bonsai:modelos-cambiados"));
      } catch (err) { avisar(`No se pudo importar: ${err.message}`, "error"); }
      finally { importar.disabled = false; }
    });
    caja.append(escanear, ruta, importar);
    return caja;
  }

  function cuerpo() {
    if (!estado.catalogo) return el("p", "hub-vacio", "Cargando catálogo…");
    if (estado.pestana === "descubrir") return vistaDescubrir();
    if (estado.pestana === "instalados") return vistaInstalados();
    if (estado.pestana === "buscar") return estado.repo ? vistaRepo() : vistaBuscar();
    if (estado.pestana === "url") return vistaUrl();
    if (estado.pestana === "importar") return vistaImportar();
    return vistaRecomendados();
  }

  function pintar() {
    if (!capa) return;
    const caja = $(".hub-dialog", capa);
    caja.innerHTML = "";
    caja.append(cabecera(), barraPestanas());
    const slot = el("div");
    slot.id = "hub-jobs-slot";
    const jobs = barraDescargas();
    if (jobs) slot.append(jobs);
    caja.append(slot);
    const scroll = el("div", "hub-body");
    scroll.append(cuerpo());
    caja.append(scroll);
    const pie = el("p", "hub-pie", `models/: ${estado.catalogo?.modelosDir || "?"} · VRAM libre ${Number(estado.catalogo?.vram?.libreMiB || 0).toLocaleString("es-ES")} / ${Number(estado.catalogo?.vram?.totalMiB || 0).toLocaleString("es-ES")} MiB · los pesos nunca salen de tu equipo.`);
    caja.append(pie);
  }

  async function refrescar() {
    try {
      const primera = !estado.catalogo;
      const [cat, jobs] = await Promise.all([
        api("/api/hub/catalog", { timeout: 60000 }),
        api("/api/hub/downloads"),
      ]);
      estado.catalogo = cat;
      estado.trabajos = jobs.trabajos || [];
      // Detecta el paso a "listo" para avisar y refrescar el selector de modelos.
      let cambioListo = false;
      for (const t of estado.trabajos) {
        if (t.estado === "listo" && estado.ultimoListo !== t.id) {
          estado.ultimoListo = t.id;
          cambioListo = true;
          avisar(`${t.nombre} instalado. Ya puedes usarlo.`, "ok", 7000);
          window.dispatchEvent(new CustomEvent("bonsai:modelos-cambiados"));
        }
      }
      if (primera || cambioListo) pintar();
      else actualizarJobs();
    } catch (err) {
      estado.error = err.message;
      if (!estado.catalogo) {
        estado.catalogo = { modelos: [], instalados: [], vram: {}, modelosDir: "?" };
        pintar();
        const cuerpo = $(".hub-body", capa);
        if (cuerpo) cuerpo.append(el("p", "hub-vacio", `No se pudo cargar el catálogo: ${err.message}. ¿Está el ui-server actualizado?`));
      }
    }
  }

  function actualizarJobs() {
    if (!capa) return;
    const slot = $("#hub-jobs-slot", capa);
    if (!slot) return;
    slot.innerHTML = "";
    const jobs = barraDescargas();
    if (jobs) slot.append(jobs);
  }

  function arrancarPoll() {
    if (temporizador) clearInterval(temporizador);
    temporizador = setInterval(() => {
      if (!capa) return;
      const activos = estado.trabajos.some((t) => ["descargando", "verificando", "instalando"].includes(t.estado));
      if (activos || document.visibilityState === "visible") void refrescar();
    }, 1200);
  }

  async function descargar(pedido, boton) {
    if (boton) { boton.disabled = true; boton.textContent = "Preparando…"; }
    try {
      const r = await api("/api/hub/download", { cuerpo: pedido, timeout: 120000 });
      avisar(`Descarga iniciada: ${r.trabajo?.nombre || pedido.clave || pedido.repo || pedido.url}`, "ok");
      estado.ultimoListo = "";
      await refrescar();
      arrancarPoll();
    } catch (err) {
      avisar(`No se pudo iniciar la descarga: ${err.message}`, "error", 9000);
    } finally {
      if (boton) { boton.disabled = false; boton.textContent = "Descargar"; }
    }
  }

  async function usarModelo(clave, nombre, opciones = {}) {
    if (!clave) return;
    const ctx = Number(opciones.contexto) || 0;
    const cuerpo = ctx
      ? { clave, enginePreset: "CUSTOM", contexto: ctx, kv: opciones.kv || "q8_0", vision: Boolean(opciones.vision), auto: false }
      : { clave, auto: true };
    const cerrar = avisar(ctx
      ? `Cargando ${nombre || clave} con ${Math.round(ctx / 1024)}k de contexto…`
      : `Cargando ${nombre || clave} con el plan automático…`, "warn", 0);
    try {
      const r = await api("/api/modelos", { cuerpo, timeout: 600000 });
      cerrar();
      avisar(`${r.nombre || nombre || clave} listo · ventana ${r.nCtx} tok${r.pensar ? ` · razona ${r.pensar}` : ""}`, "ok", 7000);
      window.dispatchEvent(new CustomEvent("bonsai:modelos-cambiados"));
      await refrescar();
    } catch (err) {
      cerrar();
      avisar(`No se pudo usar ${nombre || clave}: ${err.message}`, "error", 10000);
    }
  }

  async function verPlan(clave) {
    try {
      const r = await api(`/api/hub/plan?clave=${encodeURIComponent(clave)}`);
      const p = r.plan;
      const moe = p.moe?.activo
        ? `\nMoE: ${p.moe.capasGpu}/${p.moe.capas} capas en GPU (${p.moe.gpuExpertosMiB} MiB), ${p.moe.nCpuMoe} en RAM (${p.moe.expertosRamMiB} MiB), carga ${p.moe.loadMode}`
        : "";
      const texto = `${r.entrada.nombre}\n\nPlan: ${p.contexto} tokens · KV ${p.kv}${p.vision ? (p.mmprojCPU ? " · visión CPU" : " · visión GPU") : " · sin visión"}${moe}\nVRAM: ${p.totalMiB} MiB de ${p.libreMiB} MiB · pesos ${p.pesosMiB} + KV ${p.kvMiB} + reserva ${p.reservaMiB}\nAlternativas: f16 ${p.alternativas.f16.contexto} · q8_0 ${p.alternativas.q8_0.contexto} · q4_0 ${p.alternativas.q4_0.contexto}\n\n${p.motivo}`;
      await confirmar("Plan de motor", texto, "Cerrar");
    } catch (err) { avisar(`No se pudo calcular el plan: ${err.message}`, "error"); }
  }

  function cerrarHub() {
    if (temporizador) clearInterval(temporizador);
    temporizador = null;
    capa?.remove();
    capa = null;
    document.removeEventListener("keydown", tecla, true);
  }

  function tecla(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cerrarHub();
    }
  }

  function abrir() {
    if (capa) { capa.remove(); capa = null; }
    if (temporizador) clearInterval(temporizador);
    capa = el("div", "dialogo-fondo hub-fondo");
    const caja = el("div", "dialogo hub-dialog");
    caja.setAttribute("role", "dialog");
    caja.setAttribute("aria-modal", "true");
    caja.setAttribute("aria-label", "Model Hub");
    capa.append(caja);
    document.body.append(capa);
    capa.addEventListener("click", (e) => { if (e.target === capa) cerrarHub(); });
    document.addEventListener("keydown", tecla, true);
    estado = { catalogo: null, trabajos: [], pestana: "instalados", busqueda: "", resultados: [], descubiertos: [], descubriendo: false, descubrirError: "", repo: null, cargando: false, error: "", ultimoListo: "" };
    pintar();
    void refrescar();
    arrancarPoll();
  }

  // Botón visible de la barra superior y hooks para app.js.
  document.addEventListener("DOMContentLoaded", () => {
    const boton = document.getElementById("hub-abrir");
    if (boton) boton.addEventListener("click", abrir);
  });
  window.bonsaiHub = { abrir, cerrar: cerrarHub, refrescar, debug: () => estado };
})();
