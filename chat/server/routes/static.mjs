/** Rutas estáticas: página, recursos de ui/, GPU y artefactos de salida. */
import fs from "node:fs";
import path from "node:path";
import { TYPES, UI_SERVIDOS, fileInside } from "../http.mjs";
import { readGpu } from "../gpu.mjs";

/**
 * @param {{PAGE: string, HERE: string, SALIDA: string, get workspaceRoot(): string}} ctx
 */
export function createStaticRoutes(ctx) {
  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {URL} url
   * @returns {Promise<boolean>} true si la petición ya se respondió
   */
  return async function handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      fs.createReadStream(ctx.PAGE).pipe(res);
      return true;
    }
    if (req.method === "GET" && url.pathname.startsWith("/ui/")) {
      // Sirve cualquier archivo de chat/ui/, incluidas SUBCARPETAS (fuentes/,
      // iconos/). Antes se usaba path.basename(), que aplana la ruta, y solo se
      // permitian .js y .css: una fuente daba 404. fileInside impide salir de ui/.
      let rel = url.pathname.slice("/ui/".length);
      try {
        rel = decodeURIComponent(rel);
      } catch {
        /* un % suelto en el nombre: se usa tal cual, que es como está en disco */
      }
      const abs = fileInside(path.join(ctx.HERE, "ui"), rel);
      const ext = abs ? path.extname(abs).toLowerCase() : "";
      if (!abs || !UI_SERVIDOS.has(ext) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        res.writeHead(404).end("no está");
        return true;
      }
      // Fuentes e imagenes no cambian entre versiones: se cachean de verdad.
      // El codigo (.js/.css) va sin cache para que al editarlo se vea al recargar.
      const estable = ext === ".woff2" || ext === ".woff" || ext === ".png" || ext === ".svg";
      res.writeHead(200, {
        "Content-Type": TYPES[ext] || "application/octet-stream",
        "Cache-Control": estable ? "public, max-age=604800, immutable" : "no-store",
      });
      fs.createReadStream(abs).pipe(res);
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/gpu") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(await readGpu()));
      return true;
    }
    if (req.method === "GET" && (url.pathname.startsWith("/salida/") || url.pathname.startsWith("/p/"))) {
      const fromProject = url.pathname.startsWith("/p/");
      const rawPath = url.pathname.slice(fromProject ? "/p/".length : "/salida/".length);
      const root = fromProject ? ctx.workspaceRoot : ctx.SALIDA;
      let rel = rawPath;
      try { rel = decodeURIComponent(rawPath); } catch { rel = rawPath; }
      if (fromProject && rel.split("/").map((part) => part.replace(/[. ]+$/, "").toLowerCase()).some((part) => part === ".git" || part.startsWith(".env"))) {
        res.writeHead(404).end("no está");
        return true;
      }
      const abs = fileInside(root, rel);
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        res.writeHead(404).end("no está");
        return true;
      }
      const type = TYPES[path.extname(abs).toLowerCase()] || "application/octet-stream";
      /** @type {Record<string, string>} */
      const headers = { "Content-Type": type, "X-Content-Type-Options": "nosniff" };
      // HTML/SVG de artefactos se abren a veces en una pestaña. Con `sandbox` el
      // documento recibe un origen opaco: sus scripts pueden correr, pero fetch/XHR
      // contra /api/* es cross-origin y el navegador lo bloquea. El iframe inline
      // conserva además su propio sandbox. Los recursos relativos del artefacto
      // dejan de cargarse: es el precio de no ejecutar contenido no confiable en el
      // origen del IDE.
      if (type.startsWith("text/html") || type === "image/svg+xml") {
        headers["Content-Security-Policy"] = "sandbox allow-scripts";
        headers["Referrer-Policy"] = "no-referrer";
      }
      res.writeHead(200, headers);
      fs.createReadStream(abs).pipe(res);
      return true;
    }
    return false;
  };
}
