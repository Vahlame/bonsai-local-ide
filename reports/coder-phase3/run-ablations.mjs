/** Bounded wide-fixture ablations on the already running single model. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../..');
const app=path.join(dir,'candidate-v7-app'),base='http://127.0.0.1:8080';
const props=await(await fetch(base+'/props')).json();
if(props.default_generation_settings.n_ctx!==32768||!props.modalities?.vision)throw new Error('Expected the 32k vision model');
const rows=[];
for(const [name,ablation] of [['map-small',null],['map-off','map-off'],['map-large','map-large'],['full-files','full-files']]){
  for(const seed of [42,43]){
    const out=path.join(dir,'runs','wide-ablations',name,`seed-${seed}`);
    if(fs.existsSync(out))throw new Error(`Existing experiment: ${out}`);
    // A fixed unrelated prompt replaces slot history before each measured task.
    const warm=await fetch(base+'/completion',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:'// fixed unrelated warmup\n',n_predict:1,temperature:0,seed:42,cache_prompt:false}),signal:AbortSignal.timeout(30000)});
    if(!warm.ok)throw new Error(`Warmup failed: ${warm.status}`);await warm.arrayBuffer();
    const log=fs.openSync(path.join(dir,`wide-${name}-${seed}.log`),'wx');
    const args=[path.join(root,'chat/evaluar/coder.mjs'),'--app',app,'--out',out,'--profile','small-local-coder','--suite','extended','--tasks','wide-headers','--seed',String(seed),'--context-tokens','32768','--thinking','1024','--coder-options',JSON.stringify({outputTokens:3072,thinkingTokens:1024}),'--workspace-root',path.join(dir,'runs','fixed-workspace'),...(ablation?['--ablation',ablation]:[])];
    const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore',log,log]});
    const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});fs.closeSync(log);
    const report=JSON.parse(fs.readFileSync(path.join(out,'informe.json'),'utf8'));
    if(!report.complete||report.expectedTotal!==1||report.total!==1)throw new Error(`Incomplete ablation: ${name}/${seed}`);
    rows.push({name,seed,exitCode,reportFile:path.relative(dir,path.join(out,'informe.json')).replace(/\\/g,'/'),success:report.success,...report.results[0].metrics,codeFingerprint:report.codeFingerprint,fixtureFingerprint:report.fixtureFingerprint});
    fs.writeFileSync(path.join(dir,'wide-ablations.json'),JSON.stringify(rows,null,2));
    console.log(`${name}/${seed}: ${report.success}/1, ${report.results[0].metrics.completionMs} ms`);
  }
}
if(new Set(rows.map(r=>r.codeFingerprint)).size!==1||new Set(rows.map(r=>r.fixtureFingerprint)).size!==1)throw new Error('Mismatched experiment code/fixtures');
