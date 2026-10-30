/** CPU-only lexical retrieval + Tree-sitter symbol/import graph. No embeddings or network. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { rutaProyecto } from "./archivos-seguros.mjs";
import { simbolos } from "./diagnosticos.mjs";
import { estimateTokens, takeHeadByTokens } from "./context.mjs";
import { describirLectura } from "./lecturas.mjs";
import { typeScriptProject } from "./code-intelligence.mjs";

const require = createRequire(import.meta.url);
const EXT = new Map(
  Object.entries({
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "tsx",
    ".py": "python",
    ".rs": "rust",
    ".go": "go",
    ".java": "java",
    ".cs": "c-sharp",
    ".cpp": "cpp",
    ".h": "cpp",
    ".c": "cpp",
  }),
);
const OMIT = new Set([
  ".git",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "target",
  "models",
  "logs",
  "reports",
  ".aider.tags.cache.v4",
]);
const SOURCE =
  /\.(?:[cm]?js|jsx|tsx?|py|rs|go|java|cs|c|cpp|h|json|html|css|md|toml|ya?ml)$/i;
let runtimePromise;
async function treeRuntime() {
  if (!runtimePromise)
    runtimePromise = (async () => {
      try {
        const entry =
          process.env.BONSAI_TREE_SITTER_MODULE ||
          require.resolve("@vscode/tree-sitter-wasm");
        const api = require(entry);
        await api.Parser.init({
          locateFile: (n) => path.join(path.dirname(entry), n),
        });
        return { ...api, dir: path.dirname(entry), languages: new Map() };
      } catch {
        return null;
      }
    })();
  return runtimePromise;
}

export async function parseCode(rel, text) {
  const lang = EXT.get(path.extname(rel).toLowerCase()),
    rt = lang ? await treeRuntime() : null;
  const imports = [];
  // Dependency hints only. Resolution is verified against files, never invented.
  for (const m of text.matchAll(
    /(?:\bfrom\s*|\bimport\s*|\brequire\s*\(\s*)['"]([^'"\r\n]+)['"]/g,
  ))
    imports.push(m[1]);
  for (const m of text.matchAll(/^\s*from\s+([.\w]+)\s+import\b/gm))
    imports.push(m[1]);
  if (!rt)
    return {
      parser: "lexical",
      symbols: simbolos(rel, text).map((s) => ({
        ...s,
        endLine: s.linea,
        signature: text.split("\n")[s.linea - 1]?.trim().slice(0, 180),
      })),
      imports,
      syntaxErrors: null,
    };
  let parser, tree;
  try {
    if (!rt.languages.has(lang))
      rt.languages.set(
        lang,
        await rt.Language.load(path.join(rt.dir, `tree-sitter-${lang}.wasm`)),
      );
    parser = new rt.Parser();
    parser.setLanguage(rt.languages.get(lang));
    tree = parser.parse(text);
    if (["javascript", "typescript", "tsx", "python"].includes(lang))
      imports.length = 0;
    const symbols = [],
      stack = [tree.rootNode];
    let visited = 0;
    while (stack.length && visited++ < 30000) {
      const n = stack.pop();
      if (
        lang === "python" &&
        ["import_statement", "import_from_statement"].includes(n.type)
      ) {
        const module = n.childForFieldName("module_name")?.text || "";
        if (module) imports.push(module);
        for (const named of n.childrenForFieldName("name")) {
          const name =
            named.type === "aliased_import"
              ? named.childForFieldName("name")?.text
              : named.text;
          if (name)
            imports.push(
              module ? module + (module.endsWith(".") ? "" : ".") + name : name,
            );
        }
      }
      if (["import_statement", "export_statement"].includes(n.type)) {
        const source = n.childForFieldName("source");
        if (source) imports.push(source.text.slice(1, -1));
      }
      if (
        n.type === "call_expression" &&
        ["require", "import"].includes(n.childForFieldName("function")?.text)
      ) {
        const arg = n.childForFieldName("arguments")?.namedChild(0);
        if (arg?.type === "string") imports.push(arg.text.slice(1, -1));
      }
      if (
        /^(?:function_declaration|function_definition|generator_function_declaration|class_declaration|class_definition|method_definition|method_declaration|interface_declaration|type_alias_declaration|struct_item|enum_item|function_item|type_spec|arrow_function)$/.test(
          n.type,
        )
      ) {
        let name = n.childForFieldName("name");
        if (!name && n.type === "arrow_function")
          name = n.parent?.childForFieldName("name");
        if (name)
          symbols.push({
            nombre: name.text,
            tipo: n.type,
            linea: n.startPosition.row + 1,
            endLine: n.endPosition.row + 1,
            columna: n.startPosition.column + 1,
            nameLine: name.startPosition.row + 1,
            nameColumn: name.startPosition.column + 1,
            signature: n.text
              .split(/\r?\n/)[0]
              .replace(/\s*\{.*$/, "")
              .replace(/=>.*$/, "=> …")
              .slice(0, 180),
          });
        if (name && lang === "python" && n.type === "function_definition")
          symbols.at(-1).signature =
            `def ${name.text}${n.childForFieldName("parameters")?.text || "()"}${n.childForFieldName("return_type") ? " -> " + n.childForFieldName("return_type").text : ""}:`;
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--)
        stack.push(n.namedChild(i));
    }
    return {
      parser: "tree-sitter",
      symbols,
      imports: [...new Set(imports)],
      syntaxErrors: tree.rootNode.hasError,
    };
  } catch {
    return {
      parser: "lexical",
      symbols: simbolos(rel, text),
      imports,
      syntaxErrors: null,
    };
  } finally {
    tree?.delete();
    parser?.delete();
  }
}

export function projectFiles(root, limit = 1500) {
  let names;
  try {
    names = execFileSync(
      "git",
      [
        "-C",
        root,
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ],
      {
        encoding: "utf8",
        timeout: 3000,
        maxBuffer: 2_000_000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).split("\0");
  } catch {}
  // A workspace explicitly selected inside a parent repo's ignored directory can
  // have files while git lists none. Respect the selected root and scan it locally.
  if (!names?.some((name) => name.length > 0)) {
    names = [];
    const stack = [""];
    let dirs = 0;
    while (stack.length && names.length < limit && dirs++ < 3000) {
      const dir = stack.pop(),
        abs = dir ? rutaProyecto(root, dir) : root;
      if (!abs) continue;
      let entries;
      try {
        entries = fs
          .readdirSync(abs, { withFileTypes: true })
          .sort((a, b) => a.name.localeCompare(b.name));
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.isSymbolicLink()) continue;
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (!OMIT.has(e.name) && !e.name.startsWith(".")) stack.push(rel);
        } else if (e.isFile()) names.push(rel);
        if (names.length >= limit) break;
      }
    }
  }
  return [...new Set(names)]
    .filter(
      (n) =>
        n &&
        SOURCE.test(n) &&
        !n.split("/").some((p) => OMIT.has(p)) &&
        rutaProyecto(root, n),
    )
    .sort()
    .slice(0, limit);
}

const termsOf = (text) =>
  [
    ...new Set(
      String(text)
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .match(/[\p{L}\p{N}_]{3,}/gu) || [],
    ),
  ]
    .filter(
      (t) =>
        !new Set([
          "para",
          "con",
          "los",
          "las",
          "del",
          "una",
          "que",
          "the",
          "and",
          "test",
          "tests",
          "src",
          "function",
          "export",
          "const",
        ]).has(t),
    )
    .slice(0, 40);

export class CodeContext {
  constructor(root, config) {
    this.root = path.resolve(root);
    this.config = config;
    this.entries = new Map();
    this.truncated = false;
  }
  async refresh() {
    const names = projectFiles(this.root, this.config.maxFiles);
    const keep = new Set(names);
    this.versions = new Map();
    this.truncated = names.length >= this.config.maxFiles;
    let bytes = 0;
    for (const rel of names) {
      const abs = rutaProyecto(this.root, rel);
      let st;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      this.versions.set(rel, `${st.mtimeMs}:${st.ctimeMs}:${st.size}`);
      if (
        !st.isFile() ||
        st.size > this.config.maxFileBytes ||
        bytes + st.size > this.config.maxIndexBytes
      ) {
        this.truncated = true;
        this.entries.delete(rel);
        continue;
      }
      bytes += st.size;
      const key = `${st.mtimeMs}:${st.ctimeMs}:${st.size}`,
        old = this.entries.get(rel);
      if (old?.key === key) continue;
      const text = fs.readFileSync(abs, "utf8");
      if (text.includes("\0")) continue;
      this.entries.set(rel, {
        rel,
        key,
        text,
        ...(await parseCode(rel, text)),
        dependencies: [],
      });
    }
    for (const rel of this.entries.keys())
      if (!keep.has(rel)) this.entries.delete(rel);
    for (const e of this.entries.values()) {
      e.dependencies = [];
      e.resolvedImports = new Map();
      for (const imp of e.imports) {
        if (e.rel.endsWith(".py")) {
          const dots = imp.match(/^\.+/)?.[0].length || 0;
          const module = imp.slice(dots).replace(/\./g, "/");
          const base = dots
            ? path.posix.normalize(
                path.posix.join(
                  path.posix.dirname(e.rel),
                  ...Array(dots - 1).fill(".."),
                  module,
                ),
              )
            : module;
          const suffixes = [
            base + ".py",
            (base ? base + "/" : "") + "__init__.py",
          ];
          for (const candidate of keep)
            if (
              suffixes.some(
                (s) =>
                  candidate === s || (!dots && candidate.endsWith("/" + s)),
              ) &&
              !e.dependencies.includes(candidate)
            )
              e.dependencies.push(candidate);
          continue;
        }
        let bases = imp.startsWith(".")
          ? [
              path.posix.normalize(
                path.posix.join(path.posix.dirname(e.rel), imp),
              ),
            ]
          : [];
        for (const b of bases)
          for (const candidate of [
            b,
            ...[
              ".mjs",
              ".js",
              ".cjs",
              ".ts",
              ".tsx",
              ".py",
              "/index.mjs",
              "/index.js",
              "/__init__.py",
            ].map((x) => b + x),
          ])
            if (keep.has(candidate) && !e.dependencies.includes(candidate))
              e.dependencies.push(candidate);
      }
    }
    const semantic = typeScriptProject(this.root, this);
    for (const [rel, resolved] of semantic?.dependencies() || []) {
      const entry = this.entries.get(rel);
      for (const { specifier, target } of resolved)
        if (keep.has(target)) {
          entry.resolvedImports.set(specifier, target);
          if (!entry.dependencies.includes(target))
            entry.dependencies.push(target);
        }
    }
    return this;
  }
  rank(task, { currentFile = "", modified = [] } = {}) {
    const terms = termsOf(task),
      scores = new Map();
    for (const e of this.entries.values()) {
      const names = e.symbols
          .map((s) => s.nombre)
          .join(" ")
          .toLowerCase(),
        p = e.rel.toLowerCase(),
        body = e.text.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (p.includes(t)) score += 8;
        if (names.includes(t)) score += 6;
        if (body.includes(t)) score += 1;
      }
      if (task.includes(e.rel)) score += 30;
      if (e.rel === currentFile) score += 10;
      if (modified.includes(e.rel)) score += 8;
      scores.set(e.rel, score);
    }
    for (const e of this.entries.values())
      if (scores.get(e.rel) >= 8)
        for (const d of e.dependencies) scores.set(d, (scores.get(d) || 0) + 4);
    return [...this.entries.values()]
      .map((e) => ({ ...e, score: scores.get(e.rel) }))
      .sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel));
  }
  map(task, hints = {}, budget = this.config.repoMapTokens) {
    if (budget <= 0) return "";
    const carpeta = String(hints.carpeta || "")
      .replace(/\\/g, "/")
      .replace(/^\.\/+|\/+$/g, "");
    const lines = [];
    for (const e of this.rank(task, hints)) {
      if (carpeta && e.rel !== carpeta && !e.rel.startsWith(`${carpeta}/`))
        continue;
      const s = e.symbols
        .slice(0, 6)
        .map(
          (s) =>
            `${s.nombre}:${s.linea}${s.signature && EXT.has(path.extname(e.rel)) ? " " + s.signature : ""}`,
        )
        .join("; ");
      const line = `${e.rel}${s ? " | " + s : ""}${e.dependencies.length ? " -> " + e.dependencies.join(", ") : ""}`;
      if (estimateTokens([...lines, line].join("\n")) > budget) continue;
      lines.push(line);
      if (lines.length >= 18) break;
    }
    return lines.join("\n");
  }
  read(
    { ruta, desde, hasta, simbolo: symbol, alrededor },
    budget = this.config.toolResultTokens,
  ) {
    const abs = rutaProyecto(this.root, String(ruta || ""));
    if (!abs) throw new Error("Ruta fuera del proyecto o enlace no permitido");
    if (symbol) {
      const e = this.entries.get(
        path.relative(this.root, abs).replace(/\\/g, "/"),
      );
      const found = e?.symbols.filter((s) => s.nombre === symbol) || [];
      if (found.length !== 1)
        throw new Error(
          `Símbolo ${symbol}: ${found.length} definiciones; usa desde/hasta`,
        );
      desde = Math.max(1, found[0].linea - 2);
      hasta = (found[0].endLine || desde) + 2;
    }
    if (alrededor) {
      desde = Math.max(1, alrededor - 15);
      hasta = alrededor + 20;
    }
    desde = desde || 1;
    hasta = Math.min(hasta || desde + 79, desde + 119);
    const rendered = describirLectura({
      root: this.root,
      clave: `${ruta}:${desde}-${hasta}`,
      presupuestoTokens: Math.max(32, budget - 80),
    });
    if (!rendered.startsWith("Archivo ")) return rendered;
    const [header, ...lines] = rendered.split("\n");
    let n = desde;
    return (
      header +
      "\n" +
      lines
        .map((line) => (/^\[(?:…|rango)/.test(line) ? line : `${n++}| ${line}`))
        .join("\n")
    );
  }
  search(query, { symbol = false, references = false, limit = 16 } = {}) {
    if (!query?.trim()) throw new Error("Consulta vacía");
    const rows = [];
    if (!symbol || references) {
      try {
        const result = execFileSync(
          "rg",
          [
            "--line-number",
            "--fixed-strings",
            "--ignore-case",
            "--max-count",
            "5",
            "--max-columns",
            "200",
            "--max-columns-preview",
            "--glob",
            "!node_modules/**",
            "--glob",
            "!reports/**",
            "--glob",
            "!models/**",
            "--",
            query,
            ".",
          ],
          {
            cwd: this.root,
            encoding: "utf8",
            timeout: 3000,
            maxBuffer: 500000,
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        const safeRows = result
          .split(/\r?\n/)
          .filter((line) => {
            const rel = line.match(/^(.+?):\d+:/)?.[1]?.replace(/^\.\//, "");
            return rel && rutaProyecto(this.root, rel);
          })
          .slice(0, limit);
        if (safeRows.length) return safeRows.join("\n");
      } catch {}
    }
    for (const e of this.entries.values()) {
      if (symbol && !references) {
        for (const s of e.symbols)
          if (s.nombre.toLowerCase().includes(query.toLowerCase()))
            rows.push(`${e.rel}:${s.linea} ${s.signature || s.nombre}`);
      } else {
        const lines = e.text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++)
          if (lines[i].toLowerCase().includes(query.toLowerCase()))
            rows.push(`${e.rel}:${i + 1} ${lines[i].trim().slice(0, 200)}`);
      }
      if (rows.length >= limit) break;
    }
    return (
      rows.slice(0, limit).join("\n") ||
      "Sin coincidencias en el índice acotado. Refina la consulta o lee una ruta explícita."
    );
  }
  snippets(task, hints = {}, budget = this.config.snippetTokens) {
    this.lastSnippetFiles = [];
    const parts = [];
    if (this.config.contextMode === "full-files") {
      for (const e of this.rank(task, hints)
        .filter((e) => e.score > 0)
        .slice(0, 3)) {
        const whole = `Archivo ${e.rel} (completo):\n${e.text
          .split(/\r?\n/)
          .map((line, i) => `${i + 1}| ${line}`)
          .join("\n")}`;
        if (estimateTokens([...parts, whole].join("\n\n")) > budget) continue;
        parts.push(whole);
        this.lastSnippetFiles.push(e.rel);
      }
      return parts.join("\n\n");
    }
    for (const e of this.rank(task, hints)
      .filter((e) => e.score > 0)
      .slice(0, 3)) {
      const s =
        e.symbols.find((s) =>
          termsOf(task).some((t) => s.nombre.toLowerCase().includes(t)),
        ) || e.symbols[0];
      const remaining = budget - estimateTokens(parts.join("\n"));
      if (remaining < 100) break;
      parts.push(
        this.read(
          {
            ruta: e.rel,
            // AST ranges stay unambiguous for overloads and repeated method names.
            ...(s
              ? {
                  desde: Math.max(1, s.linea - 2),
                  hasta: (s.endLine || s.linea) + 2,
                }
              : { desde: 1, hasta: 40 }),
          },
          Math.min(600, remaining),
        ),
      );
      this.lastSnippetFiles.push(e.rel);
    }
    return parts.join("\n\n");
  }
  affectedTests(modified) {
    const impacted = new Set(modified);
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of this.entries.values())
        if (
          !impacted.has(e.rel) &&
          e.dependencies.some((d) => impacted.has(d))
        ) {
          impacted.add(e.rel);
          grew = true;
        }
    }
    return [...impacted].filter(
      (f) =>
        /(?:^|\/)(?:test[^/]*|__tests__)(?:\/|\.)|\.(?:test|spec)\.[cm]?js$|(?:^|\/)(?:test[^/]*\.py|[^/]+_test\.py)$/.test(
          f,
        ) && /(?:\.[cm]?js|\.py)$/.test(f),
    );
  }
}
