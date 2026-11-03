/* Núcleo de la interfaz: selección del editor, adjuntos e imágenes. */
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
    // El botón Detener ya no confía solo en cerrar el fetch: avisa al servidor por
    // `/api/stop` para que aborte la inferencia y las herramientas aunque el socket
    // tarde en cerrarse. Después espera a que el turno libere el servidor antes de
