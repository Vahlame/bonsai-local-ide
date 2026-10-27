/**
 * Prueba de NAVEGADOR (Edge/Chrome headless, sin dependencias):
 *   node chat/prueba-navegador.mjs [--capturas]
 *
 * Levanta un llama-server falso y un `ui-server.mjs` real con estado y proyecto
 * TEMPORALES, mete la aplicación en un iframe (mismo origen, servida por /p/) y la
 * maneja como lo haría una persona: botones, diálogos, Ctrl+K, adjuntar una imagen.
 * Al final deja el resultado en un JSON dentro del DOM y lo lee con `--dump-dom`.
 *
 * Comprueba en un navegador de verdad:
 *   · la interfaz arranca y pinta el explorador con los botones nuevos;
 *   · crear un archivo desde el explorador;
 *   · Ctrl+K: diálogo, diff propuesto, Aceptar y guardar;
 *   · el botón "Deshacer esta escritura" de la tarjeta del agente;
 *   · adjuntar una imagen (y el aviso de que no hay visión).
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.dirname(HERE);
const CAPTURAS = process.argv.includes("--capturas");
const anchoArg = process.argv.indexOf("--ancho");
const ANCHO = anchoArg >= 0 ? Number(process.argv[anchoArg + 1]) : 1440;
const CLARO = process.argv.includes("--claro");
if (!Number.isInteger(ANCHO) || ANCHO < 800 || ANCHO > 2400) throw new Error("ancho fuera de rango: 800..2400");

const EDGE = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].find((ruta) => fs.existsSync(ruta));
if (!EDGE) {
  console.error("No encontré Edge ni Chrome para la prueba de navegador.");
  process.exit(1);
}

const PUERTO = 8795;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-navegador-"));
const proyecto = path.join(tmp, "proyecto");
fs.mkdirSync(proyecto, { recursive: true });
if (CLARO) {
  fs.mkdirSync(path.join(tmp, "estado"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "estado", "ui-settings.json"), JSON.stringify({ tema: "light" }));
}
fs.writeFileSync(path.join(proyecto, "BONSAI.md"), "Regla: responde en espanol.\n", "utf8");
fs.writeFileSync(path.join(proyecto, "x.txt"), "hola mundo\nsegunda linea\n", "utf8");
fs.writeFileSync(path.join(proyecto, "y.txt"), "otra pestana\r\n", "utf8");

/** @type {Array<Record<string, any>>} */
const visto = [];

const falsoLlama = http.createServer((req, res) => {
  const url = req.url || "";
  const json = (body) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url === "/health") return json({ status: "ok" });
  if (url === "/props") return json({ default_generation_settings: { n_ctx: 32768 }, modalities: { vision: false } });
  if (url === "/v1/models") return json({ data: [{ id: "falso" }] });
  let raw = "";
  req.on("data", (p) => (raw += p));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    if (url === "/v1/chat/completions/input_tokens") return json({ input_tokens: 100 });
    if (url !== "/v1/chat/completions") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }
    visto.push(body);
    if (!body.stream) return json({ choices: [{ message: { content: "resumen" } }] });
    // El primer turno escribe el archivo; los de seguimiento ya no escriben (si no,
    // el archivo reaparecería justo después de pulsar Deshacer y la prueba mentiría).
    let contenido = "Hecho.";
    if (body.tool_choice === "none") contenido = "linea editada";
    else {
      const turnos = visto.filter((v) => v.stream && v.tool_choice !== "none").length;
      if (turnos === 1) contenido = "Listo.\n```archivo creado-por-el-agente.txt\nhola desde el agente\n```\n";
      else if (turnos === 3) contenido = "```archivo creado-2.txt\nsegundo archivo\n```";
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: contenido }, finish_reason: null }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 40, completion_tokens: 8 }, timings: { cache_n: 5, prompt_n: 35, predicted_per_second: 28 } })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
});
await new Promise((resolve) => falsoLlama.listen(0, "127.0.0.1", () => resolve(undefined)));
const puertoLlama = /** @type {import("node:net").AddressInfo} */ (falsoLlama.address()).port;

