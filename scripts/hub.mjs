#!/usr/bin/env node
/**
 * CLI del Model Hub (sin abrir el IDE).
 *
 *   node scripts/hub.mjs list
 *   node scripts/hub.mjs scan
 *   node scripts/hub.mjs search "qwen3 coder"
 *   node scripts/hub.mjs repo unsloth/Qwen3-4B-Instruct-2507-GGUF
 *   node scripts/hub.mjs download qwen3-4b-2507
 *   node scripts/hub.mjs download <repo> --file <archivo.gguf> [--vision-file <mmproj.gguf>]
 *   node scripts/hub.mjs download-url <https://...gguf> [--name archivo.gguf] [--sha256 ...]
 *   node scripts/hub.mjs import C:\ruta\modelo.gguf
 *   node scripts/hub.mjs plan <clave>
 *   node scripts/hub.mjs jobs
 *   node scripts/hub.mjs delete <clave> --yes
 *   node scripts/hub.mjs status
 *
 * Los mensajes van a stderr para que `--json` pueda usarse en scripts.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODELS_DIR,
  HUB_FILE,
  borrarModelo,
  buscarHuggingFace,
  catalogoHub,
  crearTrabajo,
  importarArchivo,
  inspeccionarRepo,
  leerCurado,
  listarInstalados,
  listarTrabajos,
  planParaModelo,
  escanearModelos,
  resumen,
  vramInfo,
} from "../chat/model-hub.mjs";

const args = process.argv.slice(2);
const comando = args[0] || "list";
const resto = args.slice(1);
const opcion = (nombre, def = "") => {
  const i = resto.indexOf(`--${nombre}`);
  return i >= 0 && resto[i + 1] && !resto[i + 1].startsWith("--") ? resto[i + 1] : def;
};
const bandera = (nombre) => resto.includes(`--${nombre}`);
const json = bandera("json");

function salida(valor) {
  if (json || (valor && typeof valor === "object")) process.stdout.write(`${JSON.stringify(valor, null, 2)}\n`);
  else process.stdout.write(`${valor}\n`);
}

function tabla(filas, columnas) {
  const anchos = columnas.map((c) => Math.max(c.titulo.length, ...filas.map((f) => String(f[c.clave] ?? "").length)));
  const linea = (valores) => valores.map((v, i) => String(v ?? "").padEnd(anchos[i])).join("  ");
  return [linea(columnas.map((c) => c.titulo)), linea(anchos.map((a) => "-".repeat(a))), ...filas.map((f) => linea(columnas.map((c) => f[c.clave])))].join("\n");
}

const mib = (n) => `${(Number(n) / 1048576).toFixed(1)} MiB`;
const gib = (n) => `${(Number(n) / 1073741824).toFixed(2)} GiB`;

/** @param {string} id */
async function esperarTrabajo(id) {
  let ultimo = -1;
  while (true) {
    const t = listarTrabajos().find((x) => x.id === id);
    if (!t) throw new Error(`se perdió el trabajo ${id}`);
    if (t.estado === "descargando") {
      const pct = Math.floor(t.progreso);
      if (pct !== ultimo) {
        ultimo = pct;
        process.stderr.write(`\r${t.nombre}: ${pct}% · ${mib(t.bytesHechos)}/${mib(t.totalBytes)} · ${(t.velocidad / 1048576).toFixed(2)} MiB/s · ETA ${t.eta}s   `);
      }
    } else if (t.estado === "verificando" || t.estado === "instalando") {
      process.stderr.write(`\r${t.nombre}: ${t.estado}...${" ".repeat(40)}`);
    }
    if (["listo", "error", "cancelado"].includes(t.estado)) {
      process.stderr.write("\n");
      if (t.estado !== "listo") throw new Error(`${t.estado}: ${t.error || "sin detalle"}`);
      return t;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
}

try {
  if (comando === "list") {
    const instalados = listarInstalados();
    const curados = leerCurado().modelos;
    if (json) {
      salida({ instalados, curados });
    } else {
      process.stdout.write(`Modelos instalados (${instalados.length}) en ${MODELS_DIR}\n`);
      if (instalados.length) {
        process.stdout.write(`${tabla(instalados.map((m) => ({
          clave: m.clave,
          nombre: m.nombre,
          tamano: gib(m.bytes),
          plan: m.plan ? `${m.plan.contexto} tok · ${m.plan.kv}${m.plan.vision ? (m.plan.mmprojCPU ? " · visión CPU" : " · visión GPU") : ""}` : "",
          estado: m.existe ? "ok" : "FALTA",
        })), [
          { clave: "clave", titulo: "CLAVE" },
          { clave: "nombre", titulo: "NOMBRE" },
          { clave: "tamano", titulo: "TAMAÑO" },
          { clave: "plan", titulo: "PLAN" },
          { clave: "estado", titulo: "ESTADO" },
        ])}\n`);
      }
      process.stdout.write(`\nCatálogo curado (${curados.length})\n`);
      process.stdout.write(`${tabla(curados.map((m) => ({
        clave: m.clave,
        nombre: m.nombre,
        tamano: gib((Number(m.bytes) || 0) + (Number(m.vision?.bytes) || 0)),
        repo: m.repo || "",
        estado: instalados.some((i) => i.clave === m.clave || i.archivo === m.archivo) ? "instalado" : "disponible",
      })), [
        { clave: "clave", titulo: "CLAVE" },
        { clave: "nombre", titulo: "NOMBRE" },
        { clave: "tamano", titulo: "TAMAÑO" },
        { clave: "repo", titulo: "ORIGEN" },
        { clave: "estado", titulo: "ESTADO" },
      ])}\n`);
    }
  } else if (comando === "scan") {
    const r = await escanearModelos({});
    salida(r);
  } else if (comando === "search") {
    const q = resto.filter((a) => !a.startsWith("--")).join(" ");
    const r = await buscarHuggingFace(q, { limit: Number(opcion("limit", "20")) });
    if (json) salida(r);
    else process.stdout.write(`${tabla(r.map((m) => ({ repo: m.repo, descargas: m.descargas, licencia: m.licencia })), [
      { clave: "repo", titulo: "REPO" },
      { clave: "descargas", titulo: "DESCARGAS" },
      { clave: "licencia", titulo: "LICENCIA" },
    ])}\n`);
  } else if (comando === "repo") {
    const repo = resto.find((a) => !a.startsWith("--")) || "";
    const r = await inspeccionarRepo(repo);
    if (json) salida(r);
    else {
      process.stdout.write(`${r.repo} · revisión ${r.revision} · ${r.licencia || "licencia ?"} · ${r.descargas} descargas\n`);
      process.stdout.write(`${tabla(r.archivos.map((a) => ({ tipo: a.vision ? "mmproj" : "modelo", archivo: a.archivo, tamano: gib(a.bytes), quant: a.quant })), [
        { clave: "tipo", titulo: "TIPO" },
        { clave: "archivo", titulo: "ARCHIVO" },
        { clave: "tamano", titulo: "TAMAÑO" },
        { clave: "quant", titulo: "QUANT" },
      ])}\n`);
    }
  } else if (comando === "download" || comando === "download-url") {
    let pedido;
    if (comando === "download-url") {
      const url = resto.find((a) => /^https?:\/\//.test(a)) || "";
      pedido = { url, nombre: opcion("name"), bytes: Number(opcion("bytes", "0")) || undefined, sha256: opcion("sha256") || undefined };
    } else {
      const objetivo = resto.find((a) => !a.startsWith("--")) || "";
      if (/^https?:\/\//.test(objetivo)) {
        pedido = { url: objetivo, nombre: opcion("name"), sha256: opcion("sha256") || undefined };
      } else if (objetivo.includes("/")) {
        pedido = {
          repo: objetivo,
          archivo: opcion("file"),
          vision: opcion("vision-file") ? { archivo: opcion("vision-file") } : undefined,
          revision: opcion("revision", "main"),
        };
        if (!pedido.archivo) throw new Error("con un repo hay que pasar --file <archivo.gguf>");
      } else {
        pedido = { clave: objetivo };
      }
    }
    const { id, trabajo } = await crearTrabajo(pedido);
    process.stderr.write(`descarga ${id}: ${trabajo.nombre} (${gib(trabajo.totalBytes)})\n`);
    const fin = await esperarTrabajo(id);
    salida({ ok: true, trabajo: fin });
  } else if (comando === "import") {
    const ruta = resto.find((a) => !a.startsWith("--")) || "";
    const entrada = await importarArchivo(ruta, { nombre: opcion("name") || undefined });
    salida({ ok: true, modelo: entrada });
  } else if (comando === "plan") {
    const clave = resto.find((a) => !a.startsWith("--")) || "";
    const r = await planParaModelo(clave, { vision: !bandera("sin-vision"), actual: bandera("actual") });
    if (json) salida(r);
    else {
      const p = r.plan;
      process.stdout.write(`${r.entrada.nombre} (${clave})\n`);
      process.stdout.write(`  plan: ${p.contexto} tokens · KV ${p.kv}${p.vision ? (p.mmprojCPU ? " · visión CPU" : " · visión GPU") : " · sin visión"}\n`);
      process.stdout.write(`  VRAM: ${p.totalMiB} MiB de ${p.libreMiB} MiB · pesos ${p.pesosMiB} + KV ${p.kvMiB} + reserva ${p.reservaMiB}${p.draftMiB ? ` + draft ${p.draftMiB}` : ""}\n`);
      process.stdout.write(`  alternativas: f16 ${p.alternativas.f16.contexto} · q8_0 ${p.alternativas.q8_0.contexto} · q4_0 ${p.alternativas.q4_0.contexto}\n`);
      process.stdout.write(`  ${p.motivo}\n`);
    }
  } else if (comando === "jobs") {
    const jobs = listarTrabajos();
    if (json) salida(jobs);
    else process.stdout.write(`${tabla(jobs.map((j) => ({ id: j.id, nombre: j.nombre, estado: j.estado, progreso: `${j.progreso}%`, velocidad: `${(j.velocidad / 1048576).toFixed(2)} MiB/s` })), [
      { clave: "id", titulo: "ID" },
      { clave: "nombre", titulo: "NOMBRE" },
      { clave: "estado", titulo: "ESTADO" },
      { clave: "progreso", titulo: "%" },
      { clave: "velocidad", titulo: "VELOCIDAD" },
    ])}\n`);
  } else if (comando === "delete") {
    const clave = resto.find((a) => !a.startsWith("--")) || "";
    const r = borrarModelo(clave, { confirmar: bandera("yes") });
    salida(r);
  } else if (comando === "status") {
    const r = { ...resumen(), vram: await vramInfo(), catalogo: (await catalogoHub()).modelos.length, hubFile: HUB_FILE };
    if (json) salida(r);
    else process.stdout.write(`modelos=${r.modelos} · descargas activas=${r.descargasActivas} · VRAM ${r.vram.libreMiB}/${r.vram.totalMiB} MiB · ${r.modelosDir}\n`);
  } else if (comando === "download-recommended") {
    const curados = leerCurado().modelos.filter((m) => !m.oculto && (m.etiquetas || []).includes("recomendado"));
    for (const m of curados) {
      process.stderr.write(`\n== ${m.nombre} ==\n`);
      const { id } = await crearTrabajo({ clave: m.clave });
      await esperarTrabajo(id);
    }
    salida({ ok: true, descargados: curados.map((m) => m.clave) });
  } else {
    process.stderr.write(`Comando desconocido: ${comando}\n`);
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
