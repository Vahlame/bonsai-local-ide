/**
 * Núcleo de la interfaz de Bonsai: antes era el script inline de index.html (líneas ~663-2419).
 *
 * Se carga como script CLÁSICO (no module), exactamente en el mismo orden que antes:
 * después de markdown.js e iconos.js, y antes de stats-boot, ide.js y app.js. Así se
 * conserva el ámbito global compartido: los let/const/function de primer nivel que app.js
 * lee y reasigna (openFile, selectionInsideEditor, refreshTree…) siguen siendo los mismos.
 */
    const log = document.querySelector("#log");
    const empty = document.querySelector("#empty");
    const input = document.querySelector("#input");
    const send = document.querySelector("#send");
    const errorBox = document.querySelector("#error");
    const tree = document.querySelector("#tree");
    const filter = document.querySelector("#filter");
    const code = document.querySelector("#code");
    const tab = document.querySelector("#tab");
    const pinOpen = document.querySelector("#pin-open");
    const addSel = document.querySelector("#add-sel");
    const attachBtn = document.querySelector("#attach");
    const picker = document.querySelector("#picker");
    const box = document.querySelector("#box");
    const attachCount = document.querySelector("#attach-count");
    const attachedBox = document.querySelector("#attached");
    const suggest = document.querySelector("#suggest");
    const help = document.querySelector("#help");
    const ayuda = document.querySelector("#ayuda");
    const carpeta = document.querySelector("#carpeta");
    const segPrompt = document.querySelector("#seg-prompt");
    const segGen = document.querySelector("#seg-gen");
    const meterNum = document.querySelector("#meter-num");
    const meterDetail = document.querySelector("#meter-detail");
    /** @type {HTMLElement | null} */
    let bubble = null;
    /** @type {AbortController | null} */
    let current = null;
    /** @type {Array<{rel: string, bytes: number}>} */
    let workspace = [];
    /**
     * @typedef {{id: string, kind: "file"|"folder"|"selection", label: string, rels: string[], rel?: string, text?: string, start?: number, end?: number}} Attachment
     */
    /** @type {Attachment[]} */
    let attachments = [];
    /** Imágenes adjuntas: se guardan en salida/adjuntos y al modelo solo le llega el aviso. */
    /** @type {{id: string, archivo: string, label: string, bytes: number}[]} */
    let imagenes = [];
    let opened = "";
    let openedText = "";
    let askId = "";
    let rawTurn = "";
    let shownLive = 0;
    let shownCmd = 0;
    /**
     * @typedef {{id: string, text: string, files: string[], snippets: Array<{rel?: string, start?: number, end?: number, text?: string}>, imagenes: string[], labels: string[]}} Queued
     */
    /** @type {Queued[]} */
    let queue = [];
    /** Continuaciones automáticas seguidas del mismo pedido (se reinicia con cada mensaje real). */
    let autoContinuaciones = 0;
    let pumping = false;
    /** El servidor tiene un turno en marcha (también tras recargar la página). */
    let serverBusy = false;
    let busyTimer = 0;
    let initialLoadDone = false;
    /** @type {Map<string, string>} */
    const oldText = new Map();

    /**
     * Aviso nativo al terminar un turno largo, solo si el usuario lo activó y
     * la ventana está oculta. No pide permiso por su cuenta: eso lo hace Ajustes.
     * @param {{motivo?: string, incompleto?: boolean} | null} evento
     */
    function notificarTurno(evento) {
      if (!evento || evento.incompleto || evento.motivo === "cancelled") return;
      if (!document.hidden || !("Notification" in window) || Notification.permission !== "granted") return;
      try {
        if (localStorage.getItem("bonsai-notificar") !== "1") return;
      } catch {
        return;
      }
      const cuerpo = evento.motivo === "error" ? "El turno terminó con error." : "Turno terminado.";
      try {
        const aviso = new Notification("Bonsai", {
          body: `${cuerpo} Vuelve a la ventana para revisar el resultado.`,
          tag: "bonsai-turno",
          silent: true,
        });
        aviso.onclick = () => {
          window.focus();
          aviso.close();
        };
      } catch {
        /* algunos navegadores bloquean Notification en app mode */
      }
    }

    /**
     * @param {string} rel
     * @returns {boolean}
     */
    function hasFile(rel) {
      return attachments.some((item) => item.kind === "file" && item.rels[0] === rel);
    }

    /**
     * @returns {string[]}
     */
    function folderNames() {
      const names = new Set();
      for (const file of workspace) {
        const parts = file.rel.split("/");
        if (parts.length > 1) names.add(parts.slice(0, -1).join("/"));
      }
      return [...names];
    }

    /**
     * @param {string} folder
     * @returns {string[]}
     */
    function filesIn(folder) {
      return workspace
        .filter((file) => file.rel === folder || file.rel.startsWith(`${folder}/`))
        .map((file) => file.rel);
    }

    let speedNote = "";

    /**
     * @param {{prompt?: number, generated?: number, cap?: number, nCtx?: number, memory?: number, folded?: number}} usage
     */
    function paintUsage(usage) {
      const nCtx = usage.nCtx || 1;
      const prompt = usage.prompt || 0;
      const generated = usage.generated || 0;
      segPrompt.style.width = `${Math.min(100, (prompt / nCtx) * 100)}%`;
      segGen.style.width = `${Math.min(100 - (prompt / nCtx) * 100, (generated / nCtx) * 100)}%`;
      meterNum.textContent = `${Math.min(nCtx, prompt + generated)} / ${nCtx}`;
      const memoria = usage.memory
        ? `memoria ${usage.memory}${usage.memoryMode === "extractiva" ? " extractiva" : ""}`
        : "memoria 0";
      const plegados = usage.folded
        ? ` · ${usage.foldedUnit === "grupos" ? "grupos plegados" : "plegados"} ${usage.folded}`
        : "";
      meterDetail.textContent = `historial ${prompt}/${usage.cap || 0} · ${memoria}${plegados} · respuesta ${generated}${speedNote ? ` · ${speedNote}` : ""}`;
    }

    /**
     * Lo que midió el servidor en la última petición: velocidad de generación y cuánto
     * del prompt salió de la caché (si es 0 % en cada turno, el servidor reprocesa todo).
     * @param {{prompt_n?: number, cache_n?: number, predicted_ps?: number}} speed
     */
    function paintSpeed(speed) {
      window.lastSpeed = speed;
      const seen = (speed.prompt_n || 0) + (speed.cache_n || 0);
      const parts = [];
      if (speed.predicted_ps) parts.push(`${speed.predicted_ps} t/s`);
      if (seen > 0) parts.push(`caché ${Math.round(((speed.cache_n || 0) / seen) * 100)} %`);
      speedNote = parts.join(" · ");
    }

    function outgoingContext() {
      const files = [];
      for (const item of attachments) {
        if (item.kind !== "selection") files.push(...item.rels);
      }
      return {
        files: [...new Set(files)].slice(0, 8),
        imagenes: imagenes.map((img) => img.archivo).slice(0, 6),
        snippets: attachments
          .filter((item) => item.kind === "selection" && item.text && item.rel)
          .slice(0, 4)
          .map((item) => ({ rel: item.rel, start: item.start, end: item.end, text: item.text })),
      };
    }

    function paintAttached() {
      attachedBox.replaceChildren();
      const packed = outgoingContext();
      const fileCount = packed.files.length + packed.snippets.length + packed.imagenes.length;
      for (const item of attachments) {
        const chip = document.createElement("button");
        chip.type = "button";
        const kind = item.kind === "folder" ? "carpeta" : item.kind === "selection" ? "selección" : "archivo";
        chip.textContent = `${kind} · ${item.label} ×`;
        chip.addEventListener("click", () => {
          attachments = attachments.filter((other) => other.id !== item.id);
          paintAttached();
          paintTree();
        });
        attachedBox.append(chip);
      }
      for (const img of imagenes) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "img";
        chip.textContent = `imagen · ${img.label} ×`;
        chip.title = `Guardada como ${img.archivo} (${img.bytes} bytes)`;
        chip.addEventListener("click", () => {
          imagenes = imagenes.filter((other) => other.id !== img.id);
          paintAttached();
        });
        attachedBox.append(chip);
      }
      attachCount.textContent = attachments.length || imagenes.length ? `${fileCount} en el prompt` : "";
      pinOpen.hidden = !opened;
      pinOpen.textContent = hasFile(opened) ? "Quitar" : "Incluir";
    }

    /**
     * @param {string} rel
     */
    function addFile(rel) {
      if (hasFile(rel)) return;
      attachments.push({ id: `file:${rel}`, kind: "file", label: rel, rels: [rel] });
      paintAttached();
      paintTree();
      if (!picker.hidden) paintPicker();
    }

    /**
     * @param {string} folder
     */
    function addFolder(folder) {
      const rels = filesIn(folder);
      if (!rels.length) return;
      const sent = rels.slice(0, 8);
      attachments = attachments.filter((item) => item.id !== `dir:${folder}`);
      const label = rels.length > sent.length ? `${folder}/ · ${sent.length} de ${rels.length}` : `${folder}/`;
      attachments.push({ id: `dir:${folder}`, kind: "folder", label, rels: sent });
      paintAttached();
      paintTree();
    }

    function paintTree() {
      const query = filter.value.trim().toLowerCase();
      tree.replaceChildren();
      for (const file of workspace) {
        if (query && !file.rel.toLowerCase().includes(query)) continue;
        const row = document.createElement("div");
        row.className = `row${file.rel === opened ? " open" : ""}${hasFile(file.rel) ? " on" : ""}`;
        row.draggable = true;
        row.addEventListener("dragstart", (event) => {
          event.dataTransfer?.setData("text/plain", file.rel);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
        });
        const ext = document.createElement("span");
        ext.className = "ext";
        ext.textContent = (file.rel.split(".").pop() || "").slice(0, 4);
        const name = document.createElement("button");
        name.type = "button";
        name.className = "name";
        name.textContent = file.rel;
        name.addEventListener("click", () => openFile(file.rel));
        const pin = document.createElement("button");
        pin.type = "button";
        pin.className = "pin";
        pin.textContent = hasFile(file.rel) ? "●" : "○";
        pin.title = "Incluir en el próximo mensaje";
        pin.addEventListener("click", () => toggleInclude(file.rel));
        row.append(ext, name, pin);
        tree.append(row);
      }
    }

    /**
     * @param {string} rel
     */
    function toggleInclude(rel) {
      if (hasFile(rel)) attachments = attachments.filter((item) => item.id !== `file:${rel}`);
      else addFile(rel);
      paintAttached();
      paintTree();
    }

    /**
     * @param {string} rel
     */
    async function openFile(rel) {
      opened = rel;
      tab.textContent = rel;
      paintAttached();
      paintTree();
      const res = await fetch(`/api/file?path=${encodeURIComponent(rel)}`);
      if (!res.ok) {
        code.className = "empty-code";
        code.textContent = "No se pudo leer el archivo.";
        return;
      }
      const text = await res.text();
      openedText = text;
      const lines = text.split(/\r?\n/);
      code.className = "";
      code.replaceChildren();
      const nums = document.createElement("div");
      nums.className = "nums";
      nums.textContent = lines.map((_, i) => String(i + 1)).join("\n");
      const src = document.createElement("div");
      src.className = "src";
      src.textContent = text;
      code.append(nums, src);
    }

    /**
     * @param {string} rel
     * @param {string} url
     * @param {number} bytes
     */
    function addFileCard(rel, url, bytes) {
      if (empty) empty.remove();
      const card = document.createElement("section");
      card.className = "card";
      card.dataset.rel = rel;
      const head = document.createElement("header");
      const name = document.createElement("strong");
      name.textContent = rel;
      const size = document.createElement("span");
      size.className = "muted";
      size.textContent = `${bytes} b`;
      const open = document.createElement("button");
      open.className = "ghost";
      open.type = "button";
      open.textContent = "Abrir";
      open.addEventListener("click", () => window.open(url, "_blank", "noopener"));
      head.append(name, size, open);
      card.append(head);
      if (rel.endsWith(".html")) {
        const frame = document.createElement("iframe");
        frame.sandbox = "allow-scripts";
        frame.src = url;
        frame.title = rel;
        card.append(frame);
      }
      log.append(card);
      log.scrollTop = log.scrollHeight;
    }

    /**
     * @param {HTMLElement} node
     * @returns {HTMLElement}
     */
    function msgText(node) {
      const body = node.querySelector(".body");
      return body instanceof HTMLElement ? body : node;
    }

    /** @type {WeakMap<HTMLElement, number>} */
    const bodyTimers = new WeakMap();

    /**
     * Pinta el texto de una respuesta como markdown (código resaltado, listas, tablas…).
     * Mientras llegan tokens se repinta como mucho cada 70 ms; el texto crudo queda en
     * data-raw para copiarlo tal cual.
     * @param {HTMLElement} node
     * @param {string} text
     * @param {boolean} [now]
     */
    function setBody(node, text, now = true) {
      node.dataset.raw = text;
      if (!window.BonsaiMd) {
        node.textContent = text;
        return;
      }
      const paint = () => {
        bodyTimers.delete(node);
        const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 40;
        node.classList.add("md");
        node.innerHTML = window.BonsaiMd.render(node.dataset.raw || "");
        if (stick) log.scrollTop = log.scrollHeight;
      };
      if (now) {
        const pending = bodyTimers.get(node);
        if (pending) window.clearTimeout(pending);
        paint();
      } else if (!bodyTimers.has(node)) {
        bodyTimers.set(node, window.setTimeout(paint, 70));
      }
    }

    /**
     * @param {string} text
     * @param {"user" | "assistant"} role
     */
    function addMessage(text, role) {
      if (empty) empty.remove();
      const node = document.createElement("div");
      node.className = `msg ${role}`;
      // Solo los mensajes nuevos entran animados; al restaurar una sesión no hay ráfaga.
      node.classList.add("nueva");
      node.addEventListener("animationend", () => node.classList.remove("nueva"), { once: true });
      if (role === "assistant") {
        const body = document.createElement("div");
        body.className = "body";
        setBody(body, text);
        const copy = document.createElement("button");
        copy.type = "button";
        copy.className = "ghost";
        copy.textContent = "Copiar";
        copy.addEventListener("click", async () => {
          const value = body.dataset.raw || body.textContent || "";
          try {
            if (!navigator.clipboard?.writeText) throw new Error("sin portapapeles");
            await navigator.clipboard.writeText(value);
            copy.textContent = "Copiado";
          } catch {
            try {
              const area = document.createElement("textarea");
              area.value = value;
              area.setAttribute("readonly", "");
              document.body.append(area);
              area.select();
              const ok = document.execCommand("copy");
              area.remove();
              copy.textContent = ok ? "Copiado" : "No se pudo copiar";
            } catch {
              copy.textContent = "No se pudo copiar";
            }
          }
          window.setTimeout(() => { copy.textContent = "Copiar"; }, 1400);
        });
        node.append(body, copy);
      } else {
        node.textContent = text;
      }
      log.append(node);
      log.scrollTop = log.scrollHeight;
      return node;
    }

    /**
     * @param {string} text
     */
    function addStatus(text) {
      if (!text) return;
      const node = document.createElement("div");
      node.className = "note";
      node.textContent = text;
      log.append(node);
      log.scrollTop = log.scrollHeight;
    }

    /**
     * @param {string} text
     * @returns {Array<{kind: string, title: string}>}
     */
    const WRITE_EXT = new Set(["html", "css", "js", "mjs", "svg", "txt", "md", "json", "py", "ps1", "ts", "tsx", "jsx"]);
