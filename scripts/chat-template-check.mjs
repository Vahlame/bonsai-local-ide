#!/usr/bin/env node
/**
 * Auditoría de plantillas de chat de los GGUF instalados.
 *
 * Comprueba que cada modelo trae `tokenizer.chat_template` en su cabecera y qué
 * capacidades declara (system/user/assistant, herramientas, razonamiento,
 * visión). No arranca el motor: sirve para detectar un modelo que se probaría
 * con el formato equivocado.
 *
 *   node scripts/chat-template-check.mjs
 *   node scripts/chat-template-check.mjs --strict
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { leerMetadatosGGUF } from "../chat/model-plan.mjs";
import { listarInstalados, leerRegistro, fusionarCatalogo } from "../chat/model-hub.mjs";
import { MODELO } from "../chat/modelo.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const ESTRICTO = process.argv.includes("--strict");
fusionarCatalogo();

const filas = [];
const vistos = new Set();
for (const m of listarInstalados()) {
  if (!m.existe || m.oculto || vistos.has(m.archivo)) continue;
  vistos.add(m.archivo);
  filas.push({ clave: m.clave, nombre: m.nombre, archivo: m.archivo });
}
for (const [clave, e] of Object.entries(MODELO.catalogo || {})) {
  if (!e?.archivo || e.servidor?.tipo === "cpu" || vistos.has(e.archivo)) continue;
  const ruta = path.join(PROJECT, "models", e.archivo);
  if (!fs.existsSync(ruta)) continue;
  vistos.add(e.archivo);
  filas.push({ clave, nombre: e.nombre || clave, archivo: e.archivo });
}

const resultados = [];
for (const f of filas.sort((a, b) => a.clave.localeCompare(b.clave, "es"))) {
  const ruta = path.join(PROJECT, "models", f.archivo);
  try {
    const meta = leerMetadatosGGUF(ruta);
    const t = String(meta.metadata["tokenizer.chat_template"] || "");
    resultados.push({
      clave: f.clave,
      nombre: f.nombre,
      chars: t.length,
      system: /system/i.test(t),
      user: /user/i.test(t),
      assistant: /assistant/i.test(t),
      tools: /tool/i.test(t),
      thinking: /think|reason/i.test(t),
      vision: /image|vision/i.test(t),
      ok: t.length > 100 && /messages/i.test(t),
    });
  } catch (error) {
    resultados.push({ clave: f.clave, nombre: f.nombre, chars: 0, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

const ancho = Math.max(5, ...resultados.map((r) => r.clave.length));
const cab = `${"CLAVE".padEnd(ancho)}  CHARS  SYS  USER  ASST  TOOLS  THINK  VISIÓN`;
process.stdout.write(`${cab}\n${"-".repeat(cab.length)}\n`);
for (const r of resultados) {
  const si = (v) => (v ? " sí " : " -- ");
  process.stdout.write(`${r.clave.padEnd(ancho)}  ${String(r.chars).padStart(5)}  ${si(r.system)} ${si(r.user)} ${si(r.assistant)} ${si(r.tools)} ${si(r.thinking)} ${si(r.vision)}${r.ok ? "" : "  ⚠ sin plantilla válida"}\n`);
}
const malos = resultados.filter((r) => !r.ok);
process.stdout.write(`\n${resultados.length - malos.length}/${resultados.length} con plantilla válida\n`);
if (malos.length) {
  process.stdout.write(`Avisos: ${malos.map((r) => r.clave).join(", ")}\n`);
  if (ESTRICTO) process.exitCode = 1;
}
