/** Read-only delivery snapshot. No model generation or workspace edits. */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const get=async url=>{const r=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error(`${url}: ${r.status}`);return r.json();};
const [health,props,state,settings,gpu,workspace]=await Promise.all([
  get('http://127.0.0.1:8080/health'),get('http://127.0.0.1:8080/props'),
  get('http://127.0.0.1:8787/api/state'),get('http://127.0.0.1:8787/api/settings'),
  get('http://127.0.0.1:8787/api/gpu'),get('http://127.0.0.1:8787/api/workspace')]);
const marker=JSON.parse(fs.readFileSync(path.join(root,'logs/servidor-administrado-8080.json'),'utf8'));
const raw=spawnSync('powershell.exe',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process -Filter \"Name='llama-server.exe'\").Count"],{encoding:'utf8',windowsHide:true});
const modelProcesses=raw.status===0?Number(raw.stdout.trim()):null;
const html=await fetch('http://127.0.0.1:8787/');
const result={checkedAt:new Date().toISOString(),ok:html.ok&&health.status==='ok'&&!state.busy&&state.nCtx===36864&&props.modalities.vision&&settings.enginePreset==='8GB-VISION-LONG'&&settings.pensarInfo.efectivo===4096&&marker.pensar===4096&&marker.kv==='f16'&&gpu.vramFreeMiB>=464&&modelProcesses===1,
  ide:'http://127.0.0.1:8787',model:'Ornith 1.5 9B Q4_K_M',engineBuild:props.build_info,
  context:state.nCtx,historyCap:state.historyCap,vision:props.modalities.vision,
  thinkingTokens:settings.pensarInfo.efectivo,showThinking:settings.verPensamiento,
  theme:settings.tema,enginePreset:settings.enginePreset,kv:marker.kv,
  gpuFreeMiB:gpu.vramFreeMiB,gpuUsedMiB:gpu.vramUsedMiB,minFreeRequiredMiB:400,
  imageAdmissionMinimumMiB:464,modelProcesses,serverPid:marker.pidServidor,workspace:workspace.root||workspace.path,
  launcher:'scripts/launch-ide.ps1',shortcut:'C:/Users/user/Desktop/Bonsai IDE.lnk'};
fs.writeFileSync(path.join(dir,'runtime-final.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
