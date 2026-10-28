/**
 * Prueba de integración del AGENTE con un llama-server FALSO (sin GPU):
 *   node chat/prueba-agente.mjs
 *
 * Comprueba de punta a punta, contra un `ui-server.mjs` real:
 *   · las reglas del proyecto (BONSAI.md) llegan al mensaje de sistema;
 *   · las escrituras del agente dejan punto de deshacer y "revertir el turno" las deshace
 *     (un archivo nuevo se borra; uno existente vuelve a su contenido anterior);
 *   · `POST /api/edit` (Ctrl+K) devuelve el reemplazo y NO toca el archivo;
 *   · una imagen adjunta se avisa como no visible (sin mmproj no hay visión).
 *
 * Todo con estado y proyecto TEMPORALES: no toca los chats ni la carpeta del usuario.
 */

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { MODELO } from "./modelo.mjs";
import { dialectoDe } from "./adaptadores.mjs";
import { BonsaiChat } from "./bonsai-chat.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** @type {string[]} */
const failures = [];
/**
 * @param {string} nombre
 * @param {boolean} cond
 * @param {string} [detalle]
 */
const check = (nombre, cond, detalle) => {
  if (!cond) failures.push(detalle ? `${nombre} (${detalle})` : nombre);
};

const PUERTO = 8794;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-agente-"));
const proyecto = path.join(tmp, "proyecto");
const estado = path.join(tmp, "estado");
const salida = path.join(tmp, "salida");
fs.mkdirSync(proyecto, { recursive: true });
fs.writeFileSync(path.join(proyecto, "BONSAI.md"), "Regla: responde en espanol y sin tildes.\n", "utf8");
fs.writeFileSync(path.join(proyecto, "hola2.txt"), "original\nsegunda\n", "utf8");

/** @type {Array<Record<string, any>>} */
const visto = [];

/**
 * llama-server de mentira. `guion(body, n)` decide qué contesta.
 * @param {(body: Record<string, any>, n: number) => object[]} guion
 */
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
    if (url === "/v1/chat/completions/input_tokens") return json({ input_tokens: Math.ceil(JSON.stringify(body.messages || "").length / 4) });
    if (url !== "/v1/chat/completions") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }
    visto.push(body);
    if (!body.stream) {
      // El resumidor de la prueba 14 contesta como lo hacían los modelos de verdad: siguiendo
      // la tarea con código dentro de las notas (salida/formato/agente-*.jsonl).
      const pide = JSON.stringify(body.messages || []);
      if (pide.includes("PRUEBA_RESUMEN")) {
        return json({ choices: [{ message: { content: "- api.py tiene la clase Almacen\n\nPrimero, creo `test_api.py`:\n\n```python\nfrom api import create_app\n```" } }] });
      }
      return json({ choices: [{ message: { content: "resumen" } }] });
    }
    const deltas = guion(body, visto.length);
    const responder = () => {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      for (const delta of deltas) res.write(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 5 }, timings: { cache_n: 10, prompt_n: 40, predicted_per_second: 28 } })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
    };
    // Para la prueba del corte: el servidor tarda en contestar, así el cliente se va antes.
    const ultimoTexto = String(body.messages?.[body.messages.length - 1]?.content || "");
    if (/desconecta/i.test(ultimoTexto)) setTimeout(responder, 1500);
    else if (/prueba del latido/i.test(ultimoTexto)) {
      // Un archivo grande escrito DENTRO de la llamada, despacio: un trozo cada 300 ms.
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const args = JSON.stringify({ ruta: "lento.txt", contenido: "x".repeat(3000) });
      const trozos = [args.slice(0, 20), args.slice(20, 1500), args.slice(1500)];
      let i = 0;
      const tic = setInterval(() => {
        if (i < trozos.length) {
          const tc = { index: 0, function: { arguments: trozos[i] }, ...(i === 0 ? { id: "lat1", type: "function", function: { name: "archivo", arguments: trozos[i] } } : {}) };
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [tc] }, finish_reason: null }] })}\n\n`);
          i += 1;
          return;
        }
        clearInterval(tic);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`);
        res.end("data: [DONE]\n\n");
      }, 1100);
    } else responder();
  });
});
await new Promise((resolve) => falsoLlama.listen(0, "127.0.0.1", () => resolve(undefined)));
const puertoLlama = /** @type {import("node:net").AddressInfo} */ (falsoLlama.address()).port;

