// Prueba del PERFIL AUTOMATICO de arranque GPU, sin cargar el modelo ni tocar la GPU.
//
// `start-gpu-model.ps1 -DryRun -FreeMiBOverride N` sustituye la medida de nvidia-smi por N MiB
// libres y sale antes de lanzar llama-server, así que es determinista y no necesita GPU.
// Comprueba la búsqueda de la mejor combinación contexto/KV, el perfil recordado, los rechazos
// cuando no cabe, que el presupuesto coincide con chat/modelo.mjs y que los scripts son válidos.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODELO, estimarVramMiB } from "./modelo.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const script = path.join(root, "scripts", "start-gpu-model.ps1");
const perfilDe = (puerto) => path.join(root, "logs", `perfil-servidor-${puerto}.json`);

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

/** @param {number} puerto */
function borrarPerfil(puerto) {
  try {
    fs.unlinkSync(perfilDe(puerto));
  } catch {
    /* no existía */
  }
}

/**
 * @param {number} puerto
 * @returns {Record<string, unknown> | null}
 */
function leerPerfil(puerto) {
  try {
    return JSON.parse(fs.readFileSync(perfilDe(puerto), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Ejecuta el script en DryRun con una VRAM libre simulada.
 * @param {{libre: number, vision?: boolean, puerto: number, contexto?: number, kv?: string}} opciones
 * @returns {{codigo: number|null, salida: string, contexto: number|null, kv: string|null, presupuesto: number|null}}
 */
function perfilDryRun({ libre, vision = false, puerto, contexto, kv }) {
  const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Modelo", "ornith9b", "-DryRun", "-FreeMiBOverride", String(libre), "-Port", String(puerto)];
  if (vision) args.push("-Vision");
  if (contexto !== undefined) args.push("-ContextSize", String(contexto));
  if (kv !== undefined) args.push("-KVCacheType", kv);
  const r = spawnSync("powershell.exe", args, { encoding: "utf8", windowsHide: true, timeout: 60000 });
  const salida = `${r.stdout || ""}\n${r.stderr || ""}`;
  const elegido = salida.match(/contexto (\d+) \| KV (f16|q8_0|q4_0)/);
  const presupuesto = salida.match(/presupuesto conservador: (\d+) MiB/);
  return {
    codigo: r.status,
    salida,
    contexto: elegido ? Number(elegido[1]) : null,
    kv: elegido ? elegido[2] : null,
    presupuesto: presupuesto ? Number(presupuesto[1]) : null,
  };
}

// Los tres scripts que toca esta tarea deben ser PowerShell válido (no se ejecuta nada real).
{
  const scripts = ["start-gpu-model.ps1", "stop-managed-server.ps1", "start-ui.ps1"].map((n) => path.join(root, "scripts", n));
  const codigo = [
    "$ErrorActionPreference = 'Stop'",
    "foreach ($ruta in @(" + scripts.map((s) => `'${s}'`).join(", ") + ")) {",
    "  $tokens = $null; $errores = $null",
    "  [System.Management.Automation.Language.Parser]::ParseFile($ruta, [ref]$tokens, [ref]$errores) | Out-Null",
    "  if ($errores -and $errores.Count -gt 0) { Write-Output ($ruta + ': ' + $errores[0].Message); exit 1 }",
    "}",
    "exit 0",
  ].join("\n");
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", codigo], { encoding: "utf8", windowsHide: true, timeout: 60000 });
  assert.equal(r.status, 0, `script de PowerShell inválido: ${r.stdout || ""}${r.stderr || ""}`);
  console.log("OK: start-gpu-model.ps1, stop-managed-server.ps1 y start-ui.ps1 son PowerShell válido");
}

assert.equal(MODELO.catalogo.ornith9b.vision.contexto, 32768, "el techo de visión de ornith9b debe ser 32768");
assert.equal(MODELO.catalogo.ornith9b.servidor.capasAtencionCompleta, 8, "Ornith debe usar 8 capas de atención completa");

// A) Visión con 7956 MiB libres: 32768/q8_0 (no se queda en el techo fijo de 16K ni exige f16).
const p1 = await puertoLibre();
try {
  borrarPerfil(p1);
  const a = perfilDryRun({ libre: 7956, vision: true, puerto: p1 });
  assert.equal(a.codigo, 0, a.salida);
  assert.equal(a.contexto, 32768);
  assert.equal(a.kv, "q8_0");
  assert.equal(a.presupuesto, 7821);
  assert.equal(a.presupuesto, estimarVramMiB({ clave: "ornith9b", ctx: 32768, kv: "q8_0", vision: true }));
  assert.match(a.salida, /Perfil automatico/);
  // GPU completa: nada de pesos/KV/proyector en CPU.
  assert.match(a.salida, /--gpu-layers all/);
  assert.match(a.salida, /--override-tensor \.\*=CUDA0/);
  assert.match(a.salida, /--kv-offload/);
  assert.match(a.salida, /--mmproj-offload/);
  assert.match(a.salida, /--mmproj-device CUDA0/);
  assert.match(a.salida, /-c 32768 -ctk q8_0 -ctv q8_0/);
  assert.doesNotMatch(a.salida, /--n-gpu-layers 0|-ngl 0|--device CPU/);
  const guardado = leerPerfil(p1);
  assert.ok(guardado, "no se guardó logs/perfil-servidor-PUERTO.json");
  assert.equal(guardado.modelo, "ornith9b");
  assert.equal(guardado.contexto, 32768);
  assert.equal(guardado.kv, "q8_0");
  assert.equal(guardado.vision, true);
  assert.equal(guardado.libreMiB, 7956);
  console.log("OK: con visión y 7956 MiB libres elige 32768/q8_0 y lo persiste");

  // B) Siguiente arranque auto con MÁS VRAM: reutiliza 32768/q8_0 en vez de saltar a f16
  //    (un arranque desde cero elegiría f16 porque cabe: q8_0 demuestra que se reutilizó).
  const b = perfilDryRun({ libre: 9000, vision: true, puerto: p1 });
  assert.equal(b.codigo, 0, b.salida);
  assert.equal(b.contexto, 32768);
  assert.equal(b.kv, "q8_0", "no reutilizó el perfil recordado");
  assert.match(b.salida, /Perfil recordado/);
  assert.equal(b.presupuesto, 7821);
  console.log("OK: el siguiente arranque auto reutiliza el perfil recordado si sigue cabiendo");

  // C) Si el perfil recordado ya no cabe (7700 < 7821), se busca de nuevo y baja el KV.
  const c = perfilDryRun({ libre: 7700, vision: true, puerto: p1 });
  assert.equal(c.codigo, 0, c.salida);
  assert.equal(c.contexto, 32768);
  assert.equal(c.kv, "q4_0");
  assert.equal(c.presupuesto, 7565);
  assert.match(c.salida, /Perfil automatico/);
  assert.equal(leerPerfil(p1).kv, "q4_0");
  console.log("OK: si el perfil recordado no cabe se vuelve a buscar (32768/q4_0 con 7700 MiB)");

  // D) Con 7300 MiB no cabe ni la combinación mínima con visión: error claro y sin arrancar.
  const d = perfilDryRun({ libre: 7300, vision: true, puerto: p1 });
  assert.notEqual(d.codigo, 0, "debería rechazar el arranque si no cabe");
  assert.match(d.salida, /No cabe/);
  assert.match(d.salida, /7300/);
  assert.match(d.salida, /No se usa CPU como respaldo/);
  assert.equal(leerPerfil(p1).kv, "q4_0", "un rechazo no debe reescribir el perfil guardado");
  console.log("OK: sin VRAM suficiente falla con un error claro y no arranca");
} finally {
  borrarPerfil(p1);
}

// E) Sin visión con 7956 MiB: contexto máximo del perfil de servidor (32768) y KV f16.
const p2 = await puertoLibre();
try {
  borrarPerfil(p2);
  const e = perfilDryRun({ libre: 7956, puerto: p2 });
  assert.equal(e.codigo, 0, e.salida);
  assert.equal(e.contexto, 32768);
  assert.equal(e.kv, "f16");
  assert.equal(e.presupuesto, 7401);
  assert.equal(e.presupuesto, estimarVramMiB({ clave: "ornith9b", ctx: 32768, kv: "f16" }));
  assert.equal(leerPerfil(p2).vision, false);
  console.log("OK: sin visión con 7956 MiB elige 32768/f16");
} finally {
  borrarPerfil(p2);
}

// F) Rechazos de configuraciones explícitas que no caben (la automática elegiría q8_0).
const p3 = await puertoLibre();
try {
  borrarPerfil(p3);
  const f1 = perfilDryRun({ libre: 7956, vision: true, puerto: p3, contexto: 32768, kv: "f16" });
  assert.notEqual(f1.codigo, 0, "32768/f16 con visión no cabe en 7956 MiB");
  assert.match(f1.salida, /No cabe todo en GPU/);
  assert.match(f1.salida, /8301/);
  assert.equal(leerPerfil(p3), null, "una configuración explícita no genera perfil automático");
  const f2 = perfilDryRun({ libre: 7956, vision: true, puerto: p3, contexto: 16384, kv: "auto" });
  assert.equal(f2.codigo, 0, f2.salida);
  assert.equal(f2.contexto, 16384);
  assert.equal(f2.kv, "f16");
  assert.equal(f2.presupuesto, 7789);
  console.log("OK: rechaza 32768/f16 con visión y acepta 16384/f16 con 7956 MiB");
} finally {
  borrarPerfil(p3);
}

// G) Falta el GGUF: nunca se arranca (aunque haya VRAM de sobra).
const p4 = await puertoLibre();
try {
  borrarPerfil(p4);
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Modelo", "no-existe", "-DryRun", "-FreeMiBOverride", "9999", "-Port", String(p4)],
    { encoding: "utf8", windowsHide: true, timeout: 60000 },
  );
  assert.notEqual(r.status, 0, "un modelo desconocido debe rechazarse");
  assert.match(`${r.stdout || ""}${r.stderr || ""}`, /Modelo sin perfil de GPU completa/);
  console.log("OK: un modelo sin perfil verificado no arranca");
} finally {
  borrarPerfil(p4);
}

console.log("prueba perfil gpu ok");
