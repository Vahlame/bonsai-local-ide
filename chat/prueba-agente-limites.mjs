/**
 * Pruebas de aceptación del bucle del agente (hallazgos 13, 14, 15, 19 y 20 del
 * reporte de codex). A diferencia de `salida/auditoria-codex-ornith/repro.mjs`, que
 * documenta los fallos viejos, aquí se exige el comportamiento CORREGIDO:
 *
 *  - una tarea de 6 archivos puede completarse (no hay tope de 4 lecturas);
 *  - una tarea de más de 24 pasos sigue por tandas mientras avance;
 *  - releer tras un plegado o tras un comando devuelve contenido, no un bloqueo;
 *  - una línea gigante informa del recorte y su sufijo se puede pedir;
 *  - un turno que se atasca o anuncia sin actuar NO se presenta como terminado
 *    (evento done con motivo real).
 *
 * Usa un llama-server simulado y estado/carpeta temporales: no necesita GPU, no
 * descarga modelos y no toca las conversaciones del usuario.
 *
 *   node chat/prueba-agente-limites.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { estimateTokens } from "./context.mjs";
import { MODELO } from "./modelo.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-agente-"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tool = (id, name, args) => ({ tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] });

/**
 * Arranca ui-server contra un llama-server simulado y devuelve lo observado.
 * `script(paso, peticion)` decide la respuesta del modelo en cada generación.
 * @param {string} nombre
 * @param {(paso: number, peticion: any) => any} script
 * @param {(work: string, state: string) => void} [preparar]
 * @param {string} [pedido]
 */
async function integracion(nombre, script, preparar = () => {}, pedido = "Revisa los archivos necesarios y crea resultado.txt con la corrección completa.") {
  const dir = path.join(BASE, nombre);
  const state = path.join(dir, "estado");
  const work = path.join(dir, "proyecto");
  fs.mkdirSync(state, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  fs.writeFileSync(path.join(state, "ui-workspace.json"), JSON.stringify({ path: work }));
  fs.writeFileSync(path.join(state, "ui-settings.json"), JSON.stringify({ historial: 32768, pensar: 0, reglas: false }));
  fs.writeFileSync(path.join(state, "ui-permit.json"), JSON.stringify({ mode: "all" }));
  for (let i = 1; i <= 8; i += 1) fs.writeFileSync(path.join(work, `f${i}.txt`), `Contenido ${i}\n`);
  fs.writeFileSync(path.join(work, "rangos.txt"), Array.from({ length: 600 }, (_, i) => `LINEA_${i + 1}`).join("\n"));
  preparar(work, state);
  let paso = 0;
  const peticiones = [];
  const falso = http.createServer((req, res) => {
    const json = (dato) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(dato));
    if (req.url === "/health") return json({ status: "ok" });
    if (req.url === "/props") return json({ default_generation_settings: { n_ctx: 16384 }, modalities: { vision: false }, model_path: path.join(PROJECT, "models", MODELO.catalogo.ornith9b.archivo) });
    if (req.url === "/v1/models") return json({ data: [{ id: MODELO.catalogo.ornith9b.archivo }] });
    let crudo = "";
    req.on("data", (b) => { crudo += b; });
    req.on("end", () => {
      try {
        const body = crudo ? JSON.parse(crudo) : {};
        if (req.url === "/v1/chat/completions/input_tokens") return json({ input_tokens: estimateTokens(JSON.stringify(body.messages || [])) + 400 });
        if (req.url !== "/v1/chat/completions") return res.writeHead(404).end("{}");
        peticiones.push(body);
        if (!body.stream) return json({ choices: [{ message: { content: "resumen simulado" } }] });
        const delta = body.tool_choice === "none" ? { content: "CIERRE: no quedó todo terminado, faltaba trabajo." } : script(++paso, body, { puertoUi, puertoLlama });
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: delta.tool_calls ? { tool_calls: delta.tool_calls } : { content: delta.content || "" } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: delta.tool_calls ? "tool_calls" : "stop" }] })}\n\n`);
        res.end("data: [DONE]\n\n");
      } catch (err) {
        res.destroy(err);
      }
    });
  });
  await new Promise((r) => falso.listen(0, "127.0.0.1", r));
  const puertoLlama = falso.address().port;
  const ocupado = http.createServer();
  await new Promise((r) => ocupado.listen(0, "127.0.0.1", r));
  const puertoUi = ocupado.address().port;
  await new Promise((r) => ocupado.close(r));
  let log = "";
  const hijo = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(puertoUi), "--llama-port", String(puertoLlama)], {
    cwd: PROJECT,
    env: { ...process.env, BONSAI_STATE: state, BONSAI_SALIDA: path.join(dir, "salida") },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  hijo.stdout.on("data", (b) => { log += b; });
  hijo.stderr.on("data", (b) => { log += b; });
  try {
    let listo = false;
    for (let i = 0; i < 100; i += 1) {
      try {
        const r = await fetch(`http://127.0.0.1:${puertoUi}/api/state`, { signal: AbortSignal.timeout(500) });
        if (r.ok) { listo = true; break; }
      } catch { /* arrancando */ }
      if (hijo.exitCode !== null) throw new Error(`el servidor murió:\n${log}`);
      await wait(100);
    }
    if (!listo) throw new Error(`la UI no arrancó:\n${log}`);
    const respuesta = await fetch(`http://127.0.0.1:${puertoUi}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: pedido }),
      signal: AbortSignal.timeout(120000),
    });
    const texto = await respuesta.text();
    const eventos = texto.split("\n").filter((l) => l.startsWith("data:")).map((l) => JSON.parse(l.slice(5)));
    const error = eventos.find((e) => e.type === "error");
    if (error) throw new Error(`evento error: ${error.text}`);
    const sesion = JSON.parse(fs.readFileSync(path.join(state, "ui-session.json"), "utf8"));
    const acciones = eventos.filter((e) => e.type === "action" && e.state === "done");
    return {
      nombre,
      pasos: paso,
      done: eventos.find((e) => e.type === "done") || null,
      acciones,
      sesion,
      final: (sesion.turns || []).filter((t) => t.role === "assistant").at(-1)?.content || "",
      resultadosHerramienta: peticiones.filter((b) => b.stream).flatMap((b) => (b.messages || []).filter((t) => t.role === "tool").map((t) => t.content)),
      resultadosNativos: peticiones.filter((b) => b.stream).flatMap((b) => (b.messages || []).filter((t) => t.role === "tool")),
      existeResultado: fs.existsSync(path.join(work, "resultado.txt")),
      work,
      state,
      log,
      procesosAlFinal: await (await fetch(`http://127.0.0.1:${puertoUi}/api/procesos`)).json(),
      sistema: peticiones.find((p) => p.stream)?.messages?.[0]?.content || "",
    };
  } finally {
    try { await fetch(`http://127.0.0.1:${puertoUi}/api/procesos`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accion: "detener-todos" }) }); } catch { /* UI ya cerrada */ }
    const salida = hijo.exitCode === null ? once(hijo, "exit") : Promise.resolve();
    hijo.kill();
    await salida;
    falso.closeAllConnections();
    await new Promise((r) => falso.close(r));
  }
}

