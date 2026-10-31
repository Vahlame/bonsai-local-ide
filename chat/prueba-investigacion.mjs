import assert from "node:assert/strict";
import http from "node:http";
import { buscarWeb, descargarWeb, extraerPagina, leerWeb, resultadosBusqueda } from "./investigacion.mjs";
import { nativeToolEffects, PC_TOOLS } from "./actions.mjs";

// El orden de atributos en DuckDuckGo cambia; no debe convertir resultados reales en vacíos.
const html = '<a href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.org%2Fdocs" class="result__a">Documentación &amp; API</a><div class="result__snippet">Fuente original</div>';
assert.deepEqual(resultadosBusqueda(html, "duckduckgo"), [{ titulo: "Documentación & API", url: "https://example.org/docs", resumen: "Fuente original" }]);
const rss = '<rss><channel><item><title><![CDATA[Documentación]]></title><link>https://example.org/api</link><description>API oficial</description></item></channel></rss>';
let intentos = 0;
const fallback = JSON.parse(await buscarWeb("API oficial", { fetcher: async () => ++intentos === 1 ? new Response("captcha", { status: 403 }) : new Response(rss, { headers: { "content-type": "application/xml" } }) }));
assert.equal(fallback.proveedor, "bing-rss"); assert.equal(fallback.resultados[0].titulo, "Documentación");
await assert.rejects(buscarWeb("consulta", { fetcher: async () => new Response("verificación", { status: 200 }) }), /No se obtuvieron fuentes/);
const parsed = await extraerPagina('<title>Fuente</title><nav>MENU</nav><main><h1>Guía</h1><script>INSTRUCCION_OCULTA</script><p>A &lt; B &#x1F680;</p><a href="/api">API</a></main>', "https://example.org/docs");
assert.match(parsed.texto, /A < B 🚀/); assert.doesNotMatch(parsed.texto, /MENU|INSTRUCCION/);
assert.equal(parsed.enlaces[0].url, "https://example.org/api");
const effects = nativeToolEffects([{ id: "fuente", name: "leer_web", arguments: { url: "https://example.org/docs" } }]);
assert.equal(effects.webs.length, 1); assert.equal(effects.ids.get("web:0"), "fuente");
assert.ok(PC_TOOLS.some((t) => t.function.name === "leer_web"));

const server = http.createServer((req, res) => {
  if (req.url === "/privado") throw new Error("No debe llegar una petición al puerto protegido");
  if (req.url === "/redirect") return res.writeHead(302, { Location: "/fuente" }).end();
  if (req.url === "/loop") return res.writeHead(302, { Location: "/loop" }).end();
  if (req.url === "/bin") return res.writeHead(200, { "content-type": "application/octet-stream" }).end("BIN");
  if (req.url === "/lento") return;
  if (req.url === "/grande") return res.writeHead(200, { "content-type": "text/plain" }).end("A".repeat(5000));
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end('<title>Fuente técnica</title><main><h1>Referencia real</h1><p>Texto de la fuente</p></main>');
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const allowPrivate = { allowPrivate: true };
try {
  const page = JSON.parse(await leerWeb({ url: `${base}/redirect` }, allowPrivate));
  assert.equal(page.url, `${base}/fuente`); assert.equal(page.titulo, "Fuente técnica");
  assert.match(page.texto, /Referencia real/); assert.match(page.aviso, /no confiables/);
  const range = JSON.parse(await leerWeb({ url: `${base}/grande`, desde: 300, caracteres: 200 }, allowPrivate));
  assert.equal(range.texto.length, 200); assert.equal(range.siguiente, 500);
  const bounded = await descargarWeb(`${base}/grande`, { maxBytes: 500, allowPrivate: true });
  assert.equal(bounded.text.length, 500); assert.equal(bounded.truncado, true);
  await assert.rejects(descargarWeb(`${base}/loop`, allowPrivate), /redirecciones/);
  await assert.rejects(leerWeb({ url: `${base}/bin` }, allowPrivate), /Contenido application\/octet-stream/);
  await assert.rejects(leerWeb({ url: "file:///C:/Windows/win.ini" }), /http\/https/);
  await assert.rejects(descargarWeb(`${base}/lento`, { timeoutMs: 30, allowPrivate: true }), /timeout|aborted/i);
  const port = server.address().port;
  await assert.rejects(leerWeb({ url: `${base}/privado` }, { blockedPorts: [port], allowPrivate: true }), /puerto pertenece al IDE/);
  await assert.rejects(descargarWeb("https://example.org/redirect", { blockedPorts: [port], fetcher: async () => new Response(null, { status: 302, headers: { location: `${base}/privado` } }), allowPrivate: true }), /puerto pertenece al IDE/);
  // P2-19: direcciones privadas/loopback/metadatos bloqueadas por defecto
  await assert.rejects(descargarWeb("http://127.0.0.1:9999/"), /Dirección privada\/loopback\/metadatos no permitida/);
  await assert.rejects(descargarWeb("http://10.0.0.1/"), /Dirección privada\/loopback\/metadatos no permitida/);
  await assert.rejects(descargarWeb("http://192.168.1.1/"), /Dirección privada\/loopback\/metadatos no permitida/);
  await assert.rejects(descargarWeb("http://172.16.0.1/"), /Dirección privada\/loopback\/metadatos no permitida/);
  await assert.rejects(descargarWeb("http://169.254.169.254/"), /Endpoint de metadatos de nube no permitido/);
  await assert.rejects(descargarWeb("http://metadata.google.internal/"), /Endpoint de metadatos de nube no permitido/);
  // Con allowPrivate=true se permiten (test usa fixture local)
  const ok = await descargarWeb(`${base}/fuente`, { allowPrivate: true });
  assert.ok(ok.text.includes("Referencia real"));
  console.log("Investigación: los puertos del IDE/modelo se protegen también tras redirecciones; otras APIs locales siguen disponibles.");
  console.log("Investigación: búsqueda con fallback, lectura, fuentes, paginación, redirecciones, límites y cancelación verificados.");
} finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
