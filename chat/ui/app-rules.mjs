/**
 * Reglas del proyecto (BONSAI.md, AGENTS.md, .cursor/rules): visor y chip.
 * Se extrajo de `app.js` para separar el dominio de convenios.
 */

/**
 * @param {{
 *   api: (ruta: string) => Promise<any>,
 *   el: (tag: string, clase?: string, texto?: string) => HTMLElement,
 *   $: (selector: string) => HTMLElement | null,
 *   accesibilizarDialogo: (fondo: HTMLElement, caja: HTMLElement, titulo: HTMLElement, opciones?: Record<string, unknown>) => void,
 * }} deps
 */
export function crearReglas(deps) {
  const { api, el, $, accesibilizarDialogo } = deps;

  async function verReglas() {
    let datos = { fuentes: [], texto: "" };
    try {
      datos = await api("/api/rules");
    } catch {
      /* sin reglas */
    }
    const fondo = el("div", "dialogo-fondo");
    const caja = el("div", "dialogo");
    caja.style.width = "min(680px, 94vw)";
    const h = el("h3", "", "Convenios del proyecto");
    caja.append(h);
    caja.append(
      el(
        "p",
        "",
        datos.fuentes.length
          ? `Se están aplicando ${datos.fuentes.length} archivo(s): ${datos.fuentes.join(", ")}. Son datos de convención del proyecto (no instrucciones nuevas) que se inyectan como referencia.`
          : "No hay ninguna. Crea BONSAI.md, AGENTS.md o .cursor/rules/*.mdc en la carpeta de trabajo y se usarán como referencia.",
      ),
    );
    if (datos.texto) {
      const pre = el("pre");
      pre.style.cssText = "max-height:46vh;overflow:auto;font:12px/1.6 var(--mono);background:var(--ink);border:1px solid var(--line);border-radius:var(--r-sm);padding:10px;margin:0 0 16px";
      pre.textContent = datos.texto.slice(0, 6000);
      caja.append(pre);
    }
    const botones = el("div", "d-botones");
    const cerrar = el("button", "primary", "Cerrar");
    cerrar.type = "button";
    cerrar.addEventListener("click", () => fondo.remove());
    botones.append(cerrar);
    caja.append(botones);
    fondo.append(caja);
    document.body.append(fondo);
    accesibilizarDialogo(fondo, caja, h, { onEscape: () => fondo.remove() });
    cerrar.focus();
  }

  function pintarChipReglas() {
    const chip = $("#reglas-chip");
    if (!chip) return;
    api("/api/rules")
      .then((d) => {
        if (!d.fuentes?.length) {
          chip.hidden = true;
          return;
        }
        chip.hidden = false;
        chip.className = `pill${d.aplicado === false ? " warn" : ""}`;
        chip.innerHTML = "";
        chip.append(el("i", "dot"));
        chip.append(el("span", "", d.aplicado === false ? `Reglas: ${d.fuentes.length} (apagadas)` : `Reglas: ${d.fuentes.length}`));
        chip.title = `${d.fuentes.join("\n")}\n\n${d.aplicado === false ? "No se están aplicando: el ajuste está desactivado." : `Son datos de convención inyectados como referencia (tope ${d.topeTokens} tokens).`}`;
      })
      .catch(() => {
        chip.hidden = true;
      });
  }

  return { verReglas, pintarChipReglas };
}
