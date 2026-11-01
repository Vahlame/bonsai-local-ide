// Offline analysis using the production Harmony parser and tool validator, without changing them.
import fs from "node:fs";
import path from "node:path";
import { parseHarmony } from "../chat/harmony.mjs";
import { validateCall } from "../chat/coder-harness.mjs";

const directory = path.resolve(process.argv[2] || "reports/lifecycle-2026-11-01/gpt-oss-diagnostic");
const rows = fs.readFileSync(path.join(directory, "raw-stream.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
const groups = new Map();
for (const row of rows) {
  const group = groups.get(row.id) || { id: row.id, start: row.t, text: "", nativeDeltas: 0 };
  group.end = row.t;
  group.text += row.choices?.[0]?.delta?.content || "";
  group.nativeDeltas += row.choices?.[0]?.delta?.tool_calls?.length || 0;
  group.finish = row.choices?.[0]?.finish_reason || group.finish || null;
  group.usage = row.usage || group.usage;
  group.timings = row.timings || group.timings;
  groups.set(row.id, group);
}
const responses = [...groups.values()].map((group) => {
  const parsed = parseHarmony(group.text);
  return { id: group.id, start: group.start, end: group.end, streamDurationMs: Date.parse(group.end) - Date.parse(group.start),
    finish: group.finish, usage: group.usage, timings: group.timings, rawCharacters: group.text.length, nativeDeltas: group.nativeDeltas,
    headers: [...group.text.matchAll(/<\|channel\|>([\s\S]*?)<\|message\|>/g)].map((match) => match[1]),
    reasoningCharacters: parsed.reasoning.length, finalCharacters: parsed.final.length,
    finalPreview: parsed.final.slice(0, 240),
    calls: parsed.calls.map((call) => { const result = validateCall(call); return { name: call.name, characters: JSON.stringify(call.arguments).length, valid: result.ok, error: result.error }; }) };
});
const tracesPath = path.join(directory, "state", "agent-traces");
const traces = fs.readdirSync(tracesPath).filter((file) => file.endsWith(".jsonl")).flatMap((file) =>
  fs.readFileSync(path.join(tracesPath, file), "utf8").trim().split("\n").filter(Boolean).map(JSON.parse));
const session = JSON.parse(fs.readFileSync(path.join(directory, "state", "ui-session.json"), "utf8"));
const result = { responses,
  invalidTools: traces.filter((r) => r.event === "invalid_tool"),
  repairs: traces.filter((r) => r.event === "repair"),
  verifications: traces.filter((r) => ["verified", "verification"].includes(r.event)),
  modelLatencies: traces.filter((r) => r.event === "llm_result"),
  lastStop: session.lastStop,
  phase: session.taskState?.phase,
  incompleteCalls: session.turns.filter((t) => t.cortadas?.length).map((t) => t.cortadas),
  finalAssistant: [...session.turns].reverse().find((t) => t.role === "assistant")?.content,
};
fs.writeFileSync(path.join(directory, "protocol-analysis.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ responses: responses.length, calls: responses.flatMap((r) => r.calls).length,
  invalidTools: result.invalidTools.length, incompleteCalls: result.incompleteCalls, lastStop: result.lastStop, phase: result.phase }));
