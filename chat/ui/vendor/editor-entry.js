/**
 * Bundle local del editor CodeMirror 6.
 *
 * Se compila con esbuild a `editor.js` (IIFE) y se carga como script clásico.
 * Es el único editor de la UI desde 2.3. No hay CDN: el editor, los lenguajes y
 * la vista de diff/merge viajan en el repositorio.
 */
import { basicSetup } from "codemirror";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { unifiedMergeView } from "@codemirror/merge";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";

const LENGUAJES = {
  js: () => javascript(),
  mjs: () => javascript(),
  cjs: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ typescript: true, jsx: true }),
  py: () => python(),
  pyw: () => python(),
  json: () => json(),
  jsonc: () => json(),
  html: () => html(),
  htm: () => html(),
  xml: () => html(),
  svg: () => html(),
  css: () => css(),
  scss: () => css(),
  less: () => css(),
  md: () => markdown(),
  markdown: () => markdown(),
  rs: () => rust(),
  go: () => go(),
  java: () => java(),
  c: () => cpp(),
  h: () => cpp(),
  cpp: () => cpp(),
  cc: () => cpp(),
  cxx: () => cpp(),
  hpp: () => cpp(),
  cs: () => cpp(),
};

function lenguajePara(rel) {
  const nombre = String(rel || "").toLowerCase();
  const ext = nombre.includes(".") ? nombre.slice(nombre.lastIndexOf(".") + 1) : "";
  return LENGUAJES[ext] ? LENGUAJES[ext]() : [];
}

// Paleta de sintaxis propia: la de CodeMirror por defecto está pensada para
// fondos claros y deja los tags de Markdown/HTML casi ilegibles en tema oscuro.
const resaltado = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier], color: "var(--syntax-keyword)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: "var(--syntax-string)" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "var(--muted)", fontStyle: "italic" },
  { tag: [tags.number, tags.integer, tags.float, tags.bool, tags.atom], color: "var(--syntax-number)" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--syntax-function)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--syntax-type)" },
  { tag: [tags.tagName], color: "var(--syntax-tag)" },
  { tag: [tags.attributeName, tags.propertyName], color: "var(--syntax-number)" },
  { tag: [tags.heading], color: "var(--text)", fontWeight: "700" },
  { tag: [tags.link, tags.url], color: "var(--syntax-function)", textDecoration: "underline" },
  { tag: [tags.emphasis], fontStyle: "italic" },
  { tag: [tags.strong], fontWeight: "700", color: "var(--text)" },
  { tag: [tags.meta, tags.processingInstruction], color: "var(--muted)" },
  { tag: [tags.invalid], color: "var(--danger)", textDecoration: "underline wavy" },
]);

const tema = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "var(--ink)",
      color: "var(--text)",
    },
    ".cm-scroller": {
      fontFamily: "var(--mono)",
      fontSize: "13px",
      lineHeight: "1.6",
      overflow: "auto",
    },
    ".cm-content": {
      caretColor: "var(--accent)",
      padding: "10px 0",
    },
    ".cm-gutters": {
      backgroundColor: "var(--ink)",
      color: "var(--dim)",
      borderRight: "1px solid var(--line)",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(205, 232, 110, 0.045)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(205, 232, 110, 0.08)",
      color: "var(--text)",
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(126, 176, 200, 0.30) !important",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "var(--accent)",
    },
    ".cm-panels": {
      backgroundColor: "var(--panel)",
      color: "var(--text)",
      borderColor: "var(--line)",
    },
    ".cm-searchMatch": {
      backgroundColor: "rgba(232, 192, 106, 0.28)",
    },
    ".cm-searchMatch.cm-searchMatch-selected": {
      backgroundColor: "rgba(205, 232, 110, 0.38)",
    },
    ".cm-tooltip": {
      backgroundColor: "var(--raised)",
      color: "var(--text)",
      border: "1px solid var(--line-strong)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--accent-soft)",
      color: "var(--text)",
    },
    "&.cm-focused": {
      outline: "none",
    },
  },
  { dark: true },
);

