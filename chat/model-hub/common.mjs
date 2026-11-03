/** Constantes y utilidades compartidas del Model Hub. */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT = path.dirname(path.dirname(HERE));
export const MIB = 1024 * 1024;
export const MODELS_DIR = path.resolve(process.env.BONSAI_MODELS_DIR || path.join(PROJECT, "models"));
export const HUB_FILE = path.resolve(process.env.BONSAI_HUB_CATALOG || path.join(MODELS_DIR, "hub-catalog.json"));
export const CURATED_FILE = path.resolve(process.env.BONSAI_CURATED_CATALOG || path.join(PROJECT, "config", "model-catalog.json"));
export const ALLOW_PRIVATE = process.env.BONSAI_HUB_ALLOW_PRIVATE === "1";
export const USER_AGENT = "Bonsai-Model-Hub/1.0 (+https://github.com/Vahlame/bonsai-local-ide)";
export const MAX_PARALELOS = 2;

export function log(...args) {
  process.stderr.write(`[model-hub] ${args.join(" ")}\n`);
}
