/** Contratos del harness: configuración, prompts, validación, verificación y recorte. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { CodeContext, parseCode } from "../code-context.mjs";
import { buscarEstructural } from "../code-search.mjs";
import { rutaProyecto } from "../archivos-seguros.mjs";
import { diagnosticarArchivo } from "../diagnosticos.mjs";
import { SYSTEM_RULES, AGENT_WORKFLOW, TOOL_WORKFLOW, CODER_TOOL_WORKFLOW, estimateTokens, takeHeadByTokens } from "../context.mjs";
import { unifiedDiff } from "../actions.mjs";
import { CODER_TOOLS, validateToolCall } from "../tool-registry.mjs";
import { verificationCommands } from "../project-verification.mjs";
import { TypeScriptLsp, typeScriptProject } from "../code-intelligence.mjs";
import { nodeRuntimeGuide, runtimeFailureFacts } from "../runtime-facts.mjs";
import { matarArbol } from "../procesos.mjs";
export { CODER_TOOLS };


/** Host-owned state machine, bounded repair, schema validation and automatic verification. */

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
        : new URL("../coder-profile.json", import.meta.url),
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
        n > (k === "timeoutMs" ? 7200000 : k === "contextTokens" ? 65536 : 32768)
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
export const CODER_SYSTEM =
  [SYSTEM_RULES, AGENT_WORKFLOW, TOOL_WORKFLOW, CODER_TOOL_WORKFLOW].join("\n\n");
export const PHASE_PROMPTS = Object.freeze({
  DISCOVER: "Localiza archivos y símbolos reales. Pide contexto solo si falta.",
  PLAN: "Si el usuario pide un plan, una propuesta o preguntas, responde primero con ellas; no inspecciones archivos por rutina. Cuando toque actuar, usa plan con cambios mínimos, archivos/símbolos y verificación. Solo decisiones operativas breves.",
  EDIT: "Edita los archivos con las herramientas. Si plan es null, elige el siguiente cambio concreto según el pedido y lo inspeccionado; no necesitas crear un plan. No repitas el análisis. El host ejecuta tests después de editar; utiliza su resultado.",
  VERIFY:
    "La comprobación automática solo valida sintaxis y tests configurados, no la tarea completa. Si el pedido original menciona archivos que aún no existen, tests que no se han ejecutado o requisitos sin implementar, créalos/ejecútalos ahora. Solo resume y termina cuando todos los requisitos estén implementados y `npm test` (o la verificación configurada) pase. No inventes requisitos ni repitas comprobaciones sin nueva evidencia.",
  REPAIR:
    "Corrige exclusivamente los fallos presentados; inspecciona sus líneas si hace falta.",
  DONE: "Da la respuesta final al usuario usando el estado disponible. Indica lo pendiente o no comprobado. No vuelvas a llamar herramientas en esta fase ni inventes resultados.",
});

export const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
export function validateCall(call, tools = CODER_TOOLS) {
  const result = validateToolCall(call, tools);
  if (result.ok) return result;
  // Conserva el prefijo con el nombre de la tool que ya usaban los mensajes.
  const error = String(result.error || "").replace(/^arguments/, String(call?.name || "arguments"));
  return { ok: false, error };
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
