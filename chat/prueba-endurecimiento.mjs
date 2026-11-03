/**
 * Regresiones de la revisión senior 2026-11-02 (2.5.1): secretos, tool calls
 * del perfil PC, fallback de redirecciones del Hub, índice por raíz y retención.
 *
 *   node chat/prueba-endurecimiento.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { commandAllowed, nativeToolEffects, resolveInside } from "./actions.mjs";
import { describirLectura } from "./lecturas.mjs";
import { PC_TOOLS, validateToolCall } from "./tool-registry.mjs";
import { cabeceraRemota, parsearOrigenHf } from "./model-hub/remote.mjs";
import { createSymbolIndex } from "./server/services/symbol-index.mjs";
import { podarSesion } from "./session-store.mjs";
import { podarDirectorio } from "./retencion.mjs";
import { esComandoSensible, esRutaSensible } from "./rutas-sensibles.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-endurecimiento-"));
try {
  // --- rutas y comandos sensibles -----------------------------------------
  assert.equal(esRutaSensible(".env"), true);
  assert.equal(esRutaSensible(".env.local"), true);
  assert.equal(esRutaSensible(".env.example"), false);
  assert.equal(esRutaSensible("sub/.env.example"), false);
  assert.equal(esRutaSensible(".git/config"), true);
  assert.equal(esRutaSensible("deploy.key"), true);
  assert.equal(esRutaSensible("src/app.js"), false);
  assert.throws(() => resolveInside(root, ".env"), /protegida|no permitida|fuera del proyecto/);
  assert.throws(() => resolveInside(root, "id_rsa"), /protegida|no permitida|fuera del proyecto/);
  assert.throws(() => resolveInside(root, ".git/config"), /protegida|no permitida|fuera del proyecto/);
  assert.match(describirLectura({ root, clave: ".env" }), /protegida/);
  assert.equal(describirLectura({ root, clave: "src/app.js" }).includes("no existe"), true);
  assert.equal(commandAllowed("type .env"), false);
  assert.equal(commandAllowed("cat .env.local"), false);
  assert.equal(commandAllowed("node -e \"require('fs').readFileSync('.env')\""), false);
  assert.equal(commandAllowed("node app.js"), true);
  assert.equal(esComandoSensible("Get-Content .env"), true);
  assert.equal(esComandoSensible("npm test"), false);

  // --- allowPrivate enviado por el modelo se descarta ---------------------
  const effects = nativeToolEffects([{
    id: "web1",
    name: "leer_web",
    arguments: { url: "https://example.org/docs", desde: 10, caracteres: 200, allowPrivate: true },
  }]);
  assert.equal(effects.webs.length, 1);
  assert.equal(Object.hasOwn(effects.webs[0], "allowPrivate"), false);
  assert.deepEqual(effects.webs[0], { url: "https://example.org/docs", desde: 10, caracteres: 200 });
  const validada = validateToolCall({ name: "leer_web", arguments: { url: "https://example.org", allowPrivate: true } }, PC_TOOLS);
  assert.equal(validada.ok, true);
  assert.equal(Object.hasOwn(validada.args, "allowPrivate"), false);

  // --- cabeceraRemota no sigue un 302 privado en el fallback ---------------
  const llamadas = [];
  const fetcher = async (url, init) => {
    llamadas.push({ url: String(url), redirect: init?.redirect });
    if (init?.method === "HEAD") return new Response(null, { status: 405 });
    return new Response(null, { status: 302, headers: { location: "http://127.0.0.1:1/privado.gguf" } });
  };
  let bloqueado = "";
  try {
    await cabeceraRemota("https://example.com/modelo.gguf", {
      allowPrivate: false,
      allowHttp: true,
      fetcher,
      resolver: async () => [{ address: "93.184.216.34" }],
    });
  } catch (err) {
    bloqueado = err.message;
  }
  assert.match(bloqueado, /privada|loopback|no permitida/i);
  assert.ok(llamadas.length >= 2, "el fallback debe probar HEAD y GET");
  assert.ok(llamadas.every((llamada) => llamada.redirect === "manual"), JSON.stringify(llamadas));

  // --- hf:// ---------------------------------------------------------------
  assert.deepEqual(parsearOrigenHf("hf://owner/repo/modelo.gguf"), { repo: "owner/repo", archivo: "modelo.gguf", revision: "main" });
  assert.deepEqual(parsearOrigenHf("hf://owner/repo@v1/modelo.gguf"), { repo: "owner/repo", archivo: "modelo.gguf", revision: "v1" });
  assert.deepEqual(parsearOrigenHf("https://huggingface.co/owner/repo/resolve/main/modelo.gguf"), { repo: "owner/repo", archivo: "modelo.gguf", revision: "main" });
  assert.equal(parsearOrigenHf("https://example.com/modelo.gguf"), null);

  // --- índice cacheado por raíz --------------------------------------------
  let raiz = "A";
  const indexados = [];
  const indice = createSymbolIndex({
    getRoot: () => raiz,
    indexar: (r) => { indexados.push(r); return new Map([[`simbolo-${r}`, []]]); },
    snapshot: () => new Map([["x.txt", "1:1"]]),
    ttlMs: 60_000,
  });
  assert.deepEqual([...(await indice.get()).keys()], ["simbolo-A"]);
  raiz = "B";
  assert.deepEqual([...(await indice.get()).keys()], ["simbolo-B"]);
  assert.deepEqual(indexados, ["A", "B"]);

  // --- retención de sesión -------------------------------------------------
  const turns = Array.from({ length: 1300 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `turno ${i}` }));
  const podada = podarSesion({ memory: "", folded: 0, turns, draft: "", files: [] }).session;
  assert.equal(podada.turns.length, 1200);
  assert.equal(podada.turns.at(-1).content, "turno 1299");
  const huerfano = podarSesion({ turns: Array.from({ length: 1201 }, (_, i) => ({ role: i === 0 ? "tool" : "user", content: `t${i}` })) }).session;
  assert.notEqual(huerfano.turns[0]?.role, "tool");

  // --- retención de logs/trazas -------------------------------------------
  const ret = path.join(root, "retencion");
  fs.mkdirSync(ret, { recursive: true });
  fs.writeFileSync(path.join(ret, "viejo.log"), "viejo");
  fs.writeFileSync(path.join(ret, "nuevo.log"), "nuevo");
  const hace40dias = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
  fs.utimesSync(path.join(ret, "viejo.log"), hace40dias, hace40dias);
  const poda = podarDirectorio(ret, { maxAgeMs: 30 * 24 * 60 * 60 * 1000, maxFiles: 10 });
  assert.equal(poda.borrados, 1);
  assert.equal(fs.existsSync(path.join(ret, "viejo.log")), false);
  assert.equal(fs.existsSync(path.join(ret, "nuevo.log")), true);

  console.log("prueba-endurecimiento: OK");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
