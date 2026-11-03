/** Fachada de metadatos GGUF y planificación de motor. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { selfTest } from "./model-plan/planner.mjs";

export * from "./model-plan/gguf.mjs";
export * from "./model-plan/planner.mjs";

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (entry === import.meta.url) {
  const fallos = selfTest();
  if (fallos.length) {
    process.stderr.write(`${fallos.join("\n")}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("model-plan ok\n");
  }
}
