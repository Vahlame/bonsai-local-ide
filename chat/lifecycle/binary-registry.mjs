import fs from "node:fs";
import path from "node:path";

export function binaryRegistry(root, env = process.env) {
  const { binaries } = JSON.parse(fs.readFileSync(new URL("../../config/llama-binaries.json", import.meta.url), "utf8"));
  return binaries.map(({ id, relative }) => ({ id, exe: path.resolve(root, relative.replace(/%([^%]+)%/g, (_, name) => {
    if (!env[name]) throw new Error(`Falta la variable ${name} del registro de binarios`);
    return env[name];
  })) }));
}

export function selectBinary(root, { legacy = false } = {}) {
  const entries = binaryRegistry(root);
  const entry = legacy ? entries.find((e) => e.id === "legacy-root") : entries.find((e) => fs.existsSync(e.exe));
  if (!entry || !fs.existsSync(entry.exe)) throw new Error("No hay un binario llama-server permitido disponible");
  return entry;
}
