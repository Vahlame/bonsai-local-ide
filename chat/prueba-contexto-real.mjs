/** Prueba opcional con el servidor ya encendido; no modifica su configuración ni chats. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BonsaiChat } from "./bonsai-chat.mjs";
import { CoderTask, CODER_CONFIG, CODER_SYSTEM } from "./coder-harness.mjs";

if (!process.argv.includes("--real")) { console.log("Usa --real con un servidor disponible y sin turnos activos."); process.exit(0); }
const temp = fs.mkdtempSync(path.join(os.tmpdir(),"bonsai-context-real-"));
try {
  const goal = "No edites ni ejecutes nada. Responde con la clave 2837 y la palabra PENDIENTE. La restricción es conservar la API existente.";
  const task = await new CoderTask({root:temp,goal,config:{contextTokens:43008,outputTokens:14336}}).start();
  task.state.phase = "DONE";
  task.state.errors = ["PENDIENTE: verificar el archivo src/calculo.js"];
  const chat = new BonsaiChat({host:"127.0.0.1",port:8080,historyCap:28672,sessionPath:path.join(temp,"session.json"),timingsPath:null});
  chat.silent=true; chat.actOnPc=true; chat.agentProfile="small-local-coder"; chat.coderTask=task;
  chat.coderConfig={...CODER_CONFIG,contextTokens:43008,outputTokens:14336};
  await chat.connect();
  assert.equal(chat.nCtx,43008);
  const turns=[{role:"user",content:goal}];
  let count=0;
  for (let group=0; group<32 && count < 30500; group++) {
    const id=`read${group}`;
    const data=Array.from({length:120},(_,i)=>`const item_${group}_${i} = ${group*1000+i}; // dato de prueba`).join("\n");
    turns.push({role:"assistant",content:"",toolCalls:[{id,name:"leer",arguments:JSON.stringify({ruta:`src/a${group}.js`})}]});
    turns.push({role:"tool",toolCallId:id,content:data});
    if (group%4===3) {
      const messages=[{role:"system",content:CODER_SYSTEM},{role:"user",content:goal},...turns.slice(1).map(t=>t.role==="tool"?{role:"tool",tool_call_id:t.toolCallId,content:t.content}:{role:"assistant",content:"",tool_calls:t.toolCalls.map(c=>({id:c.id,type:"function",function:{name:c.name,arguments:c.arguments}}))})];
      count=await chat.countPrompt(messages,false);
    }
  }
  assert.ok(count>chat.historyCap(),`No se alcanzó el umbral: ${count}`);
  chat.session.turns=turns;
  const start=performance.now(), packed=await chat.packHistory(), diag=chat.contextDiagnostics;
  assert.ok(diag.discardedGroups>0);
  assert.ok(packed.promptTokens<=chat.historyCap());
  assert.match(packed.messages[1].content,/2837/);
  assert.match(packed.messages.at(-1).content,/PENDIENTE/);
  const finalMessages=[...packed.messages,{role:"user",content:"Responde solo con la clave numérica y la palabra que figura en el estado. No llames herramientas."}];
  const response=await fetch(`${chat.base}/v1/chat/completions`,{method:"POST",headers:{"Content-Type":"application/json"},signal:AbortSignal.timeout(120000),body:JSON.stringify({model:chat.model,messages:finalMessages,...chat.toolFields(),tool_choice:"none",max_tokens:128,temperature:0,chat_template_kwargs:{enable_thinking:false},stream:false})});
  if (!response.ok) throw new Error(`Modelo HTTP ${response.status}: ${await response.text()}`);
  const result=await response.json(), content=String(result.choices?.[0]?.message?.content || "");
  assert.match(content,/2837/); assert.match(content,/pendiente/i);
  console.log(JSON.stringify({antes:diag.compactionDetails.tokensBefore,despues:packed.promptTokens,metodo:diag.countMethod,gruposOmitidos:diag.discardedGroups,tiempoMs:Math.round(performance.now()-start),entradaReal:result.usage?.prompt_tokens,salida:result.usage?.completion_tokens,respuesta:content}));
} finally {
  if (path.dirname(path.resolve(temp)) !== path.resolve(os.tmpdir())) throw new Error("ruta temporal inesperada");
  fs.rmSync(temp,{recursive:true,force:true});
}