/** Lo que contesta el modelo: por orden de petición. */
const guion = (body, n) => {
  const ultimo = String(body.messages?.[body.messages.length - 1]?.content || "");
  const ultimoMsg = body.messages?.[body.messages.length - 1] || {};
  // Turno de cierre (tool_choice "none") de la prueba del cierre: el modelo, en vez de
  // resumir, escribe OTRA llamada como XML. Es lo que pasaba en el chat real.
  if (body.tool_choice === "none" && /Ya no hagas más acciones/.test(ultimo) && body.messages.some((m) => m.tool_call_id === "call_cierre")) {
    return [{ content: "<tool_call>\n<function=ejecutar>\n<parameter=comando>\nnode -e \"console.log(7)\"\n</parameter>\n</function>\n</tool_call>" }];
  }
  // Ctrl+K: el servidor manda tool_choice "none" y solo espera el reemplazo.
  if (body.tool_choice === "none") return [{ content: "linea editada" }];
  // Prueba del cierre: pide un comando y, tras su resultado (role "tool"), lo repite una y
  // otra vez sin texto, hasta que la app corta y pide el resumen.
  const llamadaCierre = [{ tool_calls: [{ index: 0, id: "call_cierre", type: "function", function: { name: "ejecutar", arguments: JSON.stringify({ comando: "node -e \"console.log(7)\"" }) } }] }];
  if (/prueba del cierre/i.test(ultimo)) return llamadaCierre;
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "call_cierre") return llamadaCierre;
  /** @param {string} id @param {string} nombre @param {Record<string, unknown>} args @param {number} [index] */
  const nativa = (id, nombre, args, index = 0) => ({ tool_calls: [{ index, id, type: "function", function: { name: nombre, arguments: JSON.stringify(args) } }] });
  // Prueba 13: DOS llamadas a la vez (un comando con salida larga y una lectura de un
  // archivo grande). Cada resultado tiene que volver a SU llamada.
  if (/prueba de las dos llamadas/i.test(ultimo)) {
    return [
      nativa("par_cmd", "ejecutar", { comando: "node -e \"console.log('x'.repeat(20000)); console.log('ERROR_AL_FINAL')\"" }, 0),
      nativa("par_leer", "leer", { ruta: "grande.txt" }, 1),
    ];
  }
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "par_leer") return [nativa("trozo", "leer", { ruta: "grande.txt", desde: 2900, hasta: 2905 })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "trozo") return [{ content: "Leído." }];
  // Prueba 12b: la guardia de repeticiones. `node comprobar.cjs` (sin ningún .py en el
  // comando, como `python -m unittest x`) falla dos veces; el modelo arregla el archivo y lo
  // vuelve a lanzar: tiene que EJECUTARSE, no salir «Falló 2 veces» con la salida vieja.
  if (/prueba de la guardia/i.test(ultimo)) return [nativa("g1", "ejecutar", { comando: "node comprobar.cjs" })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "g1") return [nativa("g2", "ejecutar", { comando: "node comprobar.cjs" })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "g2") return [nativa("g3", "archivo", { ruta: "valor.txt", contenido: "ok" })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "g3") return [nativa("g4", "ejecutar", { comando: "node comprobar.cjs" })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "g4") return [{ content: "Arreglado y comprobado." }];
  // Prueba 12c: el bucle de regex-fechas (corrida 4): reescribe el MISMO contenido y relanza
  // el mismo comando. Eso no es un cambio: el comando no se vuelve a lanzar.
  if (/prueba del bucle igual/i.test(ultimo)) return [nativa("b1", "archivo", { ruta: "igual.cjs", contenido: "console.log('salida igual')\n" })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "b1") return [nativa("b2", "ejecutar", { comando: "node igual.cjs" })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "b2") return [nativa("b3", "archivo", { ruta: "igual.cjs", contenido: "console.log('salida igual')\n" })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "b3") return [nativa("b4", "ejecutar", { comando: "node igual.cjs" })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "b4") return [{ content: "Listo: imprime salida igual." }];
  // Prueba 16: `reemplazar` cambia un trozo (con CRLF en disco) y falla con aviso si no está.
  if (/prueba del reemplazo/i.test(ultimo)) {
    return [
      nativa("rep1", "reemplazar", { ruta: "config.ini", buscar: "puerto = 80\nmodo = lento", poner: "puerto = 8080\nmodo = rapido" }, 0),
      nativa("rep2", "reemplazar", { ruta: "config.ini", buscar: "no existe esto", poner: "x" }, 1),
    ];
  }
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "rep2") return [{ content: "Cambiado." }];
  // Prueba 22: un servidor en segundo plano se consulta con otro comando y muere con el turno.
  if (/prueba del servidor de fondo/i.test(ultimo)) return [nativa("sf1", "ejecutar", { comando: "node -e \"require('http').createServer((q,s)=>s.end('hola desde el fondo')).listen(8798,()=>console.log('escuchando en 8798'))\"", segundo_plano: true })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "sf1") return [nativa("sf2", "ejecutar", { comando: "node -e \"fetch('http://127.0.0.1:8798').then(r=>r.text()).then(t=>console.log(t))\"" })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "sf2") return [{ content: "La API responde." }];
  // Prueba 23: plan persistente (checklist que sobrevive al turno).
  if (/prueba del plan/i.test(ultimo)) return [nativa("plan1", "plan", { pasos: ["crear", "probar", "cerrar"], hechos: [1] })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "plan1") return [{ content: "Plan guardado." }];
  // Prueba 24: borrar un archivo (con punto de deshacer).
  if (/prueba del borrado/i.test(ultimo)) return [nativa("del1", "borrar", { ruta: "borrar.txt" })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "del1") return [{ content: "Borrado." }];
  // Prueba 25: mover un archivo a una subcarpeta.
  if (/prueba del movimiento/i.test(ultimo)) return [nativa("mv1", "mover", { origen: "mover.txt", destino: "sub/movido.txt" })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "mv1") return [{ content: "Movido." }];
  // Prueba 21: releer las MISMAS líneas sin que nada cambie se frena; tras un cambio, no.
  if (/prueba de la relectura/i.test(ultimo)) return [nativa("rl1", "archivo", { ruta: "relee.txt", contenido: "uno\ndos\ntres\n" })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "rl1") return [nativa("rl2", "leer", { ruta: "relee.txt", desde: 1, hasta: 2 })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "rl2") return [nativa("rl3", "leer", { ruta: "relee.txt", desde: 1, hasta: 2 })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "rl3") return [nativa("rl4", "reemplazar", { ruta: "relee.txt", buscar: "dos", poner: "DOS" })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "rl4") return [nativa("rl5", "leer", { ruta: "relee.txt", desde: 1, hasta: 2 })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "rl5") return [{ content: "Leído tras el cambio." }];
  // Prueba 17: el último comando falla y el modelo cierra como si todo fuera bien.
  if (/prueba optimista final/i.test(ultimo)) return [nativa("opt1", "ejecutar", { comando: "node -e \"process.exit(3)\"" })];
  if (ultimoMsg.role === "tool" && ultimoMsg.tool_call_id === "opt1") return [{ content: "He creado todo y está listo." }];
  // Tool call NATIVA (delta.tool_calls): la rama que usa el servidor de verdad y que
  // ninguna prueba tocaba. La ruta va con "./" a propósito: así la escribe el modelo y
  // la clave del diff y del punto de deshacer tiene que normalizarla igual que lo hace
  // writeOutputs, o el archivo preexistente se ve como "nuevo".
  if (/prueba del tool call nativo/i.test(ultimo)) {
    return [{ tool_calls: [{ index: 0, id: "call_nativo", type: "function", function: { name: "archivo", arguments: "{\"ruta\":\"./nativo.txt\",\"contenido\":\"nativo\"}" } }] }];
  }
  // Comando PROHIBIDO (lleva ".."): si la comprobación no estuviera cableada, se lanzaría
  // y escribiría fuera de la carpeta de trabajo.
  if (/prueba del comando prohibido/i.test(ultimo)) {
    const comando = "node -e \"require('fs').writeFileSync('../fuera.txt','x')\"";
    return [{ tool_calls: [{ index: 0, id: "call_prohibido", type: "function", function: { name: "ejecutar", arguments: JSON.stringify({ comando }) } }] }];
  }
  // El modelo escribe la llamada como XML (el servidor no la parseó): la app tiene
  // que quitarla de la respuesta y pedirle que la repita bien.
  if (/prueba del xml/i.test(ultimo)) {
    return [{ content: "Voy a lanzarlo.\n<tool_call>\n<function=ejecutar>\n<parameter=comando>\npython hola.py\n</parameter>\n</function>\n</tool_call>" }];
  }
  if (/No escribas bloques <tool_call>/i.test(ultimo)) return [{ content: "Entendido: lo dejo en texto." }];
  if (n === 1) return [{ content: "Listo.\n```archivo hola.txt\nhola mundo\n```\n" }];
  if (n === 3) return [{ content: "```archivo hola2.txt\nreescrito por el agente\n```" }];
  if (n === 5) return [{ content: "```archivo hola3.txt\ntercer archivo\n```" }];
  return [{ content: "Hecho." }];
};

const hijo = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(PUERTO), "--llama-port", String(puertoLlama)], {
  cwd: HERE,
  env: { ...process.env, BONSAI_STATE: estado, BONSAI_SALIDA: salida, BONSAI_LATIDO_MS: "200" },
  stdio: "ignore",
});

/**
 * @param {string} metodo
 * @param {string} ruta
 * @param {unknown} [cuerpo]
 * @param {number} [puerto]
 * @returns {Promise<{status: number, body: string, headers: http.IncomingHttpHeaders}>}
 */