// Página que maneja la aplicación dentro de un iframe del MISMO origen (se sirve
// desde /p/, o sea, desde la carpeta de trabajo temporal).
const arnes = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>prueba navegador</title></head>
<body style="margin:0;background:#111">
<iframe id="app" src="/" style="width:${ANCHO}px;height:900px;border:0"></iframe>
<pre id="resultado">{"listo":false,"checks":[]}</pre>
<script>
const checks = [];
const check = (nombre, cond, detalle) => checks.push({ nombre, ok: Boolean(cond), detalle: String(detalle || "").slice(0, 200) });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function hasta(fn, ms = 15000) {
  const t0 = Date.now();
  let ultimo = null;
  while (Date.now() - t0 < ms) {
    try { const v = await fn(); if (v) return v; } catch (e) { ultimo = e; }
    await esperar(80);
  }
  if (ultimo) check("aviso interno", false, String(ultimo.message || ultimo));
  return null;
}
const app = document.querySelector("#app");
const D = () => app.contentDocument;
const W = () => app.contentWindow;
const fila = (nombre) => [...D().querySelectorAll("#tree .row")].find((r) => (r.querySelector(".name") || {}).textContent === nombre);
const tecla = (nodo, key, extra = {}) => nodo.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra }));
const dialogoAceptar = (texto) => {
  const caja = D().querySelector(".dialogo");
  if (!caja) return false;
  const input = caja.querySelector("input");
  if (input && texto !== undefined) input.value = texto;
  const botones = [...caja.querySelectorAll(".d-botones button")];
  const ok = botones[botones.length - 1];
  if (!ok) return false;
  ok.click();
  return true;
};
const clickBoton = (texto) => {
  const b = [...D().querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(texto));
  if (!b) return false;
  b.click();
  return true;
};

