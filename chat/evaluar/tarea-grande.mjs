#!/usr/bin/env node
/**
 * Prueba de punta a punta del caso que falló en la conversación real (un HTML 3D grande e
 * interactivo): el agente tiene que ESCRIBIR un archivo largo en una carpeta limpia y cerrar
 * con texto, sin quedarse investigando ni cortando la llamada.
 *
 *   node chat/evaluar/tarea-grande.mjs                 # sin razonamiento
 *   node chat/evaluar/tarea-grande.mjs --pensar 2048   # con razonamiento (si el modelo lo admite)
 *
 * Usa el llama-server que esté abierto (puerto 8080) y un ui-server con estado TEMPORAL: no
 * toca los chats ni la carpeta del usuario. Deja el resultado en salida/tarea-grande-<sello>/.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { leerSSE } from "../sse.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHAT = path.dirname(HERE);
const PROJECT = path.dirname(CHAT);

const args = process.argv.slice(2);
const pensar = args.includes("--pensar") ? Number(args[args.indexOf("--pensar") + 1]) || 0 : 0;
const PUERTO = 8792;
const sello = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const raiz = path.join(PROJECT, "salida", `tarea-grande-${sello}${pensar ? "-pensar" : ""}`);
const estado = path.join(raiz, "estado");
const ws = path.join(raiz, "ws");
fs.mkdirSync(estado, { recursive: true });
fs.mkdirSync(ws, { recursive: true });
if (pensar > 0) fs.writeFileSync(path.join(estado, "ui-settings.json"), JSON.stringify({ pensar }), "utf8");

const PEDIDO = "necesito que me hagas un modelo 3d en un archivo html de un motor de 4 cilindros desarmado e interactuable (piezas separadas que se puedan juntar y separar con un botón, y rotar con el ratón)";

const ui = spawn(process.execPath, [path.join(CHAT, "ui-server.mjs"), "--port", String(PUERTO), "--llama-port", "8080"], {
  env: { ...process.env, BONSAI_STATE: estado, BONSAI_SALIDA: path.join(raiz, "salida") },
  stdio: ["ignore", fs.openSync(path.join(raiz, "ui.log"), "w"), fs.openSync(path.join(raiz, "ui.log"), "a")],
});
const base = `http://127.0.0.1:${PUERTO}`;
const cerrar = () => { try { ui.kill(); } catch { /* ya cerrado */ } };
process.on("exit", cerrar);

for (let i = 0; i < 60; i += 1) {
  try {
    if ((await fetch(`${base}/api/stats`)).ok) break;
  } catch { /* arrancando */ }
  await new Promise((r) => setTimeout(r, 500));
}
const json = (ruta, cuerpo) => fetch(`${base}${ruta}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
await json("/api/workspace", { path: ws });
await json("/api/permit", { mode: "all" });

const t0 = Date.now();
const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: PEDIDO }) });
if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
/** @type {Array<Record<string, any>>} */
const eventos = [];
await leerSSE(res.body, {
  exigirFin: false,
  jsonInvalido: "ignorar",
  guardarEventos: false,
  alEvento: (evento) => {
    const e = /** @type {Record<string, any>} */ (evento);
    eventos.push(e);
    if (e.type === "action" && e.state !== "run") process.stdout.write(`  · ${e.kind} ${e.state} ${String(e.title).split("\n")[0].slice(0, 70)}${e.code !== undefined ? ` (código ${e.code})` : ""}\n`);
    if (e.type === "status") process.stdout.write(`  [${e.text}]\n`);
  },
});
const segundos = Math.round((Date.now() - t0) / 1000);
// La respuesta final: lo último que se pintó. Si tras la última generación ("start") hubo un
// "replace", manda ese; si no, son los tokens que se emitieron después del último "start".
const ultimoStart = eventos.map((e) => e.type).lastIndexOf("start");
const tras = eventos.slice(ultimoStart + 1);
const reemplazo = tras.filter((e) => e.type === "replace").pop();
const final = String(reemplazo ? reemplazo.text || "" : tras.filter((e) => e.type === "token").map((e) => e.text || "").join(""));
const htmls = fs.readdirSync(ws).filter((n) => /\.html?$/i.test(n));
const html = htmls[0] ? fs.readFileSync(path.join(ws, htmls[0]), "utf8") : "";
const comprobaciones = {
  "hay un .html": htmls.length > 0,
  "es un documento completo": /<html[\s\S]*<\/html>\s*$/i.test(html.trim()),
  "usa 3D (three.js o WebGL)": /three|webgl|THREE\./i.test(html),
  "tiene botón para separar/juntar": /<button/i.test(html),
  "rota con el ratón": /mouse|pointer|OrbitControls/i.test(html),
  "más de 3 KB (no es un esqueleto)": html.length > 3000,
  "el script cierra (llaves equilibradas)": (html.match(/{/g) || []).length === (html.match(/}/g) || []).length,
  "cerró con texto, no con XML": final.length > 0 && !/<tool_call>/.test(final),
};
const ok = Object.values(comprobaciones).every(Boolean);
const informe = [
  `# Tarea grande · ${sello} · razonamiento ${pensar ? `${pensar} tokens` : "apagado"}`,
  "",
  `**${ok ? "OK" : "FALLA"}** en ${segundos} s · ${eventos.filter((e) => e.type === "action" && e.state !== "run").length} acciones · archivo ${htmls[0] || "(ninguno)"} (${html.length} car.)`,
  "",
  ...Object.entries(comprobaciones).map(([k, v]) => `- ${v ? "✅" : "❌"} ${k}`),
  "",
  "Respuesta final:",
  "",
  `> ${final.replace(/\n/g, "\n> ").slice(0, 1500)}`,
];
fs.writeFileSync(path.join(raiz, "informe.md"), informe.join("\n"), "utf8");
fs.writeFileSync(path.join(raiz, "eventos.json"), JSON.stringify(eventos, null, 1), "utf8");
process.stdout.write(`${informe.join("\n")}\n\ncarpeta: ${raiz}\n`);
cerrar();
process.exit(ok ? 0 : 1);
