/**
 * Pruebas de la guardia anti-CSRF / anti-DNS-rebinding:
 *   node chat/prueba-seguridad.mjs
 *
 * Parte 1: logica pura de `chat/guardia.mjs` (sin red).
 * Parte 2: integracion de verdad: arranca `ui-server.mjs` en un puerto libre con
 *          estado temporal y comprueba que una peticion con Origin ajeno recibe 403
 *          mientras que una peticion legitima sigue funcionando.
 * No toca la GPU, ni los chats del usuario, ni la carpeta de trabajo real.
 */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { revisarPeticion, hostsPermitidos } from "./guardia.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** @type {string[]} */
const failures = [];
/**
 * @param {string} name
 * @param {boolean} cond
 */
const check = (name, cond) => {
  if (!cond) failures.push(name);
};

const ARGS = { host: "127.0.0.1", port: 8787 };
/**
 * @param {string} method
 * @param {Record<string, string>} headers
 */
const pide = (method, headers) => revisarPeticion({ method, headers }, ARGS);

// ---------------------------------------------------------------- parte 1
{
  for (const h of ["127.0.0.1:8787", "localhost:8787", "[::1]:8787", "LOCALHOST:8787", "localhost.:8787"]) {
    check(`Host propio aceptado (${h})`, pide("GET", { host: h }).ok);
  }
  for (const h of ["evil.com:8787", "127.0.0.1:9999", "localhost", "", "127.0.0.1:8787.evil.com"]) {
    check(`Host ajeno rechazado (${h || "(vacio)"})`, !pide("GET", { host: h }).ok);
  }
  check("falta Host => rechazado", !pide("GET", {}).ok);

  check("GET sin Origin => aceptado (curl/evaluador)", pide("GET", { host: "127.0.0.1:8787" }).ok);
  check("POST sin Origin y sin cuerpo => aceptado (POST /api/reset)", pide("POST", { host: "127.0.0.1:8787", "content-length": "0" }).ok);
  check("Origin identico => aceptado", pide("POST", { host: "127.0.0.1:8787", origin: "http://127.0.0.1:8787", "content-type": "application/json", "content-length": "2" }).ok);
  check("Origin con localhost => aceptado", pide("POST", { host: "localhost:8787", origin: "http://localhost:8787", "content-type": "application/json", "content-length": "2" }).ok);
  check("Origin ajeno => rechazado", !pide("POST", { host: "127.0.0.1:8787", origin: "http://evil.com", "content-type": "application/json", "content-length": "2" }).ok);
  check("Origin null (iframe sandbox / file://) => rechazado", !pide("POST", { host: "127.0.0.1:8787", origin: "null", "content-type": "application/json", "content-length": "2" }).ok);
  check("Origin en otro puerto => rechazado", !pide("POST", { host: "127.0.0.1:8787", origin: "http://127.0.0.1:9999", "content-type": "application/json", "content-length": "2" }).ok);

  check("POST con cuerpo y text/plain => rechazado (vector CSRF)", !pide("POST", { host: "127.0.0.1:8787", "content-type": "text/plain", "content-length": "10" }).ok);
  check("POST con cuerpo y formulario => rechazado (vector CSRF)", !pide("POST", { host: "127.0.0.1:8787", "content-type": "application/x-www-form-urlencoded", "content-length": "10" }).ok);
  check("POST con cuerpo sin Content-Type => rechazado", !pide("POST", { host: "127.0.0.1:8787", "content-length": "10" }).ok);
  check("POST con application/json limpio => aceptado", pide("POST", { host: "127.0.0.1:8787", "content-type": "application/json", "content-length": "10" }).ok);
  check("POST con application/json; charset=utf-8 => aceptado", pide("POST", { host: "127.0.0.1:8787", "content-type": "application/json; charset=utf-8", "content-length": "10" }).ok);
  check("POST con transfer-encoding => se exige JSON", !pide("POST", { host: "127.0.0.1:8787", "transfer-encoding": "chunked", "content-type": "text/plain" }).ok);
  check("POST con cuerpo y Host ajeno => rechazado (rebinding)", !pide("POST", { host: "evil.com:8787", origin: "http://evil.com:8787", "content-type": "application/json", "content-length": "2" }).ok);

  const lan = hostsPermitidos({ host: "0.0.0.0", port: 8787 });
  check("bind 0.0.0.0: sigue aceptando loopback", lan.has("127.0.0.1:8787") && lan.has("localhost:8787"));
  const soloLocal = hostsPermitidos({ host: "127.0.0.1", port: 9000 });
  check("bind loopback: el puerto manda", soloLocal.has("127.0.0.1:9000") && !soloLocal.has("127.0.0.1:8787"));
}

