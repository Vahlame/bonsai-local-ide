/**
 * Bundle local de xterm.js para el panel Terminal.
 *
 * Se compila a `terminal.js` (IIFE) y se carga como script clásico. La UI lo usa
 * si existe; si el bundle falta, conserva el <pre> de siempre.
 */
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

const TEMA = {
  background: "#0d100b",
  foreground: "#e9eee0",
  cursor: "#cde86e",
  cursorAccent: "#0d100b",
  selectionBackground: "rgba(126, 176, 200, 0.30)",
  black: "#0d100b",
  red: "#ea9a89",
  green: "#7fce8a",
  yellow: "#e8c06a",
  blue: "#82b8d0",
  magenta: "#c9a7e8",
  cyan: "#8fd4c8",
  white: "#e9eee0",
  brightBlack: "#6f7a64",
  brightRed: "#f2b4a8",
  brightGreen: "#a4e6ad",
  brightYellow: "#f2d38e",
  brightBlue: "#a6d2e6",
  brightMagenta: "#ddc2f2",
  brightCyan: "#b4e8df",
  brightWhite: "#ffffff",
};

export class BonsaiTerminal {
  /**
   * @param {{parent: HTMLElement, onData?: (data: string) => void, onResize?: (cols: number, rows: number) => void}} opciones
   */
  constructor({ parent, onData, onResize }) {
    this.onData = onData;
    this.onResize = onResize;
    this.term = new Terminal({
      fontFamily: '"JetBrains Mono", "Cascadia Mono", Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.35,
      cursorBlink: true,
      convertEol: true,
      scrollback: 5000,
      theme: TEMA,
      allowProposedApi: false,
    });
    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.loadAddon(new WebLinksAddon());
    this.term.open(parent);
    this.resizeObserver = new ResizeObserver(() => {
      try { this.fitAddon.fit(); } catch { /* panel oculto */ }
    });
    this.resizeObserver.observe(parent);
    this.term.onData((data) => this.onData?.(data));
    this.term.onResize(({ cols, rows }) => this.onResize?.(cols, rows));
    this.fit();
  }

  write(texto) {
    if (texto) this.term.write(String(texto));
  }

  writeln(texto = "") {
    this.term.writeln(String(texto));
  }

  fit() {
    try { this.fitAddon.fit(); } catch { /* aún sin medidas */ }
  }

  focus() {
    this.term.focus();
  }

  reset() {
    this.term.reset();
  }

  dispose() {
    try { this.resizeObserver.disconnect(); } catch { /* ya cerrado */ }
    this.term.dispose();
  }
}

window.BonsaiTerminal = BonsaiTerminal;
