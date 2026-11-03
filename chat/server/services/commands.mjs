/**
 * Entorno y ejecución de comandos del agente. Centraliza la preparación del
 * PATH (Python de uv, shims de pip/python3) y el recorte de la salida.
 *
 * El vigilante del proceso (timeout, cancelación y muerte del árbol) sigue en
 * `chat/procesos.mjs`; aquí solo se compone el comando y se resume el delta de
 * archivos.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ejecutarComando, recortarCentro } from "../../procesos.mjs";
import { fileDelta, snapshotFiles } from "../workspace.mjs";

/**
 * @param {string} dir
 * @returns {number[]}
 */
function versionDePython(dir) {
  return path.basename(dir).split(".").map((n) => Number.parseInt(n, 10) || 0);
}

/**
 * Última instalación de Python de uv, priorizando la que tiene pip.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function findPythonHome(env = process.env) {
  const root = path.join(env.APPDATA || "", "uv", "python");
  if (!fs.existsSync(root)) return "";
  const homes = fs.readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((dir) => fs.existsSync(path.join(dir, "python.exe")))
    // Orden NUMÉRICO descendente: como texto, "3.9.13" va después de "3.10.0".
    .sort((a, b) => {
      const x = versionDePython(a);
      const y = versionDePython(b);
      for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
        const d = (y[i] || 0) - (x[i] || 0);
        if (d) return d;
      }
      return 0;
    });
  return homes.find((dir) => fs.existsSync(path.join(dir, "Lib", "site-packages", "pip"))) || homes[0] || "";
}

/**
 * Escribe un shim solo si cambió: antes cada arranque tocaba la mtime de tres
 * archivos sin necesidad.
 * @param {string} file
 * @param {string} content
 */
function asegurarArchivo(file, content) {
  try {
    if (fs.readFileSync(file, "utf8") === content) return;
  } catch {
    /* no existía */
  }
  fs.writeFileSync(file, content);
}

/**
 * @param {{here: string, env?: NodeJS.ProcessEnv, pythonHome?: string}} ctx
 * @returns {NodeJS.ProcessEnv}
 */
export function commandEnv({ here, env = process.env, pythonHome = findPythonHome(env) }) {
  const shim = path.join(here, ".shims");
  fs.mkdirSync(shim, { recursive: true });
  asegurarArchivo(path.join(shim, "pip.cmd"), "@echo off\r\npython -m pip %*\r\n");
  asegurarArchivo(path.join(shim, "pip3.cmd"), "@echo off\r\npython -m pip %*\r\n");
  asegurarArchivo(path.join(shim, "python3.cmd"), "@echo off\r\npython %*\r\n");
  const localBin = path.join(os.homedir(), ".local", "bin");
  const extra = [pythonHome, shim, localBin].filter((dir) => dir && fs.existsSync(dir));
  const resultado = { ...env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
  const key = Object.keys(resultado).find((name) => name.toUpperCase() === "PATH") || "PATH";
  resultado[key] = [...extra, resultado[key] || ""].join(path.delimiter);
  return resultado;
}

/**
 * @param {{
 *   here: string,
 *   getRoot: () => string,
 *   getTimeoutMs: () => number,
 *   env?: NodeJS.ProcessEnv,
 *   snapshot?: typeof snapshotFiles,
 *   ejecutar?: typeof ejecutarComando,
 *   recortar?: typeof recortarCentro,
 * }} ctx
 */
export function createCommandService(ctx) {
  const snapshot = ctx.snapshot || snapshotFiles;
  const ejecutar = ctx.ejecutar || ejecutarComando;
  const recortar = ctx.recortar || recortarCentro;
  const pythonHome = findPythonHome(ctx.env);
  const shellEnv = commandEnv({ here: ctx.here, env: ctx.env, pythonHome });

  /**
   * Ejecuta un comando en la carpeta de trabajo y devuelve salida + delta.
   * @param {string} command
   * @param {AbortSignal} [signal]
   * @param {(chunk: string) => void} [onOutput]
   * @returns {Promise<{code: number, output: string}>}
   */
  function runCommand(command, signal, onOutput) {
    const text = command.trim();
    if (!text || text.length > 32768) {
      return Promise.resolve({ code: 1, output: "Comando vacío o demasiado largo (máximo 32768 caracteres)." });
    }
    const before = snapshot(ctx.getRoot(), { cache: true });
    return ejecutar(text, {
      cwd: ctx.getRoot(),
      env: shellEnv,
      signal,
      timeoutMs: ctx.getTimeoutMs(),
      onOutput,
    }).then((result) => {
      const files = fileDelta(before, snapshot(ctx.getRoot(), { force: true }));
      const body = result.output.trim();
      // Recorte por el MEDIO: el final (traceback, FAILED) es lo que el modelo necesita.
      return { code: result.code, output: recortar(`${files}\n${body || "(sin salida en stdout ni stderr)"}`, 8000) };
    });
  }

  return { pythonHome, shellEnv, runCommand };
}
