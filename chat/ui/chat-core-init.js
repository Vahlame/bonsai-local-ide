/* Núcleo de la interfaz: eventos de arranque y carga inicial. */
    const stacked = () => matchMedia("(max-width: 1000px)").matches;
    const saveWidths = () => {
      const widths = {};
      for (const key of ["side", "chat", "chat-height"]) {
        const value = Number.parseInt(document.documentElement.style.getPropertyValue(`--${key}`), 10);
        if (Number.isFinite(value)) widths[key] = value;
      }
      try { localStorage.setItem(widthsKey, JSON.stringify(widths)); } catch { }
    };
    const resizePane = (pane, start, delta) => {
      const vertical = pane === "chat" && stacked();
      const key = vertical ? "chat-height" : pane;
      const max = vertical ? document.querySelector(".work").clientHeight - 164 : pane === "side" ? Math.min(360, innerWidth * .28) : innerWidth * .5;
      const min = vertical ? 180 : pane === "side" ? 170 : 300;
      document.documentElement.style.setProperty(`--${key}`, `${Math.max(min, Math.min(max, start + (pane === "side" ? delta : -delta)))}px`);
    };
    for (const gutter of document.querySelectorAll(".gutter")) {
      const pane = gutter.getAttribute("data-pane");
      const size = () => document.querySelector(pane === "side" ? "#sidebar" : "#chat").getBoundingClientRect()[pane === "chat" && stacked() ? "height" : "width"];
      const orientation = () => {
        const vertical = pane === "chat" && stacked();
        gutter.setAttribute("aria-orientation", vertical ? "horizontal" : "vertical");
        gutter.setAttribute("aria-valuemin", String(vertical ? 180 : pane === "side" ? 170 : 300));
        gutter.setAttribute("aria-valuemax", String(Math.round(vertical ? document.querySelector(".work").clientHeight * .65 : pane === "side" ? Math.min(360, innerWidth * .28) : Math.min(innerWidth * .5, innerWidth - (panes.sidebar ? document.querySelector("#sidebar").clientWidth + 296 : 0)))));
        gutter.setAttribute("aria-valuenow", String(Math.round(size())));
      };
      orientation(); window.addEventListener("resize", orientation);
      document.addEventListener("bonsai-layout-changed", orientation);
      gutter.addEventListener("dblclick", () => {
        document.documentElement.style.removeProperty(`--${pane === "chat" && stacked() ? "chat-height" : pane}`);
        orientation(); saveWidths();
      });
      gutter.addEventListener("keydown", event => {
        const negative = pane === "chat" && stacked() ? "ArrowUp" : "ArrowLeft";
        const positive = pane === "chat" && stacked() ? "ArrowDown" : "ArrowRight";
        if (![negative, positive].includes(event.key)) return;
        event.preventDefault();
        resizePane(pane, size(), event.key === positive ? 20 : -20); orientation(); saveWidths();
      });
      gutter.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        gutter.setPointerCapture(event.pointerId);
        gutter.classList.add("drag");
        const vertical = pane === "chat" && stacked();
        const startPointer = vertical ? event.clientY : event.clientX;
        const start = size();
        const move = (ev) => {
          resizePane(pane, start, (vertical ? ev.clientY : ev.clientX) - startPointer);
        };
        const up = () => {
          gutter.classList.remove("drag");
          gutter.removeEventListener("pointermove", move);
          gutter.removeEventListener("pointerup", up);
          gutter.removeEventListener("pointercancel", up);
          orientation(); saveWidths();
        };
        gutter.addEventListener("pointermove", move);
        gutter.addEventListener("pointerup", up);
        gutter.addEventListener("pointercancel", up);
      });
    }
    document.querySelector("#permit-ask")?.addEventListener("click", () => {
      setPermitMode("ask").catch((err) => { errorBox.textContent = err instanceof Error ? err.message : String(err); });
    });
    document.querySelector("#permit-all")?.addEventListener("click", () => {
      setPermitMode("all").catch((err) => { errorBox.textContent = err instanceof Error ? err.message : String(err); });
    });
    fetch("/api/permit").then(async (res) => {
      if (res.ok) paintPermitMode((await res.json()).mode === "all" ? "all" : "ask");
    }).catch(() => { paintPermitMode("ask"); });
    input.disabled = true;
    send.disabled = true;
    loadState().catch((err) => {
      errorBox.textContent = err instanceof Error ? err.message : String(err);
    });
