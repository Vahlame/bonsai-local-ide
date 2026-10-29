/** Derive compact metrics from preserved reports. Does not run inference. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {veredictoFinal} from '../../chat/evaluar/veredicto-coder.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const sum=(rows,key)=>rows.reduce((n,row)=>n+(row[key]||0),0);
function walk(root){
  if(!fs.existsSync(root))return [];
  return fs.readdirSync(root,{withFileTypes:true}).flatMap(e=>
    e.isDirectory()&&!['ws','fixed-workspace'].includes(e.name)?walk(path.join(root,e.name)):
    e.isFile()&&['informe.json','vision.json'].includes(e.name)?[path.join(root,e.name)]:[]);
}
const engines=fs.readdirSync(dir).filter(f=>/^engine-.*\.json$/.test(f)).flatMap(file=>{
  const r=read(path.join(dir,file));
  return (r.results||[]).map(x=>({report:file,label:x.label,configuration:x.configuration,
    error:x.error,skipped:x.skipped,startupMs:x.startupMs,peakVramMiB:x.peakVramMiB,
    minFreeVramMiB:x.minFreeVramMiB,codingPeakVramMiB:x.codingPeakVramMiB,
    codingMinFreeVramMiB:x.codingMinFreeVramMiB,ram:x.ram,codingRam:x.codingRam,
    samples:x.samples?.map(s=>({prompt:s.promptTokens,generated:s.generatedTokens,repetitions:s.runs.length,...s.median})),
    cache:x.cache?{coldTtftMs:x.cache.cold.ttftMs,warmTtftMs:x.cache.warm.ttftMs,reusedTokens:x.cache.warm.tokensCached,identicalOutput:x.cache.identicalOutput}:null,
    visionPassed:x.visionCheck?.ok,coding:x.codingSuccess}));
});
const coding=[],vision=[];
for(const file of [...walk(path.join(dir,'runs')),path.join(dir,'vision-36k-f16-4k.json')].filter(fs.existsSync)){
  const r=read(file),report=path.relative(dir,file).replace(/\\/g,'/');
  if(Array.isArray(r.checks)&&r.ocr===false){
    vision.push({report,ok:r.ok,context:r.context,thinking:r.thinkingTokens,
      peakVramMiB:r.peakVramMiB,minFreeVramMiB:r.minFreeVramMiB,
      checks:r.checks.map(c=>({kind:c.kind,ok:c.ok,checks:c.checks,
        promptTokens:Math.max(0,...c.requests.map(q=>q.usage?.prompt_tokens||0)),
        completionMs:c.completionMs,reasoningCharacters:sum(c.requests,'reasoningCharacters')}))});
    continue;
  }
  const m=r.results.map(t=>t.metrics);
  const strict=r.results.map(t=>{
    const trace=read(path.join(path.dirname(file),`${t.id}.trace.json`));
    return {...t,...veredictoFinal({ok:t.patchCorrect??t.ok},trace.events,t.error,r.profile)};
  });
  coding.push({report,context:r.requestedContextTokens,thinking:r.thinkingTokens,options:r.coderOptions,
    seed:r.seed,ablation:r.ablation,recordedSuccess:r.success,success:strict.filter(t=>t.ok).length,total:r.total,
    complete:r.complete??(r.total===(r.suite==='extended'?10:7)),validationVersion:r.validationVersion,
    codeFingerprint:r.codeFingerprint,fixtureFingerprint:r.fixtureFingerprint,workspaceRoot:r.workspaceRoot,
    completionMs:sum(m,'completionMs'),promptTokens:sum(m,'promptTokens'),generatedTokens:sum(m,'generatedTokens'),
    reasoningCharacters:sum(m,'reasoningCharacters'),llmCalls:sum(m,'llmCalls'),toolCalls:sum(m,'toolCalls'),
    schemaFailures:sum(m,'schemaFailures'),parseFailures:sum(m,'parseFailures'),repairAttempts:sum(m,'repairAttempts'),
    peakVramMiB:Math.max(...m.map(x=>x.peakVramMiB||0)),
    minFreeVramMiB:Math.min(...m.map(x=>x.minFreeVramMiB).filter(Number.isFinite)),
    tasks:strict.map(t=>({id:t.id,ok:t.ok,patchCorrect:t.patchCorrect,finished:t.finished,hostDone:t.hostDone,error:t.error,metrics:t.metrics})),
    failed:strict.filter(t=>!t.ok).map(t=>({id:t.id,error:t.error,stop:t.stop?.motivo,log:t.log?.slice(0,600)}))});
}
fs.writeFileSync(path.join(dir,'measurements.json'),JSON.stringify({generatedAt:new Date().toISOString(),engines,coding,vision,
  limitations:['Synthetic fixtures, few seeds and one GPU; quality claims apply only to these checks.',
    'VRAM polling can miss short transients. Memory estimates and observed usage are distinct.',
    'The first two multimodal matrices retain failures from the query image/instruction bugs; they are diagnostic evidence.',
    'engine-quality-thinking.json uses candidate-v4-app and an earlier scorer. Its second seed timed out then stopped after 2 tasks. It is superseded; strict completion scores are derived again from its preserved traces.',
    'Evaluation traces retain reasoning budgets and character counts only. The live IDE separately saves the local model reasoning in chat history at the user request; it is excluded from model input.']},null,2));
const keys=['report','context','thinking','seed','ablation','success','total','completionMs','promptTokens','generatedTokens','reasoningCharacters','llmCalls','toolCalls','schemaFailures','repairAttempts','peakVramMiB','minFreeVramMiB'];
fs.writeFileSync(path.join(dir,'coding.csv'),[keys.join(','),...coding.map(c=>keys.map(k=>JSON.stringify(c[k]??'')).join(','))].join('\n')+'\n');
console.log(`${engines.length} engine rows; ${coding.length} coding reports; ${vision.length} multimodal reports`);
