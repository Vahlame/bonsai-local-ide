/**
 * Búsqueda de texto acotada dentro de la carpeta de trabajo. No sigue enlaces
 * fuera del proyecto y no carga archivos enormes ni binarios.
 */
import fs from "node:fs";
import path from "node:path";
import { SKIP_DIR, SKIP_EXT } from "../workspace.mjs";

const MAX_ARCHIVOS = 3000;
const MAX_BYTES = 800_000;

/**
 * @param {{getRoot: () => string}} ctx
 */
export function createProjectSearch(ctx) {
  /**
   * @param {string} consulta
   * @param {number} limite
   * @returns {{rel: string, linea: number, texto: string}[]}
   */
  function search(consulta, limite) {
    const root = ctx.getRoot();
    const aguja = consulta.toLowerCase();
    /** @type {{rel: string, linea: number, texto: string}[]} */
    const out = [];
    /** @type {string[]} */
    const pendientes = [""];
    let archivos = 0;
    while (pendientes.length && out.length < limite && archivos < MAX_ARCHIVOS) {
      const rel = /** @type {string} */ (pendientes.shift());
      const absDir = rel ? path.join(root, rel) : root;
      let entradas;
      try {
        entradas = fs.readdirSync(absDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entradas) {
        if (out.length >= limite || archivos >= MAX_ARCHIVOS) break;
        // No seguir enlaces: podrían apuntar fuera del proyecto.
        if (e.isSymbolicLink()) continue;
        if (e.name.startsWith(".") && e.name !== ".cursor") continue;
        const hijoRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (SKIP_DIR.has(e.name) || e.name === ".git") continue;
          pendientes.push(hijoRel);
          continue;
        }
        if (!e.isFile()) continue;
        if (SKIP_EXT.has(path.extname(e.name).toLowerCase())) continue;
        let buf;
        try {
          // stat antes de leer: un archivo de 500 MB no debe cargarse para luego
          // descubrir que supera el límite.
          const st = fs.statSync(path.join(root, hijoRel));
          if (st.size > MAX_BYTES) continue;
          buf = fs.readFileSync(path.join(root, hijoRel));
        } catch {
          continue;
        }
        if (buf.length > MAX_BYTES || buf.includes(0)) continue;
        archivos += 1;
        const lineas = buf.toString("utf8").split("\n");
        for (let i = 0; i < lineas.length; i += 1) {
          if (lineas[i].toLowerCase().includes(aguja)) {
            out.push({ rel: hijoRel, linea: i + 1, texto: lineas[i].trim().slice(0, 220) });
            if (out.length >= limite) break;
          }
        }
      }
    }
    return out;
  }

  return { search };
}
