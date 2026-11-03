/* Núcleo de la interfaz: render en vivo, acciones, undo, conversaciones y adjuntos. */
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
