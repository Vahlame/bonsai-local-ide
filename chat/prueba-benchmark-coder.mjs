import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { espacioCoder } from "./evaluar/espacio-coder.mjs";
import { CODER_EXTENDIDAS } from "./evaluar/coder-extended.mjs";
import { prepararCoder,validarCoder } from "./evaluar/coder-tareas.mjs";
import { CodeContext } from "./code-context.mjs";
import { CODER_CONFIG } from "./coder-harness.mjs";
import {veredictoFinal} from './evaluar/veredicto-coder.mjs';
const done=[{type:'agent_trace',event:'done'},{type:'done',motivo:'completed',incompleto:false}];
assert.equal(veredictoFinal({ok:true},done,null,'small-local-coder').ok,true);
assert.equal(veredictoFinal({ok:true},done,'Timeout','small-local-coder').ok,false);
assert.equal(veredictoFinal({ok:true},done.slice(1),null,'small-local-coder').ok,false);
assert.equal(veredictoFinal({ok:true},[{type:'done',motivo:'step_limit',incompleto:true}],null,'small-local-coder').ok,false);
assert.equal(veredictoFinal({ok:false},done,null,'small-local-coder').ok,false);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-eval-cwd-"));
try {
  const personal = path.join(temp, "personal");
  fs.mkdirSync(personal);
  fs.writeFileSync(path.join(personal, "keep.txt"), "user work");
  assert.throws(() => espacioCoder(personal), /nonempty/);
  assert.equal(
    fs.readFileSync(path.join(personal, "keep.txt"), "utf8"),
    "user work",
  );
  const root = path.join(temp, "owned"),
    workspace = espacioCoder(root);
  const first = workspace.prepare("task");
  fs.writeFileSync(path.join(first, "extra.txt"), "created by model");
  const archive = path.join(temp, "archived");
  workspace.archive("task", archive);
  assert.equal(
    fs.readFileSync(path.join(archive, "extra.txt"), "utf8"),
    "created by model",
  );
  assert.equal(workspace.prepare("task"), first);
  assert.deepEqual(fs.readdirSync(first), []);
  assert.throws(() => workspace.prepare("../personal"), /Invalid/);
  assert.throws(() => workspace.archive("task", archive), /already exists/);
  fs.symlinkSync(
    personal,
    path.join(root, "linked"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => workspace.prepare("linked"), /link/);
  assert.ok(fs.existsSync(path.join(personal, "keep.txt")));
  for(const task of CODER_EXTENDIDAS.slice(7)) {
    const dir=path.join(temp,task.id);prepararCoder(task,dir);
    assert.equal(validarCoder(task,dir).ok,false,`${task.id}: broken fixture must fail`);
    if(task.id==="wide-headers") {
      const file=path.join(dir,"src/http/headers/parser.mjs");
      fs.writeFileSync(file,fs.readFileSync(file,"utf8").replace("line.slice(0, colon).toLowerCase()","line.slice(0, colon).trim().toLowerCase()"));
      const context=await new CodeContext(dir,CODER_CONFIG).refresh();
      assert.ok(context.map(task.prompt,{},1800).length>context.map(task.prompt,{},600).length*2);
      assert.ok(!context.map(task.prompt,{},1800).includes("return String"));
      const snippets=context.snippets(task.prompt);
      context.config={...context.config,contextMode:"full-files"};
      const full=context.snippets(task.prompt);
      assert.ok(!snippets.includes("Regla documentada 1:"));
      assert.ok(full.includes("Regla documentada 1:"));
    }
    if(task.id==="python-api") fs.writeFileSync(path.join(dir,"shop/cart.py"),"from .currency import sum_cents\ndef checkout(prices):\n    return sum_cents(prices)\n");
    if(task.id==="typescript-api") fs.writeFileSync(path.join(dir,"src/cart.ts"),'import {cents} from "#currency";\nexport function checkout(prices:number[]):number {return prices.reduce((sum,value)=>sum+cents(value),0);}\n');
    assert.equal(validarCoder(task,dir).ok,true,`${task.id}: corrected fixture must pass`);
  }
  console.log(
    "Fixed benchmark cwd: archived results, clean reuse and ownership/path guards verified.",
  );
} finally {
  const resolved = path.resolve(temp);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep))
    throw new Error("Unexpected test cleanup path");
  fs.rmSync(resolved, { recursive: true, force: true });
}
