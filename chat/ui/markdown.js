/**
 * Markdown y resaltado de código para la interfaz, sin dependencias y sin acceso al DOM
 * (se prueba en Node con chat/prueba-ui.mjs). Todo el texto se escapa: no pasa HTML crudo.
 *   BonsaiMd.render(texto)          -> HTML del mensaje (párrafos, listas, tablas, código…)
 *   BonsaiMd.highlight(codigo, len) -> HTML con <span class="t-kw|t-st|t-cm|t-nu|t-fn|t-ty|t-pn|t-at|t-tag">
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BonsaiMd = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  /** @param {unknown} s */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  /** Texto dentro de un nodo (sin atributos): basta con & < > */
  const escT = (s) => String(s).replace(/[&<>]/g, (c) => ESC[c]);
  const words = (s) => new Set(s.split(/\s+/).filter(Boolean));

  const KW = {
    js: words("break case catch class const continue debugger default delete do else enum export extends finally for from function if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await get set interface type implements readonly public private protected as satisfies declare namespace abstract"),
    py: words("and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case"),
    sh: words("if then else elif fi for foreach in do done while until case esac function return param begin process end switch break continue exit local export set unset echo cd"),
    sql: words("select from where and or not in is null like between join left right inner outer full cross on as group by order having limit offset insert into values update set delete create table index view drop alter add column primary key foreign references unique default distinct union all case when then else end exists count sum avg min max asc desc"),
    clike: words("auto break case char class const continue default do double else enum extern float for goto if inline int long namespace new operator private protected public register return short signed sizeof static struct switch template this throw try typedef union unsigned using virtual void volatile while import package interface extends implements final abstract fn let mut pub impl trait use mod match loop func go defer chan select range var type string bool byte rune fun val when object override suspend"),
  };
  const LIT = {
    js: words("true false null undefined NaN Infinity"),
    py: words("True False None self cls"),
    sh: words("true false null $true $false $null"),
    sql: words(""),
    clike: words("true false null nil None NULL"),
  };

  /** nombre de lenguaje -> familia de lexer */
  const ALIAS = {
    js: "js", javascript: "js", mjs: "js", cjs: "js", jsx: "js", ts: "js", typescript: "js", tsx: "js",
    py: "py", python: "py",
    json: "json", jsonc: "json",
    html: "html", htm: "html", xml: "html", svg: "html", vue: "html",
    css: "css", scss: "css", less: "css",
    sh: "sh", bash: "sh", shell: "sh", zsh: "sh", powershell: "sh", ps1: "sh", pwsh: "sh", cmd: "sh", bat: "sh", console: "sh",
    sql: "sql",
    c: "clike", cpp: "clike", cc: "clike", h: "clike", java: "clike", cs: "clike", go: "clike", rs: "clike", rust: "clike", kt: "clike", swift: "clike", php: "clike",
  };

  /**
   * @param {string} lang
   * @returns {string}
   */
  function family(lang) {
    return ALIAS[String(lang || "").toLowerCase().trim()] || "";
  }

  const STR_DQ = '"(?:\\\\[\\s\\S]|[^"\\\\\\n])*"?';
  const STR_SQ = "'(?:\\\\[\\s\\S]|[^'\\\\\\n])*'?";
  const NUM = "\\b(?:0[xX][\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b";
  const ID = "[A-Za-z_$][\\w$]*";
  const PUNCT = "=>|[-+*/%=<>!&|^~?:]+|[{}()\\[\\];,.]";

  /** @type {Record<string, Array<[string, string]>>} */
  const LEXERS = {
    js: [["cm", "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$)"], ["st", `${STR_DQ}|${STR_SQ}|\`(?:\\\\[\\s\\S]|[^\`\\\\])*\`?`], ["nu", NUM], ["id", ID], ["pn", PUNCT]],
    clike: [["cm", "\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$)|#[^\\n]*"], ["st", `${STR_DQ}|${STR_SQ}|\`(?:\\\\[\\s\\S]|[^\`\\\\])*\`?`], ["nu", NUM], ["id", ID], ["pn", PUNCT]],
    py: [["cm", "#[^\\n]*"], ["st", `[rRbBfFuU]{0,2}(?:"""[\\s\\S]*?(?:"""|$)|'''[\\s\\S]*?(?:'''|$))|[rRbBfFuU]{0,2}${STR_DQ}|[rRbBfFuU]{0,2}${STR_SQ}`], ["at", "@[A-Za-z_][\\w.]*"], ["nu", NUM], ["id", ID], ["pn", PUNCT]],
    sh: [["cm", "(?:^|(?<=\\s))#[^\\n]*"], ["st", `${STR_DQ}|${STR_SQ}`], ["va", "\\$\\{[^}\\n]*\\}|\\$[\\w:?]+|\\$\\("], ["ty", "(?<![\\w-])--?[A-Za-z][\\w-]*"], ["fn", "\\b[A-Z][a-z]+-[A-Z][A-Za-z]+\\b"], ["nu", NUM], ["id", "[A-Za-z_][\\w.-]*"], ["pn", PUNCT]],
    sql: [["cm", "--[^\\n]*|\\/\\*[\\s\\S]*?(?:\\*\\/|$)"], ["st", STR_SQ], ["nu", NUM], ["id", ID], ["pn", PUNCT]],
    css: [["cm", "\\/\\*[\\s\\S]*?(?:\\*\\/|$)"], ["st", `${STR_DQ}|${STR_SQ}`], ["at", "@[\\w-]+"], ["nu", "#[\\da-fA-F]{3,8}\\b|-?\\d*\\.?\\d+(?:px|em|rem|%|vh|vw|s|ms|deg|fr|ch)?"], ["fn", "[\\w-]+(?=\\s*:(?!:))"], ["id", "[\\w-]+"], ["pn", "[{}()\\[\\];,:.>+~*]"]],
  };
  const COMPILED = Object.fromEntries(Object.entries(LEXERS).map(([name, parts]) => [name, { re: new RegExp(parts.map(([, re]) => `(${re})`).join("|"), "gm"), cls: parts.map(([cls]) => cls) }]));

  /**
   * @param {string} code
   * @param {string} fam js | clike | py | sh | sql | css
   * @returns {string}
   */
  function lex(code, fam) {
    const spec = COMPILED[fam];
    const kw = KW[fam] || new Set();
    const lit = LIT[fam] || new Set();
    const caseless = fam === "sql";
    let out = "";
    let last = 0;
    spec.re.lastIndex = 0;
    let m;
    while ((m = spec.re.exec(code)) !== null) {
      if (m[0] === "") {
        spec.re.lastIndex += 1;
        continue;
      }
      if (m.index > last) out += escT(code.slice(last, m.index));
      let which = -1;
      for (let i = 1; i < m.length; i += 1) if (m[i] !== undefined) { which = i - 1; break; }
      let cls = spec.cls[which];
      const text = m[0];
      if (cls === "id") {
        const key = caseless ? text.toLowerCase() : text;
        const next = code.slice(m.index + text.length).match(/^\s*(.)/);
        if (kw.has(key)) cls = "kw";
        else if (lit.has(text)) cls = "nu";
        else if (next && next[1] === "(") cls = "fn";
        else if (/^[A-Z][A-Za-z0-9_]*$/.test(text) && text.length > 1 && fam !== "sql") cls = "ty";
        else cls = "";
      }
      if (cls === "pn") out += `<span class="t-pn">${escT(text)}</span>`;
      else out += cls ? `<span class="t-${cls}">${escT(text)}</span>` : escT(text);
      last = m.index + text.length;
    }
    if (last < code.length) out += escT(code.slice(last));
    return out;
  }

  /**
   * @param {string} code
   * @returns {string}
   */
  function lexJson(code) {
    const re = /("(?:\\.|[^"\\\n])*"?)(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;
    let out = "";
    let last = 0;
    let m;
    while ((m = re.exec(code)) !== null) {
      if (m.index > last) out += escT(code.slice(last, m.index));
      if (m[1] !== undefined) out += `<span class="${m[2] ? "t-fn" : "t-st"}">${escT(m[1])}</span>${m[2] ? escT(m[2]) : ""}`;
      else if (m[3] !== undefined) out += `<span class="t-nu">${escT(m[3])}</span>`;
      else out += `<span class="t-kw">${escT(m[4])}</span>`;
      last = m.index + m[0].length;
    }
    return out + escT(code.slice(last));
  }

  /**
   * HTML/XML: comentarios, etiquetas con sus atributos y el contenido de <script> y <style>.
   * @param {string} code
   * @returns {string}
   */
  function lexHtml(code) {
    const re = /<!--[\s\S]*?(?:-->|$)|<[A-Za-z!/?][^>]*>?/g;
    let out = "";
    let last = 0;
    let m;
    while ((m = re.exec(code)) !== null) {
      if (m.index > last) out += escT(code.slice(last, m.index));
      const tag = m[0];
      last = m.index + tag.length;
      if (tag.startsWith("<!--")) {
        out += `<span class="t-cm">${escT(tag)}</span>`;
        continue;
      }
      out += tag.replace(/^(<\/?)([\w:-]+|!\w+|\?\w*)|("[^"]*"?|'[^']*'?)|([\w:@.-]+)(?==)|(\/?>)$/g, (all, open, name, str, attr, close) => {
        if (name) return `${escT(open)}<span class="t-tag">${escT(name)}</span>`;
        if (str) return `<span class="t-st">${escT(str)}</span>`;
        if (attr) return `<span class="t-at">${escT(attr)}</span>`;
        if (close) return escT(close);
        return escT(all);
      });
      const inner = /^<(script|style)\b/i.exec(tag);
      if (inner && !tag.endsWith("/>")) {
        const end = code.toLowerCase().indexOf(`</${inner[1].toLowerCase()}`, last);
        const stop = end < 0 ? code.length : end;
        const body = code.slice(last, stop);
        out += lexAny(body, inner[1].toLowerCase() === "script" ? "js" : "css");
        last = stop;
        re.lastIndex = stop;
      }
    }
    return out + escT(code.slice(last));
  }

  /**
   * @param {string} code
   * @param {string} fam
   * @returns {string}
   */
  function lexAny(code, fam) {
    if (fam === "json") return lexJson(code);
    if (fam === "html") return lexHtml(code);
    if (COMPILED[fam]) return lex(code, fam);
    return escT(code);
  }

  /**
   * @param {string} code
   * @param {string} [lang]
   * @returns {string}
   */
  function highlight(code, lang) {
    const text = String(code);
    // Por encima de ~300 KB el resaltado costaría más que ayudar
    if (text.length > 300_000) return escT(text);
    return lexAny(text, family(lang || ""));
  }

  // ------------------------------------------------------------------ markdown

  /**
   * @param {string} text texto ya escapado
   * @returns {string}
   */
  function inlineMd(text) {
    const parts = text.split(/(`+)([\s\S]*?[^`])\1(?!`)/);
    // Énfasis, tachado… SOLO en texto suelto. Aplicado sobre todo el segmento, un `_` o un `*`
    // dentro de la URL recién convertida en enlace metía un <em> en el href y lo rompía:
    // `[x](https://ex.com/_a_/b)` salía como href="https://ex.com/<em>a</em>/b".
    /** @param {string} trozo */
    const conEnfasis = (trozo) => trozo
      .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^\w*])__([^_\n]+?)__(?![\w])/g, "$1<strong>$2</strong>")
      .replace(/(^|[^\w*])\*([^*\s][^*\n]*?)\*(?![\w*])/g, "$1<em>$2</em>")
      .replace(/(^|[^\w])_([^_\s][^_\n]*?)_(?![\w])/g, "$1<em>$2</em>")
      .replace(/~~([^~\n]+?)~~/g, "<del>$1</del>");
    // split con grupos devuelve [texto, ticks, código, texto, ticks, código, ...]
    let out = "";
    for (let i = 0; i < parts.length; i += 3) {
      let seg = parts[i] || "";
      seg = seg
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => `<a href="${url}" target="_blank" rel="noreferrer noopener">${label}</a>`)
        .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, (_, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noreferrer noopener">${url}</a>`)
        .split(/(<[^>]+>)/)
        .map((trozo) => (trozo.startsWith("<") ? trozo : conEnfasis(trozo)))
        .join("");
      out += seg;
      if (i + 2 < parts.length) out += `<code>${parts[i + 2]}</code>`;
    }
    return out;
  }

  /**
   * @param {string} line
   * @returns {string}
   */
  const inline = (line) => inlineMd(esc(line));

  /**
   * @param {string} lang
   * @param {string} body
   * @returns {string}
   */
  function codeBlock(lang, body) {
    const label = lang || "texto";
    return `<div class="md-code" data-lang="${esc(lang)}"><div class="md-code-h"><span>${esc(label)}</span><span class="sp"></span><button type="button" class="ghost" data-act="copy">Copiar</button></div><pre><code>${highlight(body, lang)}</code></pre></div>`;
  }

  const isTableSep = (line) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes("-");
  const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const startsBlock = (line) => /^\s*(`{3,}|~{3,})/.test(line) || /^#{1,6}\s/.test(line) || /^\s*>/.test(line) || /^\s*([-*+]|\d+[.)])\s+/.test(line) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(line);

  /**
   * @param {string} text
   * @returns {string}
   */
  function render(text) {
    const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
    /** @type {string[]} */
    const html = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i += 1;
        continue;
      }
      const fence = line.match(/^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/);
      if (fence) {
        const mark = fence[1];
        const body = [];
        i += 1;
        while (i < lines.length && !new RegExp(`^\\s*${mark[0]}{${mark.length},}\\s*$`).test(lines[i])) {
          body.push(lines[i]);
          i += 1;
        }
        i += 1; // cierre (si no hay, es una respuesta que aún se está escribiendo)
        html.push(codeBlock(fence[2] || "", body.join("\n")));
        continue;
      }
      const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (heading) {
        const level = Math.min(6, heading[1].length);
        html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        i += 1;
        continue;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
        html.push("<hr>");
        i += 1;
        continue;
      }
      if (/^\s*>/.test(line)) {
        const quote = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) {
          quote.push(lines[i].replace(/^\s*>\s?/, ""));
          i += 1;
        }
        html.push(`<blockquote>${render(quote.join("\n"))}</blockquote>`);
        continue;
      }
      if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
          rows.push(cells(lines[i]));
          i += 1;
        }
        html.push(`<div class="md-table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }
      const item = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
      if (item) {
        const ordered = /\d/.test(item[2]);
        const tag = ordered ? "ol" : "ul";
        const base = item[1].length;
        const li = [];
        while (i < lines.length) {
          const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (m && m[1].length < base + 2 && m[1].length >= base && /\d/.test(m[2]) === ordered) {
            li.push({ text: [m[3]], sub: [] });
            i += 1;
            continue;
          }
          if (m && m[1].length >= base + 2 && li.length) {
            li[li.length - 1].sub.push(lines[i].slice(base + 2));
            i += 1;
            continue;
          }
          if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && li.length && !startsBlock(lines[i])) {
            li[li.length - 1].text.push(lines[i].trim());
            i += 1;
            continue;
          }
          break;
        }
        const start = ordered && Number(item[2].replace(/\D/g, "")) > 1 ? ` start="${Number(item[2].replace(/\D/g, ""))}"` : "";
        html.push(`<${tag}${start}>${li.map((x) => `<li>${inline(x.text.join(" "))}${x.sub.length ? render(x.sub.join("\n")) : ""}</li>`).join("")}</${tag}>`);
        continue;
      }
      const para = [line];
      i += 1;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) && !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
        para.push(lines[i]);
        i += 1;
      }
      html.push(`<p>${para.map((l) => inline(l)).join("<br>")}</p>`);
    }
    return html.join("");
  }

  return { render, highlight, esc, family };
});
