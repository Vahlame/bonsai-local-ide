/** Host-owned state machine, bounded repair, schema validation and automatic verification. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { CodeContext, parseCode, projectFiles } from "./code-context.mjs";
import { rutaProyecto } from "./archivos-seguros.mjs";
import { diagnosticarArchivo } from "./diagnosticos.mjs";
import { SYSTEM_RULES, AGENT_WORKFLOW, TOOL_WORKFLOW, CODER_TOOL_WORKFLOW, estimateTokens, takeHeadByTokens } from "./context.mjs";
import { PC_TOOLS, unifiedDiff } from "./actions.mjs";
import { matarArbol } from "./procesos.mjs";
import { verificationCommands } from "./project-verification.mjs";
import { TypeScriptLsp, typeScriptProject } from "./code-intelligence.mjs";

/**
 * Identidad completa de un diagnóstico para no confundir dos errores con el mismo
 * mensaje en líneas distintas (el bug que ocultaba errores nuevos).
 * @param {{archivo?: string, linea?: number, columna?: number, mensaje?: string, fuente?: string}} d
 */
export function identidadDiagnostico(d) {
  return [d.archivo || "", d.linea ?? "", d.columna ?? "", d.fuente || "", d.mensaje || ""].join("|");
}

export const CODER_CONFIG = Object.freeze(
  JSON.parse(
    fs.readFileSync(
      process.env.BONSAI_CODER_CONFIG
        ? path.resolve(process.env.BONSAI_CODER_CONFIG)
        : new URL("./coder-profile.json", import.meta.url),
      "utf8",
    ),
  ),
);
export function coderOptions(raw = "") {
  if (!raw) return {};
  const values = JSON.parse(raw),
    out = {};
  for (const k of [
    "repoMapTokens",
    "snippetTokens",
    "contextTokens",
    "outputTokens",
    "thinkingTokens",
    "maxSteps",
    "maxRepairs",
    "timeoutMs",
  ]) {
    if (Object.hasOwn(values, k)) {
      const n = values[k];
      if (
        !Number.isInteger(n) ||
        n < 0 ||
        n > (k === "timeoutMs" ? 1800000 : k === "contextTokens" ? 65536 : 32768)
      )
        throw new Error(`Configuración inválida: ${k}`);
      out[k] = n;
    }
  }
  if (Object.hasOwn(values, "strategy")) {
    if (!["auto", "direct", "plan"].includes(values.strategy))
      throw new Error("strategy inválida");
    out.strategy = values.strategy;
  }
  if (typeof values.promptCache === "boolean")
    out.promptCache = values.promptCache;
  if (values.contextMode !== undefined) {
    if (!["snippets", "full-files"].includes(values.contextMode))
      throw new Error("contextMode inválido");
    out.contextMode = values.contextMode;
  }
  if (out.contextTokens !== undefined && out.contextTokens < 2048)
    throw new Error("contextTokens debe ser >= 2048");
  if (out.outputTokens !== undefined && out.outputTokens < 256)
    throw new Error("outputTokens debe ser >= 256");
  return out;
}
const str = { type: "string" },
  int = { type: "integer", minimum: 1 };
const tool = (name, description, properties, required = []) => ({
  type: "function",
  function: {
    name,
    description,
    strict: true,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  },
});
const base = (name) =>
  structuredClone(PC_TOOLS.find((t) => t.function.name === name));
