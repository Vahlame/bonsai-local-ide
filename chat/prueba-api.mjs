/**
 * Pruebas de la API nueva del servidor de la interfaz (guardar, deshacer, buscar,
 * reglas, ajustes, git):
 *   node chat/prueba-api.mjs
 *
 * Arranca `ui-server.mjs` en un puerto libre con estado y proyecto TEMPORALES: no
 * toca los chats, el proyecto ni la carpeta de trabajo del usuario.
 */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** Catálogo real del proyecto: la prueba comprueba que /api/modelos lo refleja. */
const modelo = JSON.parse(fs.readFileSync(path.join(HERE, "modelo.json"), "utf8"));

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

const PUERTO = 8793;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-api-"));
const proyecto = path.join(tmp, "proyecto");
fs.mkdirSync(proyecto, { recursive: true });
const planGuardado = { pasos: ["Compilar", "Verificar"], hechos: [1], ts: 123 };
const paradaGuardada = { motivo: "step_limit", saltos: 192, completo: false, ts: 456 };
fs.mkdirSync(path.join(tmp, "estado"), { recursive: true });
fs.writeFileSync(path.join(tmp, "estado", "ui-session.json"), JSON.stringify({ memory: "", folded: 0, turns: [{ role: "user", content: "Trabajo pendiente" }], draft: "", files: [], plan: planGuardado, lastStop: paradaGuardada }));

// Proyecto de prueba: un archivo, un BONSAI.md y una regla de Cursor.
fs.writeFileSync(path.join(proyecto, "saludo.txt"), "hola mundo\nsegunda linea\n", "utf8");
fs.writeFileSync(path.join(proyecto, "BONSAI.md"), "Regla: responde en espanol.\n", "utf8");
fs.mkdirSync(path.join(proyecto, ".cursor", "rules"), { recursive: true });
fs.writeFileSync(path.join(proyecto, ".cursor", "rules", "estilo.mdc"), "---\nalwaysApply: true\n---\nUsa punto y coma.\n", "utf8");
fs.writeFileSync(path.join(proyecto, ".cursor", "rules", "ignorada.mdc"), "---\nalwaysApply: false\n---\nNo debe salir.\n", "utf8");
const grande = `${"x".repeat(70_000)}\nfinal\n`;
fs.writeFileSync(path.join(proyecto, "grande.txt"), grande, "utf8");
fs.writeFileSync(path.join(proyecto, "demasiado-grande.txt"), "x".repeat(2_000_001), "utf8");
fs.writeFileSync(path.join(proyecto, "binario.bin"), Buffer.from([0, 1, 2, 255]));
fs.writeFileSync(path.join(proyecto, "grande-borrar.txt"), "y".repeat(2_000_001), "utf8");
fs.writeFileSync(path.join(proyecto, "arte.html"), "<!doctype html><script>fetch('/api/state')</script>", "utf8");
fs.writeFileSync(path.join(proyecto, "arte.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", "utf8");

// llama-server de mentira: la API de la interfaz no necesita el modelo real, solo
// que `connect()` encuentre /health, /props y /v1/models. Antes la prueba dependía
// de que el puerto 8080 tuviera el servidor de verdad levantado.
const falsoLlama = http.createServer((req, res) => {
  const url = req.url || "";
  const json = (body) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url === "/health") return json({ status: "ok" });
  if (url === "/props") {
    return json({
      default_generation_settings: { n_ctx: 32768 },
      modalities: { vision: false },
      // El catálogo se resuelve por el nombre del archivo que sirve el servidor.
      model_path: path.join(HERE, "..", "models", String(modelo.modelo.archivo)),
    });
  }
  if (url === "/v1/models") return json({ data: [{ id: "falso" }] });
  res.writeHead(404).end("{}");
});
await new Promise((resolve) => falsoLlama.listen(0, "127.0.0.1", () => resolve(undefined)));
const puertoLlama = /** @type {import("node:net").AddressInfo} */ (falsoLlama.address()).port;

const hijo = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(PUERTO), "--llama-port", String(puertoLlama)], {
  cwd: HERE,
  env: { ...process.env, BONSAI_STATE: path.join(tmp, "estado"), BONSAI_SALIDA: path.join(tmp, "salida") },
  stdio: "ignore",
});

/**
 * @param {string} metodo
 * @param {string} ruta
 * @param {unknown} [cuerpo]
 * @returns {Promise<{status: number, body: string, headers: http.IncomingHttpHeaders}>}
 */
