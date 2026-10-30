import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BonsaiChat } from "./bonsai-chat.mjs";
import { CoderTask } from "./coder-harness.mjs";
import { estimateTokens } from "./context.mjs";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-compactacion-"));
try {
  const file = path.join(temp, "app.js"), sessionPath = path.join(temp, "session.json");
  fs.writeFileSync(file, "export function calcular() { return 1; }\n");
  const task = await new CoderTask({root:temp, goal:"Corrige app.js; conserva la API y no cambies visión.", config:{contextTokens:8192,outputTokens:1536}}).start();
  task.state.modified = ["app.js"];
  task.state.errors = ["ERROR: falta comprobar calcular"];
  task.state.plan = {pasos:["Corregir app.js", "Ejecutar prueba"], hechos:[1]};
  task.state.lastDiff = "app.js: calcular devuelve 2";
  const chat = new BonsaiChat({host:"127.0.0.1",port:1,historyCap:8192,sessionPath,timingsPath:null});
  chat.silent = true; chat.actOnPc = true; chat.agentProfile = "small-local-coder"; chat.nCtx = 8192; chat.coderTask = task;
  chat.countPrompt = async messages => estimateTokens(JSON.stringify(messages)) + 400;
  const turns = [{role:"user",content:task.state.goal}];
  for (let i=0; i<24; i++) {
    turns.push({role:"assistant",content:"",toolCalls:[{id:`r${i}`,name:"leer",arguments:{ruta:"app.js"}}]});
    turns.push({role:"tool",toolCallId:`r${i}`,content:`Resultado ${i}: app.js calcular. ${"evidencia ".repeat(150)}`});
  }
  chat.session.turns = turns;
  const first = await chat.packHistory();
  const d1 = chat.contextDiagnostics.compactionDetails;
  assert.ok(d1.tokensBefore > d1.tokensAfter && d1.summaryGenerationTokens === 0);
  const b1 = chat.contextDiagnostics.budget;
  assert.equal(b1.inputUsed, d1.tokensAfter, "el presupuesto debe usar el conteo real de la petición");
  assert.equal(b1.effectiveInput, chat.historyCap());
  assert.equal(b1.effectiveInput, chat.presupuestoContexto().efectivo);
  assert.equal(b1.outputReserved, chat.presupuestoContexto().reservaSalida);
  assert.equal(b1.imagesReserved, 0);
  assert.equal(b1.thinkingIncludedInOutput, true);
  assert.equal(b1.safetyMargin, 128);
  assert.match(b1.formula, /^effectiveInput = max\(512,/);
  assert.ok(first.messages[1].content.includes("conserva la API") && first.messages[1].content.includes("MEMORIA EXTRACTIVA"));
  const state = first.messages.at(-1).content;
  for (const fact of ["app.js", "ERROR: falta comprobar", "Ejecutar prueba", "calcular devuelve 2"]) assert.ok(state.includes(fact), fact);
  const checkGroups = messages => {
    const calls = new Set();
    for (const m of messages) {
      if (m.tool_calls) for (const c of m.tool_calls) calls.add(c.id);
      if (m.role === "tool") assert.ok(calls.has(m.tool_call_id), "resultado huérfano");
    }
  };
  checkGroups(first.messages);
  for (let i=24; i<30; i++) {
    turns.push({role:"assistant",content:"",toolCalls:[{id:`r${i}`,name:"leer",arguments:{ruta:"app.js"}}]});
    turns.push({role:"tool",toolCallId:`r${i}`,content:`Resultado ${i}: ${"nuevo ".repeat(250)}`});
  }
  const second = await chat.packHistory();
  checkGroups(second.messages);
  assert.ok(second.messages[1].content.includes("conserva la API"));
  assert.equal(chat.session.turns.length, turns.length, "los originales se conservan");
  const beforeImage = chat.historyCap(); chat.pendingImageTokens = 512;
  assert.equal(chat.historyCap(), beforeImage - 512); chat.pendingImageTokens = 0;
  const ratio = new BonsaiChat({host:"127.0.0.1",port:1,historyCap:28672,timingsPath:null});
  ratio.agentProfile = "small-local-coder"; ratio.nCtx = 43008;
  ratio.coderConfig = {contextTokens:43008,outputTokens:14336};
  assert.equal(ratio.reservaSalida(),14336);
  assert.equal(ratio.historyCap(),28544); // incluye margen de 128 dentro de la ventana
  const bRatio = ratio.budgetSnapshot(1000);
  assert.deepEqual(
    {window:bRatio.window,effectiveWindow:bRatio.effectiveWindow,configuredInput:bRatio.configuredInput,effectiveInput:bRatio.effectiveInput,inputRemaining:bRatio.inputRemaining,outputReserved:bRatio.outputReserved,imagesReserved:bRatio.imagesReserved,thinkingReserved:bRatio.thinkingReserved,tighten:bRatio.tighten},
    {window:43008,effectiveWindow:43008,configuredInput:28672,effectiveInput:28544,inputRemaining:27544,outputReserved:14336,imagesReserved:0,thinkingReserved:0,tighten:0},
  );
  assert.equal(bRatio.imagesReserved,0);
  assert.equal(ratio.budgetSnapshot(999999).inputRemaining,0);
  ratio.pendingImageTokens = 576;
  assert.equal(ratio.historyCap(),27968);
  assert.equal(ratio.budgetSnapshot(0).imagesReserved,576);
  assert.equal(ratio.budgetSnapshot(0).effectiveInput,27968);
  ratio.tighten = 100;
  assert.equal(ratio.historyCap(),27868);
  assert.equal(ratio.budgetSnapshot(0).tighten,100);
  ratio.tighten = 0;
  ratio.pendingImageTokens = 0;
  fs.writeFileSync(file, "export function calcular() { return 200; }\n");
  const fresh = await chat.packHistory();
  assert.ok(!fresh.messages[1].content.includes("return 1;"), "no incluir el fragmento obsoleto");
  assert.match(fresh.messages.at(-1).content, /desactualizado/);
  await task.context.refresh();
  assert.match(task.context.read({ruta:"app.js"}), /return 200/);
  chat.session.taskState = task.state; chat.saveSession();
  const old = fs.readFileSync(sessionPath, "utf8");
  const rename = fs.renameSync;
  fs.renameSync = (src, dst) => { if (String(dst) === sessionPath) throw new Error("fallo de escritura simulado"); return rename(src,dst); };
  try { assert.throws(() => chat.saveSession(), /fallo de escritura/); } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(sessionPath,"utf8"), old);
  const resumed = new BonsaiChat({host:"127.0.0.1",port:1,historyCap:8192,sessionPath,timingsPath:null});
  resumed.silent = true; resumed.loadSession();
  assert.equal(resumed.session.taskState.goal, task.state.goal);
  assert.equal(resumed.session.turns.length, turns.length);

  const general = new BonsaiChat({host:"127.0.0.1",port:1,historyCap:4096,sessionPath:path.join(temp,"general.json"),timingsPath:null});
  general.silent = true; general.nCtx = 4096;
  general.session = {memory:"hecho anterior",folded:0,turns:[{role:"user",content:"objetivo " + "x".repeat(5000)},{role:"assistant",content:"y".repeat(5000)},{role:"user",content:"continúa"}],draft:"",files:[]};
  general.countPrompt = async messages => estimateTokens(JSON.stringify(messages));
  general.postChat = async () => ({choices:[{message:{content:""}}]});
  await assert.rejects(() => general.packHistory(), /resumen vacío|compactar/);
  assert.equal(general.session.memory,"hecho anterior"); assert.equal(general.session.folded,0);
  general.postChat = async () => { throw Object.assign(new Error("cancelado"),{name:"AbortError"}); };
  await assert.rejects(() => general.packHistory(), /cancelado/);
  assert.equal(general.session.folded,0);
  const fallback = new BonsaiChat({host:"127.0.0.1",port:1,historyCap:4096,timingsPath:null});
  fallback.silent=true; fallback.nCtx=4096; fallback.postJson=async()=>{throw new Error("sin tokenizador")};
  await fallback.countPrompt([{role:"user",content:"hola"}],false);
  assert.match(fallback.lastCountMethod,/estimación/);
  console.log(`compactación simulada: ${d1.tokensBefore} → ${d1.tokensAfter} tokens estimados, ${d1.durationMs} ms; resumen: 0 tokens`);
} finally {
  assert.equal(path.dirname(path.resolve(temp)),path.resolve(os.tmpdir()));
  fs.rmSync(temp,{recursive:true,force:true});
}
