(function (global) {
  "use strict";
  let themes = [], scheduled = false;
  const icon = (name, size = 16) => global.ICO?.[name]?.({ tam: size }) || "";
  function applyTheme(id) {
    const theme = themes.find(t => t.id === id);
    if (!theme) return;
    const root = document.documentElement;
    const [bg, panel, raised, text, muted, accent, code, line] = theme.colors;
    const light = theme.group === "Claro";
    root.dataset.theme = id; root.dataset.mode = light ? "light" : "dark";
    root.style.colorScheme = light ? "light" : "dark";
    const tokens = { ink: bg, bg, panel, raised, text, muted, dim: muted, accent, "code-bg": code, line,
      "line-strong": `color-mix(in srgb, ${text} 30%, ${panel})`, hover: `color-mix(in srgb, ${raised} 80%, ${text})`,
      "accent-hi": `color-mix(in srgb, ${accent} 82%, ${light ? "black" : "white"})`, "accent-ink": light ? "#ffffff" : bg,
      "accent-soft": `color-mix(in srgb, ${accent} ${light ? 9 : 12}%, transparent)`, "accent-line": `color-mix(in srgb, ${accent} 35%, transparent)`,
      ok: light ? "#267049" : "#8cdaad", warn: light ? "#8b5b15" : "#edc780", danger: light ? "#b33946" : "#f29da7", gen: accent,
      "danger-soft": light ? "#b3394614" : "#f29da714", "surface-radius": id === "contrast" ? "3px" : "7px" };
    for (const [key, value] of Object.entries(tokens)) root.style.setProperty(`--${key}`, value);
    document.querySelectorAll(".theme-card").forEach(card => card.setAttribute("aria-pressed", String(card.dataset.themeId === id)));
    document.querySelectorAll('select[aria-label="Tema visual"]').forEach(select => { select.value = id; });
    document.dispatchEvent(new CustomEvent("bonsai-theme-changed", { detail: { theme: id, light } }));
  }
  function gallery(selected, choose) {
    const grid = document.createElement("div"); grid.className = "theme-gallery";
    grid.setAttribute("role", "group"); grid.setAttribute("aria-label", "Galería de temas");
    for (const theme of themes) {
      const card = document.createElement("button"); card.type = "button"; card.className = "theme-card";
      card.dataset.themeId = theme.id; card.setAttribute("aria-pressed", String(selected === theme.id));
      card.setAttribute("aria-label", `${theme.name}, ${theme.group.toLowerCase()}`);
      const preview = document.createElement("span"); preview.className = "theme-preview";
      preview.style.setProperty("--preview-bg", theme.colors[0]); preview.style.setProperty("--preview-panel", theme.colors[1]);
      preview.style.setProperty("--preview-accent", theme.colors[5]); preview.innerHTML = '<i></i><b></b><em></em><s></s>';
      const label = document.createElement("span"); label.className = "theme-name"; label.innerHTML = icon(theme.icon, 14);
      label.append(document.createTextNode(theme.name));
      const group = document.createElement("small"); group.textContent = theme.group;
      card.append(preview, label, group); card.addEventListener("click", () => choose(theme.id)); grid.append(card);
    }
    return grid;
  }
  function decorate() {
    const controls = { "tog-sidebar": "panelIzq", "tog-history": "historial", "tog-files": "carpeta", "tog-editor": "codigo", "tog-chat": "mensaje", "tog-drawer": "terminal", "permit-ask": "escudo", "permit-all": "rayo", "server-start": "ejecutar", "server-stop": "desconectar", "server-terminal": "terminal", "hub-abrir": "capas", "cerrar-bonsai": "desconectar", "carpeta": "carpetaAbierta", "ayuda": "libro" };
    for (const [id, name] of Object.entries(controls)) {
      const element = document.getElementById(id);
      if (!element || element.dataset.appearanceIcon) continue;
      element.querySelector("svg")?.remove(); element.insertAdjacentHTML("afterbegin", icon(name)); element.dataset.appearanceIcon = name;
    }
    const fileIcons = { js: "codigo", mjs: "codigo", ts: "codigo", json: "capas", css: "chispa", html: "codigo", py: "comando", md: "libro", ps1: "terminal", yaml: "ajustes", yml: "ajustes", svg: "sol", png: "sol" };
    document.querySelectorAll("#tree .name").forEach(name => {
      if (name.dataset.appearanceIcon) return;
      const ext = name.textContent.trim().split(".").at(-1).toLowerCase();
      const type = fileIcons[ext] || "archivo";
      name.insertAdjacentHTML("afterbegin", icon(type, 15)); name.dataset.appearanceIcon = type;
    });
  }
  function init(registry) {
    themes = registry; decorate();
    const mark = document.querySelector(".mark");
    if (mark) mark.innerHTML = '<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M22 5C11 4 5 9 6 16c1 7 14 8 16-11Z"/><path d="M7 23 19 10M11 19v-6M15 15h5"/></svg>';
    const tree = document.getElementById("tree");
    if (tree) new MutationObserver(() => { if (!scheduled) { scheduled = true; requestAnimationFrame(() => { scheduled = false; decorate(); }); } }).observe(tree, { childList: true, subtree: true });
  }
  global.BonsaiAppearance = { init, applyTheme, gallery, decorate, themeIcon: id => icon(themes.find(t => t.id === id)?.icon || "sol", 15) };
})(window);
