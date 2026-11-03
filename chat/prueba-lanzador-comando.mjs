/** El comando reproducible debe salir del mismo perfil que el lanzador real. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createLauncherService } from "./server/services/launcher.mjs";

const proyecto = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-comando-"));
try {
  const catalog = {
    catalogo: {
      moe: {
        clave: "moe",
        archivo: "moe.gguf",
        chat_template: "{{ messages }}",
        pensar: { compatible: true, presupuesto: -1, nivel: "xhigh" },
        servidor: {
          tipo: "moe-hibrido",
          threads: 8,
          moe: { activo: true, capas: 48, nCpuMoe: 12, loadMode: "none" },
        },
        plan: { contexto: 32768, kv: "q8_0" },
      },
      parcial: {
        clave: "parcial",
        archivo: "parcial.gguf",
        pensar: { compatible: true, presupuesto: -1 },
        servidor: { tipo: "gpu-parcial", ngl: 24, threads: 8, cacheRamMiB: 0 },
        plan: { contexto: 16384, kv: "q4_0" },
      },
      sinPlantilla: {
        clave: "sinPlantilla",
        archivo: "sin.gguf",
        servidor: { tipo: "gpu-completa", threads: 4 },
        plan: { contexto: 8192, kv: "f16" },
      },
    },
  };
  const servicio = createLauncherService({
    projectRoot: proyecto,
    catalog,
    isNamedEnginePreset: () => false,
    engineProfile: () => ({}),
    selectBinary: () => ({ exe: path.join(proyecto, "bin", "llama-server.exe") }),
    LifecycleError: class extends Error {},
  });
  const moe = servicio.comandoServidorOptimizado("AUTO", 8080, "moe");
  assert.match(moe, /-t 8\b/);
  assert.match(moe, /--n-cpu-moe 12/);
  assert.match(moe, /--load-mode none/);
  assert.match(moe, /--reasoning-budget -1/);
  assert.match(moe, /--reasoning-effort xhigh/);
  assert.match(moe, /--chat-template-file/);
  assert.ok(!moe.includes("-t 4"), "el MoE medido usa 8 hilos, no 4");

  const parcial = servicio.comandoServidorOptimizado("AUTO", 8080, "parcial");
  assert.match(parcial, /--gpu-layers 24/);
  assert.match(parcial, /--fit off/);
  assert.match(parcial, /--load-mode mmap/);
  assert.match(parcial, /--cache-ram 0/);
  assert.match(parcial, /--reasoning-budget -1/);

  const sin = servicio.comandoServidorOptimizado("AUTO", 8080, "sinPlantilla");
  assert.ok(!sin.includes("--chat-template-file"), "no se referencia una plantilla que no existe");
  assert.ok(!sin.includes("--reasoning-budget"), "sin perfil de pensamiento no se inventa un presupuesto");

  console.log("prueba-lanzador-comando: OK");
} finally {
  fs.rmSync(proyecto, { recursive: true, force: true });
}
