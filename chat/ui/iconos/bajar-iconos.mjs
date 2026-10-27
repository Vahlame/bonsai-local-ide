/**
 * Baja los iconos que usa la interfaz desde Lucide (licencia ISC/MIT) y genera
 * `chat/ui/iconos.js`, un módulo sin dependencias que los sirve como SVG en línea.
 *   node chat/ui/iconos/bajar-iconos.mjs
 *
 * Por que en línea y no una fuente de iconos: los SVG heredan `currentColor`, así
 * que cambian de color con el tema, no hay parpadeo al cargar y no hace falta red
 * en tiempo de ejecución.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BASE = "https://cdn.jsdelivr.net/npm/lucide-static@latest/icons";

// Nombre en la interfaz -> archivo de Lucide
const ICONOS = {
  archivo: "file",
  archivoNuevo: "file-plus",
  carpeta: "folder",
  carpetaAbierta: "folder-open",
  guardar: "save",
  buscar: "search",
  rama: "git-branch",
  commit: "git-commit",
  terminal: "square-terminal",
  ajustes: "settings",
  cerrar: "x",
  check: "check",
  alerta: "triangle-alert",
  info: "info",
  mas: "plus",
  papelera: "trash-2",
  lapiz: "pencil",
  flechaDerecha: "chevron-right",
  flechaAbajo: "chevron-down",
  recargar: "refresh-cw",
  deshacer: "undo-2",
  ejecutar: "play",
  copiar: "copy",
  panelIzq: "panel-left",
  panelDer: "panel-right",
  sol: "sun",
  luna: "moon",
  comando: "command",
  chispa: "sparkles",
  cpu: "cpu",
  rayo: "zap",
  historial: "history",
  mensaje: "message-square",
  codigo: "code",
  ajustarTexto: "wrap-text",
  enlace: "external-link",
  filtro: "filter",
  puntos: "ellipsis",
  teclado: "keyboard",
  libro: "book-open",
  escudo: "shield-check",
  actividad: "activity",
  capas: "layers",
  diff: "diff",
  reemplazar: "replace",
  carpetaProyecto: "folder-tree",
  reglas: "scale",
  desconectar: "unplug",
  reloj: "clock",
  subir: "arrow-up",
  bajar: "arrow-down",
  limpiar: "eraser",
};

const salida = `/**
 * Iconos de Lucide (https://lucide.dev) — licencia ISC.
 * GENERADO por bajar-iconos.mjs: no editar a mano.
 *
 *   ICO.archivo()            -> "<svg …>…</svg>"
 *   ICO.archivo({ clase })   -> añade una clase
 *   pintarIconos(raiz)       -> rellena los [data-ico] que haya dentro
 */
(function (global) {
  "use strict";
  var TRAZOS = /*__TRAZOS__*/{};

  function svg(cuerpo, opciones) {
    var o = opciones || {};
    var clase = "ico" + (o.clase ? " " + o.clase : "");
    var tam = o.tam || 24;
    return '<svg class="' + clase + '" width="' + tam + '" height="' + tam + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      cuerpo + "</svg>";
  }

  var ICO = {};
  Object.keys(TRAZOS).forEach(function (nombre) {
    ICO[nombre] = function (opciones) { return svg(TRAZOS[nombre], opciones); };
  });

  /** Rellena todos los <span data-ico="nombre"> que haya bajo \`raiz\`. */
  function pintarIconos(raiz) {
    var nodos = (raiz || document).querySelectorAll("[data-ico]");
    for (var i = 0; i < nodos.length; i += 1) {
      var n = nodos[i];
      var fn = ICO[n.dataset.ico];
      if (fn) n.innerHTML = fn({ tam: Number(n.dataset.tam) || 16 });
    }
  }

  global.ICO = ICO;
  global.pintarIconos = pintarIconos;
  if (typeof module !== "undefined" && module.exports) module.exports = { ICO: ICO, pintarIconos: pintarIconos };
})(typeof window !== "undefined" ? window : globalThis);
`;

const cuerpos = {};
let ok = 0;
let fallos = 0;
for (const [nombre, archivo] of Object.entries(ICONOS)) {
  const r = await fetch(`${BASE}/${archivo}.svg`);
  if (!r.ok) {
    console.error(`FALLO ${archivo}: HTTP ${r.status}`);
    fallos += 1;
    continue;
  }
  const texto = await r.text();
  const m = texto.match(/<svg[^>]*>([\s\S]*)<\/svg>/i);
  if (!m) {
    console.error(`FALLO ${archivo}: no parece un SVG`);
    fallos += 1;
    continue;
  }
  // Normaliza el interior: quita saltos de linea y espacios sobrantes.
  cuerpos[nombre] = m[1].replace(/\s*\n\s*/g, "").trim();
  ok += 1;
}

if (!ok) {
  console.error("No se bajo ningun icono.");
  process.exit(1);
}
if (fallos) {
  // Antes se reescribia iconos.js igualmente y los que faltaban se quedaban en blanco sin
  // decir nada: mejor no tocar el archivo y avisar.
  console.error(`Faltan ${fallos} de ${ok + fallos} iconos: NO se reescribe chat/ui/iconos.js para no dejar huecos en blanco.`);
  process.exit(1);
}

fs.writeFileSync(path.join(AQUI, "..", "iconos.js"), salida.replace("/*__TRAZOS__*/{}", JSON.stringify(cuerpos)), "utf8");
console.log(`${ok} iconos -> chat/ui/iconos.js`);