export const CODER_TOOLS = [
  base("mcp_playwright"),
  base("navegador"),
  base("buscar"),
  base("leer_web"),
  tool(
    "indice",
    "Mapa compacto de archivos, símbolos y dependencias relevantes.",
    { carpeta: str },
  ),
  tool(
    "buscar_codigo",
    "Búsqueda textual local literal; devuelve rutas y líneas.",
    { consulta: str },
    ["consulta"],
  ),
  tool(
    "simbolo",
    "Busca definiciones o referencias textuales de un símbolo.",
    {
      nombre: str,
      referencias: { type: "boolean" },
      ruta: str,
      linea: int,
      columna: int,
    },
    ["nombre"],
  ),
  tool(
    "leer",
    "Lee hasta 120 líneas numeradas. Pide un rango, un símbolo o alrededor de una línea.",
    { ruta: str, desde: int, hasta: int, simbolo: str, alrededor: int },
    ["ruta"],
  ),
  base("reemplazar"),
  tool(
    "archivo",
    "Crea o reemplaza texto; para cambios localizados usa reemplazar y para archivos nuevos grandes escribir_partes.",
    { ruta: str, contenido: str },
    ["ruta", "contenido"],
  ),
  base("escribir_partes"),
  base("consultar_salida"),
  tool(
    "ejecutar",
    "Ejecuta un comando de desarrollo o tests en la shell del proyecto; salida acotada.",
    { comando: str, segundo_plano: { type: "boolean" }, repetir: { type: "boolean" } },
    ["comando"],
  ),
  base("proceso"),
  base("borrar"),
  base("mover"),
  tool("git_diff", "Diff actual de Git (incluye cambios preexistentes).", {
    ruta: str,
  }),
  base("plan"),
].map((t) => ({
  ...t,
  function: {
    ...t.function,
    strict: true,
    parameters: { ...t.function.parameters, additionalProperties: false },
  },
}));

export const CODER_SYSTEM =
  [SYSTEM_RULES, AGENT_WORKFLOW, TOOL_WORKFLOW, CODER_TOOL_WORKFLOW].join("\n\n");
export const PHASE_PROMPTS = Object.freeze({
  DISCOVER: "Localiza archivos y símbolos reales. Pide contexto solo si falta.",
  PLAN: "Usa plan con cambios mínimos, archivos/símbolos y verificación. Solo decisiones operativas breves.",
  EDIT: "Edita los archivos con las herramientas. Si plan es null, elige el siguiente cambio concreto según el pedido y lo inspeccionado; no necesitas crear un plan. No repitas el análisis. El host ejecuta tests después de editar; utiliza su resultado.",
  VERIFY:
    "La última versión pasó la verificación automática. Contrasta el diff con el pedido original: si todos sus requisitos están resueltos, resume y termina ahora. Si falta un requisito concreto, implementa solo ese paso. No inventes requisitos ni repitas comprobaciones sin nueva evidencia.",
  REPAIR:
    "Corrige exclusivamente los fallos presentados; inspecciona sus líneas si hace falta.",
  DONE: "Da la respuesta final al usuario usando el estado disponible. Indica lo pendiente o no comprobado. No vuelvas a llamar herramientas en esta fase ni inventes resultados.",
});

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
export function validateCall(call, tools = CODER_TOOLS) {
  const schema = tools.find((t) => t.function.name === call.name)?.function
    .parameters;
  if (!schema)
    return {
      ok: false,
      error: `función desconocida ${String(call.name).slice(0, 80)}`,
    };
  let args;
  try {
    if (typeof call.arguments === "string") {
      const text = call.arguments.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, "$1");
      args = JSON.parse(text);
      if (typeof args === "string" && /^\s*\{/.test(args)) args = JSON.parse(args);
    } else args = call.arguments;
  } catch {
    return {
      ok: false,
      error: "arguments: JSON inválido; envía un objeto JSON completo",
    };
  }
  const check = (v, s, p) => {
    if (s.type === "object") {
      if (!v || typeof v !== "object" || Array.isArray(v))
        return `${p}: se esperaba object`;
      for (const k of s.required || [])
        if (!Object.hasOwn(v, k)) return `${p}.${k}: campo obligatorio`;
      for (const [k, x] of Object.entries(v)) {
        if (!Object.hasOwn(s.properties || {}, k))
          return `${p}.${k}: campo desconocido`;
        const e = check(x, s.properties[k], `${p}.${k}`);
        if (e) return e;
      }
    } else if (s.type === "array") {
      if (!Array.isArray(v)) return `${p}: se esperaba array`;
      if (v.length > 30) return `${p}: máximo 30 elementos`;
      for (const x of v) {
        const e = check(x, s.items || {}, p + "[]");
        if (e) return e;
      }
    } else if (
      s.type === "integer"
        ? !Number.isInteger(v)
        : s.type && typeof v !== s.type
    )
      return `${p}: se esperaba ${s.type}, recibido ${JSON.stringify(v)?.slice(0, 80)}`;
    if (s.minimum !== undefined && v < s.minimum)
      return `${p}: mínimo ${s.minimum}`;
    if (s.enum && !s.enum.includes(v))
      return `${p}: esperado ${s.enum.join("|")}`;
    return "";
  };
  const error = check(args, schema, call.name);
  return error ? { ok: false, error } : { ok: true, args };
}

