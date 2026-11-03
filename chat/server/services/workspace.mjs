/**
 * Carpeta de trabajo activa: carga, cambio validado, persistencia y búsqueda
 * acotada. El resto del servidor solo ve `getRoot()`; la variable mutable vive
 * aquí y no en `ui-server.mjs`.
 */
import fs from "node:fs";
import path from "node:path";
import { escribirJsonAtomico } from "../../almacen-json.mjs";
import { listWorkspace } from "../workspace.mjs";
import { createProjectSearch } from "./project-search.mjs";

/**
 * @param {{
 *   projectRoot: string,
 *   stateFile: string,
 *   list?: typeof listWorkspace,
 * }} ctx
 */
export function createWorkspaceService(ctx) {
  const list = ctx.list || listWorkspace;
  let root = ctx.projectRoot;

  /** @returns {string} */
  function getRoot() {
    return root;
  }

  /**
   * Carga la última carpeta guardada. Si no existe o no es una carpeta, vuelve
   * al proyecto. No lanza: el IDE debe abrir siempre.
   * @returns {string}
   */
  function load() {
    try {
      const raw = JSON.parse(fs.readFileSync(ctx.stateFile, "utf8"));
      if (!raw || typeof raw.path !== "string") return root;
      const abs = path.resolve(raw.path);
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) root = abs;
    } catch {
      root = ctx.projectRoot;
    }
    return root;
  }

  /**
   * Cambia la carpeta activa y la persiste de forma atómica.
   * @param {string} raw
   * @returns {string}
   */
  function setRoot(raw) {
    const abs = path.resolve(String(raw));
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      throw new Error("Esa carpeta no existe.");
    }
    if (!stat.isDirectory()) throw new Error("Eso no es una carpeta.");
    root = abs;
    escribirJsonAtomico(ctx.stateFile, { path: abs }, { copia: false, espacio: 0 });
    return root;
  }

  /** @returns {{root: string, name: string, files: Array<{rel: string, bytes: number}>}} */
  function payload() {
    return {
      root,
      name: path.basename(root) || root,
      files: list(root, "", [], 0),
    };
  }

  const { search } = createProjectSearch({ getRoot });

  return { getRoot, load, setRoot, payload, search };
}