let fallos = 0;
const check = (nombre, cond, detalle = "") => {
  if (cond) console.log(`ok    ${nombre}`);
  else {
    fallos += 1;
    console.error(`FALLO ${nombre}${detalle ? `: ${detalle}` : ""}`);
  }
};

try {
  // ---------- 13: tarea de 6 archivos (antes se bloqueaba en 4) ----------
  const seis = await integracion("seis-archivos", (n) => (n <= 6 ? tool(`r${n}`, "leer", { ruta: `f${n}.txt` }) : n === 7 ? tool("w1", "archivo", { ruta: "resultado.txt", contenido: "ARREGLADO" }) : { content: "Completado y comprobado." }));
  check("13: seis archivos distintos se leen sin bloqueo", seis.acciones.filter((a) => a.kind === "read").length >= 6, JSON.stringify(seis.acciones.filter((a) => a.kind === "read").map((a) => a.title)));
  check("13: ninguna lectura se rechaza por «ya leíste suficiente»", !seis.acciones.some((a) => /Ya leíste suficiente|Ya hubo varias/.test(String(a.detail))));
  check("13: la tarea de 6 archivos termina y escribe el resultado", seis.existeResultado && seis.done?.motivo === "completed", JSON.stringify(seis.done));

  // ---------- 15: tarea de >24 pasos con rangos distintos ----------
  const saltos = await integracion("mas-de-24-pasos", (n) => (n <= 26 ? tool(`r${n}`, "leer", { ruta: "rangos.txt", desde: n, hasta: n }) : n === 27 ? tool("w1", "archivo", { ruta: "resultado.txt", contenido: "ARREGLADO" }) : { content: "Terminado tras muchas lecturas distintas." }));
  check("15: una tarea que necesita más de 24 pasos continúa por tandas", saltos.existeResultado && saltos.pasos >= 27, `pasos=${saltos.pasos}`);
  check("15: el cierre informa del motivo real", saltos.done?.motivo === "completed" && saltos.done?.incompleto === false, JSON.stringify(saltos.done));
  check("15: no deja una promesa de acción futura como respuesta", !/Voy a leer/.test(saltos.final), saltos.final);

  // ---------- 14a: releer tras plegado se sirve del caché ----------
  const plegado = await integracion("releer-tras-plegar", (n) => (n === 1 ? tool("r1", "leer", { ruta: "f1.txt" }) : n === 2 ? tool("cache", "archivo", { ruta: "cache.txt", contenido: "DATOS_GENERADOS_".repeat(1600) }) : n === 3 || n === 4 ? tool(`again${n}`, "leer", { ruta: "f1.txt" }) : n === 5 ? tool("w1", "archivo", { ruta: "resultado.txt", contenido: "ARREGLADO" }) : { content: "Completado." }));
  check("14a: releer tras plegar devuelve contenido en vez de bloquear", plegado.acciones.filter((a) => a.kind === "read" && /Contenido 1/.test(String(a.detail))).length >= 2 || plegado.resultadosHerramienta.filter((t) => /Contenido 1/.test(t)).length >= 2, `lecturas=${plegado.acciones.filter((a) => a.kind === "read").length}`);
  check("14a: la tarea termina tras recuperar la evidencia plegada", plegado.existeResultado, JSON.stringify(plegado.done));

  // ---------- 14b: releer tras un comando ve la versión nueva ----------
  const trasComando = await integracion("releer-tras-comando", (n) => (n === 1 ? tool("r1", "leer", { ruta: "f1.txt" }) : n === 2 ? tool("cmd1", "ejecutar", { comando: `node -e "require('fs').writeFileSync('f1.txt','CONTENIDO_NUEVO')"` }) : n === 3 || n === 4 ? tool(`again${n}`, "leer", { ruta: "f1.txt" }) : n === 5 ? tool("w1", "archivo", { ruta: "resultado.txt", contenido: "ARREGLADO" }) : { content: "Completado." }));
  check("14b: tras un comando que cambia el archivo, la relectura ve lo nuevo", trasComando.resultadosHerramienta.some((t) => /CONTENIDO_NUEVO/.test(t)), trasComando.resultadosHerramienta.filter((t) => t.includes("CONTENIDO_NUEVO")).length ? "" : trasComando.resultadosHerramienta.join(" | ").slice(0, 500));
  check("14b: la tarea termina tras invalidar por versión", trasComando.existeResultado, JSON.stringify(trasComando.done));

  // ---------- 20: línea gigante avisa y su sufijo se puede pedir ----------
  const gigante = await integracion(
    "linea-gigante",
    (n) => (n === 1 ? tool("r1", "leer", { ruta: "larga.txt" }) : n === 2 ? tool("r2", "leer", { ruta: "larga.txt:1:c6001-9017" }) : n === 3 ? tool("w1", "archivo", { ruta: "resultado.txt", contenido: "SUFIJO_ENCONTRADO" }) : { content: "Completado." }),
    (work) => fs.writeFileSync(path.join(work, "larga.txt"), `${"A".repeat(9000)}SUFIJO_NO_VISIBLE`),
  );
  const lecturaLarga = gigante.resultadosHerramienta.find((t) => t.startsWith("Archivo larga.txt) ") || t.startsWith("Archivo larga.txt ")) || "";
  check("20: la primera lectura avisa del recorte dentro de la línea", /recorte dentro de la línea 1/.test(lecturaLarga), lecturaLarga.slice(0, 240));
  const rangoSufijo = gigante.resultadosHerramienta.find((t) => t.startsWith("Archivo larga.txt (línea 1")) || "";
  check("20: el rango de columnas recupera el sufijo oculto", rangoSufijo.includes("SUFIJO_NO_VISIBLE"));
  check("20: el sufijo recuperado se puede usar en el resultado", gigante.existeResultado && fs.readFileSync(path.join(gigante.work, "resultado.txt"), "utf8") === "SUFIJO_ENCONTRADO");

  // ---------- 15b: turno atascado no se presenta como terminado ----------
  const atasco = await integracion("atasco", () => tool("same", "leer", { ruta: "f1.txt" }));
  check("15b: un bucle de lecturas idénticas se detecta como atasco", atasco.done?.motivo === "stalled", JSON.stringify(atasco.done));
  check("15b: el atasco se comunica como incompleto", atasco.done?.incompleto === true);
  check("15b: la respuesta final avisa de que puede faltar trabajo", /⚠️|atasc/i.test(atasco.final), atasco.final.slice(-200));
  check("15b: no se inventa el archivo pedido", !atasco.existeResultado);

  // ---------- 15c: prosa que solo anuncia una acción no es un final válido ----------
  const anuncia = await integracion("anuncia-sin-actuar", (n) => (n === 1 ? tool("r1", "leer", { ruta: "f1.txt" }) : { content: "Voy a leer lo que falta." }));
  check("15c: anunciar sin actuar no cuenta como tarea completada", anuncia.done?.motivo === "stalled", JSON.stringify(anuncia.done));
  check("15c: el cierre forzado dice que no quedó terminado", /no quedó todo terminado|⚠️|atasc/i.test(anuncia.final), anuncia.final.slice(-200));

  // Regresiones observadas en Tic-Tac-Toe: raíz '.', formatos nativos y servidor real.
  const local = await integracion("servidor-local", (n, body) => {
    if (n === 1) return tool("idx", "indice", { carpeta: "." });
    if (n === 2) return tool("srv", "archivo", { ruta: "servidor.cjs", contenido: "let n=0;const s=require('http').createServer((q,r)=>r.end('RESPUESTA_'+(++n)));s.listen(0,'127.0.0.1',()=>console.log('PORT '+s.address().port));" });
    if (n === 3) return tool("bg", "ejecutar", { comando: "node servidor.cjs", segundo_plano: true });
    if (n === 4 || n === 5) {
      const port = JSON.stringify(body.messages).match(/PORT (\d+)/)?.[1];
      assert.ok(port, "el modelo recibe el puerto real del servidor");
      return tool(`http${n}`, "ejecutar", { comando: `node -e "require('http').get('http://127.0.0.1:${port}/',r=>r.pipe(process.stdout))"` });
    }
    if (n === 6) {
      const id = JSON.stringify(body.messages).match(/id (bg[a-z0-9]+)/)?.[1];
      return tool("log", "proceso", { accion: "leer", id });
    }
    return { content: "Servidor comprobado dos veces y disponible." };
  });
  check("local: indice('.') lista la raíz", local.resultadosHerramienta.some((t) => t.startsWith("Índice del repositorio")));
  check("local: el contexto incluye la raíz seleccionada", local.sistema.includes(JSON.stringify(local.work)));
  check("local: ambas comprobaciones HTTP se ejecutan de verdad", local.resultadosHerramienta.some((t) => t.includes("RESPUESTA_1")) && local.resultadosHerramienta.some((t) => t.includes("RESPUESTA_2")));
  check("local: el servidor sigue vivo después del cierre del turno", local.procesosAlFinal.procesos.length === 1 && local.done?.motivo === "completed");
  const fondo = local.resultadosHerramienta.find((t) => t.startsWith("Lanzado en segundo plano")) || "";
  check("local: el resultado conserva id y duración correcta", /id bg/.test(fondo) && /Sobrevive al turno/.test(fondo) && !/hasta el final del turno/.test(fondo));
  check("local: proceso leer consulta el estado y salida actuales", local.resultadosHerramienta.some((t) => t.includes('"vivo": true') && t.includes("PORT ")));
  const repetir = await integracion("repetir-explicito", (n) => n <= 2 ? tool(`cmd${n}`, "ejecutar", { comando: 'node -e "console.log(Date.now())"', repetir: true }) : { content: "Dos comprobaciones ejecutadas." });
  check("local: repetir fuerza la ejecución nueva", repetir.acciones.filter((a) => a.kind === "cmd" && a.code === 0 && !String(a.detail).startsWith("Ya se ejecutó")).length === 2);
  const indices = await integracion("bucle-indices", () => tool("idx", "indice", { carpeta: "." }));
  check("local: listar la misma raíz no simula progreso", indices.done?.motivo === "stalled" && indices.pasos < 40, `pasos=${indices.pasos}`);
  const fuente = http.createServer((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end("<title>Fuente de prueba</title><main>REFERENCIA_TECNICA_VERIFICADA</main>"));
  await new Promise((r) => fuente.listen(0, "127.0.0.1", r));
  try {
    const leida = await integracion("leer-fuente-web", (n) => n === 1 ? tool("fuente", "leer_web", { url: `http://127.0.0.1:${fuente.address().port}/docs` }) : { content: "Fuente leída y comprobada." });
    check("web: el texto real llega al modelo como resultado de su llamada", leida.resultadosHerramienta.some((t) => t.includes("REFERENCIA_TECNICA_VERIFICADA") && t.includes("no confiables")) && leida.done?.motivo === "completed");
  } finally { fuente.closeAllConnections(); await new Promise((r) => fuente.close(r)); }
  const privados = await integracion("web-puertos-protegidos", (n, _body, puertos) => n <= 2
    ? tool(`privado${n}`, "leer_web", { url: `http://127.0.0.1:${n === 1 ? puertos.puertoUi : puertos.puertoLlama}/${n === 1 ? "api/state" : "props"}` })
    : { content: "Se conservaron los puertos privados." });
  check("web: leer_web no accede al estado del IDE ni al modelo", ["privado1", "privado2"].every((id) => privados.resultadosNativos.some((t) => t.tool_call_id === id && t.content.includes("puerto pertenece al IDE o al modelo"))) && privados.done?.motivo === "completed");
} finally {
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* evidencia en temp */ }
}

if (fallos) {
  console.error(`\nprueba-agente-limites: ${fallos} fallo(s)`);
  process.exitCode = 1;
} else {
  console.log("\nprueba-agente-limites: OK");
}
