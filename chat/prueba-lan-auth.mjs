/** LAN segura: sin flag/token no se expone; con token se exige en toda la API. */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "./server/http.mjs";
import { revisarPeticion } from "./guardia.mjs";

const TOKEN = "secreto-local-123456";
assert.throws(() => parseArgs(["--host", "0.0.0.0"]), /--unsafe-lan/);
assert.throws(() => parseArgs(["--host", "0.0.0.0", "--unsafe-lan"]), /token/);
const lan = parseArgs(["--host", "0.0.0.0", "--unsafe-lan", "--token", TOKEN]);
assert.equal(lan.unsafeLan, true);
assert.equal(lan.token, TOKEN);
assert.equal(parseArgs([]).token, "");
assert.equal(parseArgs(["--token", TOKEN]).token, TOKEN, "loopback también puede exigir token");

const conToken = { host: "127.0.0.1", port: 8787, token: TOKEN };
const pide = (headers, url = "/api/state") => revisarPeticion({ method: "GET", headers: { host: "127.0.0.1:8787", ...headers }, url }, conToken);
assert.equal(pide({}).ok, false);
assert.equal(pide({}).status, 401);
assert.equal(pide({ "x-bonsai-token": TOKEN }).ok, true);
assert.equal(pide({ authorization: `Bearer ${TOKEN}` }).ok, true);
assert.equal(pide({ cookie: `a=1; bonsai_token=${TOKEN}` }).ok, true);
assert.equal(pide({}, `/?token=${TOKEN}`).ok, true, "el arranque de la página acepta ?token=");
assert.equal(pide({}, `/api/state?token=${TOKEN}`).ok, false, "la API no acepta token en la URL");
assert.equal(pide({ "x-bonsai-token": `${TOKEN}x` }).ok, false);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-lan-auth-"));
const estado = path.join(tmp, "estado");
fs.mkdirSync(estado);
const puerto = await new Promise((resolve) => {
  const s = http.createServer();
  s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
});
const hijo = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(puerto), "--llama-port", "18079", "--token", TOKEN], {
  env: { ...process.env, BONSAI_STATE: estado, BONSAI_SALIDA: path.join(tmp, "salida") },
  stdio: "ignore",
  windowsHide: true,
});
const base = `http://127.0.0.1:${puerto}`;
try {
  let listo = false;
  for (let i = 0; i < 80 && hijo.exitCode === null; i += 1) {
    try { if ((await fetch(`${base}/api/stats`, { headers: { "X-Bonsai-Token": TOKEN } })).status === 200) { listo = true; break; } } catch { /* arrancando */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(listo, "el servidor con token debe arrancar");
  assert.equal((await fetch(`${base}/`)).status, 401, "sin token no se sirve ni la página");
  const arranque = await fetch(`${base}/?token=${TOKEN}`, { redirect: "manual" });
  assert.equal(arranque.status, 200);
  const cookie = String(arranque.headers.get("set-cookie") || "");
  assert.match(cookie, /bonsai_token=/);
  assert.equal((await fetch(`${base}/api/stats`, { headers: { cookie: cookie.split(";")[0] } })).status, 200, "la cookie de sesión vale para la API");
  assert.equal((await fetch(`${base}/api/stats`)).status, 401);
  console.log("LAN auth: flag, token, cookie de arranque y rechazo sin token verificados.");
} finally {
  if (hijo.exitCode === null) { hijo.kill(); await new Promise((resolve) => hijo.once("exit", resolve)); }
  fs.rmSync(tmp, { recursive: true, force: true });
}
