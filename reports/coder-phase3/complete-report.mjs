/** Final tables require complete paired runs, the same code and the same fixtures. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
const read=p=>JSON.parse(fs.readFileSync(path.join(dir,p),'utf8'));
const groups=['final-control','final-reasoning'].map(group=>[42,43].map(seed=>read(`runs/${group}/seed-${seed}/informe.json`)));
const all=groups.flat();
assert.ok(all.every(r=>r.complete&&r.total===10&&r.expectedTotal===10&&r.validationVersion===4));
assert.equal(new Set(all.map(r=>r.codeFingerprint)).size,1,'Different harness snapshots');
assert.equal(new Set(all.map(r=>r.fixtureFingerprint)).size,1,'Different fixtures');
assert.equal(new Set(all.map(r=>r.workspaceRoot)).size,1,'Different workspace paths');
assert.ok(all.every(r=>r.requestedContextTokens===32768&&r.coderOptions.outputTokens===3072&&r.coderOptions.thinkingTokens===1024));
const sum=(a,k)=>a.reduce((n,x)=>n+(x[k]||0),0);
const aggregate=rs=>{
  const tasks=rs.flatMap(r=>r.results),m=tasks.map(t=>t.metrics);
  return {success:tasks.filter(t=>t.ok).length,total:tasks.length,thinking:rs[0].thinkingTokens,
    seconds:sum(m,'completionMs')/1000,promptTokens:sum(m,'promptTokens'),generatedTokens:sum(m,'generatedTokens'),
    llmCalls:sum(m,'llmCalls'),toolCalls:sum(m,'toolCalls'),reasoningCharacters:sum(m,'reasoningCharacters'),
    peakVramMiB:Math.max(...m.map(x=>x.peakVramMiB)),minFreeVramMiB:Math.min(...m.map(x=>x.minFreeVramMiB)),
    failures:rs.flatMap(r=>r.results.filter(t=>!t.ok).map(t=>({seed:r.seed,id:t.id,stop:t.stop?.motivo}))),
    codeFingerprint:rs[0].codeFingerprint,fixtureFingerprint:rs[0].fixtureFingerprint};
};
const [off,on]=groups.map(aggregate);
assert.equal(off.thinking,0);assert.equal(on.thinking,1024);
assert.equal(off.reasoningCharacters,0);assert.ok(on.reasoningCharacters>0);
const vision=read('vision-36k-f16-4k.json');
assert.ok(vision.ok,'Final vision checks failed');
const nativeMax=Math.max(...vision.checks.flatMap(c=>c.requests.map(r=>r.usage?.prompt_tokens||0)));
const runtime=read('runtime-final.json');assert.ok(runtime.ok,'Final IDE health proof missing');
const result={comparisonConfiguration:{context:32768,kv:'f16',outputTokens:3072,thinkingTokens:[0,1024],note:'Historical paired coding comparison; not the active 4096-token thinking preset.'},off,on,comparison:{timePercent:(on.seconds/off.seconds-1)*100,callsPercent:(on.llmCalls/off.llmCalls-1)*100},vision:{report:'vision-36k-f16-4k.json',context:vision.context,thinkingTokens:vision.thinkingTokens,nativeMaxPromptTokens:nativeMax,peakVramMiB:vision.peakVramMiB,minFreeVramMiB:vision.minFreeVramMiB},runtime};
fs.writeFileSync(path.join(dir,'final-comparison.json'),JSON.stringify(result,null,2));
// RESUMEN.md is editorial: regenerating measurements must not overwrite its
// distinction between historical A/B results and the current runtime settings.
console.log(JSON.stringify({off,on,timePercent:result.comparison.timePercent,callsPercent:result.comparison.callsPercent,nativeMaxPromptTokens:nativeMax},null,2));
