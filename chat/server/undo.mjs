/**
 * Puntos de deshacer de escrituras y renombrados. Vive fuera de ui-server para
 * que la politica de retencion y conflicto no se mezcle con el router HTTP.
 */
import fs from "node:fs";
import path from "node:path";

const PROTEGIDOS = new Set([".git"]);
const UNDO_MAX = 400;
const PODAR_CADA = 16;

export class UndoStore {
  /**
   * @param {{dir: string, getWorkspaceRoot: () => string, fileInside: (root: string, rel: string) => string | null, escribirAtomico: (abs: string, text: string) => void, limiteTexto: number}} opts
   */
  constructor(opts) {
    this.dir = opts.dir;
    this.getWorkspaceRoot = opts.getWorkspaceRoot;
    this.fileInside = opts.fileInside;
    this.escribirAtomico = opts.escribirAtomico;
    this.limiteTexto = opts.limiteTexto;
    this.podarPendiente = false;
    this.escrituras = 0;
  }

  /**
   * @param {{tipo?: string, rel?: string, antes?: string | null, despues?: string | null, destino?: string}} dato
   * @param {string[]} [bolsa]
   * @returns {string}
   */
  guardar(dato, bolsa) {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      this.escribirAtomico(path.join(this.dir, `${id}.json`), JSON.stringify({ ...dato, workspace: path.resolve(this.getWorkspaceRoot()), ts: Date.now() }));
    } catch {
      return "";
    }
    if (bolsa) bolsa.push(id);
    this.#podarDiferido();
    return id;
  }

  /** @param {string} id @param {string[]} [bolsa] */
  descartar(id, bolsa) {
    if (!id) return;
    try { fs.rmSync(path.join(this.dir, `${id}.json`), { force: true }); } catch { /* la copia sigue siendo recuperable */ }
    if (bolsa) {
      const index = bolsa.indexOf(id);
      if (index >= 0) bolsa.splice(index, 1);
    }
  }

  /** @param {string} rel @returns {boolean} */
  enCarpetaProtegida(rel) {
    const partes = String(rel).replace(/\\/g, "/").split("/").map((parte) => parte.replace(/[. ]+$/, "").toLowerCase()).filter(Boolean);
    return partes.some((parte) => PROTEGIDOS.has(parte));
  }

  #podarDiferido() {
    this.escrituras += 1;
    if (this.podarPendiente || this.escrituras % PODAR_CADA !== 0) return;
    this.podarPendiente = true;
    setImmediate(() => {
      this.podarPendiente = false;
      this.#podar();
    });
  }

  #podar() {
    try {
      const nombres = fs.readdirSync(this.dir).filter((n) => n.endsWith(".json"));
      if (nombres.length <= UNDO_MAX) return;
      const fichas = nombres.map((n) => {
        const abs = path.join(this.dir, n);
        let mtime = 0;
        try { mtime = fs.statSync(abs).mtimeMs; } catch { mtime = 0; }
        return { n, abs, mtime };
      });
      fichas.sort((a, b) => b.mtime - a.mtime);
      for (const ficha of fichas.slice(UNDO_MAX)) fs.rmSync(ficha.abs, { force: true });
    } catch {
      /* si no se puede podar, no se rompe el guardado */
    }
  }

  /**
   * @param {string} id
   * @param {boolean} forzar
   * @param {boolean} [soloComprobar]
   * @returns {{ok: boolean, code: number, motivo?: string, rel?: string}}
   */
  aplicar(id, forzar, soloComprobar = false) {
    if (!/^[a-z0-9-]{4,40}$/i.test(id)) return { ok: false, code: 400, motivo: "id no valido" };
    const fichero = path.join(this.dir, `${id}.json`);
    if (!fs.existsSync(fichero)) return { ok: false, code: 404, motivo: "ese punto de deshacer ya no esta" };
    let dato;
    try {
      dato = JSON.parse(fs.readFileSync(fichero, "utf8"));
    } catch {
      return { ok: false, code: 500, motivo: "punto de deshacer ilegible" };
    }
    if (!dato || typeof dato.rel !== "string" || !dato.rel) return { ok: false, code: 500, motivo: "punto de deshacer corrupto" };
    const identidad = (p) => process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p);
    const workspaceRoot = this.getWorkspaceRoot();
    if (typeof dato.workspace !== "string" || identidad(dato.workspace) !== identidad(workspaceRoot)) return { ok: false, code: 409, motivo: "ese punto pertenece a otra carpeta o no identifica su proyecto" };
    if (this.enCarpetaProtegida(dato.rel) || (dato.destino && this.enCarpetaProtegida(dato.destino))) return { ok: false, code: 403, motivo: "carpeta protegida" };

    if (dato.tipo === "renombrado") {
      const destino = typeof dato.destino === "string" ? dato.destino : "";
      const absOrigen = this.fileInside(workspaceRoot, dato.rel);
      const absDestino = this.fileInside(workspaceRoot, destino);
      if (!absOrigen || !absDestino) return { ok: false, code: 403, motivo: "ruta no permitida" };
      if (!fs.existsSync(absDestino)) return { ok: false, code: 404, motivo: "el archivo renombrado ya no esta" };
      if (fs.existsSync(absOrigen) && !forzar) return { ok: false, code: 409, motivo: `ya existe ${dato.rel}`, rel: dato.rel };
      if (!soloComprobar) {
        fs.mkdirSync(path.dirname(absOrigen), { recursive: true });
        if (fs.existsSync(absOrigen)) fs.rmSync(absOrigen, { recursive: true, force: true });
        fs.renameSync(absDestino, absOrigen);
      }
      return { ok: true, code: 200, rel: dato.rel };
    }

    const abs = this.fileInside(workspaceRoot, dato.rel);
    if (!abs) return { ok: false, code: 403, motivo: "ruta no permitida", rel: dato.rel };
    const previsto = typeof dato.despues === "string" ? dato.despues : null;
    let actual = null;
    if (fs.existsSync(abs)) {
      const st = fs.statSync(abs);
      if (!st.isFile()) return { ok: false, code: 409, motivo: "hay una carpeta en esa ruta", rel: dato.rel };
      if (st.size > this.limiteTexto) return { ok: false, code: 409, motivo: "el archivo cambio desde entonces (es demasiado grande para compararlo)", rel: dato.rel };
      actual = fs.readFileSync(abs, "utf8");
    }
    if (!forzar && actual !== previsto) return { ok: false, code: 409, motivo: "el archivo cambio desde entonces", rel: dato.rel };
    if (soloComprobar) return { ok: true, code: 200, rel: dato.rel };
    if (typeof dato.antes === "string") {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      if (!this.fileInside(workspaceRoot, dato.rel)) return { ok: false, code: 403, motivo: "ruta no permitida", rel: dato.rel };
      this.escribirAtomico(abs, dato.antes);
    } else if (fs.existsSync(abs)) {
      fs.rmSync(abs);
    }
    return { ok: true, code: 200, rel: dato.rel };
  }
}