async function run() {
  try {
    // 1. Arranque de la interfaz: árbol pintado y acciones del explorador.
    check("la interfaz arranca", Boolean(await hasta(() => D().querySelector(".pane-acciones button"))));
    check("el explorador lista x.txt", Boolean(await hasta(() => fila("x.txt"))));
    check("la barra de estado tiene los chips", Boolean(D().querySelector("#git-chip")) && Boolean(D().querySelector("#reglas-chip")));

    // 2. Crear un archivo desde el explorador.
    D().querySelectorAll(".pane-acciones button")[0].click();
    check("el diálogo de nuevo archivo aparece", Boolean(await hasta(() => D().querySelector(".dialogo"))));
    dialogoAceptar("desde-la-ui.txt");
    check("el archivo nuevo sale en el árbol", Boolean(await hasta(() => fila("desde-la-ui.txt"))));
    const respuesta = await fetch("/api/file?path=desde-la-ui.txt");
    check("el archivo existe en disco", respuesta.status === 200, "HTTP " + respuesta.status);

    // 3. Ctrl+K: selección, diálogo, diff y aceptar.
    fila("x.txt").querySelector(".name").click();
    const area = await hasta(() => {
      const a = D().querySelector(".editor-wrap textarea");
      return a && !a.closest("[hidden]") && a.value.includes("hola mundo") ? a : null;
    });
    check("el editor abre x.txt", Boolean(area));
    area.focus();
    area.setSelectionRange(0, 10);
    tecla(D(), "k", { ctrlKey: true });
    check("Ctrl+K pide la instrucción", Boolean(await hasta(() => D().querySelector(".dialogo input"))));
    dialogoAceptar("cambia la primera línea");
    const diff = await hasta(() => D().querySelector("pre.diff-preview"));
    check("Ctrl+K enseña el diff propuesto", Boolean(diff), diff ? diff.textContent.slice(0, 80) : "sin diff");
    check("el diff marca lo que se va", Boolean(diff && diff.querySelector(".del")));
    clickBoton("Aceptar y guardar");
    const guardado = await hasta(async () => {
      const r = await fetch("/api/file?path=x.txt");
      const t = await r.text();
      return t.includes("linea editada") ? t : null;
    });
    check("Ctrl+K guarda al aceptar", Boolean(guardado), guardado ? guardado.slice(0, 40) : "sin guardar");

    // 4. El agente escribe y se deshace desde la tarjeta.
    const entrada = D().querySelector("#input");
    entrada.value = "hazme un archivo";
    D().querySelector("#composer").requestSubmit();
    const botonDeshacer = await hasta(() => D().querySelector(".action .undo-bar button"));
    check("la tarjeta del agente trae Deshacer", Boolean(botonDeshacer));
    check("la tarjeta trae el diff", Boolean(D().querySelector(".action pre.diff")));
    const creado = await fetch("/api/file?path=creado-por-el-agente.txt");
    check("el agente creó el archivo", creado.status === 200, "HTTP " + creado.status);
    botonDeshacer.click();
    const borrado = await hasta(async () => {
      const r = await fetch("/api/file?path=creado-por-el-agente.txt");
      if (r.status === 404) return true;
      const caja = D().querySelector("#error");
      if (caja && caja.textContent.trim()) return { fallo: caja.textContent.trim() };
      return null;
    });
    check("Deshacer revierte la escritura del agente", borrado === true, borrado ? JSON.stringify(borrado) : "el archivo sigue ahí");
    // La interfaz quita la tarjeta y el botón de turno cuando su petición termina:
    // hay que esperarlo, el 404 del servidor llega antes.
    const sinTarjeta = await hasta(() => ([...D().querySelectorAll(".card[data-rel]")].some((c) => c.dataset.rel === "creado-por-el-agente.txt") ? null : true), 5000);
    check("la tarjeta del archivo deshecho desaparece", sinTarjeta === true);
    const sinBarra = await hasta(() => (D().querySelector(".undo-bar.turno") ? null : true), 5000);
    check("sin escrituras pendientes no hay botón de turno", sinBarra === true);

    // 5. Segundo turno: revertir TODO el turno desde el botón.
    entrada.value = "hazme otro archivo";
    D().querySelector("#composer").requestSubmit();
    const turno = await hasta(() => D().querySelector(".undo-bar.turno button"));
    check("el botón de revertir el turno aparece", Boolean(turno), turno ? turno.textContent : "sin botón");
    check("el segundo archivo existe", (await fetch("/api/file?path=creado-2.txt")).status === 200);
    const askDelTurno = turno.closest(".undo-bar").dataset.ask || "";
    turno.click();
    const revertido = await hasta(async () => {
      const r = await fetch("/api/file?path=creado-2.txt");
      return r.status === 404 ? true : null;
    });
    check("revertir el turno borra lo escrito", revertido === true);
    check("la tarjeta del turno queda marcada", Boolean(await hasta(() => D().querySelector('.action[data-ask="' + askDelTurno + '"].undone'))));
    check("la tarjeta del primer turno sigue en el chat", [...D().querySelectorAll(".action .title")].some((t) => t.textContent.includes("creado-por-el-agente.txt")));

    // 6. Adjuntar una imagen: se guarda y avisa de que no hay visión.
    const pixel = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const archivo = new File([pixel], "pixel.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(archivo);
    const selector = D().querySelector("#pick-image");
    selector.files = dt.files;
    selector.dispatchEvent(new Event("change", { bubbles: true }));
    const chip = await hasta(() => D().querySelector("#attached button.img"));
    check("la imagen queda adjunta", Boolean(chip), chip ? chip.textContent : "sin chip");
    check("avisa de que el modelo no la ve", Boolean(await hasta(() => [...D().querySelectorAll(".aviso")].find((a) => /no tiene visión/i.test(a.textContent)))));

    // 7. Regresiones: documento actualizado antes del resaltado y guardado en vuelo.
    await W().openFile("y.txt");
    check("abrir un archivo CRLF no lo marca como modificado", !D().querySelector(".tab-item.on .dirty"));
    await W().openFile("x.txt");
    const edit = D().querySelector(".editor-wrap textarea");
    const escribir = (valor) => {
      edit.value = valor;
      edit.dispatchEvent(new (W().Event)("input", { bubbles: true }));
    };
    escribir("guardado inmediato");
    tecla(D(), "s", { ctrlKey: true });
    check("Ctrl+S inmediato guarda la ultima escritura", Boolean(await hasta(async () => (await (await fetch("/api/file?path=x.txt")).text()) === "guardado inmediato")));
    escribir("cambio rapido de pestana");
    await W().openFile("y.txt");
    await W().openFile("x.txt");
    check("cambiar de pestana conserva lo recien escrito", edit.value === "cambio rapido de pestana", edit.value);
    await esperar(120);
    check("el resaltado diferido no contamina otra pestana", edit.value === "cambio rapido de pestana");

    const fetchOriginal = W().fetch.bind(W());
    let guardarLento = true;
    W().fetch = async (url, init) => {
      if (url === "/api/file" && init && init.method === "POST" && guardarLento) {
        guardarLento = false;
        await esperar(160);
      }
      return fetchOriginal(url, init);
    };
    escribir("primera version");
    tecla(D(), "s", { ctrlKey: true });
    escribir("segunda version mientras guarda");
    await esperar(220);
    check("guardar en vuelo mantiene los cambios nuevos pendientes", Boolean(D().querySelector(".tab-item.on .dirty")));
    tecla(D(), "s", { ctrlKey: true });
    check("un segundo guardado escribe la version mas reciente", Boolean(await hasta(async () => (await (await fetch("/api/file?path=x.txt")).text()) === "segunda version mientras guarda")));
    W().fetch = fetchOriginal;

    // Cerrar todas/demas debe avisar y Cancelar conserva las pestañas.
    escribir("no descartar");
    const contexto = (nombre) => {
      D().querySelector(".tab-item.on").dispatchEvent(new (W().MouseEvent)("contextmenu", { bubbles: true, cancelable: true, clientX: 180, clientY: 100 }));
      const b = [...D().querySelectorAll(".menu button")].find((n) => n.textContent.trim() === nombre);
      if (b) b.click();
    };
    contexto("Cerrar todas");
    const avisoCerrar = await hasta(() => D().querySelector(".dialogo"));
    check("cerrar todas avisa de los cambios sin guardar", Boolean(avisoCerrar));
    if (avisoCerrar) avisoCerrar.querySelector(".d-botones button").click();
    check("cancelar conserva el documento y las pestanas", edit.value === "no descartar" && D().querySelectorAll(".tab-item").length >= 2);
    await W().openFile("y.txt");
    contexto("Cerrar las demás");
    const avisoOtras = await hasta(() => D().querySelector(".dialogo"));
    check("cerrar las demas tambien protege los cambios", Boolean(avisoOtras));
    if (avisoOtras) avisoOtras.querySelector(".d-botones button").click();
    check("cerrar las demas cancelado mantiene el editor correcto", edit.value === "otra pestana\\n");

    W().bonsaiResetLayout();
    const anchoEditor = D().querySelector("#editor").getBoundingClientRect().width;
    const anchoChat = D().querySelector("#chat").getBoundingClientRect().width;
    check("la distribucion reserva espacio para editor y chat", anchoEditor >= 260 && anchoChat >= 300, anchoEditor + "/" + anchoChat);
    check("los iconos de la barra tienen tamano acotado", [...D().querySelectorAll(".top svg")].every((svg) => svg.getBoundingClientRect().width <= 24));

    // 8. Una rafaga de tokens no debe recalcular los diffs por cada token.
    const redOriginal = W().fetch.bind(W());
    const syncOriginal = W().syncLive;
    let repintados = 0;
    W().syncLive = (...args) => { repintados += 1; return syncOriginal(...args); };
    W().fetch = async (url, init) => {
      if (url === "/api/chat") {
        const eventos = Array.from({ length: 1200 }, (_, i) => "data: " + JSON.stringify({ type: "token", text: "token" + i + " " }) + "\\n\\n").join("") + "data: " + JSON.stringify({ type: "done" }) + "\\n\\n";
        return new (W().Response)(eventos, { headers: { "Content-Type": "text/event-stream" } });
      }
      return redOriginal(url, init);
    };
    entrada.value = "prueba de respuesta larga";
    D().querySelector("#composer").requestSubmit();
    check("el chat muestra actividad mientras espera", Boolean(D().querySelector(".generation-status")));
    check("la respuesta completa se pinta tras la rafaga", Boolean(await hasta(() => [...D().querySelectorAll(".msg.assistant .body")].find((n) => n.textContent.includes("token1199")))));
    check("los tokens se agrupan antes de recalcular diffs", repintados <= 3 && repintados > 0, repintados);
    check("el indicador se limpia al terminar", Boolean(await hasta(() => !D().querySelector(".generation-status"))));
    W().fetch = redOriginal;
    W().syncLive = syncOriginal;
  } catch (err) {
    check("la prueba terminó sin excepción", false, err && err.message ? err.message : String(err));
  }
  document.querySelector("#resultado").textContent = JSON.stringify({ listo: true, checks }, null, 1);
}
run();
</script>
</body></html>
`;
fs.writeFileSync(path.join(proyecto, "__prueba-navegador.html"), arnes, "utf8");

const hijo = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(PUERTO), "--llama-port", String(puertoLlama)], {
  cwd: HERE,
  env: { ...process.env, BONSAI_STATE: path.join(tmp, "estado"), BONSAI_SALIDA: path.join(tmp, "salida") },
  stdio: "ignore",
});

/**
 * @param {string} url
 * @returns {Promise<{status: number, body: string}>}
 */
function pedir(url) {
  return new Promise((resolve) => {
    http
      .get(url, (res) => {
        let texto = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (texto += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: texto }));
      })
      .on("error", (err) => resolve({ status: 0, body: err.message }));
  });
}

async function esperarServidor() {
  for (let i = 0; i < 80; i += 1) {
    const r = await pedir(`http://127.0.0.1:${PUERTO}/api/state`);
    if (r.status === 200) return true;
    await new Promise((r2) => setTimeout(r2, 250));
  }
  return false;
}

