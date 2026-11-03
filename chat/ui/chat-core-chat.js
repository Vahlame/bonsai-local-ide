/* Núcleo de la interfaz: conversaciones, cola de turnos y preguntas al modelo. */
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
      try {
        const [stateRes, treeRes, chatRes] = await Promise.all([fetch("/api/state"), fetch("/api/workspace"), fetch("/api/chats")]);
        if (stateRes.ok) {
          const data = await stateRes.json();
          document.querySelector("#meta").textContent = `ventana ${data.nCtx}`;
          paintUsage(data.usage || { nCtx: data.nCtx, cap: data.historyCap });
          paintConversation(data);
          if (data.busy) {
            serverBusy = true;
            addStatus("Hay un turno en marcha en el servidor. Puedes esperar o pulsar Detener.");
            vigilarTurno();
          }
        }
        if (treeRes.ok) applyWorkspace(await treeRes.json(), false);
        if (chatRes.ok) paintChats(await chatRes.json());
      } finally {
        initialLoadDone = true;
        input.disabled = false;
        paintQueue();
      }
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
      if (send instanceof HTMLButtonElement) {
        send.textContent = pumping ? "Encolar" : "Enviar";
        send.disabled = !initialLoadDone || (serverBusy && !pumping);
      }
      const stop = document.querySelector("#stop");
      if (stop instanceof HTMLElement) stop.hidden = !(pumping || serverBusy);
    }

    /**
     * Tras un F5 el turno sigue vivo en el servidor. Sondea solo mientras está ocupado
     * y, al terminar, refresca la conversación (no prometemos stream en vivo).
     */
    function vigilarTurno() {
      if (busyTimer || !serverBusy) return;
      busyTimer = window.setInterval(async () => {
        try {
          const res = await fetch("/api/state", { cache: "no-store" });
          if (!res.ok) return;
          const data = await res.json();
          if (data.busy) return;
          window.clearInterval(busyTimer);
          busyTimer = 0;
          serverBusy = false;
          addStatus("El turno terminó mientras la página estaba recargada.");
          paintQueue();
          await reloadConversation().catch(() => {});
        } catch {
          /* se reintenta en el siguiente ciclo */
        }
      }, 2000);
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
        else {
          // No robar el cursor si mientras terminaba el turno el usuario se puso a
          // escribir en el editor, el terminal o cualquier otro panel.
          const activo = document.activeElement;
          const compositor = input.closest("form");
          if (!activo || activo === document.body || compositor?.contains(activo)) input.focus();
        }
      }
    }

    function enqueue() {
      if (!initialLoadDone) {
        errorBox.textContent = "La interfaz aún está cargando: espera un momento.";
        return;
      }
      if (serverBusy) {
        errorBox.textContent = "El servidor sigue ocupado con un turno anterior. Espera a que termine o pulsa Detener.";
        return;
      }
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
              progreso.innerHTML = window.ICO?.codigo?.({ tam: 14 }) || "";
              progreso.append(document.createTextNode(`${que}… ${Number(event.chars || 0).toLocaleString("es")} caracteres`));
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
        let respuestaVisible = "";
        if (bubble) {
          const body = msgText(bubble);
          if (body.dataset.raw !== undefined) setBody(body, body.dataset.raw);
          respuestaVisible = String(body.dataset.raw || body.textContent || "").trim();
          if (!respuestaVisible) bubble.remove();
        }
        pintarRevertirTurno(escriturasConUndo);
        // «Continuar hasta terminar»: si el turno paró por falta de pasos o atasco y no lo
        // cancelaste, se encola un turno interno (no se pinta como mensaje del usuario) para
        // que el agente siga con el plan pendiente. Máximo 3 seguidos; el contador se
        // reinicia en cuanto escribes un mensaje nuevo.
        if (lastDone && lastDone.incompleto && !respuestaVisible && !current.signal.aborted && autoContinuaciones < 3
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
        notificarTurno(lastDone);
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
