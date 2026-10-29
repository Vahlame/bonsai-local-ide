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
    /** @type {Map<string, string>} */
    const oldText = new Map();

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
      meterDetail.textContent = `historial ${prompt}/${usage.cap || 0} · memoria ${usage.memory || 0} · respuesta ${generated}${speedNote ? ` · ${speedNote}` : ""}`;
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

    /**
     * @param {string} rel
     * @param {string} before
     * @param {string} after
     * @returns {string}
     */
    function liveDiff(rel, before, after) {
      const next = String(after).replace(/\s+$/, "");
      if (!before) return [`--- /dev/null`, `+++ ${rel}`, ...next.split(/\n/).map((line) => `+${line}`)].join("\n");
      const oldLines = String(before).replace(/\s+$/, "").split(/\n/);
      const newLines = next.split(/\n/);
      if (oldLines.length * newLines.length > 400000) {
        return indexDiff(rel, oldLines, newLines);
      }
      const n = oldLines.length;
      const m = newLines.length;
      const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
      for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
          dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
      /** @type {string[]} */
      const rows = [];
      let i = 0;
      let j = 0;
      while (i < n && j < m) {
        if (oldLines[i] === newLines[j]) { rows.push(` ${oldLines[i]}`); i += 1; j += 1; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push(`-${oldLines[i]}`); i += 1; }
        else { rows.push(`+${newLines[j]}`); j += 1; }
      }
      while (i < n) { rows.push(`-${oldLines[i]}`); i += 1; }
      while (j < m) { rows.push(`+${newLines[j]}`); j += 1; }
      const keep = rows.map(() => false);
      for (let k = 0; k < rows.length; k += 1) {
        if (rows[k].startsWith(" ")) continue;
        for (let t = Math.max(0, k - 2); t <= Math.min(rows.length - 1, k + 2); t += 1) keep[t] = true;
      }
      /** @type {string[]} */
      const body = [`--- ${rel}`, `+++ ${rel}`];
      let skipped = false;
      for (let k = 0; k < rows.length; k += 1) {
        if (!keep[k]) { skipped = true; continue; }
        if (skipped) { body.push("@@"); skipped = false; }
        body.push(rows[k]);
      }
      return body.length > 2 ? body.join("\n") : `${body.join("\n")}\n sin cambios`;
    }

    /**
     * @param {string} head
     * @param {string} body
     * @returns {{kind: string, title: string, detail?: string} | null}
     */
    function classifyFence(head, body) {
      const h = head.trim();
      const low = h.toLowerCase();
      const lines = body.replace(/^\s+|\s+$/g, "").split(/\r?\n/);
      const first = (lines[0] || "").trim();
      const name = first.toLowerCase().split(/\s/)[0] || "";
      const inline = first.replace(/^(ejecutar|leer|indice|índice|archivo|buscar)\s*/i, "").trim();
      const rest = [inline, ...lines.slice(1)].map((line) => line.trimEnd()).filter((line, index) => line || index > 0).join("\n").trim();
      const tagged = /^(ejecutar|leer|indice|índice|archivo|buscar)\b/i.test(low);
      const tool = tagged ? low.split(/\s/)[0] : (!low ? name : "");
      const arg = tagged ? (low.replace(/^(ejecutar|leer|indice|índice|archivo|buscar)\s*/i, "").trim() || body.trim()) : rest;
      if (tool === "ejecutar") return arg ? { kind: "cmd", title: arg } : null;
      if (tool === "buscar") {
        const query = arg.replace(/\s+/g, " ").trim().slice(0, 200);
        return query ? { kind: "search", title: query } : null;
      }
      if (tool === "leer") return arg ? { kind: "read", title: arg.split(/\n/)[0] } : { kind: "index", title: "carpeta" };
      if (tool === "indice" || tool === "índice") return { kind: "index", title: arg || "carpeta" };
      if (tool === "archivo") {
        let title = (tagged ? h : first).replace(/^archivo\s*/i, "").trim();
        let fileLines = tagged ? lines.slice() : lines.slice(1);
        if (!title) {
          title = (fileLines[0] || "").trim();
          fileLines = fileLines.slice(1);
        }
        if (!/^[^\s]+\.[a-z0-9]{1,12}$/i.test(title)) return null;
        return { kind: "write", title, detail: fileLines.join("\n").replace(/\s+$/, "") };
      }
      if (/\.[a-z0-9]+$/i.test(h) && !h.includes(" ")) return { kind: "write", title: h, detail: body.replace(/\s+$/, "") };
      if (!h && /^[^\s]+\.[a-z0-9]{1,12}$/i.test(first)) {
        let fileLines = lines.slice(1);
        if ((fileLines[0] || "").trim() === first) fileLines = fileLines.slice(1);
        return { kind: "write", title: first, detail: fileLines.join("\n").replace(/\s+$/, "") };
      }
      if (WRITE_EXT.has(low) && body.trim()) return { kind: "write", title: `.${low}`, detail: body.replace(/\s+$/, "") };
      return null;
    }

    function liveSteps(text) {
      /** @type {Array<{kind: string, title: string, detail?: string}>} */
      const steps = [];
      const re = /```([^\n`]*)\n?([\s\S]*?)```/g;
      for (const match of text.matchAll(re)) {
        const step = classifyFence(match[1] || "", match[2] || "");
        if (step) steps.push(step);
      }
      return steps;
    }

    /**
     * @param {string} text
     * @returns {{kind: string, title: string, detail?: string} | null}
     */
    function trailingWrite(text) {
      const closed = text.replace(/```[\s\S]*?```/g, "");
      const open = closed.match(/```([^\n`]*)\n([\s\S]*)$/);
      if (!open) return null;
      const step = classifyFence(open[1] || "", open[2] || "");
      return step && step.kind === "write" ? step : null;
    }

    /**
     * @param {string} text
     * @returns {string}
     */
    /**
     * @param {string} text
     * @returns {string}
     */
    function stripLooseCommands(text) {
      /** @type {string[]} */
      const out = [];
      let drop = "";
      for (const line of text.split("\n")) {
        const tagged = line.match(/^(?:ejecutar|ejecutando)\s*:\s*(.+)$/i);
        if (tagged) {
          drop = (tagged[1] || "").trim();
          continue;
        }
        if (drop && line.trim() === drop) continue;
        if (line.trim() && line.trim() !== drop) drop = "";
        out.push(line);
      }
      return out.join("\n").trim();
    }

    /**
     * @param {string} text
     * @returns {string[]}
     */
    function looseCommands(text) {
      /** @type {string[]} */
      const found = [];
      for (const line of text.split("\n")) {
        const tagged = line.match(/^(?:ejecutar|ejecutando)\s*:\s*(.+)$/i);
        const command = tagged?.[1]?.trim() || "";
        if (command && !found.includes(command)) found.push(command);
      }
      return found;
    }

    function proseOf(text) {
      const closed = text.replace(/```[^\n`]*\n?[\s\S]*?```/g, (block) => (liveSteps(block).length ? "" : block));
      const open = closed.match(/```[^\n`]*\n[\s\S]*$/);
      const prose = !open || open.index === undefined
        ? closed
        : (classifyFence((open[0].match(/^```([^\n`]*)/) || [])[1] || "", open[0].replace(/^```[^\n`]*\n/, ""))
          ? closed.slice(0, open.index)
          : closed);
      return stripLooseCommands(prose);
    }

    /**
     * @param {string} id
     * @param {string} kind
     * @param {string} title
     * @param {string} [detail]
     */
    /**
     * @param {string} rel
     * @param {string[]} oldLines
     * @param {string[]} newLines
     * @returns {string}
     */
    function indexDiff(rel, oldLines, newLines) {
      /** @type {string[]} */
      const rows = [`--- ${rel}`, `+++ ${rel}`];
      const max = Math.max(oldLines.length, newLines.length);
      for (let i = 0; i < max && rows.length < 220; i += 1) {
        const prev = oldLines[i];
        const next = newLines[i];
        if (prev === next) continue;
        if (prev !== undefined) rows.push(`-${prev}`);
        if (next !== undefined) rows.push(`+${next}`);
      }
      return rows.join("\n");
    }

    function paintLive(id, kind, title, detail) {
      const body = detail || "";
      const shown = kind === "write"
        ? (body.trim() ? liveDiff(title, oldText.get(title) || "", body) : `--- ${title}\n+++ ${title}`)
        : body;
      paintAction({ id, kind, title, state: "run", detail: shown });
      const node = log.querySelector(`[data-action="${id}"]`);
      if (node instanceof HTMLElement) {
        node.classList.add("live");
        node.dataset.kind = kind;
        node.dataset.title = title;
      }
    }

    function syncLive() {
      const steps = liveSteps(rawTurn);
      while (shownLive < steps.length) {
        const step = steps[shownLive];
        shownLive += 1;
        log.querySelector(`[data-action="live-${askId}-open"]`)?.remove();
        paintLive(`live-${askId}-${shownLive}`, step.kind, step.title, step.detail || "");
        if (step.kind === "write" && !oldText.has(step.title)) {
          const title = step.title;
          const id = `live-${askId}-${shownLive}`;
          oldText.set(title, "");
          fetch(`/api/file?path=${encodeURIComponent(title)}`).then(async (res) => {
            oldText.set(title, res.ok ? await res.text() : "");
            const node = log.querySelector(`[data-action="${id}"]`);
            if (node instanceof HTMLElement && node.classList.contains("live")) paintLive(id, "write", title, step.detail || "");
          }).catch(() => { oldText.set(title, ""); });
        }
      }
      const draft = trailingWrite(rawTurn);
      if (draft) {
        paintLive(`live-${askId}-open`, "write", draft.title, draft.detail || "");
        if (!oldText.has(draft.title)) {
          const title = draft.title;
          oldText.set(title, "");
          fetch(`/api/file?path=${encodeURIComponent(title)}`).then(async (res) => {
            oldText.set(title, res.ok ? await res.text() : "");
            if (log.querySelector(`[data-action="live-${askId}-open"]`)) paintLive(`live-${askId}-open`, "write", title, draft.detail || "");
          }).catch(() => { oldText.set(title, ""); });
        }
      }
      const cmds = looseCommands(rawTurn);
      while (shownCmd < cmds.length) {
        const title = cmds[shownCmd];
        shownCmd += 1;
        paintLive(`live-${askId}-cmd-${shownCmd}`, "cmd", title, "");
      }
      if (bubble && bubble.isConnected) setBody(msgText(bubble), proseOf(rawTurn), false);
    }

    /**
     * @param {string} kind
     * @param {string} title
     */
    function dropLive(kind, title) {
      const nodes = [...log.querySelectorAll(".action.live")];
      const hit = nodes.find((el) => el instanceof HTMLElement && el.dataset.kind === kind && el.dataset.title === title)
        || nodes.find((el) => el instanceof HTMLElement && el.dataset.kind === kind);
      if (hit instanceof HTMLElement) hit.remove();
    }

    /**
     * @param {{id?: string, kind?: string, title?: string, state?: string, detail?: string, code?: number}} event
     */
    function paintAction(event) {
      const id = String(event.id || "");
      let node = id ? [...log.querySelectorAll(".action")].find((el) => el instanceof HTMLElement && el.dataset.action === id) : null;
      if (!(node instanceof HTMLElement)) {
        node = document.createElement("section");
        node.className = "action";
        if (id) node.dataset.action = id;
        const head = document.createElement("div");
        head.className = "head";
        const kind = document.createElement("span");
        kind.className = "kind";
        const title = document.createElement("span");
        title.className = "title";
        head.append(kind, title);
        const pre = document.createElement("pre");
        pre.hidden = true;
        node.append(head, pre);
        log.append(node);
        if (askId) node.dataset.ask = askId;
      }
      node.classList.toggle("run", event.state === "run" || event.state === "permit");
      node.classList.toggle("denied", event.state === "denied");
      node.querySelector(".permit-bar")?.remove();
      node.querySelector(".undo-bar")?.remove();
      const kind = node.querySelector(".kind");
      const title = node.querySelector(".title");
      const pre = node.querySelector("pre");
      const labels = { cmd: "ejecutar", read: "leer", index: "índice", write: "diff", search: "buscar", browser: "navegador", deny: "bloqueado", plan: "plan" };
      const states = { run: "en curso", done: "listo", denied: "bloqueado", permit: "¿permites?" };
      if (kind) kind.textContent = `${labels[event.kind || ""] || "acción"} · ${states[event.state || ""] || event.state || ""}`;
      const name = String(event.title || "");
      const code = typeof event.code === "number" ? ` · código ${event.code}` : "";
      if (title) title.textContent = event.state === "run" ? name : `${name}${code}`;
      if (pre) {
        const detail = typeof event.detail === "string" ? event.detail : "";
        pre.hidden = !detail;
        const asDiff = event.kind === "write" || detail.startsWith("--- ");
        const asSearch = event.kind === "search" && !asDiff;
        pre.classList.toggle("diff", asDiff);
        pre.classList.toggle("hits", asSearch);
        if (asSearch) {
          pre.replaceChildren();
          let blocks = detail.split(/\n\n+/);
          try {
            const data = JSON.parse(detail);
            if (Array.isArray(data.resultados)) blocks = data.resultados.map((r) => [r.titulo, r.url, r.resumen].filter(Boolean).join("\n"));
          } catch { /* formato de búsquedas anteriores */ }
          for (const block of blocks) {
            const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
            if (!lines.length) continue;
            const hit = document.createElement("div");
            hit.className = "hit";
            const strong = document.createElement("strong");
            strong.textContent = lines[0];
            hit.append(strong);
            const url = lines.find((line) => /^https?:\/\//i.test(line)) || "";
            if (url) {
              const link = document.createElement("a");
              link.href = url;
              link.target = "_blank";
              link.rel = "noreferrer";
              link.textContent = url;
              hit.append(link);
            }
            const rest = lines.filter((line) => line !== lines[0] && line !== url).join(" ");
            if (rest) {
              const note = document.createElement("span");
              note.textContent = rest;
              hit.append(note);
            }
            pre.append(hit);
          }
        } else if (!asDiff) pre.textContent = detail;
        else {
          pre.replaceChildren();
          const follow = event.state === "run";
          for (const line of detail.split("\n")) {
            const row = document.createElement("div");
            const mark = document.createElement("span");
            mark.className = "mark";
            const code = document.createElement("span");
            code.className = "code";
            if (line.startsWith("+") && !line.startsWith("+++")) {
              row.className = "add";
              mark.textContent = "+";
              code.textContent = line.slice(1);
            } else if (line.startsWith("-") && !line.startsWith("---")) {
              row.className = "del";
              mark.textContent = "−";
              code.textContent = line.slice(1);
            } else if (line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++") || line === " sin cambios") {
              row.className = "meta";
              row.textContent = line;
              pre.append(row);
              continue;
            } else {
              row.className = "ctx";
              mark.textContent = " ";
              code.textContent = line.startsWith(" ") ? line.slice(1) : line;
            }
            row.append(mark, code);
            pre.append(row);
          }
          if (follow) pre.scrollTop = pre.scrollHeight;
        }
      }
      node.querySelector(".browser-capture")?.remove();
      if (event.kind === "browser" && /^\/salida\/navegador\/navegador-\d+-\d+\.png$/.test(String(event.captura || ""))) {
        const capture = document.createElement("details");
        capture.className = "browser-capture";
        capture.style.padding = "8px 12px";
        const summary = document.createElement("summary");
        summary.textContent = event.vision ? "Ver captura enviada al modelo" : "Ver captura · modelo sin visión";
        const link = document.createElement("a");
        link.href = event.captura;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        const img = document.createElement("img");
        img.src = event.captura;
        img.loading = "lazy";
        img.alt = "Resultado de la acción del navegador";
        img.style.cssText = "display:block;max-width:100%;max-height:280px;object-fit:contain;margin-top:8px";
        link.append(img);
        capture.append(summary, link);
        node.append(capture);
      }
      if (event.state === "permit" && event.kind === "cmd") {
        const bar = document.createElement("div");
        bar.className = "permit-bar";
        const yes = document.createElement("button");
        yes.type = "button";
        yes.className = "primary";
        yes.textContent = "Permitir";
        const no = document.createElement("button");
        no.type = "button";
        no.className = "ghost";
        no.textContent = "Rechazar";
        const reply = (allow) => {
          yes.disabled = true;
          no.disabled = true;
          fetch("/api/permit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, allow }),
          }).catch((err) => {
            errorBox.textContent = err instanceof Error ? err.message : String(err);
          });
        };
        yes.addEventListener("click", () => reply(true));
        no.addEventListener("click", () => reply(false));
        bar.append(yes, no);
        node.append(bar);
      }
      // Cada escritura del agente trae su punto de deshacer: la tarjeta puede revertirla.
      if (event.kind === "write" && typeof event.undo === "string" && event.undo) {
        node.dataset.undo = event.undo;
        const bar = document.createElement("div");
        bar.className = "undo-bar";
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ghost";
        b.textContent = "Deshacer esta escritura";
        b.title = "Devuelve el archivo a como estaba antes de este cambio";
        b.addEventListener("click", async () => {
          b.disabled = true;
          try {
            await deshacerEscritura(event.undo, node);
            b.textContent = "Deshecho";
          } catch (err) {
            b.disabled = false;
            errorBox.textContent = err instanceof Error ? err.message : String(err);
          }
        });
        bar.append(b);
        node.append(bar);
      }
      log.scrollTop = log.scrollHeight;
    }

    /**
     * Deshace una escritura del agente (o del editor) por su id.
     * @param {string} id
     * @param {HTMLElement | null} [node]
     */
    async function deshacerEscritura(id, node) {
      const res = await fetch("/api/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      node?.classList.add("undone");
      // La tarjeta "Abrir" de ese archivo ya no lleva a nada: fuera.
      for (const card of log.querySelectorAll(".card[data-rel]")) {
        if (card.dataset.rel === data.rel) card.remove();
      }
      // Si ya no queda nada pendiente, el botón de revertir el turno sobra.
      if (!log.querySelector(".action[data-undo]:not(.undone)")) log.querySelector(".undo-bar.turno")?.remove();
      addStatus(`Deshecho: ${data.rel}`);
      await refreshTree();
    }

    /**
     * Revierte de golpe todas las escrituras del último turno del agente.
     * @param {HTMLElement} barra
     */
    async function revertirTurno(barra) {
      const botones = [...barra.querySelectorAll("button")];
      for (const b of botones) b.disabled = true;
      const ask = barra.dataset.ask || "";
      try {
        const res = await fetch("/api/undo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ turno: true }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        // Solo las tarjetas de ESTE turno: el servidor revierte las del último turno.
        for (const node of log.querySelectorAll(`.action[data-undo][data-ask="${ask}"]`)) {
          node.classList.add("undone");
          node.querySelector(".undo-bar")?.remove();
        }
        const revertidos = new Set(data.revertidos || []);
        for (const card of log.querySelectorAll(".card[data-rel]")) {
          if (revertidos.has(card.dataset.rel || "")) card.remove();
        }
        addStatus(`Revertido el turno: ${(data.revertidos || []).join(", ")}`);
        barra.remove();
        await refreshTree();
      } catch (err) {
        for (const b of botones) b.disabled = false;
        errorBox.textContent = err instanceof Error ? err.message : String(err);
      }
    }

    /**
     * Botón "Revertir todo el turno" cuando el agente escribió algo.
     * @param {number} cuantas
     */
    function pintarRevertirTurno(cuantas) {
      // Solo cuenta lo que sigue sin deshacer: si ya se revirtió una a mano, no se anuncia.
      const pendientes = log.querySelectorAll(".action[data-undo]:not(.undone)").length;
      if (!cuantas || !pendientes) return;
      const barra = document.createElement("div");
      barra.className = "undo-bar turno";
      barra.dataset.ask = askId;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ghost";
      b.textContent = pendientes === 1 ? "Revertir la escritura de este turno" : `Revertir las ${pendientes} escrituras de este turno`;
      b.addEventListener("click", () => revertirTurno(barra));
      barra.append(b);
      log.append(barra);
      log.scrollTop = log.scrollHeight;
    }

    /**
     * @param {"ask" | "all"} mode
     */
    function paintPermitMode(mode) {
      document.querySelector("#permit-ask")?.classList.toggle("on", mode === "ask");
      document.querySelector("#permit-all")?.classList.toggle("on", mode === "all");
    }

    /**
     * @param {"ask" | "all"} mode
     */
    async function setPermitMode(mode) {
      const res = await fetch("/api/permit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!res.ok) throw new Error(await res.text());
      paintPermitMode(mode);
    }

    function hideSuggest() {
      suggest.style.display = "none";
      suggest.replaceChildren();
    }

    /**
     * @param {string} rel
     */
    function pickFile(rel) {
      addFile(rel);
      const cursor = input.selectionStart || input.value.length;
      input.value = `${input.value.slice(0, cursor).replace(/@[\w./-]*$/, "")}${input.value.slice(cursor)}`;
      hideSuggest();
      paintAttached();
      paintTree();
      input.focus();
    }

    /**
     * @param {{turns?: Array<{role?: string, content?: string, actions?: Array<object>}>, files?: Array<{rel: string, url: string, bytes?: number}>}} data
     */
    function addReasoning(text, before = null) {
      const panel=document.createElement("details");panel.className="reasoning-panel";
      panel.open=localStorage.getItem("bonsai-ver-pensamiento")!=="0";
      const summary=document.createElement("summary");summary.textContent="Pensamiento del modelo";
      const pre=document.createElement("pre");pre.append(document.createTextNode(String(text||"")));
      panel.append(summary,pre);
      if(before?.isConnected)before.before(panel);else log.append(panel);
      return panel;
    }

    function paintConversation(data) {
      log.replaceChildren();
      const turns = data.turns || [];
      if (!turns.length) {
        const node = document.createElement("div");
        node.className = "msg";
        node.id = "empty";
        node.textContent = "Escribe el cambio; un clic abre el archivo y Adjuntar lo incluye en el mensaje.";
        log.append(node);
      }
      for (const turn of turns) {
        if (turn.role === "user") {
          if (turn.content) addMessage(turn.content, "user");
          continue;
        }
        if (turn.reasoning) addReasoning(turn.reasoning);
        if (turn.content) addMessage(turn.content, "assistant");
        for (const action of turn.actions || []) paintAction(/** @type {{id?: string, kind?: string, title?: string, state?: string, detail?: string, code?: number}} */ (action));
      }
      for (const file of data.files || []) addFileCard(file.rel, file.url, file.bytes || 0);
    }

    /**
     * @param {number} stamp
     * @returns {string}
     */
    function when(stamp) {
      if (!stamp) return "";
      return new Date(stamp).toLocaleString("es", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    }

    /**
     * @param {{active?: string, items?: Array<{id: string, title: string, updated: number}>}} data
     */
    function paintChats(data) {
      const list = document.querySelector("#chats");
      if (!(list instanceof HTMLElement)) return;
      list.replaceChildren();
      for (const item of data.items || []) {
        const row = document.createElement("div");
        row.className = `chat-row${item.id === data.active ? " on" : ""}`;
        const open = document.createElement("button");
        open.type = "button";
        open.className = "open";
        const title = document.createElement("strong");
        title.textContent = item.title || "Nueva conversación";
        const time = document.createElement("small");
        time.textContent = when(item.updated);
        open.append(title, time);
        open.addEventListener("click", () => { if (item.id !== data.active) void switchChat(item.id); });
        const drop = document.createElement("button");
        drop.type = "button";
        drop.className = "x";
        drop.textContent = "×";
        drop.title = "Borrar conversación";
        drop.addEventListener("click", () => { void deleteChat(item); });
        row.append(open, drop);
        list.append(row);
      }
    }

    async function reloadConversation() {
      const [stateRes, chatRes] = await Promise.all([fetch("/api/state"), fetch("/api/chats")]);
      if (stateRes.ok) {
        const data = await stateRes.json();
        document.querySelector("#meta").textContent = `ventana ${data.nCtx}`;
        paintUsage(data.usage || { nCtx: data.nCtx, cap: data.historyCap });
        paintConversation(data);
      }
      if (chatRes.ok) paintChats(await chatRes.json());
    }

    /**
     * @param {string} id
     */
    async function switchChat(id) {
      errorBox.textContent = "";
      const res = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "open", id }),
      });
      if (!res.ok) {
        errorBox.textContent = await res.text();
        return;
      }
      queue = [];
      paintQueue();
      attachments = [];
      imagenes = [];
      paintAttached();
      await reloadConversation();
    }

    /**
     * @param {{id: string, title: string}} item
     */
    async function deleteChat(item) {
      if (!window.confirm(`¿Borrar «${item.title}»?`)) return;
      const res = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "delete", id: item.id }),
      });
      if (!res.ok) {
        errorBox.textContent = await res.text();
        return;
      }
      await reloadConversation();
    }

    async function loadState() {
      const [stateRes, treeRes, chatRes] = await Promise.all([fetch("/api/state"), fetch("/api/workspace"), fetch("/api/chats")]);
      if (stateRes.ok) {
        const data = await stateRes.json();
        document.querySelector("#meta").textContent = `ventana ${data.nCtx}`;
        paintUsage(data.usage || { nCtx: data.nCtx, cap: data.historyCap });
        paintConversation(data);
      }
      if (treeRes.ok) applyWorkspace(await treeRes.json(), false);
      if (chatRes.ok) paintChats(await chatRes.json());
    }

    /**
     * @param {{root?: string, name?: string, files?: Array<{rel: string, bytes: number}>}} data
     * @param {boolean} resetView
     */
    async function refreshTree() {
      const again = await fetch("/api/workspace");
      if (!again.ok) return;
      applyWorkspace(await again.json(), false);
      if (opened && !workspace.some((file) => file.rel === opened)) {
        opened = "";
        openedText = "";
        tab.textContent = "Sin archivo";
        code.className = "empty-code";
        code.textContent = "Ese archivo ya no está en la carpeta.";
        pinOpen.hidden = true;
        paintAttached();
      }
    }

    function applyWorkspace(data, resetView) {
      workspace = data.files || [];
      const name = data.name || "proyecto local";
      const small = document.querySelector(".brand small");
      if (small instanceof HTMLElement) {
        small.textContent = name;
        small.title = data.root || "";
      }
      if (carpeta instanceof HTMLButtonElement) {
        carpeta.title = data.root ? `Carpeta: ${data.root}` : "Cambiar carpeta de trabajo";
      }
      if (resetView) {
        opened = "";
        openedText = "";
        attachments = [];
        imagenes = [];
        tab.textContent = "Sin archivo";
        code.className = "empty-code";
        code.textContent = "Abre un archivo del explorador. La vista es local y no gasta contexto hasta que la incluyas o el modelo pida leerla.";
        pinOpen.hidden = true;
        paintAttached();
      }
      paintTree();
    }

    function paintQueue() {
      const list = document.querySelector("#queue");
      if (!(list instanceof HTMLElement)) return;
      list.replaceChildren();
      list.hidden = queue.length === 0;
      queue.forEach((job, index) => {
        const row = document.createElement("div");
        row.className = "q";
        const label = document.createElement("span");
        label.textContent = `${index + 1}. ${job.text}`;
        label.title = job.text;
        const drop = document.createElement("button");
        drop.type = "button";
        drop.className = "ghost";
        drop.textContent = "Quitar";
        drop.addEventListener("click", () => {
          queue = queue.filter((item) => item.id !== job.id);
          paintQueue();
        });
        row.append(label, drop);
        list.append(row);
      });
      if (send instanceof HTMLButtonElement) send.textContent = pumping ? "Encolar" : "Enviar";
      const stop = document.querySelector("#stop");
      if (stop instanceof HTMLElement) stop.hidden = !pumping;
    }

    async function pump() {
      if (pumping) return;
      pumping = true;
      paintQueue();
      try {
        while (queue.length) {
          const job = queue.shift();
          paintQueue();
          if (job) await ask(job);
        }
      } finally {
        pumping = false;
        paintQueue();
        if (queue.length) void pump();
        else input.focus();
      }
    }

    function enqueue() {
      const text = input.value.trim();
      if (!text) return;
      const packed = outgoingContext();
      queue.push({
        id: `${Date.now()}-${queue.length}`,
        text,
        files: packed.files,
        snippets: packed.snippets,
        imagenes: packed.imagenes,
        labels: [...attachments.map((item) => item.label), ...imagenes.map((img) => `imagen ${img.label}`)],
      });
      input.value = "";
      autoContinuaciones = 0;
      attachments = [];
      imagenes = [];
      hideSuggest();
      paintAttached();
      paintTree();
      paintQueue();
      void pump();
    }

    /**
     * @param {Queued} job
     */
    async function ask(job) {
      errorBox.textContent = "";
      hideSuggest();
      if (!job.interna) addMessage(job.text, "user");
      if (job.labels.length) addStatus(`Adjuntos: ${job.labels.join(", ")}`);
      askId = String(Date.now());
      rawTurn = "";
      shownLive = 0;
      shownCmd = 0;
      // El botón de revertir el turno anterior ya no sirve: el servidor solo guarda
      // los puntos de deshacer del último turno.
      for (const vieja of [...log.querySelectorAll(".undo-bar.turno")]) vieja.remove();
      let escriturasConUndo = 0;
      /** Último evento "done" del servidor (motivo real de la parada). */
      let lastDone = null;
      /** Nota de progreso de una llamada larga (se reutiliza y se quita al terminar). */
      /** @type {HTMLElement | null} */
      let progreso = null;
      bubble = addMessage("", "assistant");
      let reasoningPanel=null;
      current = new AbortController();
      // Agrupa el analisis del texto y los diffs: hacerlo por CADA token bloqueaba
      // el hilo del navegador en respuestas largas y la caja dejaba de responder.
      let liveTimer = 0;
      let treeTimer = 0;
      const startedAt = Date.now();
      let lastDataAt = startedAt;
      let phase = "Preparando respuesta";
      const activity = document.createElement("div");
      activity.className = "generation-status";
      activity.setAttribute("role", "status");
      document.querySelector("#box").prepend(activity);
      const showActivity = () => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        activity.textContent = `${Date.now() - lastDataAt > 30000 ? "Esperando al servidor" : phase} · ${elapsed} s · Detener para cancelar`;
      };
      showActivity();
      const activityTimer = window.setInterval(showActivity, 1000);
      const flushLive = () => {
        clearTimeout(liveTimer);
        liveTimer = 0;
        syncLive();
      };
      const queueTree = () => {
        if (!treeTimer) treeTimer = window.setTimeout(() => {
          treeTimer = 0;
          refreshTree().catch(() => {});
        }, 250);
      };
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: job.text, files: job.files, snippets: job.snippets, imagenes: job.imagenes || [] }),
          signal: current.signal,
        });
        if (!res.ok || !res.body) throw new Error(await res.text());
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          lastDataAt = Date.now();
          buf += decoder.decode(value, { stream: true });
          let nl = buf.indexOf("\n");
          while (nl !== -1) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            nl = buf.indexOf("\n");
            if (!line.startsWith("data:")) continue;
            const event = JSON.parse(line.slice(5));
            if (event.type === "token") {
              phase = "Generando respuesta";
              if (!bubble || !bubble.isConnected) bubble = addMessage("", "assistant");
              rawTurn += event.text || "";
              if (!liveTimer) liveTimer = window.setTimeout(flushLive, 120);
            } else if (event.type === "reasoning") {
              phase="Pensando";showActivity();
              if(!reasoningPanel)reasoningPanel=addReasoning("",bubble);
              const pre=reasoningPanel.querySelector("pre");
              pre.firstChild.appendData(String(event.text||""));
              if(log.scrollTop+log.clientHeight>=log.scrollHeight-120)log.scrollTop=log.scrollHeight;
            } else if (event.type === "status") {
              phase = event.text || "Trabajando";
              showActivity();
              addStatus(event.text || "");
            }
            else if (event.type === "tool_progress") {
              // El modelo está escribiendo dentro de una llamada (p. ej. un archivo grande):
              // una sola nota que se actualiza, para que no parezca colgado.
              if (!progreso || !progreso.isConnected) {
                progreso = document.createElement("div");
                progreso.className = "note progreso";
                log.append(progreso);
              }
              const que = event.ruta ? `${event.name === "reemplazar" ? "Cambiando" : "Escribiendo"} ${event.ruta}` : `Preparando ${event.name || "la acción"}`;
              phase = que;
              progreso.textContent = `✍️ ${que}… ${Number(event.chars || 0).toLocaleString("es")} caracteres`;
              log.scrollTop = log.scrollHeight;
            }
            else if (event.type === "usage") paintUsage(event);
            else if (event.type === "speed") paintSpeed(event);
            else if (event.type === "action") {
              reasoningPanel=null;
              if (liveTimer) flushLive();
              if (progreso) {
                progreso.remove();
                progreso = null;
              }
              dropLive(String(event.kind || ""), String(event.title || ""));
              if (event.kind === "write" && event.state === "done") oldText.delete(String(event.title || ""));
              if (event.kind === "write" && typeof event.undo === "string" && event.undo) escriturasConUndo += 1;
              paintAction(event);
              if (event.state !== "run") {
                bubble = null;
                queueTree();
              }
            } else if (event.type === "replace") {
              clearTimeout(liveTimer);
              liveTimer = 0;
              rawTurn = "";
              shownLive = 0;
              shownCmd = 0;
              log.querySelector(`[data-action="live-${askId}-open"]`)?.remove();
              const next = event.text || "";
              if (bubble) {
                if (!next.trim()) {
                  bubble.remove();
                  bubble = null;
                } else setBody(msgText(bubble), next);
              }
            }
            else if (event.type === "file") {
              addFileCard(event.rel, event.url, event.bytes || 0);
              queueTree();
            } else if (event.type === "done") lastDone = event;
            else if (event.type === "error") throw new Error(event.text || "error");
          }
        }
        if (liveTimer) flushLive();
        for (const node of [...log.querySelectorAll(`.action.live[data-ask="${askId}"]`)]) {
          if (!(node instanceof HTMLElement)) continue;
          paintAction({
            id: node.dataset.action || "",
            kind: node.dataset.kind || "cmd",
            title: node.dataset.title || "",
            state: "denied",
            detail: "Lo escribió y no se ejecutó.",
          });
          node.classList.remove("live");
        }
        if (progreso) {
          progreso.remove();
          progreso = null;
        }
        const did = log.querySelector(`.action[data-ask="${askId}"]`);
        if (!did) addStatus("Sin acciones.");
        if (bubble) {
          const body = msgText(bubble);
          if (body.dataset.raw !== undefined) setBody(body, body.dataset.raw);
          if (!(body.dataset.raw || body.textContent || "").trim()) bubble.remove();
        }
        pintarRevertirTurno(escriturasConUndo);
        // «Continuar hasta terminar»: si el turno paró por falta de pasos o atasco y no lo
        // cancelaste, se encola un turno interno (no se pinta como mensaje del usuario) para
        // que el agente siga con el plan pendiente. Máximo 3 seguidos; el contador se
        // reinicia en cuanto escribes un mensaje nuevo.
        if (lastDone && lastDone.incompleto && !current.signal.aborted && autoContinuaciones < 3
          && (lastDone.motivo === "step_limit" || lastDone.motivo === "stalled")
          && localStorage.getItem("bonsai-continuar-auto") !== "0") {
          autoContinuaciones += 1;
          addStatus(`El turno paró por ${lastDone.motivo === "step_limit" ? "límite de pasos" : "falta de progreso"}: continúo automáticamente (${autoContinuaciones}/3).`);
          queue.push({
            id: `auto-${Date.now()}-${autoContinuaciones}`,
            text: "Sigue con lo que pedí. Continúa desde el plan pendiente y termina lo que falte; no repitas lo que ya está hecho ni vuelvas a leer lo que no cambió.",
            files: [], snippets: [], imagenes: [], labels: [], interna: true,
          });
          paintQueue();
        }
        await refreshTree();
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") addStatus("turno cortado");
        else errorBox.textContent = err instanceof Error ? err.message : String(err);
      } finally {
        clearTimeout(liveTimer);
        clearTimeout(treeTimer);
        clearInterval(activityTimer);
        activity.remove();
        if (progreso) progreso.remove();
        current?.abort();
        current = null;
        bubble = null;
      }
    }

    document.querySelector("#composer").addEventListener("submit", (event) => {
      event.preventDefault();
      enqueue();
    });
    input.addEventListener("keydown", (event) => {
      const enter = event.key === "Enter" && !event.shiftKey && !event.ctrlKey;
      const ctrlEnter = event.key === "Enter" && event.ctrlKey && !event.shiftKey;
      if (!enter && !ctrlEnter) return;
      event.preventDefault();
      document.querySelector("#composer").requestSubmit();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const helpOpen = help instanceof HTMLElement && !help.hidden;
      const suggestOpen = suggest.style.display === "block";
      const menuOpen = attachMenu instanceof HTMLElement && !attachMenu.hidden;
      const pickerOpen = !picker.hidden;
      if (!helpOpen && !suggestOpen && !pickerOpen && !menuOpen) return;
      if (helpOpen) {
        help.hidden = true;
        if (ayuda instanceof HTMLElement) ayuda.setAttribute("aria-expanded", "false");
      }
      if (suggestOpen) hideSuggest();
      if (pickerOpen || menuOpen) closeAttach();
      event.preventDefault();
    });
    input.addEventListener("input", () => {
      const cursor = input.selectionStart || 0;
      const match = input.value.slice(0, cursor).match(/@([\w./-]*)$/);
      suggest.replaceChildren();
      if (!match) {
        hideSuggest();
        return;
      }
      const query = match[1].toLowerCase();
      /**
       * @param {string} label
       * @param {() => void} action
       */
      const option = (label, action) => {
        const row = document.createElement("button");
        row.type = "button";
        row.textContent = label;
        row.addEventListener("click", () => {
          action();
          const cursor = input.selectionStart || input.value.length;
          input.value = `${input.value.slice(0, cursor).replace(/@[\w./-]*$/, "")}${input.value.slice(cursor)}`;
          hideSuggest();
          input.focus();
        });
        suggest.append(row);
      };
      if (opened && opened.toLowerCase().includes(query)) option(`Archivo abierto · ${opened}`, () => addFile(opened));
      const selected = selectionInsideEditor();
      if (selected && "seleccion".includes(query)) option(`Selección · ${opened}:${selected.start}-${selected.end}`, () => addSelection(selected));
      for (const folder of folderNames().filter((name) => name.toLowerCase().includes(query)).slice(0, 4)) {
        option(`Carpeta · ${folder}/`, () => addFolder(folder));
      }
      for (const file of workspace.filter((item) => item.rel.toLowerCase().includes(query)).slice(0, 8)) {
        option(file.rel, () => addFile(file.rel));
      }
      if (!suggest.childElementCount) {
        hideSuggest();
        return;
      }
      suggest.style.display = "block";
    });
    /**
     * @returns {{start: number, end: number, text: string} | null}
     */
    function selectionInsideEditor() {
      const sel = window.getSelection();
      const text = sel ? sel.toString() : "";
      if (!text.trim() || !sel?.anchorNode || !code.contains(sel.anchorNode) || !opened) return null;
      const at = openedText.indexOf(text);
      const start = at < 0 ? 1 : openedText.slice(0, at).split("\n").length;
      const end = start + text.split("\n").length - 1;
      return { start, end, text };
    }

    /**
     * @param {{start: number, end: number, text: string} | null} selected
     */
    function addSelection(selected) {
      if (!selected || !opened) return;
      attachments.push({
        id: `sel:${opened}:${selected.start}:${selected.end}:${Date.now()}`,
        kind: "selection",
        label: `${opened}:${selected.start}-${selected.end}`,
        rels: [],
        rel: opened,
        text: selected.text,
        start: selected.start,
        end: selected.end,
      });
      paintAttached();
    }

    function addCurrentSelection() {
      addSelection(selectionInsideEditor());
    }

    /**
     * Guarda una imagen en salida/adjuntos (fuera del proyecto del usuario) y la
     * apunta para el próximo mensaje. Sin mmproj el modelo no la ve: se avisa.
     * @param {File | null} file
     */
    async function addImage(file) {
      if (!file || !String(file.type || "").startsWith("image/")) return;
      if (file.size > 8_000_000) {
        errorBox.textContent = "La imagen pasa de 8 MB: usa una más pequeña.";
        return;
      }
      const datos = await new Promise((resolve) => {
        const lector = new FileReader();
        lector.onload = () => resolve(String(lector.result || ""));
        lector.onerror = () => resolve("");
        lector.readAsDataURL(file);
      });
      if (!datos) {
        errorBox.textContent = "No se pudo leer la imagen.";
        return;
      }
      try {
        const res = await fetch("/api/attach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nombre: file.name || "imagen.png", datos }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        imagenes.push({ id: `img:${data.archivo}`, archivo: String(data.archivo), label: file.name || "imagen.png", bytes: Number(data.bytes) || 0 });
        if (data.vision === false) {
          window.bonsaiAvisar?.("La imagen se guarda, pero el servidor no tiene visión (mmproj): el modelo no puede verla.", "warn", 7000);
        }
        errorBox.textContent = "";
        paintAttached();
      } catch (err) {
        errorBox.textContent = `No se pudo adjuntar la imagen: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    /** @type {"files" | "folder"} */
    let pickMode = "files";
    const attachMenu = document.querySelector("#attach-menu");
    const pickFilter = document.querySelector("#pick-filter");
    const pickList = document.querySelector("#pick-list");
    const pickImage = document.querySelector("#pick-image");

    function closeAttach() {
      if (attachMenu instanceof HTMLElement) attachMenu.hidden = true;
      picker.hidden = true;
      if (attachBtn instanceof HTMLElement) attachBtn.setAttribute("aria-expanded", "false");
    }

    function paintPicker() {
      if (!(pickList instanceof HTMLElement)) return;
      const query = pickFilter instanceof HTMLInputElement ? pickFilter.value.trim().toLowerCase() : "";
      pickList.replaceChildren();
      const rows = pickMode === "folder"
        ? folderNames().filter((name) => name.toLowerCase().includes(query))
        : workspace.map((file) => file.rel).filter((rel) => rel.toLowerCase().includes(query));
      if (!rows.length) {
        const emptyRow = document.createElement("button");
        emptyRow.type = "button";
        emptyRow.disabled = true;
        emptyRow.textContent = "Nada con ese nombre";
        pickList.append(emptyRow);
        return;
      }
      for (const rel of rows) {
        const row = document.createElement("button");
        row.type = "button";
        const name = document.createElement("span");
        name.textContent = pickMode === "folder" ? `${rel}/` : rel;
        row.append(name);
        const mark = document.createElement("small");
        const on = pickMode === "folder"
          ? attachments.some((item) => item.id === `dir:${rel}`)
          : hasFile(rel);
        mark.textContent = on ? "incluido" : "";
        row.append(mark);
        row.addEventListener("click", () => {
          if (pickMode === "folder") addFolder(rel);
          else addFile(rel);
          paintPicker();
        });
        pickList.append(row);
      }
    }

    /**
     * @param {"files" | "folder"} mode
     */
    function openPicker(mode) {
      pickMode = mode;
      if (attachMenu instanceof HTMLElement) attachMenu.hidden = true;
      picker.hidden = false;
      if (pickFilter instanceof HTMLInputElement) {
        pickFilter.value = "";
        pickFilter.placeholder = mode === "folder" ? "Buscar carpeta" : "Buscar archivo";
        pickFilter.focus();
      }
      paintPicker();
    }

    attachBtn.addEventListener("click", () => {
      const open = attachMenu instanceof HTMLElement && attachMenu.hidden;
      closeAttach();
      if (!open || !(attachMenu instanceof HTMLElement)) return;
      const openBtn = attachMenu.querySelector("[data-attach='open']");
      const selBtn = attachMenu.querySelector("[data-attach='sel']");
      if (openBtn instanceof HTMLButtonElement) openBtn.disabled = !opened;
      if (selBtn instanceof HTMLButtonElement) selBtn.disabled = !selectionInsideEditor();
      attachMenu.hidden = false;
      attachBtn.setAttribute("aria-expanded", "true");
    });
    if (attachMenu instanceof HTMLElement) {
      attachMenu.addEventListener("click", (event) => {
        const button = event.target instanceof Element ? event.target.closest("button") : null;
        const kind = button instanceof HTMLButtonElement ? button.dataset.attach : "";
        if (kind === "files" || kind === "folder") openPicker(kind);
        else if (kind === "imagen") {
          closeAttach();
          pickImage.click();
        } else if (kind === "open" && opened) {
          toggleInclude(opened);
          closeAttach();
        } else if (kind === "sel") {
          addCurrentSelection();
          closeAttach();
        }
      });
    }
    pickImage.addEventListener("change", () => {
      const files = [...(pickImage.files || [])];
      pickImage.value = "";
      for (const file of files) void addImage(file);
    });
    // Pegar una captura en el cuadro de texto adjunta la imagen.
    input.addEventListener("paste", (event) => {
      const items = [...(event.clipboardData?.items || [])].filter((item) => item.type.startsWith("image/"));
      if (!items.length) return;
      event.preventDefault();
      for (const item of items) void addImage(item.getAsFile());
    });
    if (pickFilter instanceof HTMLInputElement) pickFilter.addEventListener("input", paintPicker);
    if (ayuda instanceof HTMLElement && help instanceof HTMLElement) {
      ayuda.addEventListener("click", () => {
        help.hidden = !help.hidden;
        ayuda.setAttribute("aria-expanded", help.hidden ? "false" : "true");
      });
    }
    addSel.addEventListener("click", addCurrentSelection);
    document.addEventListener("mouseup", () => {
      addSel.hidden = !selectionInsideEditor();
    });
    box.addEventListener("dragover", (event) => {
      event.preventDefault();
      box.classList.add("drop");
    });
    box.addEventListener("dragleave", () => box.classList.remove("drop"));
    box.addEventListener("drop", (event) => {
      event.preventDefault();
      box.classList.remove("drop");
      const sueltos = [...(event.dataTransfer?.files || [])].filter((file) => String(file.type).startsWith("image/"));
      if (sueltos.length) {
        for (const file of sueltos) void addImage(file);
        return;
      }
      const rel = event.dataTransfer?.getData("text/plain") || "";
      if (workspace.some((file) => file.rel === rel)) addFile(rel);
    });
    filter.addEventListener("input", paintTree);
    pinOpen.addEventListener("click", () => { if (opened) toggleInclude(opened); });
    if (carpeta instanceof HTMLButtonElement) {
      carpeta.addEventListener("click", async () => {
        carpeta.disabled = true;
        errorBox.textContent = "";
        try {
          const res = await fetch("/api/workspace", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pick: true }),
          });
          if (res.status === 204) return;
          if (!res.ok) throw new Error(await res.text());
          applyWorkspace(await res.json(), true);
        } catch (err) {
          errorBox.textContent = err instanceof Error ? err.message : String(err);
        } finally {
          carpeta.disabled = false;
        }
      });
    }
    document.querySelector("#nuevo").addEventListener("click", async () => {
      current?.abort();
      queue = [];
      paintQueue();
      const res = await fetch("/api/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "new" }),
      });
      if (!res.ok) {
        errorBox.textContent = await res.text();
        return;
      }
      attachments = [];
      imagenes = [];
      paintAttached();
      paintTree();
      errorBox.textContent = "";
      await reloadConversation();
    });
    document.querySelector("#stop")?.addEventListener("click", () => {
      queue = [];
      current?.abort();
      paintQueue();
    });
    const paneKey = "bonsai-panes";
    /** @type {Record<string, boolean>} */
    let panes = { history: window.innerWidth >= 1450, files: true, editor: true, chat: true };
    try {
      const saved = JSON.parse(localStorage.getItem(paneKey) || "");
      if (saved && typeof saved === "object") panes = { ...panes, ...saved };
    } catch { /* los paneles siguen abiertos */ }
    function applyPanes() {
      for (const name of ["history", "files", "editor", "chat"]) {
        document.body.classList.toggle(`hide-${name}`, panes[name] === false);
        const button = document.querySelector(`#tog-${name}`);
        if (button instanceof HTMLElement) {
          button.classList.toggle("on", panes[name] !== false);
          button.setAttribute("aria-pressed", panes[name] === false ? "false" : "true");
        }
      }
      try { localStorage.setItem(paneKey, JSON.stringify(panes)); } catch { /* almacenamiento deshabilitado */ }
    }
    const widthsKey = "bonsai-panel-widths";
    try {
      const widths = JSON.parse(localStorage.getItem(widthsKey) || "{}");
      for (const key of ["history", "side", "chat"]) {
        if (Number.isFinite(widths[key])) document.documentElement.style.setProperty(`--${key}`, `${Math.max(160, Math.min(640, widths[key]))}px`);
      }
    } catch { /* medidas por defecto */ }
    window.bonsaiResetLayout = () => {
      panes = { history: window.innerWidth >= 1450, files: true, editor: true, chat: true };
      for (const key of ["history", "side", "chat"]) document.documentElement.style.removeProperty(`--${key}`);
      try { localStorage.removeItem(widthsKey); } catch { }
      applyPanes();
    };
    applyPanes();
    for (const name of ["history", "files", "editor", "chat"]) {
      document.querySelector(`#tog-${name}`)?.addEventListener("click", () => {
        panes[name] = panes[name] === false;
        if (innerWidth <= 980 && panes[name] && name === "history") panes.files = false;
        if (innerWidth <= 980 && panes[name] && name === "files") panes.history = false;
        applyPanes();
      });
    }
    for (const gutter of document.querySelectorAll(".gutter")) {
      gutter.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const pane = gutter.getAttribute("data-pane");
        const startX = event.clientX;
        const start = pane === "history" ? historyWidth() : pane === "side" ? asideWidth() : chatWidth();
        const move = (ev) => {
          const dx = ev.clientX - startX;
          if (pane === "history") document.documentElement.style.setProperty("--history", `${Math.max(180, Math.min(420, start + dx))}px`);
          else if (pane === "side") document.documentElement.style.setProperty("--side", `${Math.max(200, Math.min(460, start + dx))}px`);
          else document.documentElement.style.setProperty("--chat", `${Math.max(300, Math.min(640, start - dx))}px`);
        };
        const up = () => {
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
          const widths = {};
          for (const key of ["history", "side", "chat"]) {
            const value = Number.parseInt(document.documentElement.style.getPropertyValue(`--${key}`), 10);
            if (Number.isFinite(value)) widths[key] = value;
          }
          try { localStorage.setItem(widthsKey, JSON.stringify(widths)); } catch { }
        };
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      });
    }
    function historyWidth() { return document.querySelector("#history").getBoundingClientRect().width; }
    function asideWidth() { return document.querySelector("#files").getBoundingClientRect().width; }
    function chatWidth() { return document.querySelector("#chat").getBoundingClientRect().width; }
    document.querySelector("#permit-ask")?.addEventListener("click", () => {
      setPermitMode("ask").catch((err) => { errorBox.textContent = err instanceof Error ? err.message : String(err); });
    });
    document.querySelector("#permit-all")?.addEventListener("click", () => {
      setPermitMode("all").catch((err) => { errorBox.textContent = err instanceof Error ? err.message : String(err); });
    });
    fetch("/api/permit").then(async (res) => {
      if (res.ok) paintPermitMode((await res.json()).mode === "all" ? "all" : "ask");
    }).catch(() => { paintPermitMode("ask"); });
    loadState().catch((err) => {
      errorBox.textContent = err instanceof Error ? err.message : String(err);
    });
