/**
 * Ejecución de git con errores distinguibles. El panel necesita saber si no
 * hay repo, si git no está instalado o si el comando falló; antes todo eso se
 * convertía en una cadena vacía.
 */
import { execFile } from "node:child_process";

/**
 * @param {{getRoot: () => string}} ctx
 */
export function createGitService(ctx) {
  /**
   * @param {string[]} args
   * @param {string} [cwd]
   * @returns {Promise<{ok: boolean, salida: string, error: string}>}
   */
  function gitRun(args, cwd = ctx.getRoot()) {
    return new Promise((resolve) => {
      execFile("git", args, { cwd, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, salida: String(stdout || ""), error: String(stderr || "").trim() || err.message });
          return;
        }
        resolve({ ok: true, salida: String(stdout || ""), error: "" });
      });
    });
  }

  /**
   * Solo la salida ("" si falló), para las lecturas del panel. El motivo real
   * queda en el log del servidor; para decidir, usa `gitRun`.
   * @param {string[]} args
   * @returns {Promise<string>}
   */
  function git(args) {
    return gitRun(args).then((r) => {
      // "not a repository" es normal cuando la carpeta no es un repo: el panel
      // ya responde repo:false y avisar cada 15 s llenaba la consola.
      if (!r.ok && !/not a git repository/i.test(r.error)) {
        process.stderr.write(`[git] ${args.join(" ")} falló: ${r.error}\n`);
      }
      return r.ok ? r.salida : "";
    });
  }

  return { gitRun, git };
}
