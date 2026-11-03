/** Contrato público: OpenAPI generado desde los esquemas Zod. */
export function createContractRoutes(ctx) {
  return async function handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/openapi.json") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(await ctx.openapi()));
      return true;
    }
    return false;
  };
}
