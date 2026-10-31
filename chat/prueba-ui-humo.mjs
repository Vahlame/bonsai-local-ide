/**
 * Prueba de HUMO de la interfaz con Playwright/Edge (sin GPU, sin modelo real):
 *   node chat/prueba-ui-humo.mjs
 *
 * Levanta un llama-server SIMULADO y un `ui-server.mjs` real con estado y proyecto
 * TEMPORALES (BONSAI_STATE / BONSAI_SALIDA a os.tmpdir()), carga la página y comprueba:
 *   · que la UI arranca sin errores de consola y pinta explorador/editor;
 *   · que chat/ui/chat-core.js se carga como script clásico (extracción de index.html);
 *   · que Ajustes enseña el presupuesto real de contexto (ventana, solicitado,
 *     efectivo y reserva de salida: hallazgo 16);
 *   · Ctrl+K de punta a punta: propuesta, Aceptar y guardado con `before` = base;
 *   · que si el archivo cambia en disco antes de aceptar, el 409 conserva lo del disco
 *     y NO sobrescribe (hallazgo 8).
 *
 * No usa el modelo ni la GPU de verdad. tarda unos segundos.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.dirname(HERE);

const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find((ruta) => fs.existsSync(ruta));
if (!EDGE) {
  console.error("prueba ui humo: no encontré Edge ni Chrome.");
  process.exit(1);
}

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

/** @type {string[]} */
const fallos = [];
/**
 * @param {string} nombre
 * @param {() => boolean} cond
 * @param {string} [detalle]
 */
