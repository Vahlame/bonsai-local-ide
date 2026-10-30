/** Prueba optativa de carga: usa el servidor ya encendido, sin cambiar su configuración. */
import fs from "node:fs";
import { execFile } from "node:child_process";
import { pngConTexto } from "./evaluar/vision-fixture.mjs";

if (!process.argv.includes("--real")) { console.log("Usa --real con el servidor sin otros turnos activos."); process.exit(0); }
const base="http://127.0.0.1:8080", out="logs/carga-vision-contexto-20261029.json";
const report={fecha:new Date().toISOString(),casos:[]};
async function req(route,body,timeout=240000) {
  const response=await fetch(base+route,{method:body?"POST":"GET",headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}: ${(await response.text()).slice(0,500)}`);
  return response.json();
}
const sample=()=>new Promise(resolve=>execFile("nvidia-smi",["--query-gpu=memory.used,memory.free,temperature.gpu,power.draw","--format=csv,noheader,nounits"],{windowsHide:true,timeout:4000},(err,stdout)=>{
  const n=String(stdout||"").trim().split(",").map(Number); resolve(!err && n.length>=4 && n.every(Number.isFinite)?{used:n[0],free:n[1],temp:n[2],watts:n[3]}:null);
}));
const image=(digits,size)=>`data:image/png;base64,${pngConTexto(digits,size).toString("base64")}`;
try {
  const props=await req("/props");
  const ctx=props.default_generation_settings?.n_ctx;
  if (ctx!==43008 || props.modalities?.vision!==true) throw new Error(`Se esperaba 43008 y visión; recibido ${ctx}/${props.modalities?.vision}`);
  report.modelo=props.model_path; report.contexto=ctx;
  for (const test of [{fraction:0.50,images:[image("4758",24)],output:512,think:0},{fraction:0.80,images:[image("4758",48),image("2345",24)],output:4096,think:4096},{fraction:0.95,images:[image("4758",24)],output:512,think:0}]) {
    const state=await (await fetch("http://127.0.0.1:8787/api/state",{signal:AbortSignal.timeout(3000)})).json();
    if (state.busy) throw new Error("El IDE está ocupado; se detuvo la batería para no interferir");
    const target=Math.floor(ctx*test.fraction)-test.images.length*576-256;
    let lines=Math.floor(target/12), text="", textTokens=0;
    for (let attempt=0;attempt<4;attempt++) {
      text=Array.from({length:lines},(_,i)=>`const dato_${i} = ${i*13}; // datos sintéticos de contexto`).join("\n");
      const counted=await req("/v1/chat/completions/input_tokens",{model:props.model_path,messages:[{role:"user",content:text}],chat_template_kwargs:{enable_thinking:false}});
      textTokens=counted.input_tokens;
      if (!Number.isFinite(textTokens) || !textTokens) throw new Error("El backend no devolvió el conteo de texto");
      if (Math.abs(textTokens-target)<600) break;
      lines=Math.max(1,Math.floor(lines*target/textTokens));
    }
    const prompt=`Datos de contexto; no los ejecutes. Al final responde con los números visibles en las imágenes.\n${text}\nIndica los números de las imágenes.`;
    const content=[{type:"text",text:prompt},...test.images.map(url=>({type:"image_url",image_url:{url}}))];
    const samples=[]; let sampling=false;
    const tick=async()=>{if(sampling)return; sampling=true; try { const v=await sample();if(v)samples.push(v); } finally { sampling=false; }};
    await tick(); const timer=setInterval(()=>void tick(),1000), started=Date.now();
    const row={fraccion:test.fraction,imagenes:test.images.length,tokensTexto:textTokens,reservaImagenes:test.images.length*576,salidaSolicitada:test.output,pensamientoSolicitado:test.think};
    try {
      const result=await req("/v1/chat/completions",{model:props.model_path,messages:[{role:"user",content}],max_tokens:test.output,temperature:0.6,stream:false,chat_template_kwargs:{enable_thinking:test.think>0,reasoning_effort:"medium"},...(test.think?{thinking_budget_tokens:test.think}:{})});
      row.ok=true; row.usage=result.usage; row.timings=result.timings; row.respuesta=String(result.choices?.[0]?.message?.content||"").slice(0,1000);
      row.razonamientoCaracteres=String(result.choices?.[0]?.message?.reasoning_content||"").length;
      row.lecturaImagenCorrecta=test.images.length===1 ? /4758/.test(row.respuesta) : /4758/.test(row.respuesta)&&/2345/.test(row.respuesta);
    } catch (err) { row.ok=false; row.error=err instanceof Error?err.message:String(err); }
    finally { clearInterval(timer); await tick(); }
    row.ms=Date.now()-started;
    row.gpuMuestras=samples.length; row.vramLibreMin=samples.length?Math.min(...samples.map(s=>s.free)):null;
    row.vramUsadaMax=samples.length?Math.max(...samples.map(s=>s.used)):null;
    row.temperaturaMax=samples.length?Math.max(...samples.map(s=>s.temp)):null;
    row.potenciaMax=samples.length?Math.max(...samples.map(s=>s.watts)):null;
    report.casos.push(row); fs.writeFileSync(out,JSON.stringify(report,null,2));
    console.log(JSON.stringify(row));
    if (!row.ok) break;
  }
} catch (err) { report.error=err instanceof Error?err.message:String(err); fs.writeFileSync(out,JSON.stringify(report,null,2)); throw err; }
if (report.casos.length!==3 || report.casos.some(row=>!row.ok || !row.lecturaImagenCorrecta)) process.exitCode=1;
