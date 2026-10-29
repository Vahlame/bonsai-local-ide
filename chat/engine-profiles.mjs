import fs from "node:fs";
const frozen = new URL("./engine-presets.json", import.meta.url);
export const ENGINE_PROFILES = Object.freeze(JSON.parse(fs.readFileSync(
  fs.existsSync(frozen) ? frozen : new URL("../config/local-engine-presets.json", import.meta.url), "utf8")));
export function engineProfile(name) {
  if (typeof name !== "string" || !Object.hasOwn(ENGINE_PROFILES, name)) throw new Error("Perfil de motor desconocido");
  return ENGINE_PROFILES[name];
}
