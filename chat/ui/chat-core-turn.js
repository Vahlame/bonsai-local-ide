/* Núcleo de la interfaz: detener el turno, paneles y distribución. */
    // cambiar de chat (antes el POST /api/chats contestaba 409 y no abría el nuevo).
    async function cortarTurno() {
      const teniaStream = Boolean(current);
      queue = [];
      paintQueue();
      const aviso = fetch("/api/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        keepalive: true,
      }).catch(() => null);
      current?.abort();
      await aviso;
      for (let i = 0; i < 50; i += 1) {
        try {
          const estado = await fetch("/api/servidor", { cache: "no-store" });
          if (estado.ok && !(await estado.json()).ocupado) break;
        } catch { /* el servidor aún está cerrando el turno */ }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (busyTimer) {
        window.clearInterval(busyTimer);
        busyTimer = 0;
      }
      serverBusy = false;
      paintQueue();
      // Sin stream vivo (página recargada) el log no se actualizó solo: relee el estado.
      if (!teniaStream) await reloadConversation().catch(() => {});
    }
    document.querySelector("#nuevo").addEventListener("click", async () => {
      await cortarTurno();
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
      void cortarTurno();
    });
    const paneKey = "bonsai-layout-v2";
    /** @type {Record<string, boolean>} */
    let panes = { sidebar: true, history: false, files: true, editor: true, chat: true };
    try {
      const saved = JSON.parse(localStorage.getItem(paneKey) || "");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        for (const name of Object.keys(panes)) if (typeof saved[name] === "boolean") panes[name] = saved[name];
      }
    } catch { /* distribución por defecto */ }
    function applyPanes() {
      // History and files are views of one sidebar, never competing columns.
      panes.files = !panes.history;
      if (!panes.editor && !panes.chat) panes.editor = true;
      for (const name of ["sidebar", "editor", "chat"]) {
        document.body.classList.toggle(`hide-${name}`, panes[name] === false);
        const button = document.querySelector(`#tog-${name}`);
        if (button instanceof HTMLElement) {
          button.classList.toggle("on", panes[name] !== false);
          button.setAttribute("aria-pressed", panes[name] === false ? "false" : "true");
        }
      }
      for (const name of ["history", "files"]) {
        const selected = panes[name];
        document.querySelector(`#${name}`).hidden = !selected;
        const tab = document.querySelector(`#tog-${name}`);
        tab.classList.toggle("on", selected);
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
      }
      try { localStorage.setItem(paneKey, JSON.stringify(panes)); } catch { /* almacenamiento deshabilitado */ }
      document.dispatchEvent(new Event("bonsai-layout-changed"));
    }
    const widthsKey = "bonsai-layout-widths-v2";
    try {
      const widths = JSON.parse(localStorage.getItem(widthsKey) || "{}");
      for (const key of ["side", "chat", "chat-height"]) {
        if (Number.isFinite(widths[key])) document.documentElement.style.setProperty(`--${key}`, `${Math.max(160, Math.min(640, widths[key]))}px`);
      }
    } catch { /* medidas por defecto */ }
    window.bonsaiResetLayout = () => {
      panes = { sidebar: true, history: false, files: true, editor: true, chat: true };
      for (const key of ["side", "chat", "chat-height"]) document.documentElement.style.removeProperty(`--${key}`);
      try { localStorage.removeItem(widthsKey); } catch { }
      applyPanes();
    };
    applyPanes();
    for (const name of ["sidebar", "editor", "chat"]) {
      document.querySelector(`#tog-${name}`)?.addEventListener("click", () => {
        panes[name] = panes[name] === false;
        if (!panes.editor && !panes.chat) panes[name === "editor" ? "chat" : "editor"] = true;
        applyPanes();
      });
    }
    for (const name of ["history", "files"]) {
      const tab = document.querySelector(`#tog-${name}`);
      tab.addEventListener("click", () => {
        panes.sidebar = true;
        panes.history = name === "history";
        applyPanes();
      });
      tab.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const target = document.querySelector(`#tog-${event.key === "Home" ? "files" : event.key === "End" ? "history" : name === "files" ? "history" : "files"}`);
        target.click(); target.focus();
      });
    }
