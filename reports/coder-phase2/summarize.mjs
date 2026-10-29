/** Regenerate derived tables from preserved raw reports; no model execution. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const read = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,"utf8")) : null;
const median = xs => { const n=xs.filter(Number.isFinite).sort((a,b)=>a-b); return n.length ? n[Math.floor(n.length/2)] : null; };
const engineFiles = ["engine-context-kv-original.json","engine-new-quality.json","engine-runtime-options-clean.json","engine-native-final.json","engine-original-comparison.json","engine-final-regressions.json"];
const engines = engineFiles.flatMap(file => (read(path.join(dir,file))?.results || []).filter(r=>r.samples?.length).map(r=>({
  report:file,label:r.label,context:r.contextTokens ?? r.configuration?.context,
  peakVramMiB:r.peakVramMiB,minFreeVramMiB:r.minFreeVramMiB,
  peakRamMiB:r.ram?.peakWorkingSetMiB,agentPeakRamMiB:r.codingRam?.peakWorkingSetMiB,
  agentPeakVramMiB:r.codingPeakVramMiB,agentMinFreeVramMiB:r.codingMinFreeVramMiB,startupMs:r.startupMs,
  coding:r.codingSuccess,
  cache:{coldTtftMs:r.cache?.cold?.ttftMs,warmTtftMs:r.cache?.warm?.ttftMs,coldPromptMs:r.cache?.cold?.timings.prompt_ms,warmPromptMs:r.cache?.warm?.timings.prompt_ms,reusedTokens:r.cache?.warm?.tokensCached,identicalOutput:r.cache?.identicalOutput},
  matrix:r.samples.map(s=>({prompt:s.promptTokens,generated:s.generatedTokens,repetitions:s.runs.length,...s.median,hashes:[...new Set(s.runs.map(x=>x.outputHash))]})),
})));
function findReports(root) {
  if(!fs.existsSync(root)) return [];
  return fs.readdirSync(root,{withFileTypes:true}).flatMap(e=> e.isDirectory() && e.name!=="ws" && e.name!=="fixed-workspace" ? findReports(path.join(root,e.name)) : e.isFile() && e.name==="informe.json" ? [path.join(root,e.name)] : []);
}
const coding = findReports(path.join(dir,"runs")).map(file=>{
  const r=read(file),m=r.results.map(t=>t.metrics),sum=k=>m.reduce((a,b)=>a+(b[k]||0),0);
  return {report:path.relative(dir,file).replace(/\\/g,"/"),profile:r.profile,suite:r.suite,seed:r.seed,ablation:r.ablation,context:r.requestedContextTokens,success:r.success,total:r.total,codeFingerprint:r.codeFingerprint,fixtureFingerprint:r.fixtureFingerprint,workspaceRoot:r.workspaceRoot,
    completionMs:sum("completionMs"),llmCalls:sum("llmCalls"),promptTokens:sum("promptTokens"),generatedTokens:sum("generatedTokens"),cachedTokens:sum("cachedTokens"),evaluatedTokens:sum("evaluatedTokens"),promptEvaluationMs:sum("promptEvaluationMs"),toolCalls:sum("toolCalls"),schemaFailures:sum("schemaFailures"),parseFailures:sum("parseFailures"),patchFailures:sum("patchFailures"),repairAttempts:sum("repairAttempts"),medianFirstUsefulActionMs:median(m.map(x=>x.timeToFirstUsefulActionMs)),peakVramMiB:Math.max(...m.map(x=>x.peakVramMiB||0)),minFreeVramMiB:Math.min(...m.map(x=>x.minFreeVramMiB).filter(Number.isFinite)),failed:r.results.filter(t=>!t.ok).map(t=>({id:t.id,stop:t.stop?.motivo,error:t.error,log:t.log?.slice(0,600)}))};
});
const native=engines.find(x=>x.report==="engine-native-final.json" && x.label==="f16-ctx8192");
const original=engines.find(x=>x.report==="engine-original-comparison.json");
const greedy = native && original ? native.matrix.map(n=>{
  const o=original.matrix.find(x=>x.prompt===n.prompt && x.generated===n.generated);
  return {prompt:n.prompt,generated:n.generated,identical:o ? n.hashes.length===1 && o.hashes.length===1 && n.hashes[0]===o.hashes[0] : null};
}) : [];
const result={generatedAt:new Date().toISOString(),engines,coding,greedyBuildComparison:greedy,profile:read(path.join(dir,"profile-summary.json")),exclusions:["engine-runtime-options.json was interrupted because unit tests overlapped. Only engine-runtime-options-clean.json is used for timing decisions."],limitations:["Synthetic tasks and a small number of seeds; no confidence interval or real-repository quality guarantee.","The native matrix uses candidate-v2-app. candidate-final-app preserves small-state formatting, adds duplicate/pre-existing TypeScript error accounting and an explicit diagnostic-overflow warning. The final code passed 34 suites and one real-model integration task; its full matrix remains pending.","The remaining native 16k agent run was stopped; incomplete evaluations are not scored.","Profiler timings and replay throughput are excluded from speed claims.","No other weight quantizations, forced MMQ/CUBLAS builds, LTO or custom CUDA kernels were evaluated."]};
fs.writeFileSync(path.join(dir,"measurements.json"),JSON.stringify(result,null,2));
const keys=["report","context","seed","ablation","success","total","completionMs","llmCalls","promptTokens","generatedTokens","cachedTokens","evaluatedTokens","promptEvaluationMs","toolCalls","schemaFailures","patchFailures","repairAttempts","peakVramMiB","minFreeVramMiB"];
fs.writeFileSync(path.join(dir,"coding.csv"),[keys.join(","),...coding.map(r=>keys.map(k=>JSON.stringify(r[k]??"")).join(","))].join("\n")+"\n");
console.log(`${engines.length} engine configurations; ${coding.length} coding reports; derived measurements regenerated.`);