const check = (nombre, cond, detalle = "") => {
  if (cond) {
    process.stdout.write(`ok ${nombre}\n`);
  } else {
    fallos.push(`${nombre}${detalle ? ` (${detalle})` : ""}`);
    process.stderr.write(`FALLO ${nombre}${detalle ? ` (${detalle})` : ""}\n`);
  }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-ui-humo-"));
const estado = path.join(tmp, "estado");
const proyecto = path.join(tmp, "proyecto");
const salida = path.join(tmp, "salida");
fs.mkdirSync(estado, { recursive: true });
fs.mkdirSync(proyecto, { recursive: true });
fs.writeFileSync(path.join(estado, "ui-workspace.json"), JSON.stringify({ path: proyecto }));
fs.writeFileSync(path.join(estado, "ui-settings.json"), JSON.stringify({ historial: 8192, pensar: 0, reglas: false }));
fs.writeFileSync(path.join(estado, "ui-permit.json"), JSON.stringify({ mode: "ask" }));
fs.writeFileSync(path.join(proyecto, "x.txt"), "uno\ndos\ntres\n", "utf8");
fs.writeFileSync(path.join(proyecto, "y.txt"), "alfa\r\nbeta\r\n", "utf8");
fs.writeFileSync(path.join(proyecto, "nota.md"), "# nota\r\n", "utf8");

let peticionesChat = 0;
/** Respuesta del modelo para /api/edit (tool_choice "none"). */
const REEMPLAZO_X = "UNO";
const falsoLlama = http.createServer((req, res) => {
  const url = req.url || "";
  const json = (cuerpo) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(cuerpo));
  };
  if (url === "/health") return json({ status: "ok" });
  if (url === "/props") {
    return json({
      default_generation_settings: { n_ctx: 16384 },
      modalities: { vision: false },
      model_path: path.join(RAIZ, "models", "Ornith-1.5-9B-Q4_K_M.gguf"),
    });
  }
  if (url === "/v1/models") return json({ data: [{ id: "falso.gguf" }] });
  let bruto = "";
  req.on("data", (trozo) => (bruto += trozo));
  req.on("end", () => {
    let cuerpo = {};
    try {
      cuerpo = bruto ? JSON.parse(bruto) : {};
    } catch {
      cuerpo = {};
    }
    if (url === "/v1/chat/completions/input_tokens") return json({ input_tokens: 100 });
    if (url !== "/v1/chat/completions") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }
    peticionesChat += 1;
    if (!cuerpo.stream) return json({ choices: [{ message: { content: "resumen" } }] });
    const contenido = cuerpo.tool_choice === "none" ? REEMPLAZO_X : "Listo.";
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const mandar = (delta, finish = null) => {
      res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }] })}\n\n`);
    };
    mandar({ reasoning_content: "Reviso el pedido local. <b>dato literal</b>" });
    mandar({ content: contenido });
    mandar({}, "stop");
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2 } })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
});
falsoLlama.listen(0, "127.0.0.1");
await once(falsoLlama, "listening");
const puertoLlama = /** @type {import("node:net").AddressInfo} */ (falsoLlama.address()).port;

// Puerto libre para el ui-server (se reserva y se suelta).
const sonda = http.createServer();
sonda.listen(0, "127.0.0.1");
await once(sonda, "listening");
const puertoUi = /** @type {import("node:net").AddressInfo} */ (sonda.address()).port;
await new Promise((resolver) => sonda.close(resolver));

let logServidor = "";
const servidor = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(puertoUi), "--llama-port", String(puertoLlama)], {
  cwd: RAIZ,
  env: { ...process.env, BONSAI_STATE: estado, BONSAI_SALIDA: salida },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
servidor.stdout.on("data", (trozo) => (logServidor += trozo));
servidor.stderr.on("data", (trozo) => (logServidor += trozo));

const url = `http://127.0.0.1:${puertoUi}/`;
let navegador = null;
/** @type {import("playwright-core").Page | null} */
let pagina = null;
try {
  let listo = false;
  for (let i = 0; i < 150; i += 1) {
    if (servidor.exitCode !== null) throw new Error(`el ui-server terminó antes de arrancar:\n${logServidor}`);
    try {
      const res = await fetch(`${url}api/state`, { signal: AbortSignal.timeout(500) });
      if (res.ok) {
        listo = true;
        break;
      }
    } catch {
      /* aún arrancando */
    }
    await esperar(100);
  }
  assert.ok(listo, `el ui-server no arrancó:\n${logServidor}`);

  navegador = await chromium.launch({ executablePath: EDGE, headless: true });
  pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 } });
  /** @type {string[]} */
  const erroresConsola = [];
  pagina.on("console", (mensaje) => {
    if (mensaje.type() !== "error") return;
    const texto = mensaje.text();
    // El 404 del favicon no es un fallo de la aplicación: el servidor no lo sirve.
    const origen = mensaje.location()?.url || "";
    if (/favicon\.ico/i.test(texto) || /favicon\.ico/i.test(origen)) return;
    // El 409 de /api/file es el caso que se prueba a propósito (hallazgo 8): el
    // navegador lo apunta como error de red aunque la aplicación lo trate bien.
    if (/\/api\/file/.test(origen) && /409/.test(texto)) return;
    erroresConsola.push(`${texto}${origen ? ` @ ${origen}` : ""}`);
  });
  pagina.on("pageerror", (error) => erroresConsola.push(`pageerror: ${error.message}`));

  await pagina.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await pagina.waitForSelector("#tree .row", { timeout: 15000 });
  const logo = await fetch(`http://127.0.0.1:${puertoUi}/ui/iconos/modelos/qwen-color.svg`);
  check("los logos del Hub se sirven en local", logo.status === 200 && String(logo.headers.get("content-type") || "").includes("image/svg+xml"), `HTTP ${logo.status}`);

  // ---- 1. La UI pinta y chat-core.js se cargó como script clásico ----
  check("la página carga sin errores de consola", erroresConsola.length === 0, erroresConsola.slice(0, 3).join(" | "));
  check("index.html carga chat/core como script externo", await pagina.evaluate(() => Boolean(document.querySelector('script[src="/ui/chat-core.js"]'))));
  check(
    "el núcleo global sigue disponible para app.js",
    await pagina.evaluate(() => typeof window.loadState === "function" && typeof window.paintTree === "function" && typeof window.openFile === "function"),
  );
  check("el explorador pinta los archivos", (await pagina.locator("#tree .row").count()) === 3);
  check("la barra de estado existe", await pagina.locator(".statusbar").isVisible());
  check("las pestañas y el editor están montados", (await pagina.locator(".tabs").count()) === 1 && (await pagina.locator(".editor-wrap").count()) === 1);

  // ---- 2. Ctrl+K de punta a punta: propuesta, diff, Aceptar y guardar ----
  await pagina.locator("#tree .row .name", { hasText: "x.txt" }).click();
  const area = pagina.locator(".editor-wrap textarea");
  await pagina.waitForSelector(".editor-wrap:not([hidden]) textarea", { timeout: 10000 });
  check("abrir x.txt muestra su contenido", (await area.inputValue()).startsWith("uno\ndos"));
  await area.evaluate((nodo) => {
    nodo.focus();
    nodo.setSelectionRange(0, 3); // "uno"
  });
  await pagina.keyboard.press("Control+k");
  const dialogo = pagina.locator(".dialogo").last();
  await dialogo.locator("input").waitFor({ timeout: 10000 });
  await dialogo.locator("input").fill("ponlo en mayúsculas");
  await dialogo.getByRole("button", { name: "Editar" }).click();
  await pagina.waitForSelector("pre.diff-preview", { timeout: 20000 });
  const preview = pagina.locator("pre.diff-preview");
  check("Ctrl+K enseña el diff propuesto", (await preview.textContent()).includes("UNO"));
  check("Ctrl+K avisa del rango real", (await pagina.locator(".dialogo").last().textContent()).includes("rango real de líneas 1-1"));
  await pagina.getByRole("button", { name: "Aceptar y guardar" }).click();
  await pagina.waitForFunction(() => (document.querySelector(".avisos")?.textContent || "").includes("Editado x.txt"), null, { timeout: 20000 });
  const guardado = fs.readFileSync(path.join(proyecto, "x.txt"), "utf8");
  check("Ctrl+K guarda el reemplazo exacto", guardado === "UNO\ndos\ntres\n", JSON.stringify(guardado));
  check("el editor queda limpio tras guardar", await pagina.evaluate(() => {
    const t = document.querySelector(".tabs .tab-item.on");
    return Boolean(t) && !t.querySelector(".dirty");
  }));

  // ---- 2b. Guardar un archivo CRLF conserva los saltos de línea ----
  await pagina.locator("#tree .row .name", { hasText: "nota.md" }).click();
  await pagina.waitForFunction(() => (document.querySelector(".editor-wrap textarea")?.value || "").startsWith("# nota"), null, { timeout: 10000 });
  await pagina.locator(".editor-wrap textarea").fill("# nota\nnueva\n");
  await pagina.keyboard.press("Control+s");
  await pagina.waitForFunction(() => (document.querySelector(".avisos")?.textContent || "").includes("Guardado nota.md"), null, { timeout: 20000 });
  const notaGuardada = fs.readFileSync(path.join(proyecto, "nota.md"), "utf8");
  check("guardar un archivo CRLF conserva los saltos", notaGuardada === "# nota\r\nnueva\r\n", JSON.stringify(notaGuardada));

  // ---- 2c. El diálogo de borrado no acepta un Enter reflejo ----
  const filaNota = pagina.locator("#tree .row", { hasText: "nota.md" });
  await filaNota.click({ button: "right" });
  await pagina.locator(".menu button", { hasText: "Borrar" }).click();
  const dialogoBorrado = pagina.locator(".dialogo-fondo").last();
  await dialogoBorrado.waitFor({ timeout: 10000 });
  check(
    "el diálogo de borrado enfoca Cancelar",
    await dialogoBorrado.getByRole("button", { name: "Cancelar" }).evaluate((boton) => boton === document.activeElement),
  );
  await pagina.keyboard.press("Enter");
  await pagina.waitForFunction(() => !document.querySelector(".dialogo-fondo"), null, { timeout: 5000 });
  check("Enter en Cancelar no borra el archivo", fs.existsSync(path.join(proyecto, "nota.md")));

  await filaNota.click({ button: "right" });
  await pagina.locator(".menu button", { hasText: "Borrar" }).click();
  const dialogoBorrado2 = pagina.locator(".dialogo-fondo").last();
  await dialogoBorrado2.waitFor({ timeout: 10000 });
  await dialogoBorrado2.getByRole("button", { name: "Borrar" }).focus();
  await pagina.keyboard.press("Enter");
  await pagina.waitForFunction(() => !document.querySelector(".dialogo-fondo"), null, { timeout: 5000 });
  await esperar(200);
  check("Enter en Borrar borra el archivo", !fs.existsSync(path.join(proyecto, "nota.md")));

  // ---- 3. Hallazgo 8: el archivo cambia en disco antes de aceptar -> 409 sin pisar ----
  await pagina.locator("#tree .row .name", { hasText: "y.txt" }).click();
  await pagina.waitForFunction(() => (document.querySelector(".editor-wrap textarea")?.value || "").startsWith("alfa"), null, { timeout: 10000 });
  await pagina.locator(".editor-wrap textarea").evaluate((nodo) => {
    nodo.focus();
    nodo.setSelectionRange(0, 4); // "alfa"
  });
  await pagina.keyboard.press("Control+k");
  const dialogo2 = pagina.locator(".dialogo").last();
  await dialogo2.locator("input").waitFor({ timeout: 10000 });
  await dialogo2.locator("input").fill("ponlo en mayúsculas");
  await dialogo2.getByRole("button", { name: "Editar" }).click();
  await pagina.waitForSelector("pre.diff-preview", { timeout: 20000 });
  // El disco cambia DESPUÉS de que el servidor leyera la base y ANTES de aceptar.
  const externo = "CAMBIADO EXTERNO\r\nbeta\r\n";
  fs.writeFileSync(path.join(proyecto, "y.txt"), externo, "utf8");
  await pagina.getByRole("button", { name: "Aceptar y guardar" }).click();
  await pagina.waitForFunction(
    () => /cambi[oó] en disco|no se aplic[oó] nada|No se guard[oó] nada/i.test(document.querySelector(".avisos")?.textContent || ""),
    null,
    { timeout: 20000 },
  );
  check("409: el disco conserva el contenido externo", fs.readFileSync(path.join(proyecto, "y.txt"), "utf8") === externo);
  check(
    "409: el editor conserva lo del usuario y no lo pisa",
    (await pagina.locator(".editor-wrap textarea").inputValue()).startsWith("alfa\n"),
  );

  // ---- 3b. El compositor espera al estado inicial antes de aceptar envíos ----
  const paginaCarga = await navegador.newPage({ viewport: { width: 1440, height: 900 } });
  let liberarEstado = () => {};
  const esperaEstado = new Promise((resolver) => { liberarEstado = resolver; });
  await paginaCarga.route("**/api/state", async (route) => {
    await esperaEstado;
    await route.continue();
  });
  await paginaCarga.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await paginaCarga.waitForSelector("#input", { timeout: 10000 });
  check(
    "con /api/state pendiente, escribir y enviar siguen desactivados",
    (await paginaCarga.locator("#input").isDisabled()) && (await paginaCarga.locator("#send").isDisabled()),
  );
  liberarEstado();
  await paginaCarga.waitForFunction(
    () => !document.querySelector("#input")?.disabled && !document.querySelector("#send")?.disabled,
    null,
    { timeout: 20000 },
  );
  check("el compositor se activa al terminar la carga inicial", !(await paginaCarga.locator("#input").isDisabled()));
  await paginaCarga.close();

  // ---- 3c. Tras recargar con un turno vivo, Detener sigue disponible ----
  const estadoBase = await (await fetch(`${url}api/state`, { cache: "no-store" })).json();
  const paginaOcupada = await navegador.newPage({ viewport: { width: 1440, height: 900 } });
  await paginaOcupada.route("**/api/state", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...estadoBase, busy: true }),
    }),
  );
  await paginaOcupada.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  await paginaOcupada.locator("#stop:not([hidden])").waitFor({ timeout: 15000 });
  check("con un turno vivo tras recargar, Detener está visible", await paginaOcupada.locator("#stop").isVisible());
  check("con un turno vivo tras recargar, Enviar está bloqueado", await paginaOcupada.locator("#send").isDisabled());
  await paginaOcupada.locator("#stop").click();
  await paginaOcupada.waitForFunction(
    () => Boolean(document.querySelector("#stop")?.hidden) && !document.querySelector("#send")?.disabled,
    null,
    { timeout: 15000 },
  );
  check("Detener limpia el estado ocupado y reactiva el compositor", !(await paginaOcupada.locator("#send").isDisabled()));
  await paginaOcupada.close();

  // ---- 4. Hallazgo 16: Ajustes enseña los cuatro valores reales ----
  await pagina.locator('button[title="Ajustes"]').click();
  const presupuesto = pagina.locator("#ajustes-presupuesto");
  await pagina.waitForFunction(
    () => (document.querySelector("#ajustes-presupuesto")?.textContent || "").includes("Ventana del servidor"),
    null,
    { timeout: 15000 },
  );
  const textoPresupuesto = await presupuesto.textContent();
  check(
    "Ajustes enseña ventana/solicitado/efectivo/reserva",
    ["Ventana del servidor", "Historial solicitado", "Historial efectivo", "Reserva de salida"].every((etiqueta) => textoPresupuesto.includes(etiqueta)),
    textoPresupuesto.slice(0, 120),
  );
  check(
    "los valores son números reales (no el tope pedido como contexto)",
    /16\.384 tokens/.test(textoPresupuesto),
    textoPresupuesto.slice(0, 120),
  );
  check("el chip de contexto de la barra de estado está visible", await pagina.locator("#contexto-chip").isVisible());
  const ajustesDialogo=pagina.locator(".dialogo").last();
  const perfiles=ajustesDialogo.getByRole("combobox",{name:"Perfil de motor",exact:true});
  check("hay perfiles simultáneos de visión con 16k y 32k",await perfiles.locator('option[value="8GB-VISION"]').count()===1&&await perfiles.locator('option[value="8GB-VISION-CONTEXT"]').count()===1);
  check("está disponible 32k F16 con pensamiento",await perfiles.locator('option[value="8GB-VISION-QUALITY"]').count()===1&&await ajustesDialogo.locator('select option[value="1024"]').count()===1);
  await ajustesDialogo.getByRole("button",{name:"Revisar y editar…",exact:true}).click();
  const memoriaDialogo=pagina.locator(".dialogo").last();
  await memoriaDialogo.getByRole("heading",{name:"Memoria global entre chats",exact:true}).waitFor({timeout:15000});
  check("Ajustes abre el editor de memoria global",(await memoriaDialogo.textContent()).includes("presupuesto"));
  await memoriaDialogo.getByRole("button",{name:"Cerrar",exact:true}).click();
  const temas=ajustesDialogo.getByRole("combobox",{name:"Tema visual",exact:true});
  for(const tema of ['ocean','forest','sand','light','dark','slate']) {
    await temas.selectOption(tema);
    await pagina.waitForFunction(t=>document.documentElement.dataset.theme===t,tema);
  }
  check("los seis temas se aplican y se guardan",(await(await fetch(new URL('api/settings',url))).json()).tema==='slate');
  await ajustesDialogo.getByRole("combobox",{name:"Modo de respuesta",exact:true}).selectOption("consulta");
  await pagina.waitForFunction(async()=> (await (await fetch('/api/settings')).json()).modoRespuesta==='consulta');
  check("el modo consulta se guarda",(await (await fetch(new URL("api/settings",url))).json()).modoRespuesta==="consulta");
  let perfilEnviado;
  await pagina.route('**/api/modelos',async route=>{
    if(route.request().method()!=="POST")return route.continue();
    perfilEnviado=route.request().postDataJSON();
    await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({ok:true,cambiado:true,nombre:"Modelo simulado",nCtx:32768,vision:true})});
  });
  await perfiles.selectOption("8GB-VISION-CONTEXT");
  await ajustesDialogo.getByRole("button",{name:"Aplicar perfil",exact:true}).click();
  await pagina.waitForFunction(()=>!document.querySelector('button#modelo-chip')?.disabled);
  await esperar(350);
  check("Aplicar perfil envía el preset y pide recarga",perfilEnviado?.enginePreset==="8GB-VISION-CONTEXT"&&perfilEnviado.recargar===true);
  const artefactos=process.env.BONSAI_UI_EVIDENCE;
  if(artefactos){fs.mkdirSync(artefactos,{recursive:true});await pagina.screenshot({path:path.join(artefactos,"ui-desktop.png")});}
  await pagina.setViewportSize({width:390,height:844});
  check("Ajustes no desborda horizontalmente a 390px",await ajustesDialogo.evaluate(e=>e.scrollWidth<=e.clientWidth+2));
  if(artefactos)await pagina.screenshot({path:path.join(artefactos,"ui-mobile.png")});
  await pagina.locator(".dialogo").last().getByRole("button", { name: "Cerrar", exact: true }).click();
  await pagina.setViewportSize({width:1440,height:960});
  await pagina.locator('#input').fill('Hola, responde una frase breve.');
  await pagina.locator('#send').click();
  await pagina.locator('.reasoning-panel pre').first().waitFor({timeout:10000});
  check("el pensamiento llega a un panel separado",(await pagina.locator('.reasoning-panel pre').first().textContent()).includes('<b>dato literal</b>'));
  check("el pensamiento se pinta como texto seguro",await pagina.locator('.reasoning-panel pre b').count()===0);
  await pagina.waitForFunction(()=>!document.querySelector('#stop')||document.querySelector('#stop').hidden,null,{timeout:10000});
  await esperar(250);
  await pagina.reload();
  await pagina.locator('.reasoning-panel pre').first().waitFor({timeout:10000});
  check("el pensamiento se conserva al recargar",(await pagina.locator('.reasoning-panel pre').first().textContent()).includes('Reviso el pedido local.'));
  await pagina.waitForFunction(()=>document.querySelector('#vram-free')?.textContent.includes('MiB libres'),{timeout:10000});
  check("VRAM libre visible",await pagina.locator('#vram-free').isVisible());
  if(artefactos)await pagina.screenshot({path:path.join(artefactos,'ui-desktop.png')});

  // ---- 5. Model Hub: se abre, carga catálogo y muestra pestañas ----
  await pagina.click('#hub-abrir');
  await pagina.locator('.hub-dialog').waitFor({timeout:10000});
  await pagina.waitForFunction(()=>document.querySelectorAll('.hub-card').length>0,{timeout:15000});
  check("el Model Hub se abre y pinta tarjetas", (await pagina.locator('.hub-card').count()) > 0);
  check("el Hub tiene pestaña de búsqueda", (await pagina.locator('.hub-tab', {hasText:'Hugging Face'}).count()) === 1);
  await pagina.keyboard.press('Escape');
  await pagina.waitForFunction(()=>!document.querySelector('.hub-dialog'),{timeout:3000});

  // ---- 6. Errores de consola al final (todo lo anterior incluido) ----
  check("sin errores de consola durante toda la prueba", erroresConsola.length === 0, erroresConsola.slice(0, 3).join(" | "));
  check("el modelo simulado recibió peticiones del chat", peticionesChat >= 2, String(peticionesChat));
} catch (error) {
  fallos.push(`excepción: ${error instanceof Error ? error.message : String(error)}`);
  process.stderr.write(`\nFALLO excepción: ${error instanceof Error ? error.stack : String(error)}\n`);
} finally {
  try {
    if (pagina) await pagina.close();
  } catch {
    /* el navegador ya se cerró */
  }
  try {
    if (navegador) await navegador.close();
  } catch {
    /* idem */
  }
  try {
    const terminado = servidor.exitCode === null ? once(servidor, "exit") : Promise.resolve();
    servidor.kill();
    await terminado;
  } catch {
    /* el proceso ya terminó */
  }
  falsoLlama.closeAllConnections();
  await new Promise((resolver) => falsoLlama.close(resolver));
  for (let i = 0; i < 5; i += 1) {
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      break;
    } catch {
      await esperar(150);
    }
  }
}

if (fallos.length) {
  process.stderr.write(`\nFALLÓ:\n- ${fallos.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("prueba ui humo ok\n");
}
