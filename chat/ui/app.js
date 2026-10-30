/**
 * Bonsai · funciones de la interfaz (se carga el último, después de ide.js).
 *
 * Qué añade, sin tocar la estructura que ya funcionaba:
 *   · editor de verdad: pestañas, escritura, Ctrl+S, indicador de cambios y
 *     recarga automática cuando el agente reescribe el archivo;
 *   · paleta de comandos (Ctrl+P archivos, Ctrl+Shift+P comandos);
 *   · búsqueda en todo el proyecto (Ctrl+Shift+F);
 *   · tema claro/oscuro y panel de ajustes;
 *   · rama y cambios de git con commit;
 *   · reglas del proyecto (BONSAI.md, AGENTS.md, .cursor/rules);
 *   · avisos emergentes, menús y diálogos.
 *
 * Los `let`/`const`/`function` de primer nivel de index.html son globales: aquí se
 * leen y se reasignan (openFile, selectionInsideEditor, refreshTree) a propósito.
 */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /**
   * @param {string} tag
   * @param {string} [cls]
   * @param {string} [texto]
   * @returns {HTMLElement}
   */
  const el = (tag, cls, texto) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (texto !== undefined) n.textContent = texto;
    return n;
  };

  /**
   * Petición a la API propia. Siempre JSON, y lanza si la respuesta no es 2xx.
   * @param {string} ruta
   * @param {{metodo?: string, cuerpo?: unknown}} [opciones]
   */
  async function api(ruta, opciones = {}) {
    const timeout = ruta === "/api/modelos" || ruta === "/api/servidor" ? 300000 : ruta === "/api/edit" ? 180000 : 15000;
    const init = { method: opciones.metodo || "GET", cache: "no-store", signal: AbortSignal.timeout(timeout) };
    if (opciones.cuerpo !== undefined) {
      init.method = opciones.metodo || "POST";
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(opciones.cuerpo);
    }
    const res = await fetch(ruta, init);
    if (!res.ok) {
      const detalle = (await res.text()) || `HTTP ${res.status}`;
      const error = new Error(detalle);
      // El estado HTTP importa para distinguir un 409 (el archivo cambió en disco y no
      // hay que pisarlo) de un fallo genérico del servidor.
      error.status = res.status;
      throw error;
    }
    return res.status === 204 ? null : res.json();
  }

  // =========================================================== avisos emergentes
  // Un solo contenedor: index.html ya trae #avisos. Antes se creaba un segundo
  // `.avisos`, así que `avisar()` e `ide.js` pintaban toasts en cajas distintas y
  // cualquier selector `.avisos` (pruebas incluidas) podía leer la caja vacía.
  const avisos = document.getElementById("avisos") || el("div", "avisos");
  if (!avisos.isConnected) document.body.append(avisos);

  /**
   * @param {string} texto
   * @param {"" | "ok" | "error" | "warn"} [tipo]
   * @param {number} [ms]
   * @param {{texto: string, hacer: () => void}} [accion]
   */
  function avisar(texto, tipo = "", ms = 3600, accion) {
    const caja = el("div", `aviso ${tipo}`.trim());
    const icono = el("span");
    icono.innerHTML = tipo === "ok" ? ICO.check() : tipo === "error" ? ICO.alerta() : tipo === "warn" ? ICO.info() : ICO.info();
    const cuerpo = el("span", "a-txt", texto);
    caja.append(icono, cuerpo);
    if (accion) {
      const boton = el("button", "ghost", accion.texto);
      boton.type = "button";
      boton.style.padding = "3px 8px";
      boton.style.fontSize = "12px";
      boton.addEventListener("click", () => {
        accion.hacer();
        cerrar();
      });
      caja.append(boton);
    }
    const x = el("button", "a-x", "×");
    x.type = "button";
    x.setAttribute("aria-label", "Cerrar aviso");
    x.addEventListener("click", () => cerrar());
    caja.append(x);
    avisos.append(caja);
    let hecho = false;
    function cerrar() {
      if (hecho) return;
      hecho = true;
      caja.classList.add("sale");
      setTimeout(() => caja.remove(), 220);
    }
    if (ms > 0) setTimeout(cerrar, ms);
    return cerrar;
  }
  window.bonsaiAvisar = avisar;

  // ==================================================================== diálogo
  /**
   * @param {{titulo: string, texto?: string, valor?: string, ok?: string, placeholder?: string}} opciones
   * @returns {Promise<string | null>} el texto, o null si se cancela
   */
  function preguntar(opciones) {
    return new Promise((resolve) => {
      const fondo = el("div", "dialogo-fondo");
      const caja = el("div", "dialogo");
      const h = el("h3", "", opciones.titulo);
      caja.append(h);
      if (opciones.texto) caja.append(el("p", "", opciones.texto));
      const input = el("input");
      input.type = "text";
      input.value = opciones.valor || "";
      input.placeholder = opciones.placeholder || "";
      caja.append(input);
      const botones = el("div", "d-botones");
      const cancelar = el("button", "ghost", "Cancelar");
      cancelar.type = "button";
      const aceptar = el("button", "primary", opciones.ok || "Aceptar");
      aceptar.type = "button";
      botones.append(cancelar, aceptar);
      caja.append(botones);
      fondo.append(caja);
      document.body.append(fondo);
      accesibilizarDialogo(fondo, caja, h);
      input.focus();
      input.select();

      const cerrar = (valor) => {
        fondo.remove();
        document.removeEventListener("keydown", tecla, true);
        resolve(valor);
      };
      /** @param {KeyboardEvent} e */
      const tecla = (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          cerrar(null);
        } else if (e.key === "Enter" && document.activeElement === input) {
          e.stopPropagation();
          cerrar(input.value);
        }
      };
      document.addEventListener("keydown", tecla, true);
      cancelar.addEventListener("click", () => cerrar(null));
      aceptar.addEventListener("click", () => cerrar(input.value));
      fondo.addEventListener("click", (e) => {
        if (e.target === fondo) cerrar(null);
      });
    });
  }

  // ============================================================= menú flotante
  /** @type {HTMLElement | null} */
  let menuAbierto = null;
  /**
   * El MISMO clic que abre un menú (botón del chip de modelo, de git, la paleta) sigue
   * subiendo hasta `document`, y el listener que cierra el menú al pinchar fuera lo
   * cerraba en el acto: el menú no llegaba a verse. Se ignora ese clic de apertura.
   */
  let ignorarClicDeApertura = false;
  let dialogoSeq = 0;
  /** Diálogos abiertos, del más antiguo al más reciente: solo el último atrapa Tab. */
  const pilaDialogos = [];

  /**
   * Accesibilidad común de los diálogos: nombre accesible, modal real, foco atrapado
   * mientras están abiertos y devuelto al cerrarse. No mueve el foco de un panel que
   * el usuario esté usando al recargar contenido en segundo plano.
   * @param {HTMLElement} fondo
   * @param {HTMLElement} caja
   * @param {HTMLElement} titulo
   * @param {{onEscape?: () => void}} [opciones]
   */
  function accesibilizarDialogo(fondo, caja, titulo, { onEscape } = {}) {
    const tituloId = `dialogo-titulo-${++dialogoSeq}`;
    titulo.id = tituloId;
    caja.setAttribute("role", "dialog");
    caja.setAttribute("aria-modal", "true");
    caja.setAttribute("aria-labelledby", tituloId);
    const previo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const entrada = { fondo };
    pilaDialogos.push(entrada);
    const enfocables = () =>
      [...caja.querySelectorAll("button,[href],input,select,textarea,[tabindex]:not([tabindex='-1'])")]
        .filter((n) => !n.disabled && !n.hidden && n.getClientRects().length > 0);
    /** @param {KeyboardEvent} e */
    const tecla = (e) => {
      if (pilaDialogos[pilaDialogos.length - 1] !== entrada) return;
      if (e.key === "Escape" && onEscape) {
        e.preventDefault();
        e.stopPropagation();
        onEscape();
        return;
      }
      if (e.key !== "Tab") return;
      const lista = enfocables();
      if (!lista.length) {
        e.preventDefault();
        return;
      }
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      const activo = document.activeElement;
      if (e.shiftKey && (activo === primero || !caja.contains(activo))) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (activo === ultimo || !caja.contains(activo))) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener("keydown", tecla, true);
    const observador = new MutationObserver(() => {
      if (fondo.isConnected) return;
      observador.disconnect();
      document.removeEventListener("keydown", tecla, true);
      const indice = pilaDialogos.indexOf(entrada);
      if (indice >= 0) pilaDialogos.splice(indice, 1);
      if (previo?.isConnected) previo.focus();
    });
    observador.observe(document.body, { childList: true });
    const inicial = enfocables()[0];
    if (inicial) inicial.focus();
  }

  /**
   * Diálogo de sí/no (sin campo de texto), para confirmar borrados.
   * El foco empieza en Cancelar y Enter solo acepta si nace en el botón de aceptar:
   * así un Enter reflejo no borra nada.
   * @param {string} titulo
   * @param {string} texto
   * @param {string} [ok]
   * @returns {Promise<boolean>}
   */
  function confirmar(titulo, texto, ok = "Aceptar") {
    return new Promise((resolve) => {
      const fondo = el("div", "dialogo-fondo");
      const caja = el("div", "dialogo");
      const h = el("h3", "", titulo);
      caja.append(h, el("p", "", texto));
      const botones = el("div", "d-botones");
      const no = el("button", "ghost", "Cancelar");
      no.type = "button";
      const si = el("button", "primary", ok);
      si.type = "button";
      botones.append(no, si);
      caja.append(botones);
      fondo.append(caja);
      document.body.append(fondo);
      accesibilizarDialogo(fondo, caja, h);
      const cerrar = (valor) => {
        fondo.remove();
        document.removeEventListener("keydown", tecla, true);
        resolve(valor);
      };
      /** @param {KeyboardEvent} e */
      const tecla = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cerrar(false);
        } else if (e.key === "Enter" && e.target === si) {
          e.preventDefault();
          e.stopPropagation();
          cerrar(true);
        }
      };
      document.addEventListener("keydown", tecla, true);
      no.addEventListener("click", () => cerrar(false));
      si.addEventListener("click", () => cerrar(true));
      fondo.addEventListener("click", (e) => {
        if (e.target === fondo) cerrar(false);
      });
      no.focus();
    });
  }
  function cerrarMenu() {
    menuAbierto?.remove();
    menuAbierto = null;
  }
  /**
   * @param {number} x
   * @param {number} y
   * @param {Array<{texto: string, ico?: string, tecla?: string, hacer?: () => void, separador?: boolean} | null>} items
   */
  function menu(x, y, items) {
    cerrarMenu();
    const caja = el("div", "menu");
    for (const item of items) {
      if (!item) {
        caja.append(el("hr"));
        continue;
      }
      const b = el("button");
      b.type = "button";
      if (item.ico && ICO[item.ico]) {
        const s = el("span");
        s.innerHTML = ICO[item.ico]({ tam: 14 });
        b.append(s);
      }
      if (item.nota) {
        // Texto con una línea de explicación debajo (p. ej. para qué sirve cada modelo).
        const col = el("span", "m-col");
        col.append(el("span", "", item.texto), el("span", "m-nota", item.nota));
        b.append(col);
      } else {
        b.append(el("span", "", item.texto));
      }
      if (item.tecla) b.append(el("span", "m-key", item.tecla));
      if (!item.hacer) b.disabled = true;
      else b.addEventListener("click", () => {
        cerrarMenu();
        item.hacer?.();
      });
      caja.append(b);
    }
    document.body.append(caja);
    const r = caja.getBoundingClientRect();
    caja.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
    caja.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
    menuAbierto = caja;
    // El clic que abrió el menú aún tiene que llegar a `document` en este mismo despacho.
    ignorarClicDeApertura = true;
    setTimeout(() => {
      ignorarClicDeApertura = false;
    }, 0);
  }
  document.addEventListener("click", (e) => {
    if (ignorarClicDeApertura) return;
    if (menuAbierto && !(e.target instanceof Node && menuAbierto.contains(e.target))) cerrarMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") cerrarMenu();
  });

  // ================================================================== ajustes
  /** @type {{tema: string, perfil: string, pensar: number, reglas: boolean, historial: number}} */
  let ajustes = { tema: "slate", perfil: "codigo", pensar: 0, reglas: true, historial: 0, continuarAuto: true, saltosTope: 192, comandoSegundos: 180 };

  const TEMAS = [["slate","Grafito"],["ocean","Niebla azul"],["forest","Bosque"],["sand","Arena"],["light","Marfil"],["dark","Medianoche"]];
  function siguienteTema() { const i=TEMAS.findIndex(([v])=>v===ajustes.tema); return TEMAS[(i+1)%TEMAS.length][0]; }
  function aplicarTema(tema) {
    const elegido=TEMAS.find(([v])=>v===tema)||TEMAS[0];
    document.documentElement.dataset.theme = elegido[0];
    localStorage.setItem("bonsai-theme",elegido[0]);
    localStorage.setItem("bonsai-ver-pensamiento",ajustes.verPensamiento===false?"0":"1");
    const boton = $("#tema");
    if (boton) {boton.innerHTML = ICO.sol({ tam: 15 });boton.title=`Tema: ${elegido[1]} · cambiar`;boton.setAttribute("aria-label",boton.title);}
  }

  async function cargarAjustes() {
    try {
      ajustes = { ...ajustes, ...(await api("/api/settings")) };
    } catch {
      /* sin ajustes guardados: se usan los de defecto */
    }
    aplicarTema(ajustes.tema);
  }

  /** @param {Partial<typeof ajustes>} cambios */
  async function guardarAjustes(cambios) {
    try {
      ajustes = { ...ajustes, ...(await api("/api/settings", { cuerpo: cambios })) };
      aplicarTema(ajustes.tema);
      if (typeof pintarChipModelo === "function") pintarChipModelo();
    } catch (err) {
      avisar(`No se pudieron guardar los ajustes: ${err.message}`, "error");
    }
  }

  // ===================================================== pestañas + editor
  /** @type {{rel: string, texto: string, guardado: string, original: string, eol: string, truncado: boolean, bytes: number, cursor: number}[]} */
  const pestanas = [];
  let activa = -1;

  /**
   * El navegador convierte CRLF a LF dentro de un <textarea>. Se edita siempre en LF
   * y se reconstruye el estilo original al guardar. En archivos mixtos se conserva el
   * estilo dominante (política explícita: no se reescribe el archivo sin guardar).
   * @param {string} texto
   * @returns {{eol: string, mixto: boolean}}
   */
  function analizarSaltos(texto) {
    const crlf = (texto.match(/\r\n/g) || []).length;
    const lf = (texto.match(/(^|[^\r])\n/g) || []).length;
    return { eol: crlf > lf ? "\r\n" : "\n", mixto: crlf > 0 && lf > 0 };
  }

  /** @param {string} texto */
  function normalizarSaltos(texto) {
    return texto.replace(/\r\n/g, "\n");
  }

  /** @param {string} texto @param {string} eol */
  function restaurarSaltos(texto, eol) {
    return eol === "\r\n" ? texto.replace(/\n/g, "\r\n") : texto;
  }

  const editor = $("#editor");
  const code = $("#code");

  // Barra de pestañas (se inserta antes del título antiguo, que queda oculto).
  const tabs = el("div", "tabs");
  const tabbar = $(".tabbar");
  tabbar?.prepend(tabs);
  const tituloViejo = $("#tab");
  if (tituloViejo) tituloViejo.style.display = "none";

  // Barra de aviso del editor (truncado, sin guardar…).
  const nota = el("div", "editor-note");
  nota.hidden = true;

  // Capas del editor: números + resaltado + textarea transparente encima.
  const wrap = el("div", "editor-wrap");
  wrap.hidden = true;
  const scroll = el("div", "editor-scroll");
  const capas = el("div", "editor-layers");
  const numsLive = el("div", "nums-live");
  const stack = el("div", "stack");
  const hlPre = el("pre", "hl");
  const hl = el("code");
  hlPre.append(hl);
  const area = el("textarea");
  area.spellcheck = false;
  area.setAttribute("autocomplete", "off");
  area.setAttribute("autocapitalize", "off");
  area.setAttribute("wrap", "off");
  area.setAttribute("aria-label", "Editor de código");
  stack.append(hlPre, area);
  capas.append(numsLive, stack);
  scroll.append(capas);
  wrap.append(scroll);
  editor?.append(nota, wrap);

  const extension = (rel) => (rel.includes(".") ? rel.slice(rel.lastIndexOf(".") + 1) : "");
  const esEditable = (rel) => !/\.(png|jpe?g|gif|webp|ico|pdf|gguf|zip|exe|dll|woff2?|mp[34])$/i.test(rel);

  function pintarPestanas() {
    tabs.replaceChildren();
    pestanas.forEach((p, i) => {
      const b = el("button", `tab-item${i === activa ? " on" : ""}`);
      b.type = "button";
      b.title = p.rel;
      if (p.texto !== p.guardado) b.append(el("span", "dirty"));
      b.append(el("span", "tname", p.rel.split("/").pop() || p.rel));
      const x = el("button", "close", "×");
      x.type = "button";
      x.setAttribute("aria-label", `Cerrar ${p.rel}`);
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        cerrarPestana(i);
      });
      b.append(x);
      b.addEventListener("click", () => mostrarPestana(i));
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        menu(e.clientX, e.clientY, [
          { texto: "Guardar", ico: "guardar", tecla: "Ctrl+S", hacer: () => guardarPestana(p) },
          { texto: "Cerrar", ico: "cerrar", hacer: () => cerrarPestana(i) },
          null,
          { texto: "Cerrar las demás", hacer: () => cerrarOtras(i) },
          { texto: "Cerrar todas", hacer: () => cerrarTodas() },
        ]);
      });
      tabs.append(b);
    });
  }

  async function cerrarOtras(indice) {
    const conservar = pestanas[indice];
    const sucias = pestanas.filter((p) => p !== conservar && p.texto !== p.guardado && !p.truncado);
    if (sucias.length && !(await confirmar("Cerrar las demás pestañas", `${sucias.length} archivo(s) tienen cambios sin guardar. Se perderán si continúas.`, "Cerrar sin guardar"))) return;
    for (let i = pestanas.length - 1; i >= 0; i -= 1) if (i !== indice) pestanas.splice(i, 1);
    activa = pestanas.indexOf(conservar);
    mostrarPestana(activa);
  }

  async function cerrarTodas() {
    const sucias = pestanas.filter((p) => p.texto !== p.guardado && !p.truncado);
    if (sucias.length && !(await confirmar("Cerrar todas las pestañas", `${sucias.length} archivo(s) tienen cambios sin guardar. Se perderán si continúas.`, "Cerrar sin guardar"))) return;
    clearTimeout(temporizadorResaltado);
    pestanas.length = 0;
    activa = -1;
    pintarPestanas();
    pintarVacio();
  }

  /** Estado "sin archivo abierto". */
  function pintarVacio() {
    wrap.hidden = true;
    nota.hidden = true;
    if (code) {
      code.hidden = false;
      code.className = "empty-code";
      code.textContent = "Abre un archivo del explorador (o pulsa Ctrl+P). Puedes editarlo y guardar con Ctrl+S; el agente verá los cambios.";
    }
    opened = "";
    openedText = "";
    if (tituloViejo) tituloViejo.textContent = "Sin archivo";
    if (typeof paintTree === "function") paintTree();
  }

  /** @param {number} i @param {boolean} [enfocar] */
  function mostrarPestana(i, enfocar = true) {
    if (i < 0 || i >= pestanas.length) return;
    clearTimeout(temporizadorResaltado);
    // Guarda dónde estaba el cursor en la pestaña que se deja.
    if (activa >= 0 && pestanas[activa]) pestanas[activa].cursor = area.selectionStart;
    activa = i;
    const p = pestanas[i];
    opened = p.rel;
    openedText = p.texto;
    if (tituloViejo) tituloViejo.textContent = p.rel;
    if (code) code.hidden = true;
    wrap.hidden = false;
    area.value = p.texto;
    area.readOnly = p.truncado;
    area.classList.toggle("plain", !esEditable(p.rel));
    pintarResaltado(p);
    pintarNota(p);
    if (enfocar) area.focus({ preventScroll: true });
    area.setSelectionRange(Math.min(p.cursor, p.texto.length), Math.min(p.cursor, p.texto.length));
    pintarPestanas();
    if (typeof paintAttached === "function") paintAttached();
    if (typeof paintTree === "function") paintTree();
  }

  /** @param {typeof pestanas[number]} p */
  function pintarNota(p) {
    nota.replaceChildren();
    nota.classList.remove("danger");
    if (p.truncado) {
      nota.hidden = false;
      nota.classList.add("danger");
      nota.append(el("span", "", `Archivo grande (${Math.round(p.bytes / 1024)} KB): se muestra solo el principio. La edición está bloqueada para no guardarlo a medias.`));
      return;
    }
    if (p.texto !== p.guardado) {
      nota.hidden = false;
      const sp = el("span", "sp");
      nota.append(sp, el("span", "", "Cambios sin guardar"));
      const b = el("button", "ghost", "Guardar");
      b.type = "button";
      b.style.padding = "2px 8px";
      b.style.fontSize = "12px";
      b.addEventListener("click", () => guardarActiva());
      nota.append(b);
      return;
    }
    nota.hidden = true;
  }

  /** @param {typeof pestanas[number]} p */
  function pintarResaltado(p) {
    const texto = area.value;
    hl.innerHTML = esEditable(p.rel) && texto.length <= 120_000 ? BonsaiMd.highlight(texto, extension(p.rel)) : BonsaiMd.esc(texto);
    const lineas = texto.split("\n").length;
    numsLive.textContent = Array.from({ length: lineas }, (_, i) => String(i + 1)).join("\n");
  }

  let temporizadorResaltado = 0;
  area.addEventListener("input", () => {
    const p = pestanas[activa];
    if (!p) return;
    // El documento se actualiza sin espera. Solo el resaltado es diferido: de otro
    // modo Ctrl+S o cambiar de pestaña antes de 70 ms perdía la última escritura.
    p.texto = area.value;
    openedText = p.texto;
    p.cursor = area.selectionStart;
    clearTimeout(temporizadorResaltado);
    temporizadorResaltado = window.setTimeout(() => {
      if (pestanas[activa] !== p) return;
      pintarResaltado(p);
      pintarNota(p);
      pintarPestanas();
    }, 70);
  });

  // Tabula en vez de saltar de campo; Enter copia la sangría de la línea anterior.
  area.addEventListener("keydown", (e) => {
    const p = pestanas[activa];
    if (!p || p.truncado) return;
    const inicio = area.selectionStart;
    const fin = area.selectionEnd;
    if (e.key === "Tab") {
      e.preventDefault();
      const valor = area.value;
      if (inicio === fin) {
        if (e.shiftKey) {
          const iniLinea = valor.lastIndexOf("\n", inicio - 1) + 1;
          const sangria = valor.slice(iniLinea, iniLinea + 2);
          const quitar = sangria.startsWith("  ") ? 2 : sangria.startsWith(" ") || sangria.startsWith("\t") ? 1 : 0;
          if (quitar) {
            area.value = valor.slice(0, iniLinea) + valor.slice(iniLinea + quitar);
            area.setSelectionRange(inicio - quitar, inicio - quitar);
          }
        } else {
          area.value = `${valor.slice(0, inicio)}  ${valor.slice(fin)}`;
          area.setSelectionRange(inicio + 2, inicio + 2);
        }
      } else {
        // Con selección: desplaza el bloque entero.
        const desde = valor.lastIndexOf("\n", inicio - 1) + 1;
        const hasta = valor.indexOf("\n", fin) < 0 ? valor.length : valor.indexOf("\n", fin);
        const bloque = valor.slice(desde, hasta);
        const nuevo = e.shiftKey
          ? bloque.split("\n").map((l) => l.replace(/^( {1,2}|\t)/, "")).join("\n")
          : bloque.split("\n").map((l) => `  ${l}`).join("\n");
        area.value = valor.slice(0, desde) + nuevo + valor.slice(hasta);
        area.setSelectionRange(desde, desde + nuevo.length);
      }
      area.dispatchEvent(new Event("input"));
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      const iniLinea = area.value.lastIndexOf("\n", inicio - 1) + 1;
      const sangria = (area.value.slice(iniLinea, inicio).match(/^[ \t]*/) || [""])[0];
      const extra = /[{([]\s*$/.test(area.value.slice(iniLinea, inicio)) ? "  " : "";
      if (sangria || extra) {
        e.preventDefault();
        const insercion = `\n${sangria}${extra}`;
        area.value = area.value.slice(0, inicio) + insercion + area.value.slice(fin);
        area.setSelectionRange(inicio + insercion.length, inicio + insercion.length);
        area.dispatchEvent(new Event("input"));
      }
    }
  });

  /** @param {string} rel @param {number} [cursor] */
  async function abrirArchivo(rel, cursor = 0) {
    const ya = pestanas.findIndex((p) => p.rel === rel);
    if (ya >= 0) {
      mostrarPestana(ya);
      return;
    }
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(rel)}`);
      if (!res.ok) {
        avisar(`No se pudo abrir ${rel}`, "error");
        return;
      }
      const crudo = await res.text();
      const saltos = analizarSaltos(crudo);
      const texto = normalizarSaltos(crudo);
      const truncado = res.headers.get("X-Bonsai-Truncado") === "1";
      // Dos clics mientras carga no deben abrir dos copias del mismo documento.
      const existente = pestanas.findIndex((p) => p.rel === rel);
      if (existente >= 0) { mostrarPestana(existente); return; }
      pestanas.push({ rel, texto, guardado: texto, original: crudo, eol: saltos.eol, truncado, bytes: Number(res.headers.get("X-Bonsai-Bytes")) || texto.length, cursor });
      mostrarPestana(pestanas.length - 1);
    } catch (err) {
      avisar(`No se pudo abrir ${rel}: ${err.message}`, "error");
    }
  }

  /** Guarda la pestaña activa. @param {boolean} [silencioso] */
  async function guardarActiva(silencioso = false) {
    return guardarPestana(pestanas[activa], silencioso);
  }

  async function guardarPestana(p, silencioso = false) {
    if (!p) return false;
    // Serializa guardados del MISMO archivo sin bloquear los de las demás pestañas.
    while (p.guardando) await p.guardando;
    if (p.truncado) {
      avisar("Ese archivo se abrió recortado: no se guarda para no dejarlo a medias.", "warn");
      return false;
    }
    if (p.texto === p.guardado) {
      if (!silencioso) avisar("No hay cambios que guardar.", "", 1800);
      return true;
    }
    const enviado = p.texto;
    const contenido = restaurarSaltos(enviado, p.eol);
    const ruta = p.rel;
    const operacion = api("/api/file", { cuerpo: { path: ruta, content: contenido, before: p.original } });
    p.guardando = operacion.catch(() => {});
    try {
      await operacion;
      // Si se siguió escribiendo durante la petición, lo nuevo sigue sin guardar.
      p.guardado = enviado;
      p.original = contenido;
      if (pestanas[activa] === p) pintarNota(p);
      pintarPestanas();
      if (!silencioso) avisar(`Guardado ${p.rel}`, "ok", 2200);
      return true;
    } catch (err) {
      avisar(`No se pudo guardar: ${err.message}`, "error", 6000);
      return false;
    } finally {
      p.guardando = null;
    }
  }

  /** @param {number} i */
  async function cerrarPestana(i) {
    const p = pestanas[i];
    if (!p) return;
    if (p.texto !== p.guardado && !p.truncado) {
      if (!(await confirmar(`«${p.rel}» tiene cambios sin guardar`, "Si cierras ahora se pierden.", "Cerrar sin guardar"))) return;
    }
    const indice = pestanas.indexOf(p);
    if (indice < 0) return;
    const anterior = pestanas[activa];
    pestanas.splice(indice, 1);
    if (!pestanas.length) {
      activa = -1;
      pintarPestanas();
      pintarVacio();
      return;
    }
    activa = anterior !== p ? pestanas.indexOf(anterior) : Math.min(indice, pestanas.length - 1);
    mostrarPestana(activa);
  }

  // Reemplaza las funciones del script principal manteniendo su comportamiento.
  window.openFile = abrirArchivo;
  // Puente para paneles.js (diagnósticos, esquema, ir a definición): estado del editor y salto a línea.
  /** @returns {{rel: string, texto: string, linea: number, columna: number} | null} */
  window.bonsaiEditor = () => {
    const p = pestanas[activa];
    if (!p) return null;
    const antes = area.value.slice(0, area.selectionStart);
    return { rel: p.rel, texto: area.value, linea: antes.split(/\r?\n/).length, columna: antes.length - antes.lastIndexOf("\n"), cursor: area.selectionStart };
  };
  /** Abre el archivo y deja el cursor en la línea indicada (1-based). */
  window.bonsaiAbrirLinea = async (rel, linea = 1) => {
    if (!rel) return;
    await abrirArchivo(rel, 0);
    const p = pestanas.find((x) => x.rel === rel);
    if (!p) return;
    const lineas = p.texto.split(/\r?\n/);
    const l = Math.max(1, Math.min(lineas.length, Number(linea) || 1));
    let off = 0;
    for (let i = 0; i < l - 1; i += 1) off += (lineas[i] || "").length + 1;
    mostrarPestana(pestanas.indexOf(p));
    area.value = p.texto;
    area.focus();
    area.setSelectionRange(off, Math.min(area.value.length, off + 1));
    const alto = Number.parseInt(getComputedStyle(area).lineHeight, 10) || 18;
    area.scrollTop = Math.max(0, (l - 2) * alto - 40);
  };
  window.bonsaiAvisar = avisar;
  window.selectionInsideEditor = function selectionInsideEditor() {
    const p = pestanas[activa];
    if (!p || area.selectionStart === area.selectionEnd) return null;
    const texto = area.value.slice(area.selectionStart, area.selectionEnd);
    if (!texto.trim()) return null;
    const inicio = area.value.slice(0, area.selectionStart).split("\n").length;
    return { start: inicio, end: inicio + texto.split("\n").length - 1, text: texto };
  };

  // Si el agente reescribe el archivo abierto, se recarga solo (salvo si hay
  // cambios sin guardar: entonces se avisa y decide el usuario).
  let comprobando = false;
  async function comprobarCambiosExternos() {
    const p = pestanas[activa];
    if (!p || comprobando || document.hidden || p.truncado || p.guardando) return;
    comprobando = true;
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(p.rel)}`, { cache: "no-store" });
      if (!res.ok) return;
      const crudo = await res.text();
      const saltos = analizarSaltos(crudo);
      const texto = normalizarSaltos(crudo);
      if (!pestanas.includes(p) || p.guardando) return;
      if (texto === p.guardado) {
        // El disco no cambió (o solo cambió su estilo de salto): refresca el original.
        p.original = crudo;
        p.eol = saltos.eol;
        return;
      }
      if (p.texto !== p.guardado) {
        if (p.conflicto === texto) return;
        p.conflicto = texto;
        avisar(`«${p.rel}» cambió en disco y tienes cambios sin guardar.`, "warn", 8000, {
          texto: "Recargar",
          hacer: () => {
            p.texto = texto;
            p.guardado = texto;
            p.original = crudo;
            p.eol = saltos.eol;
            p.conflicto = null;
            if (pestanas[activa] === p) mostrarPestana(activa, false);
          },
        });
        return;
      }
      p.texto = texto;
      p.guardado = texto;
      p.original = crudo;
      p.eol = saltos.eol;
      if (pestanas[activa] === p) mostrarPestana(activa, false);
      avisar(`«${p.rel}» se recargó: el agente lo reescribió.`, "", 2600);
    } catch {
      /* el servidor no responde: se reintenta en el siguiente ciclo */
    } finally {
      comprobando = false;
    }
  }
  setInterval(comprobarCambiosExternos, 2500);

  // ======================================================= paleta de comandos
  /** @type {{tipo: string, texto: string, ico?: string, detalle?: string, hacer: () => void}[]} */
  const COMANDOS = [];
  function registrarComandos() {
    COMANDOS.push(
      { tipo: "comando", texto: "Cambiar de modelo (descarga el actual y carga el otro)", ico: "cpu", hacer: () => menuModelos() },
      { tipo: "comando", texto: "Editar la selección con el modelo (Ctrl+K)", ico: "chispa", detalle: "Ctrl+K", hacer: () => void editarSeleccion() },
      { tipo: "comando", texto: "Nuevo archivo", ico: "archivoNuevo", hacer: () => void nuevoArchivo() },
      { tipo: "comando", texto: "Nueva carpeta", ico: "carpeta", hacer: () => void nuevaCarpeta() },
      { tipo: "comando", texto: "Guardar el archivo activo", ico: "guardar", detalle: "Ctrl+S", hacer: () => guardarActiva() },
      { tipo: "comando", texto: "Buscar en todo el proyecto", ico: "buscar", detalle: "Ctrl+Shift+F", hacer: () => abrirBusqueda() },
      ...TEMAS.map(([tema,nombre])=>({tipo:"comando",texto:`Tema: ${nombre}`,ico:"sol",hacer:()=>guardarAjustes({tema})})),
      { tipo: "comando", texto: "Ajustes", ico: "ajustes", hacer: () => abrirAjustes() },
      { tipo: "comando", texto: "Estado de git / hacer commit", ico: "rama", hacer: () => menuGit() },
      { tipo: "comando", texto: "Reglas del proyecto", ico: "reglas", hacer: () => verReglas() },
      { tipo: "comando", texto: "Restablecer distribucion de paneles", ico: "panelIzq", hacer: () => window.bonsaiResetLayout?.() },
      { tipo: "comando", texto: "Cerrar todas las pestañas", ico: "cerrar", hacer: () => cerrarTodas() },
      { tipo: "comando", texto: "Nueva conversación", ico: "mas", hacer: () => $("#nuevo")?.click() },
      { tipo: "comando", texto: "Mostrar / ocultar el explorador", ico: "carpeta", detalle: "Ctrl+B", hacer: () => $("#tog-files")?.click() },
      { tipo: "comando", texto: "Mostrar / ocultar el historial", ico: "historial", hacer: () => $("#tog-history")?.click() },
      { tipo: "comando", texto: "Mostrar / ocultar el chat", ico: "mensaje", hacer: () => $("#tog-chat")?.click() },
      { tipo: "comando", texto: "Cambiar la carpeta de trabajo", ico: "carpetaProyecto", hacer: () => $("#carpeta")?.click() },
      { tipo: "comando", texto: "Ayuda", ico: "libro", hacer: () => $("#ayuda")?.click() },
    );
  }

  let paletaFondo = null;
  /**
   * @param {"archivos" | "comandos"} modo
   */
  async function abrirPaleta(modo) {
    if (paletaFondo) return;
    /** @type {typeof COMANDOS} */
    let items = modo === "comandos" ? COMANDOS.slice() : [];
    if (modo === "archivos") {
      try {
        const datos = await api("/api/workspace");
        items = (datos.files || []).map((f) => ({
          tipo: "archivo",
          texto: f.rel,
          ico: "archivo",
          detalle: `${Math.max(1, Math.round((f.bytes || 0) / 1024))} KB`,
          hacer: () => abrirArchivo(f.rel),
        }));
      } catch {
        avisar("No se pudo leer la lista de archivos", "error");
        return;
      }
    }

    paletaFondo = el("div", "paleta-fondo");
    const caja = el("div", "paleta");
    const input = el("input");
    input.type = "text";
    input.placeholder = modo === "comandos" ? "Escribe un comando…" : "Escribe para buscar un archivo…";
    input.setAttribute("aria-label", input.placeholder);
    const lista = el("ul");
    lista.setAttribute("role", "listbox");
    caja.append(input, lista);
    paletaFondo.append(caja);
    document.body.append(paletaFondo);

    let filtrados = items.slice(0, 60);
    let sel = 0;

    function pintar() {
      lista.replaceChildren();
      if (!filtrados.length) {
        lista.append(el("li", "p-grupo", "Sin resultados"));
        return;
      }
      filtrados.forEach((it, i) => {
        const li = el("li");
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", i === sel ? "true" : "false");
        if (it.ico && ICO[it.ico]) {
          const s = el("span");
          s.innerHTML = ICO[it.ico]({ tam: 15 });
          li.append(s);
        }
        li.append(el("span", "p-txt", it.texto));
        if (it.detalle) li.append(el("span", "p-hint", it.detalle));
        li.addEventListener("click", () => elegir(i));
        li.addEventListener("mousemove", () => {
          if (sel !== i) {
            sel = i;
            pintar();
          }
        });
        lista.append(li);
      });
      lista.children[sel]?.scrollIntoView({ block: "nearest" });
    }

    function filtrar() {
      const q = input.value.trim().toLowerCase();
      const base = q
        ? items.filter((it) => it.texto.toLowerCase().includes(q) || (it.detalle || "").toLowerCase().includes(q))
        : items;
      // Los que empiezan por lo escrito van primero: es lo que se espera al teclear.
      filtrados = base
        .slice()
        .sort((a, b) => Number(b.texto.toLowerCase().startsWith(q)) - Number(a.texto.toLowerCase().startsWith(q)))
        .slice(0, 60);
      sel = 0;
      pintar();
    }

    function elegir(i) {
      const it = filtrados[i];
      cerrar();
      it?.hacer();
    }

    function cerrar() {
      paletaFondo?.remove();
      paletaFondo = null;
      document.removeEventListener("keydown", tecla, true);
    }

    /** @param {KeyboardEvent} e */
    const tecla = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cerrar();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        sel = Math.min(sel + 1, filtrados.length - 1);
        pintar();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        sel = Math.max(sel - 1, 0);
        pintar();
      } else if (e.key === "Enter") {
        e.preventDefault();
        elegir(sel);
      }
    };

    input.addEventListener("input", filtrar);
    document.addEventListener("keydown", tecla, true);
    paletaFondo.addEventListener("click", (e) => {
      if (e.target === paletaFondo) cerrar();
    });
    pintar();
    input.focus();
  }

  // ======================================================= búsqueda en proyecto
  function abrirBusqueda() {
    const fondo = el("div", "paleta-fondo");
    const caja = el("div", "paleta");
    const input = el("input");
    input.type = "search";
    input.placeholder = "Buscar en todo el proyecto (mínimo 2 caracteres)";
    const lista = el("ul");
    caja.append(input, lista);
    fondo.append(caja);
    document.body.append(fondo);

    let temporizador = 0;
    async function buscar() {
      const q = input.value.trim();
      lista.replaceChildren();
      if (q.length < 2) return;
      lista.append(el("li", "p-grupo", "Buscando…"));
      try {
        const datos = await api(`/api/search?q=${encodeURIComponent(q)}&limit=80`);
        lista.replaceChildren();
        if (!datos.resultados.length) {
          lista.append(el("li", "p-grupo", "Sin coincidencias"));
          return;
        }
        const porArchivo = new Map();
        for (const r of datos.resultados) {
          if (!porArchivo.has(r.rel)) porArchivo.set(r.rel, []);
          porArchivo.get(r.rel).push(r);
        }
        for (const [rel, coincidencias] of porArchivo) {
          lista.append(el("li", "p-grupo", `${rel} · ${coincidencias.length}`));
          for (const c of coincidencias) {
            const li = el("li");
            li.append(el("span", "p-hint", `${c.linea}`));
            li.append(el("span", "p-txt", c.texto));
            li.addEventListener("click", () => {
              cerrar();
              abrirArchivo(rel, 0);
            });
            lista.append(li);
          }
        }
      } catch (err) {
        lista.replaceChildren(el("li", "p-grupo", `Error: ${err.message}`));
      }
    }

    function cerrar() {
      fondo.remove();
      document.removeEventListener("keydown", tecla, true);
    }
    /** @param {KeyboardEvent} e */
    const tecla = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cerrar();
      }
    };
    input.addEventListener("input", () => {
      clearTimeout(temporizador);
      temporizador = window.setTimeout(buscar, 220);
    });
    document.addEventListener("keydown", tecla, true);
    fondo.addEventListener("click", (e) => {
      if (e.target === fondo) cerrar();
    });
    input.focus();
  }

  // ====================================================================== git
  /** @type {{repo: boolean, rama?: string, archivos?: {estado: string, rel: string}[], ultimo?: {hash: string, asunto: string, cuando: string}}} */
  let estadoGit = { repo: false };

  let gitEnCurso = false;
  async function refrescarGit() {
    if (gitEnCurso || document.hidden) return;
    gitEnCurso = true;
    try {
      estadoGit = await api("/api/git");
      pintarChipGit();
    } catch {
      estadoGit = { repo: false };
      pintarChipGit();
    } finally {
      gitEnCurso = false;
    }
  }

  function pintarChipGit() {
    const chip = $("#git-chip");
    if (!chip) return;
    if (!estadoGit.repo) {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;
    const n = estadoGit.archivos?.length || 0;
    chip.className = `pill${n ? " warn" : ""}`;
    chip.innerHTML = "";
    chip.append(el("i", "dot"));
    chip.append(el("span", "", `${estadoGit.rama}${n ? ` · ${n}` : ""}`));
    chip.title = n ? `${n} archivo(s) con cambios` : "Sin cambios pendientes";
  }

  function menuGit() {
    if (!estadoGit.repo) {
      avisar("Esta carpeta no es un repositorio git.", "warn");
      return;
    }
    const chip = $("#git-chip");
    const r = chip?.getBoundingClientRect();
    const items = [
      { texto: `Rama: ${estadoGit.rama}`, ico: "rama" },
      estadoGit.ultimo ? { texto: `${estadoGit.ultimo.hash} ${estadoGit.ultimo.asunto}`.slice(0, 60), ico: "commit" } : null,
      null,
      {
        texto: `Elegir archivos para commit (${estadoGit.archivos?.length || 0})`,
        ico: "commit",
        hacer: async () => {
          const n = estadoGit.archivos?.length || 0;
          if (!n) {
            avisar("No hay cambios que commitear.", "", 2200);
            return;
          }
          const archivos = await elegirArchivosCommit(estadoGit.archivos);
          if (!archivos?.length) return;
          let sugerido = "cambios desde la interfaz";
          try {
            sugerido = `bonsai: ${archivos.slice(0, 3).join(", ")}`.slice(0, 72);
          } catch {
            /* se queda el generico */
          }
          const mensaje = await preguntar({
            titulo: "Commit",
            texto: `Se confirmarán únicamente los ${archivos.length} archivo(s) elegidos, con su contenido actual.`,
            valor: sugerido,
            ok: "Commit",
          });
          if (!mensaje) return;
          try {
            const r2 = await api("/api/git", { cuerpo: { op: "commit", mensaje, archivos } });
            avisar(r2.ok ? "Commit hecho." : `Git dijo: ${r2.salida.slice(0, 120)}`, r2.ok ? "ok" : "warn", 5000);
            refrescarGit();
          } catch (err) {
            avisar(`No se pudo commitear: ${err.message}`, "error");
          }
        },
      },
      { texto: "Ver cambios pendientes", ico: "diff", hacer: () => verCambiosGit() },
      null,
      { texto: "Actualizar estado", ico: "recargar", hacer: () => refrescarGit() },
    ];
    menu(r?.left || 100, (r?.bottom || 40) + 4, items);
  }

  /** El usuario elige nombres concretos; ningún archivo queda marcado automáticamente. */
  function elegirArchivosCommit(archivos) {
    return new Promise((resolve) => {
      const fondo = el("div", "dialogo-fondo");
      const caja = el("div", "dialogo");
      caja.style.width = "min(680px, 94vw)";
      const h = el("h3", "", "Elegir archivos para el commit");
      caja.append(h);
      caja.append(el("p", "", "Marca solo los archivos que quieres incluir. Revisa especialmente los que contienen datos privados."));
      const lista = el("div");
      lista.style.cssText = "max-height:50vh;overflow:auto;font:12px/1.7 var(--mono);margin-bottom:16px";
      const checks = [];
      for (const a of archivos || []) {
        const fila = el("label");
        fila.style.cssText = "display:flex;align-items:center;gap:8px;padding:3px 0;overflow-wrap:anywhere";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.value = a.rel;
        checks.push(check);
        fila.append(check, el("span", "", `${a.estado} ${a.rel}${a.anterior ? ` ← ${a.anterior}` : ""}`));
        lista.append(fila);
      }
      caja.append(lista);
      const botones = el("div", "d-botones");
      const cancelar = el("button", "", "Cancelar");
      const elegir = el("button", "primary", "Continuar");
      cancelar.type = elegir.type = "button";
      const cerrar = (resultado) => { document.removeEventListener("keydown", tecla, true); fondo.remove(); resolve(resultado); };
      const tecla = (event) => { if (event.key === "Escape") { event.preventDefault(); cerrar(null); } };
      cancelar.addEventListener("click", () => cerrar(null));
      elegir.addEventListener("click", () => {
        const elegidos = checks.filter((c) => c.checked).map((c) => c.value);
        if (!elegidos.length) { avisar("Selecciona al menos un archivo.", "warn"); return; }
        cerrar(elegidos);
      });
      fondo.addEventListener("click", (event) => { if (event.target === fondo) cerrar(null); });
      document.addEventListener("keydown", tecla, true);
      botones.append(cancelar, elegir);
      caja.append(botones); fondo.append(caja); document.body.append(fondo);
      accesibilizarDialogo(fondo, caja, h);
      cancelar.focus();
    });
  }

  function verCambiosGit() {
    const n = estadoGit.archivos?.length || 0;
    if (!n) {
      avisar("Sin cambios pendientes.", "ok", 2200);
      return;
    }
    const fondo = el("div", "dialogo-fondo");
    const caja = el("div", "dialogo");
    caja.classList.add("settings-dialog");
    caja.style.width = "min(620px, 94vw)";
    const h = el("h3", "", "Cambios pendientes");
    caja.append(h);
    const lista = el("div");
    lista.style.cssText = "max-height:50vh;overflow:auto;font:12px/1.7 var(--mono);margin-bottom:16px";
    for (const a of estadoGit.archivos) {
      const fila = el("div");
      const clase = a.estado.includes("?") ? "git-q" : a.estado.includes("A") ? "git-a" : "git-m";
      const b = el("span", `badge ${clase}`, a.estado);
      fila.append(b, el("span", "", ` ${a.rel}`));
      lista.append(fila);
    }
    caja.append(lista);
    const botones = el("div", "d-botones");
    const cerrar = el("button", "primary", "Cerrar");
    cerrar.type = "button";
    cerrar.addEventListener("click", () => fondo.remove());
    botones.append(cerrar);
    caja.append(botones);
    fondo.append(caja);
    document.body.append(fondo);
    accesibilizarDialogo(fondo, caja, h, { onEscape: () => fondo.remove() });
    cerrar.focus();
  }

  // ============================== archivos: crear, renombrar y borrar
  /**
   * Normaliza una ruta relativa escrita a mano (barras y espacios sobrantes).
   * @param {string} rel
   * @returns {string}
   */
  const rutaLimpia = (rel) => String(rel || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");

  async function nuevoArchivo() {
    const rel = rutaLimpia(await preguntar({
      titulo: "Nuevo archivo",
      texto: "Ruta dentro de la carpeta de trabajo. Se crean las carpetas que falten.",
      valor: "nuevo.txt",
      ok: "Crear",
    }));
    if (!rel) return;
    try {
      await api("/api/fs", { cuerpo: { op: "nuevo", path: rel } });
      await refreshTree();
      await abrirArchivo(rel);
      avisar(`Creado ${rel}`, "ok", 2200);
    } catch (err) {
      avisar(`No se pudo crear: ${err.message}`, "error", 5000);
    }
  }

  async function nuevaCarpeta() {
    const rel = rutaLimpia(await preguntar({
      titulo: "Nueva carpeta",
      texto: "Ruta de la carpeta dentro de la carpeta de trabajo.",
      valor: "nueva-carpeta",
      ok: "Crear",
    }));
    if (!rel) return;
    try {
      await api("/api/fs", { cuerpo: { op: "carpeta", path: rel } });
      await refreshTree();
      avisar(`Creada ${rel}/`, "ok", 2200);
    } catch (err) {
      avisar(`No se pudo crear: ${err.message}`, "error", 5000);
    }
  }

  /** @param {string} rel */
  async function renombrarArchivo(rel) {
    const destino = rutaLimpia(await preguntar({
      titulo: `Renombrar «${rel}»`,
      texto: "Nueva ruta (vale para archivos y carpetas).",
      valor: rel,
      ok: "Renombrar",
    }));
    if (!destino || destino === rel) return;
    try {
      await api("/api/fs", { cuerpo: { op: "renombrar", path: rel, to: destino } });
      // La pestaña abierta sigue al archivo: si no, guardaría en la ruta vieja.
      for (const p of pestanas) {
        if (p.rel === rel) p.rel = destino;
        else if (p.rel.startsWith(`${rel}/`)) p.rel = destino + p.rel.slice(rel.length);
      }
      if (opened === rel || opened.startsWith(`${rel}/`)) opened = opened === rel ? destino : destino + opened.slice(rel.length);
      pintarPestanas();
      await refreshTree();
      avisar(`Renombrado a ${destino}`, "ok", 2600);
    } catch (err) {
      avisar(`No se pudo renombrar: ${err.message}`, "error", 5000);
    }
  }

  /** @param {string} rel */
  async function borrarArchivo(rel) {
    const ok = await confirmar(
      `Borrar «${rel}»`,
      "Se quita de la carpeta de trabajo. Solo los archivos de texto pequeños se pueden restaurar con el botón Deshacer del aviso; los binarios, los archivos grandes y las carpetas, no.",
      "Borrar",
    );
    if (!ok) return;
    try {
      const r = await api("/api/fs", { cuerpo: { op: "borrar", path: rel } });
      for (let i = pestanas.length - 1; i >= 0; i -= 1) {
        if (pestanas[i].rel === rel || pestanas[i].rel.startsWith(`${rel}/`)) pestanas.splice(i, 1);
      }
      if (pestanas.length) mostrarPestana(Math.min(activa < 0 ? 0 : activa, pestanas.length - 1));
      else {
        activa = -1;
        pintarPestanas();
        pintarVacio();
      }
      await refreshTree();
      if (r.undo) {
        avisar(`Borrado ${rel}`, "", 9000, {
          texto: "Deshacer",
          hacer: async () => {
            try {
              await api("/api/undo", { cuerpo: { id: r.undo } });
              await refreshTree();
              avisar(`Restaurado ${rel}`, "ok", 2400);
            } catch (err) {
              avisar(`No se pudo restaurar: ${err.message}`, "error", 5000);
            }
          },
        });
      } else {
        avisar(`Borrado ${rel} (no se puede deshacer)`, "", 4000);
      }
    } catch (err) {
      avisar(`No se pudo borrar: ${err.message}`, "error", 5000);
    }
  }

  /** Botones de la cabecera del explorador y menú contextual de cada fila. */
  function montarExplorador() {
    const cabecera = $("#files .pane-h");
    if (cabecera) {
      const grupo = el("div", "pane-acciones");
      const nuevo = el("button", "icon-btn");
      nuevo.type = "button";
      nuevo.title = "Nuevo archivo";
      nuevo.setAttribute("aria-label", "Nuevo archivo");
      nuevo.innerHTML = ICO.archivoNuevo({ tam: 15 });
      nuevo.addEventListener("click", () => nuevoArchivo());
      const carpeta = el("button", "icon-btn");
      carpeta.type = "button";
      carpeta.title = "Nueva carpeta";
      carpeta.setAttribute("aria-label", "Nueva carpeta");
      carpeta.innerHTML = ICO.carpeta({ tam: 15 });
      carpeta.addEventListener("click", () => nuevaCarpeta());
      grupo.append(nuevo, carpeta);
      cabecera.append(grupo);
    }
    const arbol = $("#tree");
    if (!arbol) return;
    arbol.addEventListener("contextmenu", (e) => {
      const fila = e.target instanceof Element ? e.target.closest(".row") : null;
      if (!fila) return;
      const rel = fila.querySelector(".name")?.textContent || "";
      if (!rel) return;
      e.preventDefault();
      const dentro = typeof hasFile === "function" && hasFile(rel);
      menu(e.clientX, e.clientY, [
        { texto: "Abrir", ico: "archivo", hacer: () => abrirArchivo(rel) },
        { texto: dentro ? "Quitar del mensaje" : "Incluir en el mensaje", ico: "mas", hacer: () => toggleInclude(rel) },
        null,
        { texto: "Renombrar…", ico: "lapiz", tecla: "F2", hacer: () => renombrarArchivo(rel) },
        { texto: "Borrar", ico: "papelera", hacer: () => borrarArchivo(rel) },
        null,
        { texto: "Nuevo archivo…", ico: "archivoNuevo", hacer: () => nuevoArchivo() },
        { texto: "Nueva carpeta…", ico: "carpeta", hacer: () => nuevaCarpeta() },
      ]);
    });
  }

  // =================================================================== reglas
  async function verReglas() {
    let datos = { fuentes: [], texto: "" };
    try {
      datos = await api("/api/rules");
    } catch {
      /* sin reglas */
    }
    const fondo = el("div", "dialogo-fondo");
    const caja = el("div", "dialogo");
    caja.style.width = "min(680px, 94vw)";
    const h = el("h3", "", "Convenios del proyecto");
    caja.append(h);
    caja.append(
      el(
        "p",
        "",
        datos.fuentes.length
          ? `Se están aplicando ${datos.fuentes.length} archivo(s): ${datos.fuentes.join(", ")}. Son datos de convención del proyecto (no instrucciones nuevas) que se inyectan como referencia.`
          : "No hay ninguna. Crea BONSAI.md, AGENTS.md o .cursor/rules/*.mdc en la carpeta de trabajo y se usarán como referencia.",
      ),
    );
    if (datos.texto) {
      const pre = el("pre");
      pre.style.cssText = "max-height:46vh;overflow:auto;font:12px/1.6 var(--mono);background:var(--ink);border:1px solid var(--line);border-radius:var(--r-sm);padding:10px;margin:0 0 16px";
      pre.textContent = datos.texto.slice(0, 6000);
      caja.append(pre);
    }
    const botones = el("div", "d-botones");
    const cerrar = el("button", "primary", "Cerrar");
    cerrar.type = "button";
    cerrar.addEventListener("click", () => fondo.remove());
    botones.append(cerrar);
    caja.append(botones);
    fondo.append(caja);
    document.body.append(fondo);
    accesibilizarDialogo(fondo, caja, h, { onEscape: () => fondo.remove() });
    cerrar.focus();
  }

  function pintarChipReglas() {
    const chip = $("#reglas-chip");
    if (!chip) return;
    api("/api/rules")
      .then((d) => {
        if (!d.fuentes?.length) {
          chip.hidden = true;
          return;
        }
        chip.hidden = false;
        chip.className = `pill${d.aplicado === false ? " warn" : ""}`;
        chip.innerHTML = "";
        chip.append(el("i", "dot"));
        chip.append(el("span", "", d.aplicado === false ? `Reglas: ${d.fuentes.length} (apagadas)` : `Reglas: ${d.fuentes.length}`));
        chip.title = `${d.fuentes.join("\n")}\n\n${d.aplicado === false ? "No se están aplicando: el ajuste está desactivado." : `Son datos de convención inyectados como referencia (tope ${d.topeTokens} tokens).`}`;
      })
      .catch(() => {
        chip.hidden = true;
      });
  }

  // ======================================== presupuesto real de contexto (finding 16)
  /**
   * Formatea un número de tokens para enseñarlo (— si no es un número).
   * @param {unknown} n
   * @returns {string}
   */
  const formatoTokens = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString("es-ES") : "—");

  /**
   * Pide a /api/state el presupuesto REAL: ventana del servidor, historial pedido,
   * historial efectivo y reserva de salida. Devuelve null si el servidor no lo da: la
   * interfaz prefiere no enseñar nada antes que prometer un contexto que no existe.
   * @returns {Promise<{ventana: number, solicitado: number | null, efectivo: number, reservaSalida: number, historial: {error?: string, carpeta?: string} | null} | null>}
   */
  async function leerPresupuesto() {
    try {
      const datos = await api("/api/state");
      const p = datos && datos.presupuesto;
      if (!p || !Number.isFinite(Number(p.ventana))) return null;
      return {
        ventana: Number(p.ventana),
        solicitado: Number.isFinite(Number(p.solicitado)) ? Number(p.solicitado) : null,
        efectivo: Number.isFinite(Number(p.efectivo)) ? Number(p.efectivo) : Number(p.ventana),
        reservaSalida: Number.isFinite(Number(p.reservaSalida)) ? Number(p.reservaSalida) : null,
        historial: datos.historial && typeof datos.historial === "object" ? datos.historial : null,
        diagnostico: datos.contextDiagnostics || null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Pinta los cuatro valores reales dentro del diálogo de Ajustes.
   * @param {HTMLElement} contenedor
   */
  async function pintarPresupuestoEn(contenedor) {
    contenedor.replaceChildren(el("p", "", "Consultando el presupuesto real del servidor…"));
    const datos = await leerPresupuesto();
    contenedor.replaceChildren();
    if (!datos) {
      const aviso = el(
        "p",
        "",
        "El servidor no informa del presupuesto real de contexto. El tope de historial es solo una petición: depende de la ventana con la que arrancó llama-server, así que aquí no se muestra un valor inventado.",
      );
      aviso.style.cssText = "color:var(--muted);font-size:12.5px;margin:0;line-height:1.5";
      contenedor.append(aviso);
      return;
    }
    const dl = el("dl");
    dl.style.cssText = "display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:6px 0 0;font-size:13px";
    /**
     * @param {string} etiqueta
     * @param {string} valor
     * @param {string} [detalle]
     */
    const dato = (etiqueta, valor, detalle) => {
      dl.append(el("dt", "", etiqueta));
      const dd = el("dd", "", valor);
      dd.style.cssText = "margin:0;font-family:var(--mono)";
      if (detalle) dd.title = detalle;
      dl.append(dd);
    };
    dato("Ventana del servidor", `${formatoTokens(datos.ventana)} tokens`, "Contexto con el que arrancó llama-server.");
    dato(
      "Historial solicitado",
      datos.auto || datos.solicitado === null ? "Automático (ventana − salida)" : `${formatoTokens(datos.solicitado)} tokens`,
      "Automático = todo el historial que quepa dejando la reserva para pensar y responder.",
    );
    dato("Historial efectivo", `${formatoTokens(datos.efectivo)} tokens`, "Lo que de verdad puede viajar como historial en cada petición.");
    dato(
      "Reserva de salida",
      datos.reservaSalida === null ? "—" : `${formatoTokens(datos.reservaSalida)} tokens`,
      "Tokens de la ventana reservados para la respuesta del modelo.",
    );
    contenedor.append(dl);
    const nota = el("p", "");
    nota.style.cssText = "color:var(--muted);font-size:12px;margin:8px 0 0;line-height:1.5";
    nota.textContent =
      `El tope de historial que elijas es una petición: con una ventana de ${formatoTokens(datos.ventana)} tokens, ` +
      `el historial efectivo es ${formatoTokens(datos.efectivo)} y la reserva de salida ${formatoTokens(datos.reservaSalida)}. ` +
      "No es VRAM libre: es el reparto de la misma ventana.";
    contenedor.append(nota);
    if (datos.solicitado !== null && datos.solicitado > datos.efectivo) {
      const recorte = el("p", "");
      recorte.style.cssText = "color:var(--warn);font-size:12px;margin:4px 0 0;line-height:1.5";
      recorte.textContent = `Pediste ${formatoTokens(datos.solicitado)} tokens de historial, pero el servidor solo entrega ${formatoTokens(datos.efectivo)} con esta ventana: la diferencia se recorta.`;
      contenedor.append(recorte);
    }
    if (datos.historial && datos.historial.error) {
      const error = el("p", "");
      error.style.cssText = "color:var(--danger);font-size:12px;margin:6px 0 0;line-height:1.5";
      error.textContent = datos.historial.error;
      contenedor.append(error);
    }
    if (datos.diagnostico) {
      const detalle = el("details"), titulo = el("summary", "", "Diagnóstico de la última petición"), pre = el("pre");
      pre.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;max-height:240px;overflow:auto";
      pre.textContent = JSON.stringify(datos.diagnostico, null, 2);
      detalle.append(titulo, pre); contenedor.append(detalle);
    }
  }

  /**
   * Chip de la barra de estado con lo que de verdad hay (ventana e historial efectivo).
   * Se oculta si el servidor no da el dato; nunca enseña el tope pedido como si fuera real.
   */
  async function actualizarChipPresupuesto() {
    const chip = $("#contexto-chip");
    if (!chip) return;
    const datos = await leerPresupuesto();
    if (!datos) {
      chip.hidden = true;
      return;
    }
    const k = (n) => (Number.isFinite(Number(n)) ? `${Math.round(Number(n) / 1024)}K` : "?");
    chip.hidden = false;
    chip.className = "pill";
    chip.replaceChildren(el("i", "dot"), el("span", "", `contexto ${k(datos.ventana)} · hist. ${k(datos.efectivo)}`));
    chip.title =
      `Ventana del servidor: ${formatoTokens(datos.ventana)} tokens\n` +
      `Historial solicitado: ${datos.solicitado === null ? "—" : `${formatoTokens(datos.solicitado)} tokens`}\n` +
      `Historial efectivo: ${formatoTokens(datos.efectivo)} tokens\n` +
      `Reserva de salida: ${datos.reservaSalida === null ? "—" : `${formatoTokens(datos.reservaSalida)} tokens`}\n\n` +
      "Pulsa para ver el detalle en Ajustes.";
    if (datos.historial && datos.historial.error) {
      chip.classList.add("warn");
      chip.title += `\n\n${datos.historial.error}`;
    }
  }

  // ============================================================ memoria global
  /**
   * Revisa, añade, edita y borra las notas que se comparten entre conversaciones.
   * El archivo vive en el estado local del IDE, nunca en el proyecto del usuario.
   */
  async function abrirMemoriaGlobal() {
    const fondo = el("div", "dialogo-fondo");
    const caja = el("div", "dialogo");
    caja.style.cssText = "width:min(760px,calc(100vw - 24px));max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow-y:auto;box-sizing:border-box";
    const h = el("h3", "", "Memoria global entre chats");
    caja.append(h);
    const estado = el("p");
    estado.style.cssText = "color:var(--muted);font-size:12px;line-height:1.5";
    caja.append(estado);
    const preview = el("p");
    preview.style.cssText = "color:var(--muted);font-size:12px;line-height:1.5";
    caja.append(preview);

    const buscar = el("input");
    buscar.type = "search";
    buscar.placeholder = "Probar relevancia: escribe un pedido y mira qué se inyectaría…";
    buscar.style.cssText = "width:100%;box-sizing:border-box;margin:4px 0 10px";
    caja.append(buscar);

    const nuevo = el("textarea");
    nuevo.rows = 2;
    nuevo.placeholder = "Nueva nota: una preferencia, una convención del proyecto o una decisión estable…";
    nuevo.style.cssText = "width:100%;box-sizing:border-box;resize:vertical";
    const etiquetas = el("input");
    etiquetas.placeholder = "etiquetas separadas por comas (opcional)";
    etiquetas.style.cssText = "flex:1;min-width:160px";
    const fijarNueva = el("input");
    fijarNueva.type = "checkbox";
    const agregar = el("button", "primary", "Añadir nota");
    agregar.type = "button";
    const controlesNueva = el("div");
    controlesNueva.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0 14px";
    const fijarNuevaEtiqueta = el("label", "", "fijar");
    fijarNuevaEtiqueta.style.cssText = "display:flex;gap:4px;align-items:center;font-size:12px;color:var(--muted)";
    fijarNuevaEtiqueta.prepend(fijarNueva);
    controlesNueva.append(etiquetas, fijarNuevaEtiqueta, agregar);
    caja.append(nuevo, controlesNueva);

    const lista = el("div");
    lista.style.cssText = "display:flex;flex-direction:column;gap:10px";
    caja.append(lista);

    const pie = el("div", "d-botones");
    pie.style.cssText = "margin-top:16px;justify-content:space-between;flex-wrap:wrap;gap:8px";
    const vaciar = el("button", "ghost", "Borrar toda la memoria");
    vaciar.type = "button";
    const cerrar = el("button", "primary", "Cerrar");
    cerrar.type = "button";
    const accionesPie = el("div");
    accionesPie.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
    accionesPie.append(vaciar, cerrar);
    pie.append(accionesPie);
    caja.append(pie);

    let temporizador = 0;
    const cargar = async () => {
      try {
        const consulta = buscar.value.trim();
        const datos = await api(`/api/memoria${consulta ? `?q=${encodeURIComponent(consulta)}` : ""}`);
        pintar(datos);
      } catch (err) {
        avisar(`No se pudo leer la memoria global: ${err.message}`, "error", 6000);
      }
    };

    function pintar(datos) {
      estado.textContent = `${datos.total} nota(s) · ${datos.fijadas} fijada(s) · ${datos.automaticas} automática(s) · ${formatoTokens(datos.tokensTotales)} tokens guardados · presupuesto ${formatoTokens(datos.config?.presupuesto ?? 0)} tokens por turno · ${datos.archivo}`;
      if (datos.seleccion) {
        preview.textContent = datos.seleccion.razon
          ? `Para ese pedido no se inyectaría nada: ${datos.seleccion.razon}.`
          : `Para ese pedido se inyectarían ${datos.seleccion.entradas.length} nota(s): ${formatoTokens(datos.seleccion.tokens)} de ${formatoTokens(datos.seleccion.presupuesto)} tokens.`;
      } else {
        preview.textContent = "Solo se envía lo relevante al pedido de cada turno (más las notas fijadas), nunca toda la memoria.";
      }
      lista.replaceChildren();
      if (!datos.entradas.length) {
        const vacio = el("p", "", "Todavía no hay notas. Se crean al pulsar «Añadir nota» o, si la captura automática está activa, al decir cosas como «prefiero…» o «recuerda que…».");
        vacio.style.cssText = "color:var(--muted);font-size:13px";
        lista.append(vacio);
        return;
      }
      for (const entrada of datos.entradas) {
        const fila = el("div");
        fila.style.cssText = "border:1px solid var(--line);border-radius:8px;padding:9px;display:flex;flex-direction:column;gap:6px";
        const cabecera = el("div");
        cabecera.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:11px;color:var(--muted)";
        const tipo = el("span", "badge", entrada.origen?.tipo === "auto" ? "auto" : "manual");
        const fecha = el("span", "", new Date(entrada.actualizada || entrada.creada).toLocaleString("es-ES"));
        const tokens = el("span", "", `${formatoTokens(estimateTokensUi(entrada.texto))} tok`);
        cabecera.append(tipo, fecha, tokens);
        if (entrada.fijada) cabecera.append(el("span", "badge git-a", "fijada"));
        const texto = el("textarea");
        texto.value = entrada.texto;
        texto.rows = 2;
        texto.style.cssText = "width:100%;box-sizing:border-box;resize:vertical";
        const pieFila = el("div");
        pieFila.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap";
        const tags = el("input");
        tags.value = (entrada.tags || []).join(", ");
        tags.placeholder = "etiquetas";
        tags.style.cssText = "flex:1;min-width:140px;font-size:12px";
        const fijada = el("input");
        fijada.type = "checkbox";
        fijada.checked = Boolean(entrada.fijada);
        const etiquetaFijada = el("label", "", "fijar");
        etiquetaFijada.style.cssText = "display:flex;gap:4px;align-items:center;font-size:12px;color:var(--muted)";
        etiquetaFijada.prepend(fijada);
        const guardar = el("button", "", "Guardar");
        guardar.type = "button";
        const borrar = el("button", "ghost", "Eliminar");
        borrar.type = "button";
        guardar.addEventListener("click", async () => {
          try {
            await api("/api/memoria", { cuerpo: { op: "edit", id: entrada.id, texto: texto.value, tags: tags.value, fijada: fijada.checked } });
            avisar("Nota actualizada.", "ok", 2200);
            await cargar();
          } catch (err) {
            avisar(`No se pudo guardar: ${err.message}`, "error", 6000);
          }
        });
        borrar.addEventListener("click", async () => {
          if (!(await confirmar("Borrar nota de memoria", entrada.texto.slice(0, 240), "Borrar"))) return;
          try {
            await api("/api/memoria", { cuerpo: { op: "delete", id: entrada.id } });
            avisar("Nota borrada.", "ok", 2200);
            await cargar();
          } catch (err) {
            avisar(`No se pudo borrar: ${err.message}`, "error", 6000);
          }
        });
        pieFila.append(tags, etiquetaFijada, guardar, borrar);
        fila.append(cabecera, texto, pieFila);
        lista.append(fila);
      }
    }

    agregar.addEventListener("click", async () => {
      if (!nuevo.value.trim()) {
        avisar("Escribe la nota antes de añadirla.", "warn", 3000);
        return;
      }
      try {
        await api("/api/memoria", { cuerpo: { op: "add", texto: nuevo.value, tags: etiquetas.value, fijada: fijarNueva.checked } });
        nuevo.value = "";
        etiquetas.value = "";
        fijarNueva.checked = false;
        avisar("Nota añadida a la memoria global.", "ok", 2500);
        await cargar();
      } catch (err) {
        avisar(`No se pudo añadir: ${err.message}`, "error", 6000);
      }
    });
    vaciar.addEventListener("click", async () => {
      if (!(await confirmar("Borrar toda la memoria global", "Se borrarán todas las notas guardadas entre chats. No se puede deshacer.", "Borrar todo"))) return;
      try {
        await api("/api/memoria", { cuerpo: { op: "clear", confirm: true } });
        avisar("Memoria global vaciada.", "ok", 2500);
        await cargar();
      } catch (err) {
        avisar(`No se pudo vaciar: ${err.message}`, "error", 6000);
      }
    });
    buscar.addEventListener("input", () => {
      clearTimeout(temporizador);
      temporizador = window.setTimeout(cargar, 250);
    });
    const cerrarDialogo = () => {
      clearTimeout(temporizador);
      fondo.remove();
    };
    cerrar.addEventListener("click", cerrarDialogo);
    fondo.addEventListener("click", (event) => { if (event.target === fondo) cerrarDialogo(); });
    fondo.append(caja);
    document.body.append(fondo);
    accesibilizarDialogo(fondo, caja, h, { onEscape: cerrarDialogo });
    cerrar.focus();
    await cargar();
  }

  /** Estimación local para mostrar el tamaño de una nota (3 caracteres ≈ 1 token). */
  const estimateTokensUi = (texto) => Math.ceil(String(texto || "").length / 3);

  // ================================================================== ajustes
  function abrirAjustes() {
    const fondo = el("div", "dialogo-fondo");
    const caja = el("div", "dialogo");
    caja.style.cssText="width:min(640px,calc(100vw - 32px));max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow-y:auto;box-sizing:border-box";
    const h = el("h3", "", "Ajustes");
    caja.append(h);
    caja.append(el("p", "", "Tu espacio y tu modelo. Los cambios se guardan automáticamente."));

    /** @param {string} etiqueta @param {HTMLElement} control */
    const fila = (etiqueta, control) => {
      const f = el("div");
      f.className="setting-row";
      f.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--line)";
      control.style.maxWidth="100%";control.style.minWidth="0";
      control.style.marginLeft="auto";
      if(control instanceof HTMLInputElement && control.type==="checkbox")control.style.width="auto";
      f.append(el("span", "", etiqueta), control);
      return f;
    };
    // Se rellena después con /api/state: son los valores REALES, no el tope pedido.
    const presupuestoCaja = el("div");
    presupuestoCaja.id = "ajustes-presupuesto";

    const tema = el("select");
    tema.setAttribute("aria-label","Tema visual");
    for (const [v, t] of TEMAS) {
      const o = el("option", "", t);
      o.value = v;
      if (ajustes.tema === v) o.selected = true;
      tema.append(o);
    }
    tema.addEventListener("change", () => guardarAjustes({ tema: tema.value }));
    const verPensamiento=el("input");verPensamiento.type="checkbox";verPensamiento.checked=ajustes.verPensamiento!==false;
    verPensamiento.setAttribute("aria-label","Pensamiento expandido");
    verPensamiento.addEventListener("change",()=>guardarAjustes({verPensamiento:verPensamiento.checked}));

    const perfil = el("select");
    for (const [v, t] of [["codigo", "Código (ajustes del modelo)"], ["chat", "Chat (temp 0.7)"]]) {
      const o = el("option", "", t);
      o.value = v;
      if (ajustes.perfil === v) o.selected = true;
      perfil.append(o);
    }
    perfil.addEventListener("change", () => guardarAjustes({ perfil: perfil.value }));

    const agentePerfil = el("select");
    agentePerfil.setAttribute("aria-label","Agente");
    for (const [v, label] of [["legacy", "General"], ["small-local-coder", "Coding local · contexto selectivo y verificación automática"]]) {
      const option = el("option", "", label); option.value = v;
      option.selected = (ajustes.agentePerfil || "legacy") === v; agentePerfil.append(option);
    }
    agentePerfil.addEventListener("change", () => guardarAjustes({ agentePerfil: agentePerfil.value }));
    const modo = el("select");
    modo.setAttribute("aria-label","Modo de respuesta");
    for (const [value,label] of [["agente","Agente · editar y verificar"],["consulta","Consulta · sin herramientas"]]) {
      const option=el("option","",label); option.value=value; option.selected=(ajustes.modoRespuesta || "agente")===value; modo.append(option);
    }
    modo.addEventListener("change",()=>guardarAjustes({modoRespuesta:modo.value}));
    const motorCaja=el("div"); motorCaja.style.cssText="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end";
    const motor=el("select");
    motor.setAttribute("aria-label","Perfil de motor");
    const actualOpt=el("option","","Mantener perfil actual"); actualOpt.value=""; motor.append(actualOpt);
    for(const [name,p] of Object.entries(ajustes.engineProfiles || {})) {
      const option=el("option","",p.label || `${name} · ${p.context/1024}k`); option.value=name; option.selected=ajustes.enginePreset===name; motor.append(option);
    }
    // Show "CUSTOM" if active preset is custom (historial ≠ full context)
    if(ajustes.enginePreset==="CUSTOM"||(!ajustes.enginePreset&&ajustes.historial&&ajustes.coderContextTokens&&Number(ajustes.historial)!==Number(ajustes.coderContextTokens))){
      const customOpt=el("option","","Personalizado (historial ajustado)"); customOpt.value="CUSTOM"; customOpt.selected=true; motor.append(customOpt);
    }
    const aplicarMotor=el("button","","Aplicar perfil"); aplicarMotor.type="button";
    aplicarMotor.addEventListener("click",async()=>{
      const clave=estadoModelos.actual;
      if(!motor.value || !clave) { avisar("Selecciona un perfil y un modelo disponible.","warn"); return; }
      aplicarMotor.disabled=true;
      try {
        const historialActual = motor.value === "CUSTOM" ? Number(ajustes.historial) : undefined;
        await recargarModelo(clave, motor.value, historialActual);
      } finally { aplicarMotor.disabled=false; motor.value=ajustes.enginePreset || ""; }
    });
    motorCaja.append(motor,aplicarMotor);

    // Razonamiento: solo lo usan los modelos que lo admiten (Override-6 sí, BoldingBuilds v1
    // no: deja respuestas vacías). Se fija al arrancar llama-server, así que encenderlo pide
    // reiniciarlo; apagarlo no (cada petición dice si razona).
    const infoPensar = ajustes.pensarInfo || { compatible: true, recomendado: 2048 };
    const pensar = el("select");
    for (const [v, t] of [[512, "512 tokens"], [1024, "1024 tokens"], [2048, `2048 tokens${infoPensar.recomendado === 2048 ? " (recomendado)" : ""}`], [4096, "4096 tokens"], [8192, "8192 tokens (lento)"]]) {
      const o = el("option", "", t);
      o.value = String(v);
      if (Number(ajustes.pensar || infoPensar.recomendado) === v) o.selected = true;
      pensar.append(o);
    }
    pensar.addEventListener("change", async () => {
      const antes = Number(ajustes.pensar) || 0;
      const nuevo = Number(pensar.value);
      await guardarAjustes({ pensar: nuevo });
      const info = ajustes.pensarInfo || {};
      if (nuevo > 0 && info.compatible === false) {
        avisar("El modelo cargado no admite el modo razonamiento: queda guardado para un modelo compatible.", "warn", 8000);
        return;
      }
      if (nuevo > 0 && nuevo !== antes && info.servidor !== nuevo) {
        const actual = estadoModelos.actual || info.modelo;
        if (!actual) return;
        const ok = await confirmar(
          "Reiniciar el modelo para razonar",
          `El razonamiento se fija al arrancar el servidor del modelo. ¿Lo reinicio ahora con ${nuevo} tokens? Tarda unos segundos y el chat se conserva.`,
          "Reiniciar",
        );
        if (ok) void recargarModelo(actual);
      }
    });
    const pensarCaja = el("div");
    pensarCaja.style.cssText = "display:flex;flex-direction:column;align-items:flex-end;gap:3px";
    pensarCaja.append(pensar);
    if ((ajustes.agentePerfil || "legacy") === "small-local-coder") {
      const limite=el("small","",`Coding permite hasta ${infoPensar.limiteCoding ?? 512} tokens de pensamiento; el resto de la salida queda para la respuesta y las ediciones.`);
      limite.style.cssText="max-width:280px;color:var(--muted)"; pensarCaja.append(limite);
    }
    if (infoPensar.compatible === false) {
      const nota = el("small", "", "este modelo no lo admite");
      nota.style.color = "var(--muted)";
      pensarCaja.append(nota);
    }

    // Cuánto historial viaja tal cual antes de resumirse. Con poco, en una tarea de muchos
    // pasos el modelo acababa trabajando sobre un resumen y perdía el pedido. OJO: esto es
    // una PETICIÓN al servidor; el tope real lo recorta historyCap() según la ventana que
    // arrancó llama-server (por eso abajo se enseñan los cuatro valores reales).
    const historial = el("select");
    const topes = [[0, "Automático (ventana − salida)"], [8192, "8192 tokens"], [16384, "16384 tokens"], [32768, "32768 tokens"], [65536, "65536 tokens"], [110592, "110592 tokens"]];
    if (Number.isFinite(Number(ajustes.historial)) && !topes.some(([v]) => v === Number(ajustes.historial))) topes.push([Number(ajustes.historial), `${ajustes.historial} tokens`]);
    for (const [v, t] of topes) {
      const o = el("option", "", String(t));
      o.value = String(v);
      if (Number(ajustes.historial) === v) o.selected = true;
      historial.append(o);
    }
    historial.addEventListener("change", async () => {
      const nuevoHistorial = Number(historial.value);
      const ctx = Number(ajustes.coderContextTokens) || 0;
      // If historial < context window, mark preset as CUSTOM so the chip reflects it
      const presetResultante = (nuevoHistorial > 0 && ctx > 0 && nuevoHistorial < ctx) ? "CUSTOM" : (ajustes.enginePreset || "");
      await guardarAjustes({ historial: nuevoHistorial, ...(presetResultante !== ajustes.enginePreset ? { enginePreset: presetResultante } : {}) });
      // Update motor dropdown to show CUSTOM if needed
      if (presetResultante === "CUSTOM") {
        const existing = Array.from(motor.options).find(o => o.value === "CUSTOM");
        if (!existing) { const co=el("option","","Personalizado (historial ajustado)"); co.value="CUSTOM"; motor.append(co); }
        motor.value = "CUSTOM";
      }
      // El historial efectivo puede cambiar: se vuelven a leer los valores reales.
      void pintarPresupuestoEn(presupuestoCaja);
      void actualizarChipPresupuesto();
    });

    const reglas = el("input");
    reglas.type = "checkbox";
    reglas.checked = Boolean(ajustes.reglas);
    reglas.addEventListener("change", () => guardarAjustes({ reglas: reglas.checked }));

    // Continuar hasta terminar: si el turno se queda sin pasos o se atasca, la interfaz
    // encadena otro turno interno (hasta 3 seguidos) en vez de dejarlo a medias.
    const seguir = el("input");
    seguir.type = "checkbox";
    seguir.checked = localStorage.getItem("bonsai-continuar-auto") !== "0";
    seguir.addEventListener("change", () => {
      localStorage.setItem("bonsai-continuar-auto", seguir.checked ? "1" : "0");
      guardarAjustes({ continuarAuto: seguir.checked });
    });

    // Tope de pasos del agente por turno (antes eran 96 fijos).
    const pasos = el("select");
    for (const v of [96, 192, 288, 400]) {
      const o = el("option", "", `${v} pasos`);
      o.value = String(v);
      if (Number(ajustes.saltosTope) === v) o.selected = true;
      pasos.append(o);
    }
    pasos.addEventListener("change", () => guardarAjustes({ saltosTope: Number(pasos.value) }));

    // Tiempo máximo por comando (antes eran 60 s fijos: cortaba npm install y builds).
    const tiempo = el("select");
    for (const [v, t] of [[120, "2 min"], [180, "3 min"], [300, "5 min"], [600, "10 min"], [900, "15 min"], [1800, "30 min"]]) {
      const o = el("option", "", t);
      o.value = String(v);
      if (Number(ajustes.comandoSegundos) === v) o.selected = true;
      tiempo.append(o);
    }
    tiempo.addEventListener("change", () => guardarAjustes({ comandoSegundos: Number(tiempo.value) }));

    // Memoria global entre chats: apagable, con presupuesto explícito y revisable.
    const memoriaActiva = el("input");
    memoriaActiva.type = "checkbox";
    memoriaActiva.checked = ajustes.memoriaGlobal !== false;
    memoriaActiva.addEventListener("change", () => guardarAjustes({ memoriaGlobal: memoriaActiva.checked }));
    const memoriaAuto = el("input");
    memoriaAuto.type = "checkbox";
    memoriaAuto.checked = ajustes.memoriaGlobalAuto !== false;
    memoriaAuto.addEventListener("change", () => guardarAjustes({ memoriaGlobalAuto: memoriaAuto.checked }));
    const memoriaTokens = el("select");
    for (const v of [0, 240, 480, 800, 1200, 2000]) {
      const o = el("option", "", v === 0 ? "0 · no inyectar" : `${v} tokens`);
      o.value = String(v);
      if (Number(ajustes.memoriaGlobalTokens ?? 480) === v) o.selected = true;
      memoriaTokens.append(o);
    }
    memoriaTokens.addEventListener("change", () => guardarAjustes({ memoriaGlobalTokens: Number(memoriaTokens.value) }));
    const revisarMemoria = el("button", "", "Revisar y editar…");
    revisarMemoria.type = "button";
    revisarMemoria.addEventListener("click", () => void abrirMemoriaGlobal());

    caja.append(
      el("h4","settings-section","Apariencia"),
      fila("Tema", tema),
      fila("Mostrar pensamiento expandido", verPensamiento),
      el("h4","settings-section","Modelo y respuesta"),
      fila("Perfil de muestreo", perfil),
      fila("Agente", agentePerfil),
      fila("Modo de respuesta", modo),
      fila("Motor · reinicia el modelo", motorCaja),
      fila("Modo razonamiento", pensarCaja),
      fila("Tope de historial (pedido)", historial),
      el("h4","settings-section","Trabajo del agente"),
      fila("Aplicar reglas del proyecto", reglas),
      fila("Continuar solo hasta terminar", seguir),
      fila("Pasos del agente por turno", pasos),
      fila("Tiempo máximo por comando", tiempo),
      el("h4","settings-section","Memoria entre chats"),
      fila("Usar memoria global", memoriaActiva),
      fila("Aprender preferencias automáticamente", memoriaAuto),
      fila("Presupuesto por turno", memoriaTokens),
      fila("Notas guardadas", revisarMemoria),
    );
    const aviso = el("p", "", "El perfil se aplica en cada petición. El razonamiento solo lo usan los modelos que lo admiten. «Continuar solo» encadena hasta 3 turnos internos si el agente se queda sin pasos o se atasca; los procesos lanzados en segundo plano ya no se cierran al acabar el turno. La memoria global solo inyecta las notas relevantes al pedido (más las fijadas), dentro del presupuesto elegido; se guarda fuera del proyecto y de Git.");
    aviso.style.marginTop = "12px";
    caja.append(aviso);

    // Finding 16: aquí se enseñan los valores REALES de contexto, no el tope pedido.
    const separador = el("h4", "", "Contexto real");
    separador.style.cssText = "margin:18px 0 2px;font-size:13px";
    const explicacion = el("p", "", "Lo que el servidor entrega, no lo que se pide: cambiar el tope no agranda la ventana del modelo.");
    explicacion.style.cssText = "color:var(--muted);font-size:12px;margin:0 0 2px";
    caja.append(separador, explicacion, presupuestoCaja);
    void pintarPresupuestoEn(presupuestoCaja);

    const botones = el("div", "d-botones");
    const cerrar = el("button", "primary", "Cerrar");
    cerrar.type = "button";
    cerrar.addEventListener("click", () => fondo.remove());
    botones.append(cerrar);
    caja.append(botones);
    fondo.append(caja);
    document.body.append(fondo);
    accesibilizarDialogo(fondo, caja, h, { onEscape: () => fondo.remove() });
    cerrar.focus();
  }

  // ==================================================== edición en línea (Ctrl+K)
  /**
   * Diff propuesto por el modelo, con Aceptar / Rechazar.
   * @param {{rel: string, start: number, end: number, diff: string, borra?: boolean, recortada?: boolean}} r
   * @returns {Promise<boolean>}
   */
  function previsualizarDiff(r) {
    return new Promise((resolve) => {
      const fondo = el("div", "dialogo-fondo");
      const caja = el("div", "dialogo");
      caja.style.width = "min(780px, 95vw)";
      const h = el("h3", "", r.borra ? `Borrado propuesto en ${r.rel}` : `Cambio propuesto en ${r.rel}`);
      caja.append(h);
      caja.append(el("p", "", `Se aplicará el rango real de líneas ${r.start}-${r.end}. Nada se guarda hasta que aceptes.`));
      if (r.recortada) {
        const aviso = el(
          "p",
          "",
          "La selección es más grande que el límite del modelo: solo se reemplaza la parte que el modelo recibió. El resto de la selección se conserva intacto.",
        );
        aviso.style.color = "var(--warn, #d9a441)";
        caja.append(aviso);
      }
      if (r.borra) {
        const aviso = el("p", "", "El modelo pidió BORRAR esa selección: el texto se eliminará del archivo al aceptar.");
        aviso.style.color = "var(--warn, #d9a441)";
        caja.append(aviso);
      }
      const pre = el("pre", "diff-preview");
      for (const linea of String(r.diff || "(sin cambios)").split("\n")) {
        const fila = el("div");
        const marca = el("span", "mark");
        const cuerpo = el("span", "code");
        if (linea.startsWith("+") && !linea.startsWith("+++")) {
          fila.className = "add";
          marca.textContent = "+";
          cuerpo.textContent = linea.slice(1);
        } else if (linea.startsWith("-") && !linea.startsWith("---")) {
          fila.className = "del";
          marca.textContent = "−";
          cuerpo.textContent = linea.slice(1);
        } else if (linea.startsWith("@@") || linea.startsWith("---") || linea.startsWith("+++")) {
          fila.className = "meta";
          fila.textContent = linea;
          pre.append(fila);
          continue;
        } else {
          fila.className = "ctx";
          marca.textContent = " ";
          cuerpo.textContent = linea.startsWith(" ") ? linea.slice(1) : linea;
        }
        fila.append(marca, cuerpo);
        pre.append(fila);
      }
      caja.append(pre);
      const botones = el("div", "d-botones");
      const no = el("button", "ghost", "Rechazar");
      no.type = "button";
      const si = el("button", "primary", r.borra ? "Borrar y guardar" : "Aceptar y guardar");
      si.type = "button";
      botones.append(no, si);
      caja.append(botones);
      fondo.append(caja);
      document.body.append(fondo);
      accesibilizarDialogo(fondo, caja, h);
      const cerrar = (valor) => {
        fondo.remove();
        document.removeEventListener("keydown", tecla, true);
        resolve(valor);
      };
      /** @param {KeyboardEvent} e */
      const tecla = (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          cerrar(false);
        } else if (e.key === "Enter" && !e.shiftKey && !r.borra) {
          // Un borrado no se acepta con Enter por accidente: exige el clic explícito.
          e.stopPropagation();
          cerrar(true);
        }
      };
      document.addEventListener("keydown", tecla, true);
      no.addEventListener("click", () => cerrar(false));
      si.addEventListener("click", () => cerrar(true));
      fondo.addEventListener("click", (e) => {
        if (e.target === fondo) cerrar(false);
      });
      si.focus();
    });
  }

  /**
   * Carpeta de trabajo actual tal como la pintó la interfaz (sin pedirla otra vez).
   * Sirve para detectar un cambio de proyecto mientras el modelo responde.
   * @returns {string}
   */
  function proyectoActual() {
    const marca = $(".brand small");
    const origen = marca?.title || $("#carpeta")?.title || "";
    return String(origen || "").replace(/^Carpeta:\s*/, "").trim();
  }

  /**
   * Estado de la pestaña que hay que conservar mientras se espera al modelo (hallazgo 8:
   * aceptar una propuesta vieja no puede pisar lo que el usuario escribió o recargó).
   * @param {typeof pestanas[number]} p
   */
  function instantaneaEditor(p) {
    return { rel: p.rel, texto: p.texto, guardado: p.guardado, proyecto: proyectoActual() };
  }

  /**
   * Qué cambió desde la instantánea, en palabras para el usuario ("" si nada).
   * @param {typeof pestanas[number]} p
   * @param {{rel: string, texto: string, guardado: string, proyecto: string}} antes
   * @returns {string}
   */
  function cambioDesde(p, antes) {
    if (!pestanas.includes(p)) return "Se cerró la pestaña";
    if (proyectoActual() !== antes.proyecto) return "Cambiaste de proyecto";
    if (p.rel !== antes.rel) return `Se renombró la pestaña a «${p.rel}»`;
    if (p.texto !== antes.texto || p.guardado !== antes.guardado) return "Editaste el archivo";
    return "";
  }

  /**
   * Aviso de que la propuesta se descartó porque el editor cambió durante la espera,
   * con la opción de pedirla otra vez sobre el contenido actual.
   * @param {string} motivo
   */
  function descartarPorCambio(motivo) {
    avisar(`${motivo} mientras el modelo respondía: no se aplicó nada.`, "warn", 10000, {
      texto: "Revisar de nuevo",
      hacer: () => void editarSeleccion(),
    });
  }

  /** Ctrl+K sobre la selección del editor. */
  async function editarSeleccion() {
    const p = pestanas[activa];
    if (!p) {
      avisar("Abre un archivo para editar en línea.", "warn");
      return;
    }
    if (p.truncado) {
      avisar("Ese archivo se abrió recortado: no se puede editar.", "warn");
      return;
    }
    if (p.texto !== p.guardado) {
      avisar("Guarda tus cambios (Ctrl+S) antes de usar Ctrl+K: el modelo lee el archivo del disco.", "warn", 6000);
      return;
    }
    const sel = window.selectionInsideEditor();
    if (!sel) {
      avisar("Selecciona primero el texto que quieres cambiar.", "warn");
      return;
    }
    const instruccion = await preguntar({
      titulo: `Ctrl+K · ${p.rel}:${sel.start}-${sel.end}`,
      texto: "Qué quieres que haga el modelo con la selección. Solo se cambiará esa parte.",
      placeholder: "por ejemplo: envuélvelo en una función con docstring",
      ok: "Editar",
    });
    if (!instruccion || !instruccion.trim()) return;
    // Lo que hay AHORA: al aceptar se compara para no pisar cambios hechos mientras se
    // espera al modelo (hallazgo 8).
    const antes = instantaneaEditor(p);
    const cerrarAviso = avisar("Pidiendo la edición al modelo…", "", 0);
    /** @type {{rel: string, base: string, start: number, end: number, seleccion: string, propuesta: string, texto: string, borra: boolean, cambia: boolean, diff: string}} */
    let r;
    try {
      r = await api("/api/edit", { cuerpo: { path: antes.rel, start: sel.start, end: sel.end, instruccion } });
    } catch (err) {
      cerrarAviso();
      avisar(`No se pudo editar: ${err.message}`, "error", 7000);
      return;
    }
    cerrarAviso();
    const cambio = cambioDesde(p, antes);
    if (cambio) {
      descartarPorCambio(cambio);
      return;
    }
    // `base` es el contenido EXACTO del disco sobre el que se generó la propuesta
    // (contrato de /api/edit): se usa como precondición al guardar.
    if (typeof r.base !== "string") {
      avisar("El servidor no devolvió la base de la propuesta: no se toca el archivo. Actualiza el servidor.", "error", 9000);
      return;
    }
    if (normalizarSaltos(r.base) !== antes.guardado) {
      avisar(
        "El archivo cambió en disco desde que se abrió y la propuesta se hizo sobre otra versión. No se ha tocado nada: recarga el archivo y vuelve a intentarlo.",
        "warn",
        11000,
        { texto: "Revisar de nuevo", hacer: () => void editarSeleccion() },
      );
      return;
    }
    if (!r.cambia) {
      avisar("El modelo no cambió nada.", "", 3000);
      return;
    }
    // Si el servidor recortó la selección por tokens, hay que decirlo: la vista de diff
    // puede estar truncada y no se debe prometer que se cambió toda la selección.
    const norm = (t) => String(t ?? "").replace(/\r\n/g, "\n");
    const seleccionLocal = norm(sel.text).replace(/\n+$/, "");
    const recortada = typeof r.seleccion === "string" && norm(r.seleccion).length < seleccionLocal.length;
    const aceptar = await previsualizarDiff({
      rel: antes.rel,
      start: r.start,
      end: r.end,
      diff: r.diff,
      borra: Boolean(r.borra),
      recortada,
    });
    if (!aceptar) {
      avisar("Edición descartada.", "", 2200);
      return;
    }
    if (r.borra) {
      // El borrado nunca se ejecuta por el mero hecho de que el modelo devuelva BORRAR.
      const seguro = await confirmar(
        "Borrar la selección",
        `El modelo pidió borrar ${r.start === r.end ? `la línea ${r.start}` : `las líneas ${r.start}-${r.end}`} de «${antes.rel}». Revisa el diff de la vista previa: lo que no se envió al modelo no se toca.`,
        "Borrar",
      );
      if (!seguro) {
        avisar("Borrado descartado.", "", 2200);
        return;
      }
    }
    // Comprobación final entre la vista previa y el guardado: el sondeo de cambios
    // externos (2,5 s) o el usuario pudieron modificar la pestaña durante el diálogo.
    const cambioFinal = cambioDesde(p, antes);
    if (cambioFinal) {
      descartarPorCambio(cambioFinal);
      return;
    }
    try {
      await api("/api/file", { cuerpo: { path: antes.rel, content: r.texto, before: r.base } });
      // El disco ya tiene r.texto. Si mientras se enviaba el guardado el usuario siguió
      // escribiendo, se conserva lo escrito como cambio sin guardar (no se pierde).
      const seguiaIgual = p.texto === antes.texto;
      const textoGuardado = normalizarSaltos(r.texto);
      p.guardado = textoGuardado;
      p.original = r.texto;
      if (seguiaIgual) p.texto = textoGuardado;
      if (pestanas[activa] === p) mostrarPestana(activa);
      else pintarPestanas();
      avisar(`Editado ${antes.rel}`, "ok", 2400);
    } catch (err) {
      if (err.status === 409) {
        // El archivo cambió en disco entre la propuesta y el guardado: se conservan los
        // cambios del usuario y NO se sobrescribe nada.
        avisar(
          `«${antes.rel}» cambió en disco mientras el modelo respondía. No se guardó nada: tus cambios siguen en el editor, sin tocar la versión nueva. Revísala y vuelve a intentarlo.`,
          "error",
          12000,
          { texto: "Revisar de nuevo", hacer: () => void editarSeleccion() },
        );
      } else {
        avisar(`No se pudo guardar: ${err.message}`, "error", 6000);
      }
    }
  }

  // ================================================================== modelos
  /** @type {{actual: string, modelos: Array<{clave: string, nombre: string, archivo?: string, rol: string, uso?: string, bytes: number, existe: boolean, predeterminado: boolean}>}} */
  let estadoModelos = { actual: "", modelos: [] };
  /** Nombre del modelo que se está cargando ("" si no hay cambio en curso). */
  let cargandoModelo = "";
  let servidorEncendido = false;
  let cambiandoServidor = false;

  let servidorEnCurso = false;
  async function refrescarServidor() {
    const boton = $("#servidor-toggle");
    if (!boton || cambiandoServidor || servidorEnCurso || document.hidden) return;
    servidorEnCurso = true;
    try {
      const estado = await api("/api/servidor");
      if (cambiandoServidor) return;
      servidorEncendido = estado.encendido;
      boton.textContent = servidorEncendido ? "Apagar IA" : "Encender IA";
      boton.title = servidorEncendido ? "Apagar el servidor local de IA" : "Encender el servidor local de IA";
      boton.disabled = false;
    } catch { boton.textContent = "IA sin conexión"; boton.disabled = true; }
    finally { servidorEnCurso = false; }
  }

  async function controlarServidor(accion) {
    if (cambiandoServidor) return;
    if (accion === "cerrar") {
      const sucias = pestanas.filter((p) => p.texto !== p.guardado && !p.truncado).length;
      if (!(await confirmar("Cerrar IDE e IA", sucias ? `Hay ${sucias} archivo(s) con cambios sin guardar. Se perderán al cerrar.` : "Se apagará la IA y se cerrará el servidor del IDE.", "Cerrar ambos"))) return;
    }
    cambiandoServidor = true;
    const boton = $("#servidor-toggle"), cerrar = $("#cerrar-bonsai");
    boton.disabled = true; cerrar.disabled = true;
    boton.textContent = accion === "encender" ? "Encendiendo IA…" : "Apagando IA…";
    try {
      await api("/api/servidor", { cuerpo: { accion } });
      if (accion === "cerrar") {
        document.body.innerHTML = "<main style='padding:2rem;font-family:sans-serif'>IDE e IA cerrados. Puedes cerrar esta pestaña.</main>";
        return;
      }
      avisar(accion === "encender" ? "Servidor de IA encendido" : "Servidor de IA apagado", "ok");
      await refrescarModelos();
    } catch (err) { avisar(`No se pudo completar la operación: ${err.message}`, "error", 10000); }
    finally { cambiandoServidor = false; cerrar.disabled = false; void refrescarServidor(); }
  }

  $("#servidor-toggle")?.addEventListener("click", () => void controlarServidor(servidorEncendido ? "apagar" : "encender"));
  $("#cerrar-bonsai")?.addEventListener("click", () => void controlarServidor("cerrar"));
  void refrescarServidor();
  setInterval(() => void refrescarServidor(), 15000);

  let modelosEnCurso = false;
  async function refrescarModelos() {
    if (modelosEnCurso || document.hidden) return;
    modelosEnCurso = true;
    const antes = estadoModelos && estadoModelos.actual;
    try {
      estadoModelos = await api("/api/modelos");
      pintarChipModelo();
      // Si el modelo cambió por fuera de la app, la ventana (y con ella el presupuesto de
      // contexto) también: se refresca el chip en vez de enseñar el valor anterior.
      if (antes !== estadoModelos.actual) void actualizarChipPresupuesto();
    } catch {
      estadoModelos = { actual: "", modelos: [] };
      pintarChipModelo();
    } finally {
      modelosEnCurso = false;
    }
  }

  function pintarChipModelo() {
    const chip = $("#modelo-chip");
    if (!chip) return;
    const actual = estadoModelos.modelos.find((m) => m.clave === estadoModelos.actual);
    // El modelo activo se ve SIEMPRE: antes el chip se ocultaba en cuanto la lista
    // venía vacía o fallaba la petición, y era justo cuando más falta hace saber con
    // qué modelo se está hablando. Sin nombre en el catálogo se enseña la clave.
    chip.hidden = false;
    chip.className = "pill";
    chip.innerHTML = "";
    const nombre = actual ? actual.nombre : (estadoModelos.actual || "Modelo");
    chip.append(el("i", "dot"), el("span", "", nombre));
    chip.title = actual
      ? `Modelo activo: ${actual.nombre} (${actual.archivo}). Pulsa para cambiar.`
      : "Cambiar de modelo";
    // El botón de la barra de arriba: el mismo dato, pero a la vista y con aspecto de botón.
    const boton = $("#modelo-boton");
    if (boton) {
      const etiqueta = boton.querySelector(".modelo-nombre");
      // «· piensa» cuando el razonamiento está encendido Y el modelo cargado lo admite.
      const piensa = Number(ajustes.pensarInfo?.efectivo) > 0;
      if (etiqueta) etiqueta.textContent = cargandoModelo ? `Cargando ${cargandoModelo}…` : `${nombre}${piensa ? " · piensa" : ""}`;
      boton.disabled = Boolean(cargandoModelo);
      boton.title = cargandoModelo
        ? "Cambiando de modelo: espera a que termine de cargar"
        : actual
          ? `Modelo activo: ${actual.nombre}${actual.uso ? ` — ${actual.uso}` : ""}. Pulsa para cambiar.`
          : "Cambiar de modelo";
    }
  }

  /**
   * @param {Element | null} [ancla] elemento bajo el que se abre el menú
   */
  function menuModelos(ancla) {
    const desde = ancla || $("#modelo-boton") || $("#modelo-chip");
    const r = desde?.getBoundingClientRect();
    const items = estadoModelos.modelos.map((m) => ({
      texto: m.nombre,
      nota: m.uso || m.rol || "",
      tecla: !m.gpuCompleta ? "no disponible: usa CPU" : m.clave === estadoModelos.actual ? "cargado" : (m.existe ? "" : "falta el GGUF"),
      ico: m.clave === estadoModelos.actual ? "check" : "cpu",
      hacer: !m.gpuCompleta || m.clave === estadoModelos.actual || !m.existe || cargandoModelo ? undefined : () => void cambiarModelo(m.clave, m.nombre),
    }));
    if (!items.length) items.push({ texto: "No hay modelos en chat\\modelo.json (o el servidor no responde)", ico: "alerta" });
    items.push(null);
    items.push({ texto: "Actualizar estado", ico: "recargar", hacer: () => void refrescarModelos() });
    menu(r?.left || 100, (r?.bottom || 40) + 4, items);
  }

  /**
   * Descarga el modelo cargado y carga el otro (tarda ~40-60 s: se reinicia llama-server).
   * @param {string} clave
   * @param {string} nombre
   */
  /**
   * Reinicia el MISMO modelo (p. ej. para encender el razonamiento o cambiar el preset de motor).
   * @param {string} clave
   * @param {string} [enginePreset]   preset nombrado o "CUSTOM"
   * @param {number} [historial]      tope de historial explícito (solo para CUSTOM)
   */
  async function recargarModelo(clave, enginePreset, historial) {
    const fila = estadoModelos.modelos.find((m) => m.clave === clave);
    const nombre = fila?.nombre || clave;
    const cerrar = avisar(`Reiniciando ${nombre}…`, "warn", 0);
    cargandoModelo = nombre;
    pintarChipModelo();
    const cuerpo = { clave, recargar: true, ...(enginePreset ? {enginePreset} : {}) };
    if (historial !== undefined) cuerpo.historial = historial;
    try {
      const r = await api("/api/modelos", { cuerpo });
      cargandoModelo = "";
      cerrar();
      avisar(`${r.nombre} listo${r.pensar ? ` · razona con hasta ${r.pensar} tokens` : ""}`, "ok", 6000);
      await cargarAjustes();
      void actualizarChipPresupuesto();
    } catch (err) {
      cargandoModelo = "";
      cerrar();
      avisar(`No se pudo reiniciar el modelo: ${err.message}`, "error", 10000);
    }
    await refrescarModelos();
    void pintarChipVision();
    const presupuestoAbierto=$("#ajustes-presupuesto");
    if(presupuestoAbierto)void pintarPresupuestoEn(presupuestoAbierto);
  }

  async function cambiarModelo(clave, nombre) {
    const ok = await confirmar(
      `Cambiar a ${nombre}`,
      "Se apaga el servidor, se descarga el modelo que está en la GPU y se carga el otro. El chat queda bloqueado mientras (suele tardar menos de un minuto) y el historial se conserva.",
      "Cambiar",
    );
    if (!ok) return;
    const cerrar = avisar(`Descargando el modelo actual y cargando ${nombre}…`, "warn", 0);
    cargandoModelo = nombre;
    pintarChipModelo();
    try {
      const r = await api("/api/modelos", { cuerpo: { clave } });
      cargandoModelo = "";
      cerrar();
      avisar(r.cambiado ? `${r.nombre} cargado · ventana ${r.nCtx} tok${r.pensar ? ` · razona con hasta ${r.pensar} tokens` : ""}` : `${r.nombre} ya estaba cargado`, "ok", 6000);
      await cargarAjustes();
      await refrescarModelos();
      void pintarChipVision();
      void actualizarChipPresupuesto();
      const meta = $("#meta");
      if (meta) meta.textContent = `ventana ${r.nCtx}`;
    } catch (err) {
      cargandoModelo = "";
      cerrar();
      avisar(`No se pudo cambiar de modelo: ${err.message}`, "error", 10000);
      await refrescarModelos();
    }
  }

  // ================================================================== atajos
  document.addEventListener("keydown", (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    const k = e.key.toLowerCase();
    if (k === "s") {
      e.preventDefault();
      guardarActiva();
      return;
    }
    if (k === "p" && !e.shiftKey) {
      e.preventDefault();
      abrirPaleta("archivos");
      return;
    }
    if (k === "p" && e.shiftKey) {
      e.preventDefault();
      abrirPaleta("comandos");
      return;
    }
    if (k === "f" && e.shiftKey) {
      e.preventDefault();
      abrirBusqueda();
      return;
    }
    if (k === "k") {
      e.preventDefault();
      void editarSeleccion();
      return;
    }
    if (k === "b") {
      e.preventDefault();
      $("#tog-files")?.click();
      return;
    }
    if (k === "w" && e.altKey) {
      e.preventDefault();
      if (activa >= 0) cerrarPestana(activa);
    }
  });

  // Al cerrar con cambios sin guardar, el navegador pregunta.
  window.addEventListener("beforeunload", (e) => {
    if (pestanas.some((p) => p.texto !== p.guardado && !p.truncado)) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  // F2 renombra lo que esté abierto en el editor (igual que en un IDE).
  document.addEventListener("keydown", (e) => {
    if (e.key === "F2" && opened) {
      e.preventDefault();
      void renombrarArchivo(opened);
    }
  });

  // ================================================================ arranque
  function montarChips() {
    const barra = $(".statusbar");
    if (!barra) return;
    const git = el("button", "pill");
    git.id = "git-chip";
    git.type = "button";
    git.hidden = true;
    git.addEventListener("click", () => menuGit());
    const reglas = el("button", "pill");
    reglas.id = "reglas-chip";
    reglas.type = "button";
    reglas.hidden = true;
    reglas.addEventListener("click", () => verReglas());
    // Visión: solo aparece si el servidor arrancó con -Vision (mmproj).
    const vision = el("button", "pill");
    vision.id = "vision-chip";
    vision.type = "button";
    vision.hidden = true;
    vision.append(el("i", "dot"), el("span", "", "Visión"));
    vision.title = "El servidor ve imágenes (mmproj). Pulsa para saber más.";
    vision.addEventListener("click", () => {
      avisar("Visión activada: el modelo y el proyector usan la GPU; el reconocimiento de texto local ayuda a leer imágenes.", "ok", 6000);
    });
    // Modelo: descarga el cargado y carga el otro.
    const modelo = el("button", "pill");
    modelo.id = "modelo-chip";
    modelo.type = "button";
    modelo.hidden = true;
    modelo.title = "Cambiar de modelo";
    modelo.addEventListener("click", () => menuModelos(modelo));
    // Presupuesto real de contexto (finding 16): ventana del servidor e historial
    // efectivo. Se oculta si /api/state no da el dato: nunca se enseña el tope pedido
    // como si fuera el contexto que hay.
    const contexto = el("button", "pill");
    contexto.id = "contexto-chip";
    contexto.type = "button";
    contexto.hidden = true;
    contexto.title = "Presupuesto real de contexto";
    contexto.addEventListener("click", () => abrirAjustes());
    barra.prepend(modelo, contexto, vision, reglas, git);
  }

  /** Enciende el chip de visión si el servidor la tiene. */
  async function pintarChipVision() {
    try {
      const datos = await api("/api/stats");
      const chip = $("#vision-chip");
      if (chip) chip.hidden = !datos.vision;
    } catch {
      /* sin datos: el chip se queda oculto */
    }
  }

  function montarBotonesBarra() {
    const barra = $(".top");
    if (!barra) return;
    const paleta = el("button", "icon-btn");
    paleta.type = "button";
    paleta.title = "Buscar archivo (Ctrl+P)";
    paleta.setAttribute("data-tip", "Ctrl+P");
    paleta.innerHTML = ICO.buscar({ tam: 15 });
    paleta.addEventListener("click", () => abrirPaleta("archivos"));

    const comandos = el("button", "icon-btn");
    comandos.type = "button";
    comandos.title = "Comandos (Ctrl+Shift+P)";
    comandos.innerHTML = ICO.comando({ tam: 15 });
    comandos.addEventListener("click", () => abrirPaleta("comandos"));

    const tema = el("button", "icon-btn");
    tema.id = "tema";
    tema.type = "button";
    tema.title = "Cambiar de tema";
    tema.addEventListener("click", () => guardarAjustes({ tema: siguienteTema() }));

    const ajustesBoton = el("button", "icon-btn");
    ajustesBoton.type = "button";
    ajustesBoton.title = "Ajustes";
    ajustesBoton.innerHTML = ICO.ajustes({ tam: 15 });
    ajustesBoton.addEventListener("click", () => abrirAjustes());

    const distribuir = el("button", "icon-btn");
    distribuir.type = "button";
    distribuir.title = "Restablecer distribucion de paneles";
    distribuir.setAttribute("aria-label", distribuir.title);
    distribuir.innerHTML = ICO.panelIzq({ tam: 15 });
    distribuir.addEventListener("click", () => window.bonsaiResetLayout?.());

    const grupo = el("div", "panes");
    grupo.style.marginLeft = "4px";
    grupo.append(paleta, comandos, distribuir, tema, ajustesBoton);

    // Cambiar de modelo a la vista, sin terminal: el chip de la barra de estado es pequeño
    // y se confundía con las etiquetas fijas de al lado ("Modelo en RTX 4060").
    const modelo = el("button", "ghost modelo-boton");
    modelo.id = "modelo-boton";
    modelo.type = "button";
    modelo.title = "Cambiar de modelo";
    modelo.setAttribute("aria-haspopup", "menu");
    const icono = el("span", "modelo-ico");
    icono.innerHTML = ICO.cpu({ tam: 14 });
    const flecha = el("span", "modelo-flecha");
    flecha.innerHTML = ICO.flechaAbajo({ tam: 12 });
    modelo.append(icono, el("span", "modelo-nombre", "Modelo"), flecha);
    modelo.addEventListener("click", () => menuModelos(modelo));

    barra.append(modelo, grupo);
  }

  async function arrancar() {
    if (typeof ICO === "undefined") return;
    pintarIconos(document);
    montarBotonesBarra();
    montarChips();
    montarExplorador();
    registrarComandos();
    await cargarAjustes();
    aplicarTema(ajustes.tema);
    pintarChipReglas();
    void pintarChipVision();
    void refrescarModelos();
    void actualizarChipPresupuesto();
    refrescarGit();
    setInterval(refrescarGit, 15000);
    // El modelo también puede cambiar por fuera de la app (start-server.ps1 -Modelo, otra
    // pestaña): el chip se refresca solo para no enseñar uno que ya no está cargado.
    setInterval(() => void refrescarModelos(), 15000);
    // Los intervalos no trabajan con la pestaña oculta; al volver se refresca de inmediato.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      void refrescarServidor();
      void refrescarModelos();
      refrescarGit();
      void comprobarCambiosExternos();
    });
    pintarVacio();
    pintarPestanas();
    // Enlace directo: http://127.0.0.1:8787/#chat/ui/app.js abre ese archivo.
    const hash = decodeURIComponent(location.hash.replace(/^#/, "")).trim();
    if (hash) abrirArchivo(hash);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar);
  else arrancar();
})();
