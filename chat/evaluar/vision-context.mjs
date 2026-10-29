/** Real-model multimodal checks: image-only evidence, long-context recall and coding. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { spawn, spawnSync, execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { leerSSE } from "../sse.mjs";
import { pngConTexto } from "./vision-fixture.mjs";
import { matarArbol } from "../procesos.mjs";

const argv=process.argv.slice(2), option=(name,fallback)=>{const i=argv.indexOf(name);return i<0?fallback:argv[i+1];};
const port=Number(option("--port","8080")), out=path.resolve(option("--out",`reports/vision-${Date.now()}.json`));
if(fs.existsSync(out)) throw new Error("Existing vision report; choose a fresh output path");
const modelBase=`http://127.0.0.1:${port}`, props=await (await fetch(modelBase+"/props")).json();
if(!props.modalities?.vision) throw new Error("The server must have vision enabled");
const context=Number(option("--context",String(props.default_generation_settings.n_ctx)));
const thinking=Number(option("--thinking","0")), minFree=Number(option("--min-free","768"));
const seed=Number(option("--seed","42"));
const fill=Number(option("--fill-ratio","0.64"));
if(!Number.isFinite(fill)||fill<0.55||fill>0.9)throw new Error("Fill ratio must be 0.55-0.90");
if(!Number.isInteger(seed)||seed<0)throw new Error("Invalid seed");
const extraOptions=JSON.parse(option("--coder-options","{}"));
if(!Number.isInteger(thinking)||thinking<0||thinking>8192||!Number.isInteger(minFree)||minFree<0)throw new Error("Invalid thinking or VRAM budget");
if(![8192,16384,32768,36864,39936].includes(context) || context>props.default_generation_settings.n_ctx) throw new Error("Unsupported context budget");
const app=path.resolve(option("--app",path.join(path.dirname(fileURLToPath(import.meta.url)),"..")));
const require=createRequire(import.meta.url);
fs.mkdirSync(path.dirname(out),{recursive:true});
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"bonsai-multimodal-")), workspace=path.join(temp,"project"),state=path.join(temp,"state");
fs.mkdirSync(workspace);fs.mkdirSync(state);
fs.mkdirSync(path.join(workspace,"src"));fs.mkdirSync(path.join(workspace,"test"));
const original='export function getPin() { return "0000"; }\n';
const publicTest="import assert from 'node:assert/strict';\nimport {getPin} from '../src/pin.mjs';\nassert.match(getPin(), /^\\d{4}$/);\nassert.notEqual(getPin(),'0000');\n";
fs.writeFileSync(path.join(workspace,"src/pin.mjs"),original);
fs.writeFileSync(path.join(workspace,"test/pin.test.mjs"),publicTest);
fs.writeFileSync(path.join(state,"ui-workspace.json"),JSON.stringify({path:workspace}));
const ocrStub=path.join(temp,"no-ocr.ps1");fs.writeFileSync(ocrStub,"'{\"ok\":false,\"texto\":\"\",\"error\":\"Disabled for image-only evidence\"}'");
let requests=[],ui,currentMode="consulta",gpuBusy=false;
const gpu=[];
const report={createdAt:new Date().toISOString(),context,seed,fillRatio:fill,thinkingTokens:thinking,minFreeRequiredMiB:minFree,model:props.model_path,app,ocr:false,checks:[]};
const proxy=http.createServer(async(req,res)=>{
  const controller=new AbortController();res.on("close",()=>controller.abort());
  try {
    let raw="";for await(const part of req)raw+=part;
    if(req.url==="/v1/chat/completions") {
      const body=JSON.parse(raw);body.seed=seed;if(currentMode==="consulta")body.temperature=0;
      const images=body.messages.flatMap((m,index)=>Array.isArray(m.content)?m.content.filter(p=>p.type==="image_url").map(p=>({index,role:m.role,hash:crypto.createHash("sha256").update(p.image_url.url).digest("hex")})):[]);
      requests.push({images,toolChoice:body.tool_choice,toolDefinitions:body.tools?.length||0,maxTokens:body.max_tokens,thinkingBudget:body.thinking_budget_tokens,cachePrompt:body.cache_prompt});raw=JSON.stringify(body);
    }
    const upstream=await fetch(modelBase+req.url,{method:req.method,headers:req.headers["content-type"]?{"content-type":req.headers["content-type"]}:{},signal:controller.signal,...(raw?{body:raw}:{})});
    res.writeHead(upstream.status,{"content-type":upstream.headers.get("content-type")||"application/json"});
    const decoder=new TextDecoder();let responseText="";
    for await(const chunk of upstream.body){if(req.url==="/v1/chat/completions")responseText+=decoder.decode(chunk,{stream:true});res.write(chunk);}
    if(req.url==="/v1/chat/completions") {
      const row=requests.at(-1);row.visibleContent="";row.reasoningCharacters=0;row.toolCalls=[];
      for(const line of responseText.split(/\r?\n/))try{
        const data=JSON.parse(line.startsWith("data: ")?line.slice(6):line),delta=data.choices?.[0]?.delta;
        if(delta?.content)row.visibleContent+=delta.content;
        row.reasoningCharacters+=delta?.reasoning_content?.length||0;
        for(const call of delta?.tool_calls||[])if(call.function?.name)row.toolCalls.push(call.function.name);
        if(data.usage)row.usage=data.usage;
        if(data.choices?.[0]?.finish_reason)row.finishReason=data.choices[0].finish_reason;
      }catch{}
    }
    res.end();
  } catch(error) {if(!res.headersSent)res.writeHead(502);res.end(String(error));}
});
await new Promise(r=>proxy.listen(0,"127.0.0.1",r));
const free=http.createServer();await new Promise(r=>free.listen(0,"127.0.0.1",r));const uiPort=free.address().port;await new Promise(r=>free.close(r));
const base=`http://127.0.0.1:${uiPort}`,log=fs.openSync(out+".ui.log","wx");
const monitor=setInterval(()=>{
  if(gpuBusy)return;gpuBusy=true;
  execFile("nvidia-smi",["--query-gpu=memory.used,memory.free","--format=csv,noheader,nounits"],{windowsHide:true,timeout:2000},(error,value)=>{gpuBusy=false;if(!error)gpu.push(value.trim().split(",").map(Number));});
},500);
const post=async(route,body)=>{
  const response=await fetch(base+route,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  if(!response.ok)throw new Error(`${route}: HTTP ${response.status} ${await response.text()}`);return response;
};
try {
  ui=spawn(process.execPath,[path.join(app,"ui-server.mjs"),"--port",String(uiPort),"--llama-port",String(proxy.address().port),"--prompt-cap",String(context)],{windowsHide:true,stdio:["ignore",log,log],env:{...process.env,BONSAI_STATE:state,BONSAI_SALIDA:path.join(temp,"outputs"),BONSAI_AGENT_PROFILE:"small-local-coder",BONSAI_CODER_OPTIONS:JSON.stringify({contextTokens:context,...extraOptions,...(argv.includes("--cache-off")?{promptCache:false}:{})}),BONSAI_OCR_SCRIPT:ocrStub,BONSAI_TREE_SITTER_MODULE:require.resolve("@vscode/tree-sitter-wasm"),BONSAI_TYPESCRIPT_MODULE:require.resolve("typescript"),BONSAI_TS_LSP_CLI:require.resolve("typescript-language-server/lib/cli.mjs")}});
  let ready=false;for(let i=0;i<120;i++){try{if((await fetch(base+"/api/stats")).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
  if(!ready)throw new Error("Isolated IDE failed startup");
  await post("/api/permit",{mode:"all"});await post("/api/settings",{pensar:thinking,historial:context,continuarAuto:false});
  const pins=["8234","5728","3475"], probes={inicio:"ALFA_371",centro:"BETA_824",fin:"OMEGA_592"};
  for(const [index,kind] of ["short-vision","long-vision","vision-coding"].entries()) {
    requests=[];currentMode=kind==="vision-coding"?"agente":"consulta";
    await post("/api/reset",{});
    const image=pngConTexto(pins[index],48);
    const attached=await (await post("/api/attach",{nombre:"screenshot.png",datos:`data:image/png;base64,${image.toString("base64")}`})).json();
    let text="Responde solamente JSON con la propiedad pin, como string con las cuatro cifras de la imagen. No uses herramientas.";
    if(kind==="long-vision") {
      let lines=Math.floor(context/16);
      for(let i=0;i<3;i++) {
        const code=Array.from({length:lines},(_,j)=>`const item_${j} = ${j*17};`);
        code[0]=`const inicio = "${probes.inicio}";`;code[Math.floor(lines/2)]=`const centro = "${probes.centro}";`;code[lines-1]=`const fin = "${probes.fin}";`;
        text=`Consulta de datos; no ejecutes ni edites nada.\n${code.join("\n")}\nResponde solamente JSON con pin (cuatro cifras vistas en la imagen), inicio, centro y fin (valores de esas constantes).`;
        const counted=await (await fetch(modelBase+"/v1/chat/completions/input_tokens",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({messages:[{role:"user",content:text}]})})).json();
        const count=counted.input_tokens||0;if(count>context*(fill-.04)&&count<context*(fill+.04))break;
        lines=Math.max(100,Math.floor(lines*context*fill/Math.max(1,count)));
      }
    }
    if(kind==="vision-coding") text="Actualiza getPin en src/pin.mjs para devolver exactamente las cuatro cifras que aparecen en la imagen adjunta. Inspecciona el código, edita únicamente esa función y verifica los tests. No cambies los tests.";
    const events=[],start=Date.now();let error=null;
    try {
      const response=await fetch(base+"/api/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text,imagenes:[attached.archivo],modo:currentMode}),signal:AbortSignal.timeout(180000)});
      if(!response.ok)throw new Error(`Chat HTTP ${response.status}`);
      await leerSSE(response.body,{exigirFin:false,guardarEventos:false,alEvento:event=>events.push(event)});
    }catch(e){error=e.message;await post("/api/stop",{}).catch(()=>{});}
    const session=JSON.parse(fs.readFileSync(path.join(state,"ui-session.json"),"utf8"));
    const answer=session.turns.findLast(t=>t.role==="assistant")?.content||"";
    const promptTokens=Math.max(0,...events.filter(e=>e.type==="usage").map(e=>Number(e.prompt)||0));
    const checks={finished:events.some(e=>e.type==="done"&&!e.incompleto),imagesSent:requests.length>0&&requests.every(r=>r.images.length===1),noPersistedPixels:!JSON.stringify(session).includes("data:image/")};
    if(currentMode==="consulta") {
      let parsed;try{parsed=JSON.parse(answer.match(/\{[\s\S]*\}/)?.[0]||answer);}catch{}
      checks.imageRead=parsed?.pin===pins[index];checks.noTools=requests.every(r=>r.toolChoice==="none");
      checks.noEdits=fs.readFileSync(path.join(workspace,"src/pin.mjs"),"utf8")===original;
      if(kind==="long-vision") {checks.longContext=promptTokens>=context*(fill-.09);checks.recall=Object.entries(probes).every(([key,value])=>parsed?.[key]===value);}
    }else{
      const oracle=spawnSync(process.execPath,["--input-type=module","-e",`import {getPin} from ${JSON.stringify(pathToFileURL(path.join(workspace,"src/pin.mjs")).href)}; if(getPin()!==${JSON.stringify(pins[index])})process.exit(1);`],{encoding:"utf8",windowsHide:true,timeout:10000});
      checks.correctPatch=oracle.status===0;checks.originalTestsPreserved=fs.readFileSync(path.join(workspace,"test/pin.test.mjs"),"utf8")===publicTest;
      checks.imagePinnedAcrossSteps=requests.length>=2&&requests.every(r=>r.images[0]?.index===1&&r.images[0]?.hash===requests[0].images[0].hash);
      checks.hostVerified=(session.taskState?.tests||[]).some(t=>t.code===0)&&!session.taskState?.errors?.length;
    }
    report.checks.push({kind,ok:!error&&Object.values(checks).every(Boolean),checks,error,expectedPin:pins[index],answer:answer.slice(0,2000),promptTokens,completionMs:Date.now()-start,requests});
    console.log(`${kind}: ${report.checks.at(-1).ok?"PASS":"FAIL"}, ${promptTokens} prompt tokens, ${requests.length} calls`);
  }
}catch(error){report.error=error.message;}
finally {
  clearInterval(monitor);if(ui&&ui.exitCode===null){matarArbol(ui);if(ui.exitCode===null)await new Promise(r=>ui.once("exit",r));}
  await new Promise(r=>proxy.close(r));fs.closeSync(log);
  report.peakVramMiB=gpu.length?Math.max(...gpu.map(x=>x[0])):null;
  report.minFreeVramMiB=gpu.length?Math.min(...gpu.map(x=>x[1])):null;
  report.ok=!report.error&&report.checks.length===3&&report.checks.every(c=>c.ok)&&report.minFreeVramMiB>=minFree;
  fs.writeFileSync(out,JSON.stringify(report,null,2));
  if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith("bonsai-multimodal-"))throw new Error("Unexpected cleanup root");
  fs.rmSync(temp,{recursive:true,force:true});
}
if(!report.ok)process.exitCode=1;