// ---------------------------------------------------------------- parte 2
/**
 * Peticion cruda para poder falsear cabeceras que `fetch` no deja tocar (Host).
 * @param {number} port
 * @param {{method: string, path: string, headers: Record<string, string>, body?: string}} opciones
 * @returns {Promise<{status: number, body: string}>}
 */
function crudo(port, opciones) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: opciones.method, path: opciones.path, headers: opciones.headers, setHost: false },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
      },
    );
    req.on("error", reject);
    if (opciones.body) req.write(opciones.body);
    req.end();
  });
}

/**
 * @param {number} port
 * @param {number} intentos
 */
async function esperar(port, intentos = 60) {
  for (let i = 0; i < intentos; i += 1) {
    try {
      const r = await crudo(port, { method: "GET", path: "/api/gpu", headers: { host: `127.0.0.1:${port}` } });
      if (r.status === 200) return true;
    } catch {
      /* todavia no escucha */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

const PUERTO = 8792;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-seg-"));
// llama-server de mentira: ui-server.mjs hace connect() (/health, /props, /v1/models)
// ANTES de ponerse a escuchar, así que sin un servidor en --llama-port no arranca. Antes
// aquí ponía 8080 a pelo y, sin el modelo cargado, las 32 comprobaciones se quedaban en
// una sola en rojo ("el servidor de pruebas arranca"). Mismo patrón que prueba-api.mjs.
const falsoLlama = http.createServer((req, res) => {
  const url = req.url || "";
  const json = (body) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url === "/health") return json({ status: "ok" });
  if (url === "/props") return json({ default_generation_settings: { n_ctx: 32768 }, modalities: { vision: false } });
  if (url === "/v1/models") return json({ data: [{ id: "falso" }] });
  res.writeHead(404, { "Content-Type": "application/json" }).end("{}");
});
await new Promise((resolve) => falsoLlama.listen(0, "127.0.0.1", () => resolve(undefined)));
const puertoLlama = /** @type {import("node:net").AddressInfo} */ (falsoLlama.address()).port;

const hijo = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(PUERTO), "--llama-port", String(puertoLlama)], {
  cwd: HERE,
  env: { ...process.env, BONSAI_STATE: path.join(tmp, "estado"), BONSAI_SALIDA: path.join(tmp, "salida") },
  stdio: "ignore",
});

try {
  const vivo = await esperar(PUERTO);
  check("el servidor de pruebas arranca", vivo);
  if (vivo) {
    const host = { host: `127.0.0.1:${PUERTO}` };

    const legitimo = await crudo(PUERTO, { method: "GET", path: "/api/gpu", headers: host });
    check("integracion: GET legitimo => 200", legitimo.status === 200);

    const csrfGet = await crudo(PUERTO, { method: "GET", path: "/api/gpu", headers: { ...host, origin: "http://evil.com" } });
    check("integracion: GET con Origin ajeno => 403", csrfGet.status === 403);

    const csrfPost = await crudo(PUERTO, {
      method: "POST",
      path: "/api/chat",
      headers: { ...host, origin: "http://evil.com", "content-type": "text/plain", "content-length": "2" },
      body: "{}",
    });
    check("integracion: POST CSRF a /api/chat => 403", csrfPost.status === 403);

    const rebinding = await crudo(PUERTO, { method: "GET", path: "/api/gpu", headers: { host: `evil.com:${PUERTO}` } });
    check("integracion: Host ajeno (DNS rebinding) => 403", rebinding.status === 403);

    const resetSinCuerpo = await crudo(PUERTO, { method: "POST", path: "/api/reset", headers: { ...host, "content-length": "0" } });
    // /api/reset responde 204 (No Content) y NO manda Content-Type: es justo el caso
    // que un requisito global de application/json romperia. Lo que se comprueba es
    // que la guardia no lo bloquea.
    check("integracion: POST /api/reset sin cuerpo sigue funcionando", resetSinCuerpo.status === 204);

    const postJson = await crudo(PUERTO, {
      method: "POST",
      path: "/api/permit",
      headers: { ...host, "content-type": "application/json", "content-length": "14" },
      body: '{"mode":"ask"}',
    });
    check("integracion: POST /api/permit con JSON sigue funcionando", postJson.status === 200);
  }
} finally {
  hijo.kill();
  falsoLlama.close();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* da igual */
  }
}

if (failures.length) {
  console.error("FALLOS:");
  for (const f of failures) console.error(` - ${f}`);
  process.exit(1);
}
console.log("prueba seguridad ok");
