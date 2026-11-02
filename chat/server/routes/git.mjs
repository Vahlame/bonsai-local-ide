/** Rutas del panel Git: estado del repositorio y commit de archivos elegidos. */
import { readBody } from "../http.mjs";
import { analizarEstadoGit, elegirRutasGit } from "../../git-seguro.mjs";

/**
 * @param {Record<string, any>} ctx
 */
export function createGitRoutes(ctx) {
  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {URL} url
   * @returns {Promise<boolean>}
   */
  return async function handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/git") {
      const dentro = await ctx.git(["rev-parse", "--is-inside-work-tree"]);
      if (!dentro.trim()) {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ repo: false }));
        return true;
      }
      const raiz = (await ctx.gitRun(["rev-parse", "--show-toplevel"])).salida.trim();
      const [rama, estado, ultimo] = await Promise.all([
        ctx.gitRun(["rev-parse", "--abbrev-ref", "HEAD"], raiz),
        ctx.gitRun(["status", "--porcelain=v1", "-z", "--untracked-files=all"], raiz),
        ctx.gitRun(["log", "-1", "--pretty=%h\u0001%s\u0001%cr"], raiz),
      ]);
      if (!estado.ok) { res.writeHead(500).end(`No se pudo consultar Git: ${estado.error}`); return true; }
      const archivos = analizarEstadoGit(estado.salida);
      const partes = ultimo.salida.trim().split("\u0001");
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ repo: true, rama: rama.salida.trim(), archivos, ultimo: partes[0] ? { hash: partes[0], asunto: partes[1], cuando: partes[2] } : null }));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/git") {
      const raw = JSON.parse(await readBody(req));
      if (!raw || raw.op !== "commit") {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("operacion desconocida");
        return true;
      }
      const mensaje = String(raw.mensaje || "").trim().slice(0, 2000);
      if (!mensaje) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("falta el mensaje");
        return true;
      }
      const raiz = (await ctx.gitRun(["rev-parse", "--show-toplevel"])).salida.trim();
      if (!raiz) { res.writeHead(409).end("No hay repositorio Git en esta carpeta."); return true; }
      const estado = await ctx.gitRun(["status", "--porcelain=v1", "-z", "--untracked-files=all"], raiz);
      if (!estado.ok) { res.writeHead(500).end(estado.error); return true; }
      let rutas;
      try { rutas = elegirRutasGit(analizarEstadoGit(estado.salida), raw.archivos); }
      catch (err) { res.writeHead(409).end(err instanceof Error ? err.message : String(err)); return true; }
      // --literal-pathspecs impide que nombres con * o [ ] seleccionen otros archivos.
      // --only mantiene fuera del commit los cambios previamente preparados que no se eligieron.
      // El origen de un renombrado preparado ya no está en el índice y `git add`
      // lo rechaza como pathspec inexistente. Se prepara solo el destino elegido;
      // el commit sí recibe origen y destino para registrar ambos cambios.
      const puesto = await ctx.gitRun(["--literal-pathspecs", "add", "-A", "--", ...new Set(raw.archivos)], raiz);
      if (!puesto.ok) { res.writeHead(409, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ ok: false, salida: puesto.error || puesto.salida })); return true; }
      const commit = await ctx.gitRun(["--literal-pathspecs", "commit", "--only", "-m", mensaje, "--", ...rutas], raiz);
      const ok = commit.ok && (commit.salida.includes("]") || /files? changed/.test(commit.salida));
      // El motivo real (nada que commitear, git sin configurar, no es un repo) viaja
      // al usuario en vez de un 409 mudo.
      const salida = (commit.salida || commit.error || puesto.error || "").slice(0, 800);
      res.writeHead(ok ? 200 : 409, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok, salida }));
      return true;
    }
    return false;
  };
}