export class BonsaiCodeEditor {
  /**
   * @param {{parent: HTMLElement, doc?: string, rel?: string, onChange?: (doc: string, cursor: {offset: number, line: number, col: number}) => void, onCursor?: (cursor: {offset: number, line: number, col: number}) => void}} opciones
   */
  constructor({ parent, doc = "", rel = "", onChange, onCursor }) {
    this.onChange = onChange;
    this.onCursor = onCursor;
    this.silencioso = false;
    this.lang = new Compartment();
    this.readOnly = new Compartment();
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          basicSetup,
          keymap.of([indentWithTab]),
          tema,
          syntaxHighlighting(resaltado),
          EditorView.lineWrapping,
          EditorState.tabSize.of(2),
          this.lang.of(lenguajePara(rel)),
          this.readOnly.of(EditorState.readOnly.of(false)),
          EditorView.updateListener.of((update) => {
            if (this.silencioso) return;
            if (update.docChanged) this.onChange?.(this.getValue(), this.getCursor());
            else if (update.selectionSet) this.onCursor?.(this.getCursor());
          }),
        ],
      }),
    });
  }

  getValue() {
    return this.view.state.doc.toString();
  }

  /**
   * @param {string} doc
   * @param {string} [rel]
   * @param {number} [offset]
   */
  setDoc(doc, rel = "", offset = 0) {
    this.silencioso = true;
    try {
      const actual = this.getValue();
      const anchor = Math.max(0, Math.min(Number(offset) || 0, doc.length));
      this.view.dispatch({
        changes: actual === doc ? undefined : { from: 0, to: actual.length, insert: doc },
        selection: { anchor },
        effects: this.lang.reconfigure(lenguajePara(rel)),
      });
    } finally {
      this.silencioso = false;
    }
    this.view.requestMeasure();
  }

  /** Reemplaza el documento como una edición real (dispara onChange). */
  setDocLive(doc) {
    const actual = this.getValue();
    this.view.dispatch({ changes: { from: 0, to: actual.length, insert: String(doc ?? "") } });
  }

  /** @param {boolean} valor */
  setReadOnly(valor) {
    this.view.dispatch({
      effects: this.readOnly.reconfigure(EditorState.readOnly.of(Boolean(valor))),
    });
  }

  /** @param {number} from @param {number} to */
  setSelection(from, to = from) {
    const largo = this.view.state.doc.length;
    const a = Math.max(0, Math.min(Number(from) || 0, largo));
    const b = Math.max(a, Math.min(Number(to) || a, largo));
    this.view.dispatch({ selection: { anchor: a, head: b } });
  }

  /** @returns {{from: number, to: number, text: string}} */
  getSelection() {
    const rango = this.view.state.selection.main;
    return {
      from: rango.from,
      to: rango.to,
      text: this.view.state.sliceDoc(rango.from, rango.to),
    };
  }

  /** @returns {{offset: number, line: number, col: number}} */
  getCursor() {
    const pos = this.view.state.selection.main.head;
    const linea = this.view.state.doc.lineAt(pos);
    return { offset: pos, line: linea.number, col: pos - linea.from + 1 };
  }

  /** @param {number} offset */
  setCursorOffset(offset) {
    this.setSelection(offset, offset);
  }

  /** @param {number} linea */
  scrollToLine(linea) {
    const numero = Math.max(1, Math.min(this.view.state.doc.lines, Number(linea) || 1));
    const pos = this.view.state.doc.line(numero).from;
    this.view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
  }

  focus() {
    this.view.focus();
  }

  requestMeasure() {
    this.view.requestMeasure();
  }

  destroy() {
    this.view.destroy();
  }
}

/**
 * Vista de diff/merge unificada sobre CodeMirror. Se usa en Ctrl+K y en la
 * previsualización de cambios: el original queda como texto de referencia y el
 * documento editable (solo lectura aquí) muestra las inserciones y borrados.
 */
export class BonsaiDiff {
  /**
   * @param {{parent: HTMLElement, original?: string, modified?: string, rel?: string}} opciones
   */
  constructor({ parent, original = "", modified = "", rel = "" }) {
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: String(modified ?? ""),
        extensions: [
          basicSetup,
          tema,
          syntaxHighlighting(resaltado),
          EditorState.tabSize.of(2),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          lenguajePara(rel),
          unifiedMergeView({
            original: String(original ?? ""),
            highlightChanges: true,
            gutter: true,
            mergeControls: false,
          }),
        ],
      }),
    });
  }

  destroy() {
    this.view.destroy();
  }
}

window.BonsaiCodeEditor = BonsaiCodeEditor;
window.BonsaiDiff = BonsaiDiff;
