/**
 * Búsqueda en todo el proyecto (Ctrl+Shift+F). Se extrajo de `app.js` para
 * separar el dominio de búsqueda del resto de la interfaz.
 */

/**
 * @param {{
 *   api: (ruta: string) => Promise<any>,
 *   el: (tag: string, clase?: string, texto?: string) => HTMLElement,
 *   abrirArchivo: (rel: string, cursor?: number) => void | Promise<void>,
 * }} deps
 */
export function crearBuscador(deps) {
  const { api, el, abrirArchivo } = deps;

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
      lista.append(el("li", "p-grupo", "Buscando."));
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

  return { abrirBusqueda };
}