function pedir(metodo, ruta, cuerpo, puerto = PUERTO) {
  const datos = cuerpo === undefined ? "" : JSON.stringify(cuerpo);
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: puerto,
        method: metodo,
        path: ruta,
        headers: {
          host: `127.0.0.1:${puerto}`,
          ...(datos ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(datos)) } : {}),
        },
      },
      (res) => {
        let texto = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (texto += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, body: texto, headers: res.headers }));
      },
    );
    req.on("error", (err) => resolve({ status: 0, body: `conexion cortada: ${err.message}`, headers: {} }));
    if (datos) req.write(datos);
    req.end();
  });
}

/**
 * Manda un turno de chat y devuelve todos los eventos SSE.
 * @param {number} puerto
 * @param {string} texto
 * @param {{imagenes?: string[]}} [extra]
 * @returns {Promise<Array<Record<string, any>>>}
 */
async function chatEn(puerto, texto, extra = {}) {
  const res = await fetch(`http://127.0.0.1:${puerto}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: texto, ...extra }),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const lector = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  /** @type {Array<Record<string, any>>} */
  const eventos = [];
  while (true) {
    const { done, value } = await lector.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl = buf.indexOf("\n");
    while (nl !== -1) {
      const linea = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
      if (linea.startsWith("data:")) {
        try {
          eventos.push(JSON.parse(linea.slice(5)));
        } catch {
          /* trozo incompleto */
        }
      }
    }
  }
  return eventos;
}

/** @param {string} texto @param {{imagenes?: string[]}} [extra] */
const chat = (texto, extra = {}) => chatEn(PUERTO, texto, extra);

/**
 * @param {number} [puerto]
 * @returns {Promise<boolean>}
 */
async function esperar(puerto = PUERTO) {
  for (let i = 0; i < 80; i += 1) {
    const r = await pedir("GET", "/api/state", undefined, puerto);
    if (r.status === 200) return true;
    await new Promise((r2) => setTimeout(r2, 250));
  }
  return false;
}

try {
  check("el servidor arranca", await esperar());
  check("fija la carpeta de trabajo", (await pedir("POST", "/api/workspace", { path: proyecto })).status === 200);

  // --- 1. El agente escribe un archivo NUEVO --------------------------------
  const eventos = await chat("créame hola.txt");
  const acciones = eventos.filter((e) => e.type === "action");
  const escritura = acciones.find((e) => e.kind === "write");
  check("el agente crea el archivo", fs.existsSync(path.join(proyecto, "hola.txt")), fs.readdirSync(proyecto).join(", "));
  check("avisa de la escritura", Boolean(escritura), JSON.stringify(acciones).slice(0, 200));
  check("la escritura trae punto de deshacer", typeof escritura?.undo === "string" && escritura.undo.length > 4, String(escritura?.undo));
  check("el turno termina bien", eventos.some((e) => e.type === "done"));

  // --- 2. Las reglas del proyecto van en el mensaje de sistema --------------
  const sistema = String(visto[0]?.messages?.[0]?.content || "");
  check("las reglas llegan al mensaje de sistema", sistema.includes("Regla: responde en espanol y sin tildes."), sistema.slice(0, 160));
  check("y siguen ahí en el turno siguiente", String(visto[1]?.messages?.[0]?.content || "").includes("responde en espanol"));

  // --- 3. Deshacer UNA escritura por su id (el botón de la tarjeta) ---------
  const porId = await pedir("POST", "/api/undo", { id: escritura?.undo });
  check("deshacer por id responde 200", porId.status === 200, `HTTP ${porId.status} ${porId.body}`);
  check("deshacer por id borra el archivo que creó", !fs.existsSync(path.join(proyecto, "hola.txt")));

  // --- 4. El agente reescribe un archivo que YA existía ---------------------
  const eventos2 = await chat("reescribe hola2.txt");
  check("el agente reescribió el archivo", fs.readFileSync(path.join(proyecto, "hola2.txt"), "utf8").trim() === "reescrito por el agente", JSON.stringify(fs.readFileSync(path.join(proyecto, "hola2.txt"), "utf8")));
  check("también avisa de esa escritura", eventos2.filter((e) => e.type === "action" && e.kind === "write").length === 1, JSON.stringify(eventos2.filter((e) => e.type === "action").map((e) => e.kind)));
  const vuelta = await pedir("POST", "/api/undo", { turno: true });
  check("revertir el turno devuelve el contenido anterior", vuelta.status === 200 && fs.readFileSync(path.join(proyecto, "hola2.txt"), "utf8") === "original\nsegunda\n", `HTTP ${vuelta.status} ${fs.readFileSync(path.join(proyecto, "hola2.txt"), "utf8")}`);

  // --- 5. Revertir el turno de un archivo nuevo lo borra --------------------
  await chat("créame otro archivo");
  check("el tercer archivo está en disco", fs.existsSync(path.join(proyecto, "hola3.txt")));
  const revertido = await pedir("POST", "/api/undo", { turno: true });
  check("revertir el turno responde 200", revertido.status === 200, `HTTP ${revertido.status} ${revertido.body}`);
  check("el archivo del turno se borra", !fs.existsSync(path.join(proyecto, "hola3.txt")));
  check("dice qué revirtió", revertido.status === 200 && JSON.parse(revertido.body).revertidos.includes("hola3.txt"), revertido.body);
  check("no queda nada que revertir", (await pedir("POST", "/api/undo", { turno: true })).status === 409);

  // --- 5. Ctrl+K: /api/edit propone y no escribe ----------------------------
  const edicion = await pedir("POST", "/api/edit", { path: "hola2.txt", start: 1, end: 1, instruccion: "cambia la primera línea" });
  const ed = edicion.status === 200 ? JSON.parse(edicion.body) : {};
  check("Ctrl+K responde", edicion.status === 200, `HTTP ${edicion.status} ${edicion.body.slice(0, 120)}`);
  check("Ctrl+K devuelve la propuesta", ed.propuesta === "linea editada", JSON.stringify(ed.propuesta));
  check("Ctrl+K devuelve el archivo entero", ed.texto === "linea editada\nsegunda\n", JSON.stringify(ed.texto));
  check("Ctrl+K trae un diff", String(ed.diff || "").includes("-original") && String(ed.diff || "").includes("+linea editada"), String(ed.diff || "").slice(0, 120));
  check("Ctrl+K NO escribe el archivo", fs.readFileSync(path.join(proyecto, "hola2.txt"), "utf8") === "original\nsegunda\n");
  check("Ctrl+K sin instrucción da 400", (await pedir("POST", "/api/edit", { path: "hola2.txt", start: 1, end: 1 })).status === 400);
  check("Ctrl+K en carpeta protegida da 403", (await pedir("POST", "/api/edit", { path: "models/x.txt", start: 1, end: 1, instruccion: "x" })).status === 403);
  check("Ctrl+K de un archivo que no existe da 404", (await pedir("POST", "/api/edit", { path: "noexiste.txt", start: 1, end: 1, instruccion: "x" })).status === 404);

  // --- 6. Imagen adjunta: se guarda y se avisa de que no hay visión ---------
  const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const adj = await pedir("POST", "/api/attach", { nombre: "pixel.png", datos: `data:image/png;base64,${pixel}` });
  const adjunto = adj.status === 200 ? JSON.parse(adj.body) : {};
  check("la imagen se adjunta", adj.status === 200 && adjunto.archivo, `HTTP ${adj.status} ${adj.body.slice(0, 90)}`);
  await chat("mira la imagen", { imagenes: [String(adjunto.archivo)] });
  const ultimo = visto[visto.length - 1];
  const mensajeUsuario = String(ultimo?.messages?.[ultimo.messages.length - 1]?.content || "");
  check("el modelo recibe el aviso de la imagen", mensajeUsuario.includes("No tienes visión") && mensajeUsuario.includes(String(adjunto.archivo)), mensajeUsuario.slice(-220));

  // --- 7. Llamada a función escrita como XML (no parseada por el servidor) ---
  await chat("prueba del xml");
  const estado = JSON.parse((await pedir("GET", "/api/state")).body);
  const respuestas = (estado.turns || []).filter((t) => t.role === "assistant");
  const ultima = respuestas[respuestas.length - 1];
  check("el XML no se enseña como respuesta final", !String(ultima?.content || "").includes("<tool_call>"), String(ultima?.content || "").slice(0, 140));
  check("el XML no queda en el historial", !JSON.stringify(estado.turns || []).includes("<tool_call>"));
  const colas = visto.slice(-3).map((b) => String(b.messages?.[b.messages.length - 1]?.content || "").slice(-90));
  check("se le pide que la repita como función", visto.some((b) => /No escribas bloques <tool_call>/i.test(String(b.messages?.[b.messages.length - 1]?.content || ""))), JSON.stringify(colas));
  check("el turno cierra con texto", String(ultima?.content || "").trim().length > 0, String(ultima?.content || ""));

  // --- 9. Un corte del cliente no deja el servidor en "turno en curso" -------
  // (El bug del zombi: si algo fallaba entre reclamar el turno y el try/finally,
  // `busy` se quedaba en true y el servidor respondía 409 para siempre.)
  {
    const cuerpo = JSON.stringify({ text: "desconecta y sigue" });
    const corte = http.request({
      host: "127.0.0.1",
      port: PUERTO,
      method: "POST",
      path: "/api/chat",
      headers: { host: `127.0.0.1:${PUERTO}`, "content-type": "application/json", "content-length": String(Buffer.byteLength(cuerpo)) },
    });
    corte.on("error", () => {});
    corte.write(cuerpo);
    corte.end();
    await new Promise((r) => setTimeout(r, 250));
    corte.destroy();
    let libre = false;
    for (let i = 0; i < 20; i += 1) {
      const r = await pedir("POST", "/api/chat", { text: "¿sigues ahí?" });
      if (r.status === 200) {
        libre = true;
        break;
      }
      await new Promise((r2) => setTimeout(r2, 250));
    }
    check("tras un corte del cliente el servidor queda libre", libre);
  }

  // --- 10. Tool call NATIVA con la ruta en "./" -----------------------------
  // El modelo escribe `./nativo.txt` y writeOutputs devuelve `nativo.txt`. Sin
  // normalizar las dos formas, el diff decía "--- /dev/null" (como si el archivo fuera
  // nuevo) y el punto de deshacer guardaba antes=null, así que deshacer BORRABA un
  // archivo que existía en vez de restaurarlo.
  fs.writeFileSync(path.join(proyecto, "nativo.txt"), "viejo\n", "utf8");
  const eventosNativo = await chat("prueba del tool call nativo");
  const tarjetaNativa = eventosNativo.filter((e) => e.type === "action" && e.kind === "write")[0];
  check("la tool call nativa se ejecuta", fs.readFileSync(path.join(proyecto, "nativo.txt"), "utf8") === "nativo", JSON.stringify(fs.readFileSync(path.join(proyecto, "nativo.txt"), "utf8")));
  check("el diff de la tool call nativa ve el contenido anterior", String(tarjetaNativa?.detail || "").includes("-viejo"), String(tarjetaNativa?.detail || "").slice(0, 140));
  check("el diff no da el archivo por nuevo", !String(tarjetaNativa?.detail || "").includes("/dev/null"), String(tarjetaNativa?.detail || "").slice(0, 140));
  // El resultado de la llamada vuelve como role "tool" con el id de SU llamada (la
  // plantilla lo envuelve en <tool_response>), y el sistema le dice dónde está.
  const tras = visto.filter((b) => (b.messages || []).some((m) => m.tool_call_id === "call_nativo"));
  const resultadoNativo = tras[0]?.messages?.find((m) => m.tool_call_id === "call_nativo");
  check("el resultado de la tool call viaja como role tool", resultadoNativo?.role === "tool" && /Guardado nativo\.txt/.test(String(resultadoNativo?.content || "")), JSON.stringify(resultadoNativo).slice(0, 200));
  check("el resultado no lleva el párrafo de instrucciones", !/Sigue con lo que pedí/.test(String(resultadoNativo?.content || "")));
  check("tras el resultado sigue habiendo un mensaje del usuario (la plantilla lo exige)", (tras[0]?.messages || []).some((m) => m.role === "user" && /tool call nativo/.test(String(m.content))));
  const sistemaAgente = String(tras[0]?.messages?.[0]?.content || "");
  check("el sistema le dice Windows, cmd.exe y que escriba con `archivo`", /Windows/.test(sistemaAgente) && /cmd\.exe/.test(sistemaAgente) && /`archivo`/.test(sistemaAgente), sistemaAgente.slice(0, 200));
  check("el resultado no se pinta como mensaje del usuario", !JSON.parse((await pedir("GET", "/api/state")).body).turns.some((t) => t.role === "tool" || /Guardado nativo/.test(String(t.content))));
  const deshacerNativo = await pedir("POST", "/api/undo", { id: tarjetaNativa?.undo });
  const trasDeshacer = fs.existsSync(path.join(proyecto, "nativo.txt")) ? JSON.stringify(fs.readFileSync(path.join(proyecto, "nativo.txt"), "utf8")) : "(borrado)";
  check(
    "deshacer la tool call nativa RESTAURA el archivo anterior",
    deshacerNativo.status === 200 && trasDeshacer === JSON.stringify("viejo\n"),
    `HTTP ${deshacerNativo.status} ${deshacerNativo.body} contenido=${trasDeshacer}`,
  );

  // --- 11. Un comando PROHIBIDO no se lanza ---------------------------------
  // `commandAllowed()` (chat/actions.mjs) bloquea rutas absolutas, `..`, `shutdown`,
  // `format`, `reg delete`… Estaba exportada y probada, pero NADIE la llamaba en el
  // camino real: el comando se lanzaba igual.
  const eventosProhibido = await chat("prueba del comando prohibido");
  const tarjetaProhibida = eventosProhibido.filter((e) => e.type === "action" && e.kind === "cmd")[0];
  check("un comando prohibido sale marcado como denegado", tarjetaProhibida?.state === "denied", JSON.stringify(tarjetaProhibida));
  check("un comando prohibido no queda como ejecutado", !eventosProhibido.some((e) => e.type === "action" && e.kind === "cmd" && e.state === "done"), JSON.stringify(eventosProhibido.filter((e) => e.kind === "cmd")));
  check("un comando prohibido NO escribe fuera de la carpeta", !fs.existsSync(path.join(tmp, "fuera.txt")), "apareció fuera.txt en el directorio padre");

  // --- 12. El cierre forzado no enseña XML -----------------------------------
  // El modelo repite la misma llamada hasta que la app corta y pide un resumen con
  // tool_choice "none"; entonces escribe otra llamada como XML. Antes ese XML se guardaba y
  // era lo último que veía el usuario.
  check("permiso en todo para la prueba del cierre", (await pedir("POST", "/api/permit", { mode: "all" })).status === 200);
  const eventosCierre = await chat("prueba del cierre");
  await pedir("POST", "/api/permit", { mode: "ask" });
  const estadoCierre = JSON.parse((await pedir("GET", "/api/state")).body);
  const respuestasCierre = (estadoCierre.turns || []).filter((t) => t.role === "assistant");
  const finalCierre = String(respuestasCierre[respuestasCierre.length - 1]?.content || "");
  check("el comando de la prueba del cierre se ejecutó", eventosCierre.some((e) => e.type === "action" && e.kind === "cmd" && e.state === "done" && /\b7\b/.test(String(e.detail || ""))), JSON.stringify(eventosCierre.filter((e) => e.kind === "cmd")).slice(0, 300));
  check("el cierre no enseña XML", !finalCierre.includes("<tool_call>") && !finalCierre.includes("<function="), finalCierre.slice(0, 200));
  check("el cierre resume lo que se hizo", /No llegué a cerrar/.test(finalCierre) && /ejecuté `node -e/.test(finalCierre), finalCierre.slice(0, 300));
  check("la interfaz recibe el reemplazo limpio", eventosCierre.some((e) => e.type === "replace" && /No llegué a cerrar/.test(String(e.text || ""))));
  // El cierre lleva delante los resultados que quedaron sin mandar: ninguna llamada del
  // historial se queda sin su <tool_response>.
  const peticionCierre = visto.filter((b) => b.tool_choice === "none" && /Ya no hagas más acciones/.test(JSON.stringify(b.messages || []))).pop();
  const msgsCierre = peticionCierre?.messages || [];
  const llamadasSinRespuesta = msgsCierre.flatMap((m, i) => (m.role === "assistant" && Array.isArray(m.tool_calls) ? m.tool_calls.filter((tc) => !msgsCierre.slice(i + 1).some((r) => r.role === "tool" && r.tool_call_id === tc.id)).map((tc) => tc.id) : []));
  check("en el cierre ninguna llamada queda sin su resultado", llamadasSinRespuesta.length === 0, llamadasSinRespuesta.join(", "));

  // --- 13. Dos llamadas a la vez: un resultado por llamada, con su id -------
  // Antes las dos salidas viajaban en UN mensaje con el id de la primera y la segunda
  // llamada se quedaba sin respuesta (el modelo la repetía). Además: la salida larga
  // conserva el FINAL y la lectura de un archivo grande avisa del recorte.
  fs.writeFileSync(path.join(proyecto, "grande.txt"), Array.from({ length: 3000 }, (_, i) => `línea ${i + 1}`).join("\n"), "utf8");
  await pedir("POST", "/api/permit", { mode: "all" });
  await chat("prueba de las dos llamadas");
  const conDos = visto.find((b) => (b.messages || []).some((m) => m.tool_call_id === "par_leer"));
  const resCmd = conDos?.messages?.find((m) => m.role === "tool" && m.tool_call_id === "par_cmd");
  const resLeer = conDos?.messages?.find((m) => m.role === "tool" && m.tool_call_id === "par_leer");
  check("cada llamada recibe SU resultado (dos mensajes tool)", Boolean(resCmd) && Boolean(resLeer), JSON.stringify((conDos?.messages || []).filter((m) => m.role === "tool").map((m) => m.tool_call_id)));
  check("el resultado del comando va solo en su llamada", /Salida de node/.test(String(resCmd?.content || "")) && !/Archivo grande\.txt/.test(String(resCmd?.content || "")));
  check("la salida larga conserva la cola (el error del final)", /ERROR_AL_FINAL/.test(String(resCmd?.content || "")), String(resCmd?.content || "").slice(-200));
  check("la lectura grande avisa del recorte y de cómo seguir", /recortado por presupuesto: faltan las líneas|recorte dentro de la línea/.test(String(resLeer?.content || "")) && /desde \d+/.test(String(resLeer?.content || "")), String(resLeer?.content || "").slice(-240));
  const conTrozo = visto.find((b) => (b.messages || []).some((m) => m.tool_call_id === "trozo"));
  const resTrozo = String(conTrozo?.messages?.find((m) => m.tool_call_id === "trozo")?.content || "");
  check("leer con desde/hasta trae ese trozo (y no se toma por releer)", /líneas 2900-2905 de 3000/.test(resTrozo) && resTrozo.includes("línea 2903") && !/Misma versión del archivo/.test(resTrozo), resTrozo.slice(0, 200));

  // --- 12b. La guardia de repeticiones deja relanzar tras arreglar el código --
  fs.writeFileSync(path.join(proyecto, "comprobar.cjs"), "const fs = require('fs');\nif (!fs.existsSync('valor.txt') || fs.readFileSync('valor.txt', 'utf8').trim() !== 'ok') { console.error('FALTA valor.txt'); process.exit(1); }\nconsole.log('TODO OK');\n", "utf8");
  const eventosGuardia = await chat("prueba de la guardia");
  const cmdsGuardia = eventosGuardia.filter((e) => e.type === "action" && e.kind === "cmd" && e.state === "done");
  check("tras arreglar el archivo, el comando se vuelve a lanzar de verdad", cmdsGuardia.some((e) => e.code === 0 && /TODO OK/.test(String(e.detail || ""))), JSON.stringify(cmdsGuardia.map((e) => [e.code, String(e.detail || "").slice(0, 60)])));
  check("no se le enseña la salida vieja como si fuera nueva", !cmdsGuardia.some((e) => /^Falló \d+ veces/.test(String(e.detail || "")) && e.id === cmdsGuardia[cmdsGuardia.length - 1]?.id));

  // --- 16. reemplazar: cambia solo ese trozo y respeta el CRLF del archivo ---
  fs.writeFileSync(path.join(proyecto, "config.ini"), "[app]\r\nnombre = demo\r\npuerto = 80\r\nmodo = lento\r\nfin = si\r\n", "utf8");
  const eventosRep = await chat("prueba del reemplazo");
  check("reemplazar cambia solo ese trozo", fs.readFileSync(path.join(proyecto, "config.ini"), "utf8") === "[app]\r\nnombre = demo\r\npuerto = 8080\r\nmodo = rapido\r\nfin = si\r\n", JSON.stringify(fs.readFileSync(path.join(proyecto, "config.ini"), "utf8")));
  const tarjetaRep = eventosRep.find((e) => e.type === "action" && e.kind === "write" && e.title === "config.ini");
  check("reemplazar deja diff y punto de deshacer", /\+puerto = 8080/.test(String(tarjetaRep?.detail || "")) && typeof tarjetaRep?.undo === "string", JSON.stringify(tarjetaRep).slice(0, 200));
  const conRep = visto.find((b) => (b.messages || []).some((m) => m.tool_call_id === "rep2"));
  check("reemplazar sin coincidencia lo dice en SU resultado", /No encontré ese texto en config\.ini/.test(String(conRep?.messages?.find((m) => m.tool_call_id === "rep2")?.content || "")) && /Cambiado config\.ini/.test(String(conRep?.messages?.find((m) => m.tool_call_id === "rep1")?.content || "")));

  // --- 19. Latido y progreso mientras el modelo escribe un archivo largo ------
  {
    const r = await fetch(`http://127.0.0.1:${PUERTO}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "prueba del latido" }) });
    const crudo = await r.text();
    check("mientras escribe, el stream lleva latidos", (crudo.match(/^: latido/gm) || []).length >= 2, `latidos: ${(crudo.match(/^: latido/gm) || []).length}`);
    check("y avisa del progreso con la ruta", /"type":"tool_progress"[^\n]*"ruta":"lento\.txt"/.test(crudo), crudo.slice(0, 300));
    check("el archivo lento se escribe entero", fs.existsSync(path.join(proyecto, "lento.txt")) && fs.readFileSync(path.join(proyecto, "lento.txt"), "utf8").length === 3000);
  }

  // --- 18. Pregunta de conversación pura: un salto y sin herramientas --------
  const antesCharla = visto.length;
  const eventosCharla = await chat("¿Qué es una closure en JavaScript? Dame un ejemplo corto.");
  const pidioCharla = visto.slice(antesCharla).filter((b) => b.stream);
  check("una pregunta conceptual va en UN salto y con tool_choice none", pidioCharla.length === 1 && pidioCharla[0].tool_choice === "none", JSON.stringify(pidioCharla.map((b) => b.tool_choice)));
  check("y no ejecuta ni escribe nada", !eventosCharla.some((e) => e.type === "action"));
  const antesNoCharla = visto.length;
  await chat("explica el error de app.py y arréglalo");
  check("si hay algo que hacer, las herramientas siguen puestas", visto.slice(antesNoCharla).filter((b) => b.stream)[0]?.tool_choice === "auto");

  // --- 22. Servidor en segundo plano: se usa y SIGUE VIVO tras el turno ---------
  await pedir("POST", "/api/permit", { mode: "all" });
  await chat("prueba del servidor de fondo");
  const resFondo = (id) => String(visto.find((b) => (b.messages || []).some((m) => m.tool_call_id === id))?.messages?.find((m) => m.tool_call_id === id)?.content || "");
  check("el servidor queda en segundo plano", /Corriendo en segundo plano/.test(resFondo("sf1")) && /escuchando en 8798/.test(resFondo("sf1")), resFondo("sf1").slice(0, 200));
  check("otro comando lo consulta mientras corre", /hola desde el fondo/.test(resFondo("sf2")), resFondo("sf2").slice(0, 200));
  await new Promise((r) => setTimeout(r, 1500));
  const sigueVivo = await fetch("http://127.0.0.1:8798").then(() => true).catch(() => false);
  check("al acabar el turno el servidor YA NO se cierra", sigueVivo);
  const listaProc = JSON.parse((await pedir("GET", "/api/procesos")).body);
  const fondo = (listaProc.procesos || []).find((p) => /escuchando en 8798/.test(String(p.comando)));
  check("el proceso aparece en /api/procesos", Boolean(fondo), JSON.stringify(listaProc));
  const parado = await pedir("POST", "/api/procesos", { accion: "detener", id: fondo?.id });
  check("detener el proceso responde 200", parado.status === 200, parado.body);
  await new Promise((r) => setTimeout(r, 800));
  const aunVivo = await fetch("http://127.0.0.1:8798").then(() => true).catch(() => false);
  check("tras detenerlo el puerto queda libre", !aunVivo);

  // --- 23. Plan persistente: se guarda y se recuerda en el turno siguiente -----
  const evPlan = await chat("prueba del plan");
  const sesionPlan = JSON.parse(fs.readFileSync(path.join(tmp, "estado", "ui-session.json"), "utf8"));
  check("el plan queda guardado en la sesión", Array.isArray(sesionPlan.plan?.pasos) && sesionPlan.plan.pasos.length === 3 && sesionPlan.plan.hechos[0] === 1, JSON.stringify(sesionPlan.plan));
  check("la tarjeta del plan sale en el chat", evPlan.some((e) => e.type === "action" && e.kind === "plan"), JSON.stringify(evPlan.filter((e) => e.type === "action").map((e) => e.kind)));
  await chat("gracias, sigue");
  const peticionPlan = visto.filter((b) => b.stream).pop();
  const sisPlan = String(peticionPlan?.messages?.[0]?.content || "");
  check("el plan viaja en el mensaje de sistema del turno siguiente", /PLAN DE LA TAREA/.test(sisPlan) && /\[x\] 1\./.test(sisPlan), sisPlan.slice(-220));

  // --- 24. Borrar: archivo eliminado + punto de deshacer -----------------------
  fs.writeFileSync(path.join(proyecto, "borrar.txt"), "efimero\n");
  const evBorrar = await chat("prueba del borrado");
  check("el archivo se borra", !fs.existsSync(path.join(proyecto, "borrar.txt")));
  const accionBorrar = evBorrar.filter((e) => e.type === "action").find((e) => /borrar/.test(String(e.title)));
  check("la acción de borrar trae punto de deshacer", Boolean(accionBorrar) && typeof accionBorrar.undo === "string" && accionBorrar.undo.length > 4, JSON.stringify(evBorrar.filter((e) => e.type === "action")));
  const vueltaBorrar = await pedir("POST", "/api/undo", { id: accionBorrar?.undo });
  check("deshacer restaura el archivo borrado", vueltaBorrar.status === 200 && fs.existsSync(path.join(proyecto, "borrar.txt")), `HTTP ${vueltaBorrar.status} ${vueltaBorrar.body}`);

  // --- 25. Mover/renombrar: se mueve y el undo lo devuelve ---------------------
  fs.writeFileSync(path.join(proyecto, "mover.txt"), "mueveme\n");
  const evMover = await chat("prueba del movimiento");
  check("el archivo se mueve a la subcarpeta", fs.existsSync(path.join(proyecto, "sub", "movido.txt")) && !fs.existsSync(path.join(proyecto, "mover.txt")));
  const accionMover = evMover.filter((e) => e.type === "action").find((e) => /mover/.test(String(e.title)));
  check("la acción de mover trae punto de deshacer", Boolean(accionMover) && typeof accionMover.undo === "string", JSON.stringify(evMover.filter((e) => e.type === "action")));
  const vueltaMover = await pedir("POST", "/api/undo", { id: accionMover?.undo });
  check("deshacer devuelve el archivo a su sitio", vueltaMover.status === 200 && fs.existsSync(path.join(proyecto, "mover.txt")) && !fs.existsSync(path.join(proyecto, "sub", "movido.txt")), `HTTP ${vueltaMover.status} ${vueltaMover.body}`);

  // --- 26. Panel: terminal con stdin y diagnósticos/esquema/definición ---------
  const abierto = JSON.parse((await pedir("POST", "/api/terminal", { accion: "abrir" })).body);
  check("el terminal se abre", typeof abierto.id === "string" && abierto.id.length > 0, JSON.stringify(abierto));
  await pedir("POST", "/api/terminal", { accion: "escribir", id: abierto.id, datos: "node -e \"console.log('panel-terminal')\"\r\n" });
  await new Promise((r) => setTimeout(r, 1800));
  const leido = JSON.parse((await pedir("POST", "/api/terminal", { accion: "leer", id: abierto.id, desde: 0 })).body);
  check("el terminal devuelve la salida del comando", /panel-terminal/.test(String(leido.salida)), String(leido.salida).slice(0, 200));
  await pedir("POST", "/api/terminal", { accion: "cerrar", id: abierto.id });
  fs.writeFileSync(path.join(proyecto, "roto.js"), "function foo() {\n");
  const diagRoto = JSON.parse((await pedir("GET", `/api/diag?path=${encodeURIComponent("roto.js")}`)).body);
  check("los diagnósticos detectan el JS roto", Array.isArray(diagRoto.diagnosticos) && diagRoto.diagnosticos.length > 0 && diagRoto.diagnosticos[0].severidad === "error", JSON.stringify(diagRoto));
  const simbolosOk = JSON.parse((await pedir("GET", `/api/simbolos?path=${encodeURIComponent("roto.js")}`)).body);
  check("el esquema del archivo responde", Array.isArray(simbolosOk.simbolos) && simbolosOk.simbolos.some((s) => s.nombre === "foo"), JSON.stringify(simbolosOk));
  const def = JSON.parse((await pedir("POST", "/api/definir", { palabra: "foo", path: "roto.js" })).body);
  check("ir a definición encuentra la función", def.definicion?.archivo === "roto.js" && def.definicion?.linea === 1, JSON.stringify(def));
  // (El permiso sigue en "all": lo necesitan los pasos de abajo y se devuelve a "ask" tras el 12c.)

  // --- 21. Releer sin cambios se frena; tras un cambio, se permite ------------
  await chat("prueba de la relectura");
  const resLect = (id) => String(visto.find((b) => (b.messages || []).some((m) => m.tool_call_id === id))?.messages?.find((m) => m.tool_call_id === id)?.content || "");
  // Releer sin cambios ya NO se bloquea: el servidor conserva el contenido en un caché del
  // turno y lo devuelve, para que recuperar evidencia plegada no sea imposible.
  check("releer las mismas líneas sin cambios se sirve del caché (no se bloquea)", /Misma versión del archivo/.test(resLect("rl3")), resLect("rl3").slice(0, 160));
  check("tras cambiar el archivo, esa relectura sí se hace", /DOS/.test(resLect("rl5")) && !/Misma versión del archivo/.test(resLect("rl5")), resLect("rl5").slice(0, 120));

  // --- 17. Cierre optimista con el último comando en rojo: se avisa ------------
  const eventosOpt = await chat("prueba optimista final");
  const finalOpt = String(eventosOpt.filter((e) => e.type === "replace").pop()?.text || "");
  check("si el último comando falló y no lo dice, se avisa", /código 3/.test(finalOpt) && /no está comprobado/.test(finalOpt), finalOpt.slice(0, 200));
  const eventosBien = await chat("prueba de la guardia");
  check("si todo salió bien no se añade aviso", !eventosBien.some((e) => e.type === "replace" && /no está comprobado/.test(String(e.text || ""))));

  // --- 12c. Reescribir lo mismo no cuenta como cambio ------------------------
  const eventosIgual = await chat("prueba del bucle igual");
  const cmdsIgual = eventosIgual.filter((e) => e.type === "action" && e.kind === "cmd" && e.state === "done");
  check("tras reescribir el MISMO contenido, el comando no se relanza", cmdsIgual.length === 2 && /^Ya se ejecutó/.test(String(cmdsIgual[1]?.detail || "")), JSON.stringify(cmdsIgual.map((e) => String(e.detail || "").slice(0, 50))));
  const conIgual = visto.find((b) => (b.messages || []).some((m) => m.tool_call_id === "b3"));
  check("al modelo se le dice que el archivo no cambió", /ya tenía exactamente ese contenido/.test(String(conIgual?.messages?.find((m) => m.tool_call_id === "b3")?.content || "")));
  await pedir("POST", "/api/permit", { mode: "ask" });

  // --- 15b. Un modelo que no está en el catálogo (o no lo admite) no razona --
  const sinPensar = JSON.parse((await pedir("POST", "/api/settings", { pensar: 2048 })).body).pensarInfo || {};
  check("un modelo no compatible se queda sin razonamiento aunque se pida", sinPensar.compatible === false && sinPensar.efectivo === 0, JSON.stringify(sinPensar));
  const antesSin = visto.length;
  await chat("¿sigues ahí sin pensar?");
  const pidioSin = visto.slice(antesSin).filter((b) => b.stream);
  check("y sus peticiones van con enable_thinking false", pidioSin.length > 0 && pidioSin.every((b) => b.chat_template_kwargs?.enable_thinking === false), JSON.stringify(pidioSin.map((b) => b.chat_template_kwargs)));
  await pedir("POST", "/api/settings", { pensar: 0 });

  // --- 14. El resumidor ve las llamadas y no deja código en las notas --------
  {
    const resumidor = new BonsaiChat({ host: "127.0.0.1", port: puertoLlama, historyCap: 4096, sessionPath: path.join(tmp, "sesion-resumen.json"), timingsPath: null });
    resumidor.silent = true;
    const notas = await resumidor.summarize("", [
      { role: "user", content: "PRUEBA_RESUMEN monta un gestor de tareas" },
      { role: "assistant", content: "", toolCalls: [{ id: "r1", name: "archivo", arguments: JSON.stringify({ ruta: "api.py", contenido: "class Almacen:\n    pass\n" }) }] },
      { role: "tool", content: "Guardado api.py (24 bytes).", toolCallId: "r1" },
    ], "");
    const peticion = visto.filter((b) => !b.stream).pop();
    const textoPeticion = JSON.stringify(peticion?.messages || []);
    check("el resumidor recibe qué archivo se escribió", textoPeticion.includes("[llamó archivo(api.py"), textoPeticion.slice(0, 300));
    check("al resumidor no le llega el código del archivo", !textoPeticion.includes("class Almacen"));
    check("las notas no guardan el código inventado", !notas.includes("```") && !notas.includes("create_app") && notas.includes("Almacen"), notas);
  }

  // --- 8. Con Visión (mmproj): la imagen viaja al modelo como `image_url` ----
  // Segundo par llama-server falso + ui-server, este con modalities.vision = true.
  {
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-agente-vision-"));
    const proyecto2 = path.join(tmp2, "proyecto");
    fs.mkdirSync(proyecto2, { recursive: true });
    /** @type {Array<Record<string, any>>} */
    const visto2 = [];
    const llama2 = http.createServer((req, res) => {
      const url = req.url || "";
      const json = (body) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (url === "/health") return json({ status: "ok" });
      // Este servidor dice que sirve el GGUF del catálogo: así el adaptador declarado
      // para ese modelo (chat\modelo.json → catalogo.override6.toolcalls) está activo.
      if (url === "/props") return json({ default_generation_settings: { n_ctx: 32768 }, modalities: { vision: true }, model_path: path.join(HERE, "..", "models", String(MODELO.catalogo.override6.archivo)) });
      if (url === "/v1/models") return json({ data: [{ id: "falso-vision" }] });
      let raw = "";
      req.on("data", (p) => (raw += p));
      req.on("end", () => {
        const body = raw ? JSON.parse(raw) : {};
        if (url === "/v1/chat/completions/input_tokens") return json({ input_tokens: 120 });
        if (url !== "/v1/chat/completions") {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end("{}");
          return;
        }
        visto2.push(body);
        if (!body.stream) return json({ choices: [{ message: { content: "resumen" } }] });
        // El modelo escribe su llamada como TEXTO, con el dialecto de su plantilla. Es
        // salida CRUDA (la forma exacta está capturada en salida/eval-4/tarea-lru-cache.json:669).
        const textoUltimo = String(body.messages?.[body.messages.length - 1]?.content || "");
        const crudo = /prueba del dialecto del modelo/i.test(textoUltimo)
          ? "<tool_call>\n<function=archivo>\n<parameter=ruta>\nxml-nativo.txt\n</parameter>\n<parameter=contenido>\ndesde xml\n</parameter>\n</function>\n</tool_call>"
          : /Lee ventas\.json y genera/i.test(textoUltimo)
            ? "Listo. El resultado:\n```json\n{\"por_producto\": {\"manzana\": 90, \"pera\": 45}, \"total_general\": 135}\n```"
            : "";
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: crudo || "Veo un píxel." }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
        res.end("data: [DONE]\n\n");
      });
    });
    await new Promise((resolve) => llama2.listen(0, "127.0.0.1", () => resolve(undefined)));
    const puertoLlama2 = /** @type {import("node:net").AddressInfo} */ (llama2.address()).port;
    const hijo2 = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(PUERTO + 1), "--llama-port", String(puertoLlama2)], {
      cwd: HERE,
      env: { ...process.env, BONSAI_STATE: path.join(tmp2, "estado"), BONSAI_SALIDA: path.join(tmp2, "salida") },
      stdio: "ignore",
    });
    try {
      check("el servidor con visión arranca", await esperar(PUERTO + 1));
      check("fija la carpeta de trabajo", (await pedir("POST", "/api/workspace", { path: proyecto2 }, PUERTO + 1)).status === 200);
      const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      const adj = await pedir("POST", "/api/attach", { nombre: "pixel.png", datos: `data:image/png;base64,${pixel}` }, PUERTO + 1);
      const adjunto2 = JSON.parse(adj.body);
      check("con visión el adjunto lo anuncia", adjunto2.vision === true, adj.body.slice(0, 80));
      await chatEn(PUERTO + 1, "¿qué hay en la imagen?", { imagenes: [String(adjunto2.archivo)] });
      const cuerpo = visto2[visto2.length - 1];
      const mensaje = cuerpo?.messages?.[cuerpo.messages.length - 1] || {};
      const partes = Array.isArray(mensaje.content) ? mensaje.content : [];
      check("la imagen viaja como image_url", partes.some((p) => p.type === "image_url" && String(p.image_url?.url || "").startsWith("data:image/png;base64,")), JSON.stringify(partes).slice(0, 120));
      check("el texto del usuario sigue ahí", String(partes[0]?.text || "").includes("qué hay en la imagen"));
      check("ya no se le dice que no ve", !JSON.stringify(partes).includes("No tienes visión"));

      // --- 11. El modelo declara su dialecto: bonsai reconoce su tool call CRUDA ------
      // El servidor dice que sirve el GGUF de `override6`, cuyo dialecto está declarado en
      // chat\modelo.json. El modelo escribe la llamada como TEXTO (plantilla Qwen) y bonsai
      // tiene que EJECUTARLA tal cual: no se le pide que la escriba de otra forma.
      check("el dialecto del modelo está declarado", dialectoDe("override6", MODELO.catalogo) === "xml-funcion", dialectoDe("override6", MODELO.catalogo));
      // --- 15. Modo pensar: este servidor dice tener Override-6, que SÍ lo admite --------
      const info2 = JSON.parse((await pedir("GET", "/api/settings", undefined, PUERTO + 1)).body).pensarInfo || {};
      check("Override-6 se anuncia compatible con el modo pensar", info2.compatible === true && info2.recomendado > 0, JSON.stringify(info2));
      const conPensar = JSON.parse((await pedir("POST", "/api/settings", { pensar: 2048 }, PUERTO + 1)).body).pensarInfo || {};
      check("con Override-6 el razonamiento pedido se aplica", conPensar.efectivo === 2048, JSON.stringify(conPensar));
      const antesXml = visto2.length;
      const eventosXml = await chatEn(PUERTO + 1, "prueba del dialecto del modelo");
      const saltos = visto2.slice(antesXml).filter((b) => b.stream);
      check("el primer salto razona (plan)", saltos[0]?.chat_template_kwargs?.enable_thinking === true && saltos[0]?.thinking_budget_tokens === 2048, JSON.stringify(saltos[0]?.chat_template_kwargs));
      check("un salto rutinario tras un éxito no razona", saltos.length >= 2 && saltos[1]?.chat_template_kwargs?.enable_thinking === false, JSON.stringify(saltos.map((b) => b.chat_template_kwargs)));
      await pedir("POST", "/api/settings", { pensar: 0 }, PUERTO + 1);

      // --- 20. Una cerca de código en la respuesta NO crea archivos (modelo con tool calls) ---
      const antesCerca = new Set(fs.readdirSync(proyecto2));
      const eventosCerca = await chatEn(PUERTO + 1, "Lee ventas.json y genera resumen.json con el total");
      const nuevos = fs.readdirSync(proyecto2).filter((n) => !antesCerca.has(n));
      check("enseñar un resultado en ```json no crea un archivo inventado", nuevos.length === 0, nuevos.join(", "));
      check("y el turno no sigue dando saltos por eso", !eventosCerca.some((e) => e.type === "action"), JSON.stringify(eventosCerca.filter((e) => e.type === "action").map((e) => e.title)));
      const escrito = path.join(proyecto2, "xml-nativo.txt");
      check(
        "reconoce la tool call CRUDA del modelo y la ejecuta",
        fs.existsSync(escrito) && fs.readFileSync(escrito, "utf8") === "desde xml",
        fs.existsSync(escrito) ? JSON.stringify(fs.readFileSync(escrito, "utf8")) : "(no se creó)",
      );
      check("la llama como acción, no como texto", eventosXml.some((e) => e.type === "action" && e.kind === "write" && e.title === "xml-nativo.txt"), JSON.stringify(eventosXml.filter((e) => e.type === "action").map((e) => e.title)));
      check("el XML crudo no se enseña como respuesta", !eventosXml.some((e) => e.type === "replace" && /<tool_call>/i.test(String(e.text || ""))), JSON.stringify(eventosXml.filter((e) => e.type === "replace").map((e) => String(e.text || "").slice(0, 60))));
      check("no se le pide repetir la llamada como función", !visto2.slice(-2).some((b) => /No escribas bloques <tool_call>/i.test(String(b.messages?.[b.messages.length - 1]?.content || ""))));
    } finally {
      hijo2.kill();
      llama2.close();
      try {
        fs.rmSync(tmp2, { recursive: true, force: true });
      } catch {
        /* da igual */
      }
    }
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
console.log("prueba agente ok");
