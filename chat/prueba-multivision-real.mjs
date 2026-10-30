/** Prueba dos adjuntos y OCR en una interfaz aislada con el servidor real disponible. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {pngConTexto} from "./evaluar/vision-fixture.mjs";
import {leerSSE} from "./sse.mjs";

if (!process.argv.includes("--real")) { console.log("Usa --real con el servidor sin otros turnos activos."); process.exit(0); }
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"bonsai-multivision-"));
let ui;
try {
  const state=path.join(temp,"state"), workspace=path.join(temp,"workspace"), output=path.join(temp,"output");
  fs.mkdirSync(state); fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(state,"ui-workspace.json"),JSON.stringify({path:workspace}));
  const socket=http.createServer(); await new Promise(r=>socket.listen(0,"127.0.0.1",r)); const port=socket.address().port; await new Promise(r=>socket.close(r));
  ui=spawn(process.execPath,[fileURLToPath(new URL("./ui-server.mjs",import.meta.url)),"--port",String(port),"--llama-port","8080"],{env:{...process.env,BONSAI_STATE:state,BONSAI_SALIDA:output},windowsHide:true,stdio:"ignore"});
  const base=`http://127.0.0.1:${port}`;
  let ready=false;
  for (let i=0;i<60 && ui.exitCode===null;i++) { try {if((await fetch(`${base}/api/state`)).ok){ready=true;break;}} catch {} await new Promise(r=>setTimeout(r,200)); }
  if(!ready) throw new Error("No arrancó la interfaz aislada");
  const post=(url,data)=>fetch(`${base}${url}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data),signal:AbortSignal.timeout(120000)});
  const ids=[];
  for(const [digits,size] of [["4758",48],["2345",24]]) {
    const res=await post("/api/attach",{nombre:`${digits}.png`,datos:`data:image/png;base64,${pngConTexto(digits,size).toString("base64")}`});
    if(!res.ok) throw new Error(`No se pudo adjuntar la imagen: HTTP ${res.status}`);
    ids.push((await res.json()).archivo);
  }
  const res=await post("/api/chat",{text:"Transcribe los números de las dos imágenes en orden. Indica solo los números.",imagenes:ids,modo:"consulta"});
  if(!res.ok) throw new Error(`Chat HTTP ${res.status}`);
  const events=[]; await leerSSE(res.body,{exigirFin:false,alEvento:e=>events.push(e)});
  const answer=events.filter(e=>e.type==="replace").at(-1)?.text || events.filter(e=>e.type==="token").map(e=>e.text).join("");
  const ok=/4758/.test(answer)&&/2345/.test(answer);
  console.log(JSON.stringify({ok,respuesta:answer,errores:events.filter(e=>e.type==="error").map(e=>e.text)}));
  if(!ok) process.exitCode=1;
} finally {
  if(ui && ui.exitCode===null){ui.kill();await new Promise(r=>ui.once("exit",r));}
  if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir())) throw new Error("ruta temporal inesperada");
  fs.rmSync(temp,{recursive:true,force:true});
}