function pedir(metodo, ruta, cuerpo) {
  const datos = cuerpo === undefined ? "" : JSON.stringify(cuerpo);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PUERTO,
        method: metodo,
        path: ruta,
        headers: {
          host: `127.0.0.1:${PUERTO}`,
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
    // Un corte de conexión se reporta como status 0 en vez de tumbar la suite:
    // asi el fallo se ve como una comprobacion fallida y no como un stack trace.
    req.on("error", (err) => resolve({ status: 0, body: `conexion cortada: ${err.message}`, headers: {} }));
    if (datos) req.write(datos);
    req.end();
  });
}

async function esperar() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await pedir("GET", "/api/gpu");
      if (r.status === 200) return true;
    } catch {
      /* aun no escucha */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

try {
  check("el servidor arranca", await esperar());
  const ws = await pedir("POST", "/api/workspace", { path: proyecto });
  check("fija la carpeta de trabajo", ws.status === 200, `HTTP ${ws.status}`);

  // --- catálogo de modelos: viene de chat/modelo.json, no de la interfaz -----
  const cat = JSON.parse((await pedir("GET", "/api/modelos")).body);
  check("el catálogo sale de la configuración y dice cuál está cargado", cat.actual === "override6" && Array.isArray(cat.modelos) && cat.modelos.length >= 2, JSON.stringify(cat.actual));
  check("informa del modelo guardado para el próximo arranque", typeof cat.guardado === "string", JSON.stringify(cat.guardado));
  check("el catálogo trae el dialecto de tool calls de cada modelo", cat.modelos.every((m) => typeof m.clave === "string" && typeof m.nombre === "string"), JSON.stringify(cat.modelos.map((m) => m.clave)));

  // --- leer y guardar ------------------------------------------------------
  const leido = await pedir("GET", "/api/file?path=saludo.txt");
  check("lee un archivo", leido.status === 200 && leido.body.includes("hola mundo"), `HTTP ${leido.status}`);

  const guardado = await pedir("POST", "/api/file", { path: "saludo.txt", content: "adios mundo\n" });
  check("guarda un archivo", guardado.status === 200, `HTTP ${guardado.status} ${guardado.body}`);
  const idUndo = guardado.status === 200 ? JSON.parse(guardado.body).undo : "";
  check("devuelve id de deshacer", typeof idUndo === "string" && idUndo.length > 4, idUndo);
  check("el archivo cambia en disco", fs.readFileSync(path.join(proyecto, "saludo.txt"), "utf8") === "adios mundo\n");

  // --- artefactos HTML/SVG: origen opaco, sin acceso a la API del IDE --------
  const html = await pedir("GET", "/p/arte.html");
  const svg = await pedir("GET", "/p/arte.svg");
  const htmlCsp = String(html.headers["content-security-policy"] || "");
  check(
    "el HTML de artefacto se sirve con sandbox y sin referrer",
    html.status === 200 && /sandbox/.test(htmlCsp) && !/allow-same-origin/.test(htmlCsp) && html.headers["referrer-policy"] === "no-referrer",
    `${html.status} ${htmlCsp} ${html.headers["referrer-policy"] || ""}`,
  );
  check("el SVG de artefacto también se aísla", svg.status === 200 && /sandbox/.test(String(svg.headers["content-security-policy"] || "")));
  check("los artefactos no se adivinan como otro tipo", html.headers["x-content-type-options"] === "nosniff");

  // --- deshacer ------------------------------------------------------------
  const deshecho = await pedir("POST", "/api/undo", { id: idUndo });
  check("deshace la escritura", deshecho.status === 200, `HTTP ${deshecho.status}`);
  check("el archivo vuelve a su contenido", fs.readFileSync(path.join(proyecto, "saludo.txt"), "utf8") === "hola mundo\nsegunda linea\n");
  const deshecho2 = await pedir("POST", "/api/undo", { id: idUndo });
  // Ojo con lo que se afirma aquí: el punto de deshacer NO se consume (nadie lo borra).
  // El 409 sale del control de conflicto, porque tras deshacer el archivo ya no coincide
  // con lo que ese punto escribió. Comprobarlo por el motivo evita que esta prueba siga
  // en verde si alguien quita el control de conflicto.
  check("deshacer dos veces da 409 por conflicto", deshecho2.status === 409 && /cambio desde entonces/.test(deshecho2.body), `HTTP ${deshecho2.status} ${deshecho2.body}`);
  const otroProyecto = path.join(tmp, "otro-proyecto");
  fs.mkdirSync(otroProyecto);
  fs.writeFileSync(path.join(otroProyecto, "saludo.txt"), "adios mundo\n");
  await pedir("POST", "/api/workspace", { path: otroProyecto });
  const undoAjeno = await pedir("POST", "/api/undo", { id: idUndo, force: true });
  check("un punto de otro proyecto no modifica el actual", undoAjeno.status === 409 && fs.readFileSync(path.join(otroProyecto, "saludo.txt"), "utf8") === "adios mundo\n");
  await pedir("POST", "/api/workspace", { path: proyecto });

  // --- conflictos y limites ------------------------------------------------
  const otra = await pedir("POST", "/api/file", { path: "saludo.txt", content: "tercero\n" });
  const id3 = JSON.parse(otra.body).undo;
  fs.writeFileSync(path.join(proyecto, "saludo.txt"), "tocado por fuera\n", "utf8");
  const conflicto = await pedir("POST", "/api/undo", { id: id3 });
  check("409 si el archivo cambio por medio", conflicto.status === 409, `HTTP ${conflicto.status}`);
  const forzado = await pedir("POST", "/api/undo", { id: id3, force: true });
  check("force si restaura", forzado.status === 200, `HTTP ${forzado.status}`);
  const versionAntes = fs.readFileSync(path.join(proyecto, "saludo.txt"), "utf8");
  const versionObsoleta = await pedir("POST", "/api/file", { path: "saludo.txt", content: "no debe pisar", before: "version vieja" });
  check("un guardado obsoleto recibe 409 y no pisa el archivo", versionObsoleta.status === 409 && fs.readFileSync(path.join(proyecto, "saludo.txt"), "utf8") === versionAntes);
  const versionVigente = await pedir("POST", "/api/file", { path: "saludo.txt", content: versionAntes, before: versionAntes });
  check("guarda si la version del editor coincide", versionVigente.status === 200);

  // Si no se puede guardar la copia para deshacer, el original debe quedar intacto.
  const undoDir = path.join(tmp, "estado", "undo");
  const undoReservado = path.join(tmp, "estado", "undo-reservado");
  fs.renameSync(undoDir, undoReservado);
  fs.writeFileSync(undoDir, "bloqueado");
  try {
    const fallido = await pedir("POST", "/api/file", { path: "saludo.txt", content: "no guardar" });
    check("el fallo de copia no modifica el archivo", fallido.status === 500 && fs.readFileSync(path.join(proyecto, "saludo.txt"), "utf8") === versionAntes);
  } finally {
    fs.unlinkSync(undoDir);
    fs.renameSync(undoReservado, undoDir);
  }

  check("no guarda en metadatos Git", (await pedir("POST", "/api/file", { path: ".git/malo.txt", content: "x", create: true })).status === 403);
  check("no guarda fuera del proyecto", (await pedir("POST", "/api/file", { path: "../fuera.txt", content: "x", create: true })).status === 403);
  check("rechaza archivos de mas de 2 MB", (await pedir("POST", "/api/file", { path: "gordo.txt", content: "x".repeat(2_100_000), create: true })).status === 413);
  check("404 si no existe y no se pide crear", (await pedir("POST", "/api/file", { path: "nuevo.txt", content: "x" })).status === 404);
  check("crea si se pide", (await pedir("POST", "/api/file", { path: "nuevo.txt", content: "x", create: true })).status === 200);

  // --- deshacer un archivo NUEVO -------------------------------------------
  // Antes, crear un archivo no dejaba punto de deshacer (antes === null) y el
  // endpoint intentaba escribir null. Es justo el caso del agente creando código.
  const creado = await pedir("POST", "/api/file", { path: "creado.txt", content: "contenido nuevo\n", create: true });
  const idCreado = creado.status === 200 ? JSON.parse(creado.body).undo : "";
  check("crear un archivo deja punto de deshacer", idCreado.length > 4, `HTTP ${creado.status} id=${idCreado}`);
  const deshacerCreado = await pedir("POST", "/api/undo", { id: idCreado });
  check("deshacer una creación borra el archivo", deshacerCreado.status === 200 && !fs.existsSync(path.join(proyecto, "creado.txt")), `HTTP ${deshacerCreado.status} ${deshacerCreado.body}`);
  const deshacerOtraVez = await pedir("POST", "/api/undo", { id: idCreado });
  check("volver a deshacer la creación da 409 por conflicto", deshacerOtraVez.status === 409 && /cambio desde entonces/.test(deshacerOtraVez.body), `HTTP ${deshacerOtraVez.status} ${deshacerOtraVez.body}`);

  // --- rutas con % y con ./ -------------------------------------------------
  // Un nombre con "%" se pide codificado (%25). Con doble decodificación
  // decodeURIComponent("informe 50%.md") lanza URIError y el archivo daba 404.
  const conPorcentaje = "informe 50%.md";
  check("crea un archivo con % en el nombre", (await pedir("POST", "/api/file", { path: conPorcentaje, content: "50%\n", create: true })).status === 200);
  const leidoPorcentaje = await pedir("GET", `/api/file?path=${encodeURIComponent(conPorcentaje)}`);
  check("lee un archivo con % en el nombre", leidoPorcentaje.status === 200 && leidoPorcentaje.body === "50%\n", `HTTP ${leidoPorcentaje.status} ${JSON.stringify(leidoPorcentaje.body.slice(0, 60))}`);
  // La misma ruta por donde la interfaz abre el archivo (/p/, como la construye /api/state):
  // con la doble decodificación esto daba 404.
  const porUrl = await pedir("GET", `/p/${conPorcentaje.split("/").map(encodeURIComponent).join("/")}`);
  check("sirve por URL un archivo con % en el nombre", porUrl.status === 200 && porUrl.body === "50%\n", `HTTP ${porUrl.status} ${JSON.stringify(porUrl.body.slice(0, 60))}`);
  // "a%20b.txt" es un nombre literal: decodificarlo resolvía OTRO archivo ("a b.txt").
  check("crea un archivo que se llama a%20b.txt", (await pedir("POST", "/api/file", { path: "a%20b.txt", content: "literal\n", create: true })).status === 200);
  check("no confunde a%20b.txt con 'a b.txt'", fs.existsSync(path.join(proyecto, "a%20b.txt")) && !fs.existsSync(path.join(proyecto, "a b.txt")), fs.readdirSync(proyecto).join(", "));

  // --- carpetas protegidas a CUALQUIER profundidad --------------------------
  // Antes bastaba un prefijo ("./" o "sub/") para escribir dentro de node_modules o .git.
  check("node_modules pertenece al proyecto y admite texto explícito", (await pedir("POST", "/api/file", { path: "sub/node_modules/malo.js", content: "x", create: true })).status === 200);
  check("no guarda en .git ni con ./ delante", (await pedir("POST", "/api/file", { path: "./.git/config", content: "x", create: true })).status === 403);
  fs.mkdirSync(path.join(proyecto, "sub", "models"), { recursive: true });
  check("models es una carpeta normal del proyecto", (await pedir("POST", "/api/fs", { op: "borrar", path: "sub/models" })).status === 200);

  // Una junction de Windows puede apuntar fuera aunque la ruta parezca interna.
  const externo = path.join(tmp, "externo");
  fs.mkdirSync(externo);
  fs.writeFileSync(path.join(externo, "privado.txt"), "intacto");
  fs.symlinkSync(externo, path.join(proyecto, "enlace"), process.platform === "win32" ? "junction" : "dir");
  check("no lee por una junction externa", (await pedir("GET", "/api/file?path=enlace%2Fprivado.txt")).status !== 200);
  check("no guarda por una junction externa", (await pedir("POST", "/api/file", { path: "enlace/privado.txt", content: "cambiado" })).status === 403);
  check("no crea por una junction externa", (await pedir("POST", "/api/fs", { op: "nuevo", path: "enlace/nuevo.txt" })).status === 403);
  check("no renombra por una junction externa", (await pedir("POST", "/api/fs", { op: "renombrar", path: "saludo.txt", to: "enlace/nuevo.txt" })).status === 403);
  check("no borra por una junction externa", (await pedir("POST", "/api/fs", { op: "borrar", path: "enlace/privado.txt" })).status === 403);
  check("los archivos externos siguen intactos", fs.readFileSync(path.join(externo, "privado.txt"), "utf8") === "intacto" && !fs.existsSync(path.join(externo, "nuevo.txt")));
  const antesDeCambiarCarpeta = await pedir("POST", "/api/file", { path: "carpeta-undo/privado.txt", content: "propio", create: true });
  const undoEnlace = JSON.parse(antesDeCambiarCarpeta.body).undo;
  fs.renameSync(path.join(proyecto, "carpeta-undo"), path.join(proyecto, "carpeta-undo-original"));
  fs.symlinkSync(externo, path.join(proyecto, "carpeta-undo"), process.platform === "win32" ? "junction" : "dir");
  check("deshacer no sigue una junction nueva", (await pedir("POST", "/api/undo", { id: undoEnlace, force: true })).status === 403 && fs.readFileSync(path.join(externo, "privado.txt"), "utf8") === "intacto");

  // --- nuevo / renombrar / borrar ------------------------------------------
  check("no crea algo que ya existe", (await pedir("POST", "/api/fs", { op: "nuevo", path: "saludo.txt" })).status === 409);
  check("crea un archivo vacío y sus carpetas", (await pedir("POST", "/api/fs", { op: "nuevo", path: "sub/carpeta/x.txt" })).status === 200 && fs.existsSync(path.join(proyecto, "sub", "carpeta", "x.txt")));
  check("crea una carpeta", (await pedir("POST", "/api/fs", { op: "carpeta", path: "otra" })).status === 200 && fs.statSync(path.join(proyecto, "otra")).isDirectory());
  check("no renombra a algo que existe", (await pedir("POST", "/api/fs", { op: "renombrar", path: "sub/carpeta/x.txt", to: "saludo.txt" })).status === 409);
  check("no toca metadatos Git", (await pedir("POST", "/api/fs", { op: "borrar", path: ".git" })).status === 403);
  check("no borra fuera del proyecto", (await pedir("POST", "/api/fs", { op: "borrar", path: "../fuera.txt" })).status === 403);
  check("no crea fuera del proyecto", (await pedir("POST", "/api/fs", { op: "nuevo", path: "../malo.txt" })).status === 403);
  const renombrado = JSON.parse((await pedir("POST", "/api/fs", { op: "renombrar", path: "sub/carpeta/x.txt", to: "sub/y.txt" })).body);
  check("renombra un archivo", fs.existsSync(path.join(proyecto, "sub", "y.txt")) && !fs.existsSync(path.join(proyecto, "sub", "carpeta", "x.txt")), JSON.stringify(renombrado));
  check("renombrar deja punto de deshacer", typeof renombrado.undo === "string" && renombrado.undo.length > 4);
  const deshacerRen = await pedir("POST", "/api/undo", { id: renombrado.undo });
  check("deshace un renombrado", deshacerRen.status === 200 && fs.existsSync(path.join(proyecto, "sub", "carpeta", "x.txt")), `HTTP ${deshacerRen.status} ${deshacerRen.body}`);

  const antesDeBorrar = fs.readFileSync(path.join(proyecto, "saludo.txt"), "utf8");
  const borrado = JSON.parse((await pedir("POST", "/api/fs", { op: "borrar", path: "saludo.txt" })).body);
  check("borra un archivo", !fs.existsSync(path.join(proyecto, "saludo.txt")));
  check("borrar deja punto de deshacer", typeof borrado.undo === "string" && borrado.undo.length > 4);
  const deshacerBorrado = await pedir("POST", "/api/undo", { id: borrado.undo });
  check("deshacer un borrado lo restaura", deshacerBorrado.status === 200 && fs.readFileSync(path.join(proyecto, "saludo.txt"), "utf8") === antesDeBorrar, `HTTP ${deshacerBorrado.status}`);

  // --- sin escrituras del agente, "revertir el turno" avisa ------------------
  const nadaQueRevertir = await pedir("POST", "/api/undo", { turno: true });
  check("revertir el turno sin escrituras da 409", nadaQueRevertir.status === 409, `HTTP ${nadaQueRevertir.status}`);

  // --- adjuntar imágenes ----------------------------------------------------
  const pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const adjunto = await pedir("POST", "/api/attach", { nombre: "pixel.png", datos: `data:image/png;base64,${pixel}` });
  const adjuntoJ = adjunto.status === 200 ? JSON.parse(adjunto.body) : {};
  check("adjunta una imagen", adjunto.status === 200 && adjuntoJ.bytes > 0, `HTTP ${adjunto.status} ${adjunto.body.slice(0, 90)}`);
  check("la imagen no se guarda dentro del proyecto", fs.existsSync(path.join(tmp, "salida", "adjuntos", String(adjuntoJ.archivo))) && !fs.existsSync(path.join(proyecto, String(adjuntoJ.archivo))));
  check("avisa de que el servidor no tiene visión", adjuntoJ.vision === false, String(adjuntoJ.vision));
  check("rechaza un adjunto vacío", (await pedir("POST", "/api/attach", { nombre: "x.png", datos: "" })).status === 400);
  check("rechaza una imagen de más de 8 MB", (await pedir("POST", "/api/attach", { nombre: "x.png", datos: `data:image/png;base64,${"A".repeat(11_000_000)}` })).status === 413);

  // --- truncado ------------------------------------------------------------
  const big = await pedir("GET", "/api/file?path=grande.txt");
  check("archivos de mas de 60 KB se leen enteros para editar", big.headers["x-bonsai-truncado"] === "0" && big.body === grande);
  const enorme = await pedir("GET", "/api/file?path=demasiado-grande.txt");
  check("avisa de truncado solo al superar el limite de guardado", enorme.headers["x-bonsai-truncado"] === "1" && enorme.body.length === 2_000_000);
  check("informa del tamano real", Number(big.headers["x-bonsai-bytes"]) === Buffer.byteLength(grande, "utf8"), String(big.headers["x-bonsai-bytes"]));

  // --- buscar --------------------------------------------------------------
  const bus = await pedir("GET", "/api/search?q=mundo");
  check("busca en el proyecto", bus.status === 200 && bus.body.includes("saludo.txt"), `HTTP ${bus.status}`);
  const busCorta = await pedir("GET", "/api/search?q=m");
  check("pide 2 caracteres minimo", busCorta.status === 400);

  // --- reglas --------------------------------------------------------------
  const reglas = await pedir("GET", "/api/rules");
  const rj = JSON.parse(reglas.body);
  check("lee BONSAI.md", rj.fuentes.includes("BONSAI.md"), JSON.stringify(rj.fuentes));
  check("lee .cursor/rules con alwaysApply", rj.fuentes.includes(".cursor/rules/estilo.mdc"), JSON.stringify(rj.fuentes));
  check("ignora las reglas con alwaysApply: false", !rj.fuentes.includes(".cursor/rules/ignorada.mdc"), JSON.stringify(rj.fuentes));
  check("quita el frontmatter", !rj.texto.includes("alwaysApply"), rj.texto.slice(0, 60));
  check("las reglas salen como aplicadas", rj.aplicado === true, JSON.stringify(rj).slice(0, 120));
  check("el tope de reglas es el declarado", rj.topeTokens === 700, String(rj.topeTokens));
  await pedir("POST", "/api/settings", { reglas: false });
  check("el ajuste desactiva las reglas", JSON.parse((await pedir("GET", "/api/rules")).body).aplicado === false);
  await pedir("POST", "/api/settings", { reglas: true });
  check("y se vuelven a activar", JSON.parse((await pedir("GET", "/api/rules")).body).aplicado === true);

  // --- ajustes -------------------------------------------------------------
  const porDefecto = JSON.parse((await pedir("GET", "/api/settings")).body);
  check("ajustes por defecto", porDefecto.tema === "slate" && porDefecto.pensar === 0, JSON.stringify(porDefecto));
  const puestos = JSON.parse((await pedir("POST", "/api/settings", { tema: "light", inventado: 1 })).body);
  check("guarda ajustes", puestos.tema === "light", JSON.stringify(puestos));
  check("ignora claves no permitidas", !("inventado" in puestos), JSON.stringify(puestos));
  check("los ajustes persisten", JSON.parse((await pedir("GET", "/api/settings")).body).tema === "light");
  const limites = JSON.parse((await pedir("POST", "/api/settings", { saltosTope: 288, comandoSegundos: 900, continuarAuto: false })).body);
  check("los controles de autonomía y tiempo se guardan", limites.saltosTope === 288 && limites.comandoSegundos === 900 && limites.continuarAuto === false);
  const releidos = JSON.parse((await pedir("GET", "/api/settings")).body);
  check("los límites de ejecución sobreviven a una recarga", releidos.comandoSegundos === 900 && releidos.saltosTope === 288);

  // --- memoria global entre chats ------------------------------------------
  const memoriaInicial = JSON.parse((await pedir("GET", "/api/memoria")).body);
  check("la memoria global arranca vacía y con presupuesto explícito", memoriaInicial.total === 0 && memoriaInicial.config.presupuesto === 480, JSON.stringify(memoriaInicial).slice(0, 160));
  const agregada = await pedir("POST", "/api/memoria", { op: "add", texto: "En este proyecto usamos pnpm para instalar dependencias.", tags: ["proyecto", "paquetes"], fijada: true });
  const agregadaJson = JSON.parse(agregada.body);
  check("añade una nota de memoria global", agregada.status === 200 && agregadaJson.total === 1, `HTTP ${agregada.status} ${agregada.body.slice(0, 120)}`);
  const idMemoria = agregadaJson.entrada?.id || "";
  const secreto = await pedir("POST", "/api/memoria", { op: "add", texto: "api key = sk-abcdefghijklmnopqrstuv" });
  check("rechaza secretos en la memoria", secreto.status === 400, `HTTP ${secreto.status} ${secreto.body.slice(0, 80)}`);
  const memoriaConNota = JSON.parse((await pedir("GET", "/api/memoria")).body);
  check("la nota se puede inspeccionar", memoriaConNota.entradas.some((entrada) => entrada.id === idMemoria && entrada.fijada === true), JSON.stringify(memoriaConNota.entradas));
  const seleccion = JSON.parse((await pedir("GET", `/api/memoria?q=${encodeURIComponent("pnpm dependencias")}`)).body);
  check("la vista previa selecciona lo relevante dentro del presupuesto", seleccion.seleccion?.texto?.includes("pnpm") && seleccion.seleccion.entradas.includes(idMemoria) && seleccion.seleccion.tokens <= seleccion.seleccion.presupuesto, JSON.stringify(seleccion.seleccion).slice(0, 160));
  const estadoConMemoria = JSON.parse((await pedir("GET", "/api/state")).body);
  check("el estado enseña la memoria global", estadoConMemoria.memoriaGlobal?.total === 1 && estadoConMemoria.memoriaGlobal.activa === true, JSON.stringify(estadoConMemoria.memoriaGlobal).slice(0, 160));
  const editada = await pedir("POST", "/api/memoria", { op: "edit", id: idMemoria, texto: "En este proyecto usamos pnpm; npm está prohibido.", tags: ["proyecto"], fijada: false });
  check("edita una nota de memoria global", editada.status === 200 && JSON.parse(editada.body).entrada?.texto?.includes("npm está prohibido"), `HTTP ${editada.status} ${editada.body.slice(0, 120)}`);
  const presupuestoInvalido = await pedir("POST", "/api/settings", { memoriaGlobalTokens: 9999 });
  check("rechaza un presupuesto de memoria fuera de rango", presupuestoInvalido.status === 400, `HTTP ${presupuestoInvalido.status}`);
  const apagada = JSON.parse((await pedir("POST", "/api/settings", { memoriaGlobal: false })).body);
  check("la memoria global se puede apagar", apagada.memoriaGlobal === false, JSON.stringify(apagada).slice(0, 120));
  await pedir("POST", "/api/settings", { memoriaGlobal: true });
  const borrada = await pedir("POST", "/api/memoria", { op: "delete", id: idMemoria });
  check("borra una nota de memoria global", borrada.status === 200 && JSON.parse(borrada.body).total === 0, `HTTP ${borrada.status} ${borrada.body.slice(0, 120)}`);
  await pedir("POST", "/api/memoria", { op: "add", texto: "El proyecto usa SQLite para el estado local." });
  const sinConfirmar = await pedir("POST", "/api/memoria", { op: "clear" });
  check("no vacía toda la memoria sin confirmación", sinConfirmar.status === 400, `HTTP ${sinConfirmar.status}`);
  const vaciada = await pedir("POST", "/api/memoria", { op: "clear", confirm: true });
  check("vacía toda la memoria con confirmación", vaciada.status === 200 && JSON.parse(vaciada.body).total === 0, `HTTP ${vaciada.status}`);

  // --- modelos: catálogo y cambio (sin reiniciar si ya está cargado) --------
  const modelos = await pedir("GET", "/api/modelos");
  const mj = modelos.status === 200 ? JSON.parse(modelos.body) : { modelos: [] };
  check("el catálogo de modelos sale", modelos.status === 200 && mj.modelos.length >= 2, `HTTP ${modelos.status} ${modelos.body.slice(0, 90)}`);
  check("dice cuál está cargado", mj.actual === "override6", String(mj.actual));
  check("los GGUF del catálogo están enteros", mj.modelos.every((m) => m.existe), JSON.stringify(mj.modelos.map((m) => [m.clave, m.existe])));
  check("marca Ornith como predeterminado de GPU completa", mj.modelos.some((m) => m.predeterminado && m.clave === "ornith9b" && m.gpuCompleta), JSON.stringify(mj.modelos.map((m) => m.predeterminado)));
  const desconocido = await pedir("POST", "/api/modelos", { clave: "no-existe" });
  check("rechaza un modelo desconocido", desconocido.status === 400, `HTTP ${desconocido.status}`);
  const mismo = await pedir("POST", "/api/modelos", { clave: "override6" });
  check("rechaza incluso el modelo ya cargado si no garantiza GPU completa", mismo.status === 409, `HTTP ${mismo.status} ${mismo.body.slice(0, 90)}`);
  check("el servidor sigue vivo tras esa llamada", (await pedir("GET", "/api/state")).status === 200);

  // --- archivos estáticos de la interfaz (/ui/) ------------------------------
  // Antes solo se servían .js y .css y se aplanaba la ruta con path.basename, así
  // que una fuente en /ui/fuentes/ daba 404 y el @font-face fallaba en silencio.
  const fuente = await pedir("GET", "/ui/fuentes/inter-latin.woff2");
  check("sirve fuentes .woff2", fuente.status === 200, `HTTP ${fuente.status}`);
  check("con Content-Type font/woff2", fuente.headers["content-type"] === "font/woff2", String(fuente.headers["content-type"]));
  check("y se pueden cachear", /immutable/.test(String(fuente.headers["cache-control"])), String(fuente.headers["cache-control"]));
  check("sirve la hoja de fuentes", (await pedir("GET", "/ui/fuentes/fuentes.css")).status === 200);
  check("sirve el tema", (await pedir("GET", "/ui/tema.css")).status === 200);
  check("sirve los iconos", (await pedir("GET", "/ui/iconos.js")).status === 200);
  check("el codigo va sin cache (se ve al recargar)", /no-store/.test(String((await pedir("GET", "/ui/tema.css")).headers["cache-control"])));
  check("no deja salir de ui/", (await pedir("GET", "/ui/%2e%2e/ui-server.mjs")).status === 404);
  check("no sirve extensiones no permitidas", (await pedir("GET", "/ui/../models/x.gguf")).status === 404);

  // Todos los recursos que declara index.html tienen que existir: un 404 aqui se
  // ve como "la interfaz no carga" y es facil que pase desapercibido.
  const pagina = await pedir("GET", "/");
  check("sirve la pagina", pagina.status === 200 && pagina.body.includes("<title>"), `HTTP ${pagina.status}`);
  const referencias = [...pagina.body.matchAll(/(?:href|src)="(\/ui\/[^"]+)"/g)].map((m) => m[1]);
  check("la pagina declara recursos", referencias.length >= 4, `${referencias.length}`);
  for (const r of referencias) {
    const res = await pedir("GET", r);
    check(`el recurso ${r} existe`, res.status === 200, `HTTP ${res.status}`);
  }
  check("carga el sistema de diseno", referencias.includes("/ui/tema.css"), referencias.join(" "));
  check("carga los iconos", referencias.includes("/ui/iconos.js"), referencias.join(" "));
  check("carga las fuentes locales", referencias.some((r) => r.includes("fuentes.css")), referencias.join(" "));
  check("carga el modulo de funciones", referencias.includes("/ui/app.js"), referencias.join(" "));

  // --- git -----------------------------------------------------------------
  const gitFuera = JSON.parse((await pedir("GET", "/api/git")).body);
  check("detecta que no hay repositorio git", gitFuera.repo === false, JSON.stringify(gitFuera));
  const chats = JSON.parse((await pedir("GET", "/api/chats")).body);
  const guardadoInicio = JSON.parse(fs.readFileSync(path.join(tmp, "estado", "ui-chats", `${chats.active}.json`), "utf8"));
  check("arranque: el archivado conserva plan y parada", JSON.stringify(guardadoInicio.plan) === JSON.stringify(planGuardado) && JSON.stringify(guardadoInicio.lastStop) === JSON.stringify(paradaGuardada));
  check("crea otro chat", (await pedir("POST", "/api/chats", { op: "new" })).status === 200);
  check("reabre el chat pendiente", (await pedir("POST", "/api/chats", { op: "open", id: chats.active })).status === 200);
  const reabierto = JSON.parse(fs.readFileSync(path.join(tmp, "estado", "ui-session.json"), "utf8"));
  check("cambiar de chat conserva el plan y el motivo de parada", JSON.stringify(reabierto.plan) === JSON.stringify(planGuardado) && JSON.stringify(reabierto.lastStop) === JSON.stringify(paradaGuardada));
  check("detecta servidor de IA encendido", JSON.parse((await pedir("GET", "/api/servidor")).body).encendido === true);
  if (process.platform === "win32") {
    const ajeno = await pedir("POST", "/api/servidor", { accion: "apagar" });
    check("no apaga un servidor ajeno", ajeno.status !== 200 && JSON.parse((await pedir("GET", "/api/servidor")).body).encendido === true);
    await new Promise((resolve) => { falsoLlama.close(resolve); falsoLlama.closeAllConnections(); });
    check("detecta servidor de IA apagado", JSON.parse((await pedir("GET", "/api/servidor")).body).encendido === false);
    const cierre = await pedir("POST", "/api/servidor", { accion: "cerrar" });
    check("cierra el IDE con IA apagada", cierre.status === 200, cierre.body);
    await new Promise((resolve) => setTimeout(resolve, 300));
    check("el IDE dejó de escuchar", (await pedir("GET", "/api/state")).status === 0);
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
console.log("prueba api ok");
