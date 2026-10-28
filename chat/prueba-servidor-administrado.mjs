// Prueba aislada: nunca utiliza el puerto habitual ni detiene procesos ajenos.
// Cubre BUG-05: marcador con el PID real de llama-server.exe, cierre de un servidor huérfano
// cuando el lanzador ya murió, borrado del marcador al parar, compatibilidad con marcadores
// antiguos (pid del lanzador) y rechazo de todo proceso sin marcador válido.
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stop = path.join(root, "scripts", "stop-managed-server.ps1");
const launch = path.join(root, "scripts", "start-server.ps1");
const catalogo = JSON.parse(fs.readFileSync(path.join(root, "chat", "modelo.json"), "utf8"));
const run = promisify(execFile);
const ps = (...args) => run("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", stop, ...args], { windowsHide: true, timeout: 30000 });
const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const marcadorDe = (puerto) => path.join(root, "logs", `servidor-administrado-${puerto}.json`);

/** @returns {Promise<number>} */
function puertoLibre() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = /** @type {import("node:net").AddressInfo} */ (s.address()).port;
      s.close(() => resolve(p));
    });
  });
}

/**
 * @param {number} puerto
 * @param {Record<string, unknown>} datos
 */
function escribirMarcador(puerto, datos) {
  fs.mkdirSync(path.dirname(marcadorDe(puerto)), { recursive: true });
  fs.writeFileSync(marcadorDe(puerto), JSON.stringify(datos));
}

/** @param {number} puerto */
function borrarMarcador(puerto) {
  try {
    fs.unlinkSync(marcadorDe(puerto));
  } catch {
    /* no existía */
  }
}

/**
 * @param {number} puerto
 * @returns {Record<string, unknown> | null}
 */
function leerMarcador(puerto) {
  try {
    return JSON.parse(fs.readFileSync(marcadorDe(puerto), "utf8"));
  } catch {
    return null;
  }
}

/** PID que ya no existe, para marcadores rancios. */
function pidMuerto() {
  return spawnSync("cmd.exe", ["/c", "exit", "0"], { windowsHide: true }).pid;
}

/** @param {number} pid */
function vivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lanzador falso: un powershell.exe cuya línea de comandos parece un arranque administrado
 * (-ManagedByIDE + start-server.ps1) pero que solo duerme. No arranca ningún modelo.
 * @returns {Promise<{ hijo: import("node:child_process").ChildProcess, ticks: string }>}
 */
async function lanzadorFalso() {
  const hijo = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "& { Start-Sleep -Seconds 120 }", "-ManagedByIDE", path.join(root, "scripts", "start-server.ps1")],
    { windowsHide: true, stdio: "ignore" },
  );
  let ticks = "";
  for (let i = 0; i < 50 && !ticks; i += 1) {
    try {
      const texto = await run(
        "powershell.exe",
        ["-NoProfile", "-Command", `try { (Get-Process -Id ${hijo.pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks.ToString() } catch { "no" }`],
        { windowsHide: true, timeout: 10000 },
      );
      const valor = texto.stdout.trim();
      if (/^\d+$/.test(valor)) ticks = valor;
    } catch {
      /* el proceso aún no está */
    }
    if (!ticks) await esperar(100);
  }
  if (!ticks) throw new Error("el lanzador falso no arrancó");
  return { hijo, ticks };
}

// 1) Servidor ajeno sin marcador: ni se detiene ni se toca su puerto.
{
  const testServer = http.createServer((_req, res) => res.end("servidor ajeno"));
  await new Promise((resolve) => testServer.listen(0, "127.0.0.1", resolve));
  const port = testServer.address().port;
  try {
    await assert.rejects(ps("-Port", String(port)), /no administra/);
    await assert.rejects(ps("-Port", String(port), "-CheckOnly"), /no administra/);
    const respuesta = await fetch(`http://127.0.0.1:${port}`);
    assert.equal(await respuesta.text(), "servidor ajeno");
    console.log("OK: no se detiene el servidor ajeno del puerto solicitado");
  } finally {
    await new Promise((resolve) => testServer.close(resolve));
  }
  assert.equal((await ps("-Port", String(port), "-CheckOnly")).stdout.trim(), "empty");
  console.log("OK: puerto libre identificado");
}