/**
 * @param {string[]} args
 * @returns {Promise<string>}
 */
function edge(args) {
  return new Promise((resolve) => {
    execFile(EDGE, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true, timeout: 120000 }, (err, stdout) => {
      resolve(String(stdout || "") + (err && !stdout ? `\n[edge] ${err.message}` : ""));
    });
  });
}

const perfil = path.join(tmp, "perfil-edge");
const BASE = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${perfil}`, "--virtual-time-budget=45000", `--window-size=${ANCHO + 60},1000`];

let fallos = [];
try {
  if (!(await esperarServidor())) throw new Error("el ui-server no arrancó");
  await pedir(`http://127.0.0.1:${PUERTO}/api/workspace`);
  // La carpeta de trabajo se fija por la API (con la cabecera host correcta).
  // El estado del POST SÍ se comprueba: si esto fallaba (400/403/500), la suite seguía
  // como si el proyecto temporal estuviera fijado y terminaba escribiendo en la carpeta
  // de trabajo real del usuario.
  const fijado = await new Promise((resolve) => {
    const datos = JSON.stringify({ path: proyecto });
    const req = http.request(
      { host: "127.0.0.1", port: PUERTO, method: "POST", path: "/api/workspace", headers: { host: `127.0.0.1:${PUERTO}`, "content-type": "application/json", "content-length": String(Buffer.byteLength(datos)) } },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode || 0));
      },
    );
    req.on("error", () => resolve(0));
    req.write(datos);
    req.end();
  });
  if (fijado !== 200) throw new Error(`no se pudo fijar la carpeta de trabajo temporal (HTTP ${fijado})`);

  const volcado = await edge([...BASE, "--dump-dom", `http://127.0.0.1:${PUERTO}/p/__prueba-navegador.html`]);
  const bloque = volcado.match(/<pre id="resultado">([\s\S]*?)<\/pre>/);
  if (!bloque) {
    fallos.push(`La página de prueba no dejó resultado. Salida: ${volcado.slice(-500)}`);
  } else {
    const limpio = bloque[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    /** @type {{listo: boolean, checks: Array<{nombre: string, ok: boolean, detalle?: string}>}} */
    const datos = JSON.parse(limpio);
    if (!datos.listo) fallos.push("la prueba no llegó al final");
    for (const c of datos.checks) if (!c.ok) fallos.push(`${c.nombre}${c.detalle ? ` (${c.detalle})` : ""}`);
    const total = datos.checks.length;
    process.stdout.write(`comprobaciones en el navegador: ${datos.checks.filter((c) => c.ok).length}/${total}\n`);
  }

  if (CAPTURAS) {
    fs.mkdirSync(path.join(RAIZ, "capturas"), { recursive: true });
    const nombreCaptura = `ui-2026-10-26-${ANCHO}-${CLARO ? "claro" : "oscuro"}.png`;
    await edge([...BASE, "--virtual-time-budget=20000", `--screenshot=${path.join(RAIZ, "capturas", nombreCaptura)}`, `http://127.0.0.1:${PUERTO}/p/__prueba-navegador.html`]);
    process.stdout.write(`captura: capturas/${nombreCaptura}\n`);
  }
} catch (err) {
  fallos.push(err instanceof Error ? err.message : String(err));
} finally {
  hijo.kill();
  falsoLlama.close();
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* da igual */
  }
}

if (fallos.length) {
  console.error("FALLOS:");
  for (const f of fallos) console.error(` - ${f}`);
  process.exit(1);
}
console.log("prueba navegador ok");