export function runCheck(
  file,
  args,
  { cwd, signal, timeout = 30000, logPath, env } = {},
) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({
        command: [file, ...args].join(" "),
        code: -1,
        output: "Verificación cancelada",
        timedOut: false,
      });
      return;
    }
    if (logPath) fs.writeFileSync(logPath, "");
    const child = spawn(file, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "",
      done = false;
    const add = (s) => {
      if (logPath) fs.appendFileSync(logPath, s);
      output += s;
      if (output.length > 1_000_000) output = output.slice(-800000);
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    let timedOut = false;
    const abort = () => matarArbol(child);
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      matarArbol(child);
    }, timeout);
    const finish = (code, error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve({
        command: [file, ...args].join(" "),
        code: timedOut ? -1 : code,
        output: output + (error ? "\n" + error : ""),
        timedOut,
      });
    };
    child.on("error", (e) => finish(-1, e.message));
    child.on("close", (code) => finish(code ?? -1));
  });
}

export class CoderTask {
  constructor({
    root,
    goal,
    config = {},
    emit = () => {},
    traceDir,
    signal,
    currentFile = "",
  }) {
    this.root = root;
    this.config = { ...CODER_CONFIG, ...config };
    this.emit = emit;
    this.traceDir = traceDir;
    this.signal = signal;
    this.currentFile = currentFile;
    this.context = new CodeContext(root, this.config);
    this.original = new Map();
    this.calls = new Map();
    this.invalid = 0;
    this.steps = 0;
    this.started = Date.now();
    this.state = {
      goal,
      root: path.resolve(root),
      phase: "DISCOVER",
      inspected: [],
      modified: [],
      symbols: [],
      plan: null,
      tests: [],
      errors: [],
      preexistingErrors: [],
      repairs: 0,
      actions: [],
      lastDiff: "",
    };
    this.lastVerified = "";
    this.touched = new Set();
    this.lastFailure = "";
    this.needsFinalVerification = false;
    this.id = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  }
  trace(event, data = {}) {
    const row = {
      type: "agent_trace",
      taskId: this.id,
      event,
      phase: this.state.phase,
      elapsedMs: Date.now() - this.started,
      ...data,
    };
    this.emit(row);
    if (this.traceDir) {
      fs.mkdirSync(this.traceDir, { recursive: true });
      fs.appendFileSync(
        path.join(this.traceDir, `${this.id}.jsonl`),
        JSON.stringify(row) + "\n",
      );
    }
  }
  git(args) {
    try {
      return execFileSync("git", ["-C", this.root, ...args], {
        encoding: "utf8",
        timeout: 3000,
        maxBuffer: 2_000_000,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      return "";
    }
  }
  async start() {
    await this.context.refresh();
    this.originalVersions = new Map(this.context.versions);
    for (const e of this.context.entries.values())
      this.original.set(e.rel, e.text);
    this.types = typeScriptProject(this.root, this.context);
    this.originalTypeErrors = new Map();
    if (this.types) {
      try {
        for (const diagnostic of this.types.diagnostics())
          this.originalTypeErrors.set(diagnostic.key, (this.originalTypeErrors.get(diagnostic.key) || 0) + 1);
      } catch (error) {
        this.typeWarning = error.message;
        this.types = null;
      }
    }
    this.state.preexistingGit = this.git(["status", "--porcelain=v1"]);
    this.initialMap = this.context.map(this.state.goal, {
      currentFile: this.currentFile,
    });
    this.initialSnippets = this.context.snippets(this.state.goal, {
      currentFile: this.currentFile,
    });
    this.state.inspected = [...(this.context.lastSnippetFiles || [])];
    this.snippetVersions = new Map(this.state.inspected.map(rel => [rel, this.context.versions.get(rel)]));
    const pkg = this.context.entries.get("package.json");
    if (pkg) {
      try {
        const p = JSON.parse(pkg.text);
        this.projectMetadata = JSON.stringify({
          type: p.type,
          engines: p.engines,
          scripts: p.scripts,
        });
      } catch {}
    }
    const complex =
      this.config.strategy === "plan" ||
      (this.config.strategy === "auto" &&
        /planifica|migraci[oó]n|refactor|(?:[4-9]|varios) archivos|multi.?file|cross.?file/i.test(
          this.state.goal,
        ));
    this.state.phase = complex ? "PLAN" : "EDIT";
    this.trace("start", {
      config: this.config,
      filesSelected: this.state.inspected,
      mapTokens: estimateTokens(this.initialMap),
      parserCounts: [...this.context.entries.values()].reduce(
        (a, e) => ((a[e.parser] = (a[e.parser] || 0) + 1), a),
        {},
      ),
      preexistingGit: this.state.preexistingGit,
      indexTruncated: this.context.truncated,
    });
    return this;
  }
  accept(calls) {
    this.steps++;
    if (this.steps > this.config.maxSteps)
      throw new Error("Límite de pasos del agente");
    if (Date.now() - this.started > this.config.timeoutMs)
      throw new Error("Tiempo máximo de tarea agotado");
    const valid = [],
      errors = [];
    const batchFiles = new Map();
    const batchCounts = new Map();
    for (const call of calls) {
      const r = validateCall(call);
      let error = r.ok ? "" : r.error;
      if (r.ok) {
        const a = r.args,
          abs = a.ruta ? rutaProyecto(this.root, a.ruta) : null;
        const limit = {archivo:6,reemplazar:8,ejecutar:6,buscar:4,borrar:6,mover:6,proceso:6}[call.name];
        if (limit) {
          const count = (batchCounts.get(call.name) || 0) + 1;
          batchCounts.set(call.name, count);
          if (count > limit) error = `El lote admite como máximo ${limit} llamadas ${call.name}; envía las restantes en el siguiente paso`;
        }
        if (["archivo", "reemplazar"].includes(call.name)) {
          if (!error && !abs) error = "ruta: fuera del proyecto o enlace no permitido";
          else if (
            !error &&
            fs.existsSync(abs) &&
            !this.state.inspected.includes(
              path.relative(this.root, abs).replace(/\\/g, "/"),
            )
          )
            error = `Inspecciona primero ${path.relative(this.root, abs).replace(/\\/g, "/")} con leer antes de sobrescribirlo`;
          else if (call.name === "reemplazar" && !a.buscar)
            error = "buscar: anchor vacío";
          if (!error && abs) {
            const key = path.resolve(abs).toLowerCase();
            const previous = batchFiles.get(key);
            if (previous && (previous === "archivo" || call.name === "archivo"))
              error = "Varias escrituras completas o una escritura y un reemplazo afectan al mismo archivo en el mismo lote; aplícalas en pasos separados";
            else batchFiles.set(key, call.name);
          }
        }
        if (!error) {
          const key = hash(JSON.stringify([call.name, a])),
            revision = this.revision();
          const old = this.calls.get(key);
          const n = old?.revision === revision ? old.n + 1 : 1;
          this.calls.set(key, { revision, n });
          const repetitionLimit = [
            "leer",
            "indice",
            "buscar_codigo",
            "simbolo",
            "git_diff",
          ].includes(call.name)
            ? 6
            : 2;
          if (n > repetitionLimit)
            error = `Llamada idéntica a ${call.name} repetida ${n} veces sin cambios en el proyecto. No la ejecuté; usa el resultado anterior, cambia los argumentos o pasa a otra comprobación`;
          else valid.push({ ...call, arguments: JSON.stringify(a) });
        }
      }
      if (error) {
        errors.push({
          id: call.id,
          error: `${error}. Corrige solo esta llamada según su schema.`,
        });
        this.trace("invalid_tool", { name: call.name, error });
      }
    }
    this.invalid = errors.length ? this.invalid + 1 : 0;
    if (this.invalid > 4) {
      this.stopped = "invalid_tool_limit";
      this.state.errors = errors.map((e) => e.error);
    }
    return { valid, errors };
  }
  /**
   * Un archivo que este turno acaba de crear o escribir ya es conocido: no hace falta
   * volver a `leer` para poder corregirlo. Antes solo `leer` añadía a `inspected`, así
   * que el agente quedaba bloqueado al intentar arreglar su propio archivo recién creado.
   * @param {string} rel
   */
  noteWritten(rel) {
    const limpia = String(rel || "").replace(/\\/g, "/").replace(/^\.\//, "");
    if (!limpia) return;
    if (!this.state.inspected.includes(limpia)) this.state.inspected.push(limpia);
  }
  revision() {
    return hash(
      [...(this.context.versions || new Map())]
        .map(
          ([rel, version]) =>
            rel +
            (this.context.entries.has(rel)
              ? hash(this.context.entries.get(rel).text)
              : version),
        )
        .join("\n"),
    );
  }
  async special(call) {
    const a = JSON.parse(call.arguments);
    await this.context.refresh();
    let result;
    if (call.name === "buscar_codigo") result = this.context.search(a.consulta);
    else if (call.name === "simbolo") {
      result = this.context.search(a.nombre, {
        symbol: true,
        references: a.referencias,
      });
      const entries = [...this.context.entries.values()].filter(
        (e) =>
          /\.[cm]?[jt]sx?$/.test(e.rel) &&
          (!a.ruta ||
            path.resolve(this.root, e.rel) === path.resolve(this.root, a.ruta)),
      );
      const candidates = entries.flatMap((e) =>
        e.symbols.filter((s) => s.nombre === a.nombre).map((s) => ({ e, s })),
      );
      const selected = a.ruta && (a.linea || candidates.length <= 1)
        ? entries[0]
        : candidates.length === 1
          ? candidates[0].e
          : null;
      if (selected) {
        const symbol = candidates.find((c) => c.e === selected)?.s;
        const line = a.linea || symbol?.nameLine || symbol?.linea;
        const column =
          a.columna ||
          (!a.linea ? symbol?.nameColumn : undefined) ||
          (line ? selected.text.split(/\r?\n/)[line - 1] : "")?.indexOf(
            a.nombre,
          ) + 1;
        if (line && column > 0) {
          try {
            this.lsp ||= new TypeScriptLsp(this.root, { signal: this.signal });
            const locations = await this.lsp.lookup(
              {
                ruta: selected.rel,
                linea: line,
                columna: column,
                referencias: a.referencias,
              },
              selected.text,
            );
            result = locations.length
              ? `LSP TypeScript (${a.referencias ? "referencias" : "definición de origen"}):\n${locations.join("\n")}`
              : `LSP TypeScript: sin resultados locales en esa posición.`;
          } catch (error) {
            this.trace("lsp_unavailable", { reason: error.message });
            result = `LSP no disponible; coincidencias léxicas:\n${result}`;
          }
        }
      } else if (candidates.length > 1) {
        result = `Varias definiciones; indica ruta, linea y columna para consultar LSP. Coincidencias léxicas:\n${result}`;
      }
      this.state.symbols = [
        ...new Set([...this.state.symbols, a.nombre]),
      ].slice(-16);
    } else if (call.name === "leer") {
      result = this.context.read(a);
      const abs = rutaProyecto(this.root, a.ruta);
      if (abs && result.startsWith("Archivo "))
        this.state.inspected = [
          ...new Set([
            ...this.state.inspected,
            path.relative(this.root, abs).replace(/\\/g, "/"),
          ]),
        ];
    } else if (call.name === "indice") {
      const abs = rutaProyecto(this.root, a.carpeta || ".", {
        permitirRaiz: true,
      });
      if (!abs) throw new Error("Carpeta fuera del proyecto");
      result = this.context.map(this.state.goal, {
        currentFile: this.currentFile,
        modified: this.state.modified,
      });
    } else if (call.name === "git_diff") {
      if (a.ruta && !rutaProyecto(this.root, a.ruta))
        throw new Error("Ruta de Git fuera del proyecto");
      const available =
        this.git(["rev-parse", "--is-inside-work-tree"]).trim() === "true";
      result =
        takeHeadByTokens(
          this.git([
            "diff",
            "--no-ext-diff",
            "--",
            ...(a.ruta ? [a.ruta] : []),
          ]),
          this.config.toolResultTokens,
          estimateTokens,
        ) ||
        (available
          ? `Sin diff de archivos seguidos por Git. Puede haber archivos nuevos sin seguimiento. Cambios de esta tarea:\n${this.state.lastDiff || "(ninguno registrado)"}`
          : `Git no está disponible en esta carpeta. Cambios de esta tarea:\n${this.state.lastDiff || "(ninguno registrado)"}`);
    } else return null;
    this.trace("tool", { name: call.name, resultChars: result.length });
    return result;
  }
  async changed() {
    await this.context.refresh();
    const changed = [];
    const paths = new Set([
      ...this.originalVersions.keys(),
      ...this.context.versions.keys(),
    ]);
    for (const rel of paths) {
      if (this.originalVersions.get(rel) === this.context.versions.get(rel))
        continue;
      if (
        this.original.has(rel) &&
        this.context.entries.get(rel)?.text === this.original.get(rel)
      )
        continue;
      changed.push(rel);
    }
    this.state.modified = changed;
    for (const rel of changed) this.touched.add(rel);
    this.state.lastDiff = takeHeadByTokens(
      changed
        .slice(0, 20)
        .map((rel) =>
          unifiedDiff(
            rel,
            this.original.get(rel) || "",
            this.context.entries.get(rel)?.text || "",
          ),
        )
        .join("\n"),
      600,
      estimateTokens,
    );
    return changed;
  }
  async verify({ run = runCheck, final = false } = {}) {
    let files = await this.changed();
    // Reverting a bad edit to the initial (still buggy) version does not prove
    // success. Recheck touched files, or the selected files at a claimed finish.
    if (!files.length && (this.touched.size || final))
      files = this.touched.size
        ? [...this.touched]
        : this.state.inspected.filter((rel) => this.context.entries.has(rel));
    const signature = this.revision();
    if (!files.length) {
      this.needsFinalVerification = false;
      // A finish claim without a diff or inspected evidence cannot prove that an
      // edit request was completed. Non-final calls still report "nothing to do".
      if (final) {
        this.verificationSummary =
          "No se modificó ni inspeccionó ningún archivo: no hay evidencia para dar la tarea por terminada.";
        this.trace("verified", {
          ok: false,
          files: [],
          tests: [],
          summary: this.verificationSummary,
          reason: "no_evidence",
        });
        return { ok: false, summary: this.verificationSummary, changed: false };
      }
      return {
        ok: true,
        summary: "Sin cambios que verificar.",
        changed: false,
      };
    }
    if (signature === this.lastVerified && !final)
      return {
        ok: this.state.errors.length === 0,
        summary: this.verificationSummary || "",
        changed: false,
      };
    this.state.phase = "VERIFY";
    const errors = [],
      preexisting = [],
      checks = [];
    for (const rel of files) {
      let e = this.context.entries.get(rel);
      if (!e) {
        const abs = rutaProyecto(this.root, rel);
        if (!abs || !fs.existsSync(abs)) continue;
        if (fs.statSync(abs).size > 2_000_000) {
          errors.push(
            `${rel}: archivo mayor de 2 MB; verificación automática fuera del límite.`,
          );
          continue;
        }
        e = { text: fs.readFileSync(abs, "utf8") };
      }
      const ast = await parseCode(rel, e.text),
        before = this.original.has(rel)
          ? await parseCode(rel, this.original.get(rel))
          : null;
      if (/\.[cm]?[jt]sx?$/.test(rel)) {
        for (const imported of ast.imports.filter((i) => i.startsWith("."))) {
          if (e.resolvedImports?.has(imported)) continue;
          const base = path.posix.normalize(
            path.posix.join(path.posix.dirname(rel), imported),
          );
          const candidates = [
            base,
            ...[
              ".js",
              ".mjs",
              ".cjs",
              ".ts",
              ".tsx",
              ".json",
              "/index.js",
              "/index.mjs",
              "/index.ts",
            ].map((ext) => base + ext),
          ];
          if (
            !candidates.some((p) => {
              const abs = rutaProyecto(this.root, p);
              return abs && fs.existsSync(abs) && fs.statSync(abs).isFile();
            })
          ) {
            const message = `${rel}: import local no encontrado: ${imported}`;
            (before?.imports.includes(imported) &&
            !candidates.some((p) => this.originalVersions.has(p))
              ? preexisting
              : errors
            ).push(message);
          }
        }
      }
      if (ast.syntaxErrors)
        errors.push(
          `${rel}: Tree-sitter detectó error de sintaxis; usa leer para localizarlo.`,
        );
      const diags = await diagnosticarArchivo(path.join(this.root, rel));
      const oldDiags = this.original.has(rel)
        ? await diagnosticarArchivo(
            path.join(this.root, rel),
            this.original.get(rel),
          )
        : [];
      const prior = new Set(
        oldDiags.filter((d) => d.severidad === "error").map(identidadDiagnostico),
      );
      for (const d of diags.filter((d) => d.severidad === "error")) {
        const msg = `${rel}:${d.linea} ${d.mensaje}`;
        (prior.has(identidadDiagnostico(d)) ? preexisting : errors).push(msg);
      }
    }
    if (!errors.length) {
      this.types ||= typeScriptProject(this.root, this.context);
      if (this.types) {
        try {
          const occurrences = new Map();
          for (const diagnostic of this.types.diagnostics()) {
            const count = (occurrences.get(diagnostic.key) || 0) + 1;
            occurrences.set(diagnostic.key, count);
            (count <= (this.originalTypeErrors.get(diagnostic.key) || 0)
              ? preexisting
              : errors
            ).push(diagnostic.text);
          }
          this.typeWarning = "";
          this.trace("typecheck", {
            source: "typescript",
            errors: errors.length,
            preexisting: preexisting.length,
          });
        } catch (error) {
          this.typeWarning = error.message;
          this.trace("typecheck_unavailable", { reason: error.message });
        }
      }
    }
    if (!errors.length) {
      // Explicit project configuration supports non-Node projects without guessing shell commands.
      let settings = {};
      const cfg = rutaProyecto(this.root, ".bonsai-coder.json");
      try {
        if (cfg && fs.statSync(cfg).size < 16000)
          settings = JSON.parse(fs.readFileSync(cfg, "utf8"));
      } catch {}
      const commands = verificationCommands(
        this.root,
        this.context,
        files,
        settings,
      );
      for (const c of commands) {
        this.signal?.throwIfAborted();
        const logPath = this.traceDir
          ? path.join(
              this.traceDir,
              `${this.id}-check-${this.steps}-${checks.length + 1}.log`,
            )
          : undefined;
        const result = await run(c.file, c.args, {
          cwd: this.root,
          signal: this.signal,
          timeout: 30000,
          logPath,
          env: c.env,
        });
        checks.push(result);
        this.trace("verification", {
          command: result.command,
          code: result.code,
          outputChars: result.output.length,
        });
        if (result.code !== 0) {
          errors.push(
            `${result.command} (exit ${result.code}):\n${compactFailure(result.output)}`,
          );
          break;
        }
      }
    }
    this.lastVerified = signature;
    this.needsFinalVerification = false;
    this.state.tests = checks.map((c) => ({
      command: c.command,
      code: c.code,
    }));
    this.state.errors = errors;
    this.state.preexistingErrors = preexisting;
    this.verificationSummary = errors.length
      ? errors.join("\n")
      : checks.length
        ? "Sintaxis y tests focalizados correctos."
        : `${this.types && !this.typeWarning ? "Sintaxis y tipos comprobados" : "Sintaxis comprobada"}. No se encontraron tests focalizados ni verificación configurada; comportamiento no comprobado.`;
    if (this.typeWarning)
      this.verificationSummary += `\nTypecheck automático no disponible: ${this.typeWarning}`;
    if (errors.length) {
      this.state.phase = "REPAIR";
      if (this.state.repairs >= this.config.maxRepairs)
        this.stopped = "repair_limit";
      else {
        this.state.repairs++;
        this.state.phase = "REPAIR";
        this.trace("repair", { attempt: this.state.repairs, errors });
      }
    } else this.state.phase = "VERIFY";
    this.trace("verified", {
      ok: !errors.length,
      files,
      tests: this.state.tests,
      preexistingErrors: preexisting,
      summary: this.verificationSummary,
    });
    return {
      ok: !errors.length,
      summary: this.verificationSummary,
      changed: true,
    };
  }
  workingState(budget = this.stateBudget || 600) {
    // Keep the complete state and logs on the host. Render a bounded view, never a
    // sliced JSON object or a second copy of the same failed-test stack trace.
    const s = this.state;
    const complete = JSON.stringify({ phase: s.phase, inspected: s.inspected.slice(-12), symbols: s.symbols, modified: s.modified, plan: s.plan, tests: s.tests, errors: s.errors, actions: s.actions, repairs: s.repairs, previousTask: s.previousTask, lastDiff: s.lastDiff || undefined });
    // Preserve the established representation when it already fits. Compact only
    // oversized state, avoiding needless prompt changes on ordinary iterations.
    if (estimateTokens(complete) <= budget) return complete;
    const brief = (value, tokens) => takeHeadByTokens(
      String(typeof value === "string" ? value : JSON.stringify(value ?? ""))
        .split(this.root).join(".")
        .split(this.root.replace(/\\/g, "/")).join(".")
        .split(/\r?\n/).filter(line => !/^\s+at .*\bnode:/.test(line)).join("\n"),
      tokens, estimateTokens,
    );
    const view = {
      phase: s.phase, repairs: s.repairs, compact: true,
      inspected: s.inspected.slice(-8).map(p => brief(p, 45)),
      modified: s.modified.slice(0, 8).map(p => brief(p, 45)),
      symbols: s.symbols.slice(-8).map(p => brief(p, 30)),
      actions: s.actions.slice(-4).map(a => ({ kind: a.kind, title: brief(a.title, 40), state: a.state, code: a.code })),
      plan: s.plan ? brief(s.plan, 100) : undefined,
      tests: s.tests.slice(-2).map(t => ({ command: brief(t.command, 65), code: t.code })),
      errors: s.errors.slice(0, 2).map(e => brief(e, 120)),
      previousTask: s.previousTask ? brief(s.previousTask, 60) : undefined,
      lastDiff: s.lastDiff ? brief(s.lastDiff, 120) : undefined,
    };
    const render = () => JSON.stringify({ ...view, omitted: {
      inspected: s.inspected.length - view.inspected.length,
      modified: s.modified.length - view.modified.length,
      tests: s.tests.length - view.tests.length,
      errors: s.errors.length - view.errors.length,
    } });
    for (const key of ["lastDiff", "previousTask"])
      if (estimateTokens(render()) > budget) delete view[key];
    for (const key of ["inspected", "symbols", "actions", "tests", "modified", "errors"])
      while (estimateTokens(render()) > budget && view[key].length > (key === "errors" ? 1 : 0))
        view[key].pop();
    // The first failure is essential even with many long paths/diagnostics.
    for (let cap = 100; estimateTokens(render()) > budget && cap >= 10; cap -= 10)
      view.errors = view.errors.map(e => brief(e, cap));
    if (estimateTokens(render()) > budget) delete view.plan;
    return render();
  }
  dynamic() {
    const summary = !this.state.errors.length && this.state.modified.length
      ? takeHeadByTokens(this.verificationSummary || "Cambios pendientes de verificar.", 90, estimateTokens)
      : "";
    const phase = [PHASE_PROMPTS[this.state.phase], this.contextHint].filter(Boolean).join("\n");
    return `ESTADO DE TAREA:\n${this.workingState()}\n${phase}\n${summary}`;
  }
  dispose() {
    this.images = [];
    this.lsp?.dispose();
  }
}

export function compactFailure(output, max = 2200) {
  const lines = String(output).split(/\r?\n/),
    interesting = [];
  for (let i = 0; i < lines.length; i++)
    if (
      /error|fail|not ok|exception|assert|expected|actual|\.\w+:\d+/i.test(
        lines[i],
      )
    )
      for (
        let j = Math.max(0, i - 1);
        j <= Math.min(lines.length - 1, i + 2);
        j++
      )
        interesting.push(j);
  return (
    [...new Set(interesting)]
      .map((i) => lines[i])
      .join("\n")
      .slice(0, max) || lines.slice(-12).join("\n").slice(0, max)
  );
}