// 2) Servidor ajeno con un marcador que apunta a PIDs que no son el bin\llama-server.exe:
//    el marcador no autoriza a matar nada.
{
  const testServer = http.createServer((_req, res) => res.end("servidor ajeno"));
  await new Promise((resolve) => testServer.listen(0, "127.0.0.1", resolve));
  const port = testServer.address().port;
  try {
    escribirMarcador(port, {
      modelo: "ornith9b", puerto: port, contexto: 8192, kv: "f16", vision: false,
      pensar: 0, dormir: 0, hostIP: "127.0.0.1", pid: pidMuerto(), wrapperPid: pidMuerto(),
      iniciado: "639287331916875405", pidServidor: pidMuerto(), iniciadoServidor: "639287331916875405",
    });
    await assert.rejects(ps("-Port", String(port)), /no administra/);
    const respuesta = await fetch(`http://127.0.0.1:${port}`);
    assert.equal(await respuesta.text(), "servidor ajeno");
    assert.ok(leerMarcador(port), "el marcador no debe borrarse si el puerto es ajeno");
    console.log("OK: un marcador con PIDs ajenos no autoriza a cerrar un servidor que no es de llama-server.exe");
  } finally {
    borrarMarcador(port);
    await new Promise((resolve) => testServer.close(resolve));
  }
}

// 3) Marcador de un puerto que no es el solicitado: no vale como prueba de propiedad.
{
  const testServer = http.createServer((_req, res) => res.end("servidor ajeno"));
  await new Promise((resolve) => testServer.listen(0, "127.0.0.1", resolve));
  const port = testServer.address().port;
  try {
    escribirMarcador(port, {
      modelo: "ornith9b", puerto: port + 1, contexto: 8192, kv: "f16", vision: false,
      pensar: 0, dormir: 0, hostIP: "127.0.0.1", pid: pidMuerto(), iniciado: "639287331916875405",
    });
    await assert.rejects(ps("-Port", String(port)), /no administra/);
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "servidor ajeno");
    console.log("OK: un marcador de otro puerto no autoriza a cerrar el puerto solicitado");
  } finally {
    borrarMarcador(port);
    await new Promise((resolve) => testServer.close(resolve));
  }
}

// 4) Marcador rancio (procesos muertos, puerto libre): se descarta para no bloquear.
{
  const port = await puertoLibre();
  try {
    escribirMarcador(port, {
      modelo: "ornith9b", puerto: port, contexto: 16384, kv: "f16", vision: true,
      pensar: 0, dormir: 0, hostIP: "127.0.0.1", pid: pidMuerto(), wrapperPid: pidMuerto(),
      iniciado: "639287331916875405", pidServidor: pidMuerto(), iniciadoServidor: "639287331916875406",
    });
    assert.equal((await ps("-Port", String(port), "-CheckOnly")).stdout.trim(), "empty");
    await ps("-Port", String(port));
    assert.equal(leerMarcador(port), null, "el marcador rancio debe borrarse al parar");
    console.log("OK: marcador rancio del formato nuevo se borra");
  } finally {
    borrarMarcador(port);
  }
  const port2 = await puertoLibre();
  try {
    escribirMarcador(port2, {
      modelo: "ornith9b", puerto: port2, contexto: 16384, kv: "f16", vision: true,
      pensar: 0, dormir: 0, hostIP: "127.0.0.1", pid: pidMuerto(), iniciado: "639287331916875405",
    });
    await ps("-Port", String(port2));
    assert.equal(leerMarcador(port2), null, "el marcador rancio antiguo debe borrarse al parar");
    console.log("OK: marcador rancio del formato antiguo (pid del lanzador) se borra");
  } finally {
    borrarMarcador(port2);
  }
}

// 5) Compatibilidad con marcadores antiguos: lanzador vivo pero sin hijo todavía.
//    Se informa "starting" y no se le mata ni se borra su marcador.
{
  const port = await puertoLibre();
  const { hijo, ticks } = await lanzadorFalso();
  try {
    escribirMarcador(port, {
      modelo: "ornith9b", puerto: port, contexto: 16384, kv: "f16", vision: true,
      pensar: 0, dormir: 0, hostIP: "127.0.0.1", pid: hijo.pid, iniciado: ticks,
    });
    assert.equal((await ps("-Port", String(port), "-CheckOnly")).stdout.trim(), "starting");
    await assert.rejects(ps("-Port", String(port)), /arranque administrado en curso/);
    assert.equal(vivo(hijo.pid), true, "no debe matarse al lanzador de un arranque en curso");
    assert.ok(leerMarcador(port), "no debe borrarse el marcador de un arranque en curso");
    console.log("OK: marcador antiguo con lanzador vivo se respeta (starting, sin matar)");
  } finally {
    borrarMarcador(port);
    try {
      execFileSync("taskkill", ["/PID", String(hijo.pid), "/F"], { stdio: "ignore" });
    } catch {
      /* ya no estaba */
    }
  }
}

