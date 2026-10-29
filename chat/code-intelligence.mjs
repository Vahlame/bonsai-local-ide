/** Optional CPU TypeScript diagnostics and a bounded stdio LSP client. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { rutaProyecto } from "./archivos-seguros.mjs";
import { matarArbol } from "./procesos.mjs";
const require = createRequire(import.meta.url);
export function typeScriptProject(root, context) {
  const configured = ["tsconfig.json", "jsconfig.json"].some((f) =>
    context.entries.has(f),
  );
  if (
    !configured &&
    ![...context.entries.keys()].some((f) => /\.[cm]?tsx?$/.test(f))
  )
    return null;
  let ts;
  try {
    ts = require(process.env.BONSAI_TYPESCRIPT_MODULE || "typescript");
  } catch {
    return null;
  }
  return {
    dependencies() {
      const config = ["tsconfig.json", "jsconfig.json"]
        .map((f) => rutaProyecto(root, f))
        .find((p) => p && fs.existsSync(p));
      let options = {
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        module: ts.ModuleKind.ESNext,
      };
      if (config) {
        const read = ts.readConfigFile(config, ts.sys.readFile);
        options = ts.parseJsonConfigFileContent(
          read.config || {},
          ts.sys,
          path.dirname(config),
        ).options;
      }
      const result = new Map();
      for (const entry of context.entries.values())
        if (/\.[cm]?[jt]sx?$/.test(entry.rel)) {
          const resolved = [];
          for (const specifier of entry.imports) {
            const module = ts.resolveModuleName(
              specifier,
              path.join(root, entry.rel),
              options,
              ts.sys,
            ).resolvedModule;
            if (!module) continue;
            const target = path
              .relative(root, module.resolvedFileName)
              .replace(/\\/g, "/");
            if (rutaProyecto(root, target))
              resolved.push({ specifier, target });
          }
          result.set(entry.rel, resolved);
        }
      return result;
    },
    diagnostics() {
      const config = ["tsconfig.json", "jsconfig.json"]
        .map((f) => rutaProyecto(root, f))
        .find((p) => p && fs.existsSync(p));
      let options = {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        skipLibCheck: true,
      };
      let names = [...context.entries.keys()]
          .filter((f) => /\.[cm]?tsx?$/.test(f))
          .map((f) => path.join(root, f)),
        configErrors = [];
      if (config) {
        const read = ts.readConfigFile(config, ts.sys.readFile);
        const parsed = ts.parseJsonConfigFileContent(
          read.config || {},
          ts.sys,
          path.dirname(config),
        );
        options = parsed.options;
        names = parsed.fileNames;
        configErrors = [...(read.error ? [read.error] : []), ...parsed.errors];
      }
      names = names.filter((p) => rutaProyecto(root, path.relative(root, p)));
      if (names.length > 256)
        throw new Error(
          "TypeScript project exceeds the 256-file automatic check limit; configure verification explicitly",
        );
      const program = ts.createProgram(names, {
        ...options,
        noEmit: true,
        incremental: false,
        composite: false,
      });
      const diagnostics = [...configErrors, ...ts.getPreEmitDiagnostics(program)]
        .filter(
          (d) =>
            d.category === ts.DiagnosticCategory.Error &&
            (!d.file ||
              rutaProyecto(root, path.relative(root, d.file.fileName))),
        );
      if (diagnostics.length > 40)
        throw new Error("TypeScript reports more than 40 errors; automatic typecheck is incomplete. Configure project verification explicitly.");
      return diagnostics.map((d) => {
          const position =
            d.file && d.start !== undefined
              ? d.file.getLineAndCharacterOfPosition(d.start)
              : { line: 0, character: 0 };
          const file = d.file
            ? path.relative(root, d.file.fileName).replace(/\\/g, "/")
            : path.basename(config || "tsconfig.json");
          const message = ts
            .flattenDiagnosticMessageText(d.messageText, " ")
            .slice(0, 600);
          return {
            key: `${file}:${d.code}:${message}`,
            text: `${file}:${position.line + 1}:${position.character + 1} TS${d.code}: ${message}`,
          };
        });
    },
  };
}

export class TypeScriptLsp {
  constructor(root, { signal, timeout = 6000 } = {}) {
    this.root = root;
    this.signal = signal;
    this.timeout = timeout;
    this.pending = new Map();
    this.documents = new Map();
    this.nextId = 1;
    this.buffer = Buffer.alloc(0);
  }
  async start() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      this.signal?.throwIfAborted();
      const cli =
        process.env.BONSAI_TS_LSP_CLI ||
        require.resolve("typescript-language-server/lib/cli.mjs");
      const ts =
        process.env.BONSAI_TYPESCRIPT_MODULE || require.resolve("typescript");
      this.child = spawn(
        process.execPath,
        [cli, "--stdio", "--log-level", "1"],
        { cwd: this.root, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
      );
      this.child.stderr.resume();
      this.child.stdin.on("error", (e) => this.fail(e));
      this.child.once("error", (e) => this.fail(e));
      this.child.once("exit", () =>
        this.fail(new Error("Language server exited")),
      );
      this.child.stdout.on("data", (data) => {
        try {
          this.buffer = Buffer.concat([this.buffer, data]);
          if (this.buffer.length > 2_000_000)
            throw new Error("LSP frame limit exceeded");
          while (true) {
            const end = this.buffer.indexOf("\r\n\r\n");
            if (end < 0) break;
            const length = Number(
              this.buffer
                .subarray(0, end)
                .toString()
                .match(/Content-Length:\s*(\d+)/i)?.[1],
            );
            if (!Number.isInteger(length) || length < 0 || length > 2_000_000)
              throw new Error("Invalid LSP length");
            if (this.buffer.length < end + 4 + length) break;
            const message = JSON.parse(
              this.buffer.subarray(end + 4, end + 4 + length).toString("utf8"),
            );
            this.buffer = this.buffer.subarray(end + 4 + length);
            if (message.method && message.id !== undefined)
              this.send({
                id: message.id,
                result:
                  message.method === "workspace/configuration"
                    ? (message.params?.items || []).map(() => null)
                    : null,
              });
            else if (message.id !== undefined) {
              const waiting = this.pending.get(message.id);
              if (!waiting) continue;
              this.pending.delete(message.id);
              clearTimeout(waiting.timer);
              message.error
                ? waiting.reject(new Error(message.error.message))
                : waiting.resolve(message.result);
            }
          }
        } catch (error) {
          this.fail(error);
        }
      });
      this.abort = () => this.dispose();
      this.signal?.addEventListener("abort", this.abort, { once: true });
      await this.request("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(this.root).href,
        capabilities: {
          textDocument: { definition: { linkSupport: true }, references: {} },
        },
        workspaceFolders: [
          {
            uri: pathToFileURL(this.root).href,
            name: path.basename(this.root),
          },
        ],
        initializationOptions: {
          tsserver: { path: path.join(path.dirname(ts), "tsserver.js") },
          disableAutomaticTypingAcquisition: true,
        },
      });
      this.notify("initialized", {});
      return this;
    })();
    return this.ready;
  }
  send(message) {
    if (this.closed) throw new Error("Language server is closed");
    const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }));
    this.child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.child.stdin.write(body);
  }
  notify(method, params) {
    this.send({ method, params });
  }
  request(method, params) {
    if (this.pending.size >= 16)
      return Promise.reject(new Error("LSP pending request limit exceeded"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP timeout: ${method}`));
        this.dispose();
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  async lookup({ ruta, linea = 1, columna = 1, referencias = false }, text) {
    const abs = rutaProyecto(this.root, ruta);
    if (!abs) throw new Error("LSP path outside project");
    await this.start();
    const uri = pathToFileURL(abs).href,
      previous = this.documents.get(uri),
      version = (previous?.version || 0) + 1;
    if (!previous)
      this.notify("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId: /\.tsx$/.test(ruta)
            ? "typescriptreact"
            : /\.[cm]?ts$/.test(ruta)
              ? "typescript"
              : "javascript",
          version,
          text,
        },
      });
    else if (previous.text !== text)
      this.notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }],
      });
    this.documents.set(uri, { version, text });
    await this.request("workspace/executeCommand", {
      command: "typescript.tsserverRequest",
      arguments: ["projectInfo", { file: abs, needFileNameList: true }, {}],
    });
    const position = { line: linea - 1, character: columna - 1 };
    const result = referencias
      ? await this.request("textDocument/references", {
          textDocument: { uri },
          position,
          context: { includeDeclaration: true },
        })
      : await this.request("workspace/executeCommand", {
          command: "_typescript.goToSourceDefinition",
          arguments: [uri, position],
        });
    const rows = Array.isArray(result) ? result : result ? [result] : [];
    return rows
      .flatMap((row) => {
        try {
          const file = fileURLToPath(row.uri || row.targetUri),
            rel = path.relative(this.root, file).replace(/\\/g, "/");
          if (!rutaProyecto(this.root, rel)) return [];
          const start = (
            row.range ||
            row.targetSelectionRange ||
            row.targetRange
          ).start;
          return [`${rel}:${start.line + 1}:${start.character + 1}`];
        } catch {
          return [];
        }
      })
      .slice(0, 20);
  }
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const { timer, reject } of this.pending.values()) {
      clearTimeout(timer);
      reject(error);
    }
    this.pending.clear();
    if (this.child?.exitCode === null) matarArbol(this.child);
  }
  dispose() {
    this.signal?.removeEventListener("abort", this.abort);
    this.fail(new Error("Language server disposed"));
  }
}
