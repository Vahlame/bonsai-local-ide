/* Núcleo de la interfaz: deshacer, permisos y selección de archivos. */
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