// 6) Marcador nuevo con lanzador vivo y PID del servidor aún inexistente: también "starting".
{
  const port = await puertoLibre();
  const { hijo, ticks } = await lanzadorFalso();
  try {
    escribirMarcador(port, {
      modelo: "ornith9b", puerto: port, contexto: 16384, kv: "f16", vision: true,
      pensar: 0, dormir: 0, hostIP: "127.0.0.1", pid: hijo.pid, wrapperPid: hijo.pid, iniciado: ticks,
      pidServidor: pidMuerto(), iniciadoServidor: "639287331916875406",
    });
    assert.equal((await ps("-Port", String(port), "-CheckOnly")).stdout.trim(), "starting");
    await assert.rejects(ps("-Port", String(port)), /arranque administrado en curso/);
    assert.equal(vivo(hijo.pid), true);
    assert.ok(leerMarcador(port));
    console.log("OK: marcador nuevo con lanzador vivo se respeta (starting, sin matar)");
  } finally {
    borrarMarcador(port);
    try {
      execFileSync("taskkill", ["/PID", String(hijo.pid), "/F"], { stdio: "ignore" });
    } catch {
      /* ya no estaba */
    }
  }
}

// 7) Prueba real (opt-in): -ManagedByIDE debe registrar el PID de llama-server.exe y, si el
//    lanzador muere, el marcador debe permitir cerrar el huérfano. Necesita GPU y modelo.
if (process.argv.includes("--gpu")) {
  const port = await puertoLibre();
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", launch, "-ManagedByIDE", "-Modelo", "ornith9b", "-Port", String(port), "-ContextSize", "8192", "-Pensar", "0"],
    { cwd: root, windowsHide: true, stdio: "ignore" },
  );
  /** @type {Record<string, unknown> | null} */
  let datos = null;
  try {
    let ready = false;
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline && child.exitCode === null) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) })).ok) {
          ready = true;
          break;
        }
      } catch {
        /* cargando */
      }
      await esperar(1000);
    }
    assert.equal(ready, true, "servidor GPU de prueba no arrancó");
    datos = leerMarcador(port);
    assert.ok(datos, "el arranque administrado no escribió el marcador");
    assert.equal(Number.isInteger(datos.pidServidor), true, "el marcador no guarda el PID real de llama-server.exe");
    assert.equal(Number.isInteger(datos.wrapperPid), true, "el marcador no guarda el PID del lanzador");
    assert.notEqual(datos.pidServidor, datos.wrapperPid);
    assert.equal(datos.modelo, "ornith9b");
    assert.equal(datos.contexto, 8192);
    assert.equal(datos.kv, "f16");
    const info = JSON.parse(
      execFileSync(
        "powershell.exe",
        ["-NoProfile", "-Command", `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${datos.pidServidor}"; if ($p) { [pscustomobject]@{ exe = $p.ExecutablePath; cmd = $p.CommandLine } | ConvertTo-Json -Compress }`],
        { encoding: "utf8", windowsHide: true },
      ).trim(),
    );
    assert.equal(path.basename(String(info.exe)).toLowerCase(), "llama-server.exe", "el PID del marcador no es llama-server.exe");
    assert.match(String(info.cmd), new RegExp(`--port\\s+${port}(?:\\s|$)`));
    assert.equal((await ps("-Port", String(port), "-CheckOnly")).stdout.trim(), "managed");

    // BUG-05: muere el lanzador, el servidor sigue vivo y el marcador permite cerrarlo.
    execFileSync("taskkill", ["/PID", String(datos.wrapperPid), "/F"], { stdio: "ignore" });
    for (let i = 0; i < 50 && !vivo(Number(datos.pidServidor)); i += 1) {
      if (i === 0) await esperar(1000);
      else await esperar(100);
    }
    assert.equal(vivo(Number(datos.pidServidor)), true, "el servidor no sobrevivió al lanzador");
    assert.equal((await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) })).ok, true);
    assert.equal((await ps("-Port", String(port), "-CheckOnly")).stdout.trim(), "managed");
    await ps("-Port", String(port));
    assert.equal(leerMarcador(port), null, "el marcador no se borró al parar");
    for (let i = 0; i < 50 && vivo(Number(datos.pidServidor)); i += 1) await esperar(100);
    assert.equal(vivo(Number(datos.pidServidor)), false, "el llama-server huérfano sigue vivo");
    console.log("OK: se cierra el llama-server huérfano y se borra el marcador (BUG-05)");
  } finally {
    try {
      await ps("-Port", String(port));
    } catch {
      /* sin marcador/proceso verificable: no tocar */
    }
    if (child.exitCode === null) {
      try {
        execFileSync("taskkill", ["/PID", String(child.pid), "/F"], { stdio: "ignore" });
      } catch {
        /* ya no estaba */
      }
    }
    if (datos && Number.isInteger(datos.pidServidor) && vivo(Number(datos.pidServidor))) {
      try {
        execFileSync("taskkill", ["/PID", String(datos.pidServidor), "/F"], { stdio: "ignore" });
      } catch {
        /* ya no estaba */
      }
    }
    borrarMarcador(port);
  }
}
