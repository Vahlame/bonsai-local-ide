/**
 * Panel de Git de la UI: chip de rama, menú, selección de archivos y lista de
 * cambios. No conoce el estado global de `app.js`: recibe las dependencias que
 * necesita para poder probarse y mantenerse por separado.
 */

/**
 * @param {{
 *   api: (ruta: string, opciones?: {cuerpo?: unknown}) => Promise<any>,
 *   avisar: (texto: string, tipo?: string, ms?: number) => void,
 *   el: (tag: string, clase?: string, texto?: string) => HTMLElement,
 *   $: (selector: string) => HTMLElement | null,
 *   menu: (x: number, y: number, items: unknown[]) => void,
 *   preguntar: (opciones: Record<string, unknown>) => Promise<string | null>,
 *   accesibilizarDialogo: (fondo: HTMLElement, caja: HTMLElement, titulo: HTMLElement, opciones?: Record<string, unknown>) => void,
 * }} deps
 */
export function crearPanelGit(deps) {
  const { api, avisar, el, $, menu, preguntar, accesibilizarDialogo } = deps;
  /** @type {{repo: boolean, rama?: string, archivos?: {estado: string, rel: string, anterior?: string}[], ultimo?: {hash: string, asunto: string, cuando: string}}} */
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
            /* se queda el genérico */
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
    const cerrarDialogo = () => fondo.remove();
    cerrar.addEventListener("click", cerrarDialogo);
    botones.append(cerrar);
    caja.append(botones);
    fondo.append(caja);
    document.body.append(fondo);
    accesibilizarDialogo(fondo, caja, h, { onEscape: cerrarDialogo });
    h.focus();
  }

  return { refrescarGit, menuGit, pintarChipGit };
}
