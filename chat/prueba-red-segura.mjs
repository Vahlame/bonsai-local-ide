#!/usr/bin/env node
/** Pruebas de la política SSRF: IPs, DNS y redirecciones. */
import assert from "node:assert/strict";
import http from "node:http";
import { esHostMetadata, esIpPrivada, fetchRemoto, validarUrlRemota } from "./red-segura.mjs";

const publico = async () => [{ address: "93.184.216.34" }];
const privado = async () => [{ address: "127.0.0.1" }];

assert.equal(esHostMetadata("169.254.169.254"), true);
assert.equal(esHostMetadata("metadata.google.internal"), true);
assert.equal(esIpPrivada("127.0.0.1"), true);
assert.equal(esIpPrivada("10.0.0.1"), true);
assert.equal(esIpPrivada("172.16.0.1"), true);
assert.equal(esIpPrivada("192.168.1.1"), true);
assert.equal(esIpPrivada("169.254.169.254"), true);
assert.equal(esIpPrivada("100.64.0.1"), true);
assert.equal(esIpPrivada("::1"), true);
assert.equal(esIpPrivada("fd00::1"), true);
assert.equal(esIpPrivada("fe80::1"), true);
assert.equal(esIpPrivada("::ffff:127.0.0.1"), true);
assert.equal(esIpPrivada("::ffff:7f00:1"), true);
assert.equal(esIpPrivada("::ffff:c0a8:101"), true);
assert.equal(esIpPrivada("::127.0.0.1"), true);
assert.equal(esIpPrivada("93.184.216.34"), false);
assert.equal(esIpPrivada("::ffff:5db8:d822"), false);
assert.equal(esIpPrivada("2606:4700:4700::1111"), false);

await assert.rejects(validarUrlRemota("http://example.com", { resolver: publico }), /HTTPS/);
await assert.rejects(validarUrlRemota("https://user:pass@example.com", { resolver: publico }), /credenciales/);
await assert.rejects(validarUrlRemota("https://evil.test", { resolver: privado }), /privada/);
await assert.rejects(validarUrlRemota("https://169.254.169.254", { allowPrivate: true }), /metadatos/);
const ok = await validarUrlRemota("https://example.com", { resolver: publico });
assert.equal(ok.hostname, "example.com");

let llamadas = 0;
const redirigeAPrivado = async () => {
  llamadas += 1;
  return new Response(null, { status: 302, headers: { location: "https://interno.test/robo" } });
};
await assert.rejects(
  fetchRemoto("https://example.com", {}, { resolver: async (host) => host === "interno.test" ? [{ address: "127.0.0.1" }] : publico(), fetcher: redirigeAPrivado }),
  /privada/,
);
assert.equal(llamadas, 1, "no debe llamar al host privado");

let saltos = 0;
const redirigeBien = async () => {
  saltos += 1;
  if (saltos === 1) return new Response(null, { status: 302, headers: { location: "https://cdn.example.com/modelo.gguf" } });
  return new Response("ok", { status: 200 });
};
const final = await fetchRemoto("https://example.com", {}, { resolver: publico, fetcher: redirigeBien });
assert.equal(final.status, 200);
assert.equal(saltos, 2);

// La conexión debe ir a la IP comprobada, no volver a resolver el nombre. El
// host `falso.test` no existe en DNS: si se resolviera de nuevo, fallaría.
const servidor = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(`host=${req.headers.host}`);
});
await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
const puerto = servidor.address().port;
try {
  const fijado = await fetchRemoto(`http://falso.test:${puerto}/x`, {}, {
    allowPrivate: true,
    allowHttp: true,
    resolver: async () => [{ address: "127.0.0.1" }],
  });
  assert.equal(fijado.status, 200);
  assert.equal(await fijado.text(), `host=falso.test:${puerto}`);
  assert.equal(fijado.url, `http://falso.test:${puerto}/x`);
} finally {
  await new Promise((resolve) => servidor.close(resolve));
}

process.stdout.write("red-segura: SSRF, DNS, redirecciones y fijación de IP verificados.\n");
