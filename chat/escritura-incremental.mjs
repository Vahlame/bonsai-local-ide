import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveInside } from "./actions.mjs";
import { escribirAtomico } from "./archivos-seguros.mjs";

// Las piezas se conservan fuera del proyecto hasta la confirmación final.
// El offset en bytes hace detectables los reintentos y los trozos perdidos.
export class EscrituraIncremental {
  constructor(root, dir) { this.root = path.resolve(root); this.dir = dir; }
  paths(id) {
    if (!/^[a-f0-9]{32}$/.test(String(id))) throw new Error("Identificador de escritura inválido");
    return { meta: path.join(this.dir, `${id}.json`), data: path.join(this.dir, `${id}.part`) };
  }
  iniciar(rel) {
    const abs = resolveInside(this.root, rel);
    if (fs.existsSync(abs)) throw new Error("El archivo ya existe; usa reemplazar para editarlo");
    fs.mkdirSync(this.dir, { recursive: true });
    const id = crypto.randomBytes(16).toString("hex"), p = this.paths(id);
    fs.writeFileSync(p.data, "", { flag: "wx" });
    const canonical = path.relative(this.root, abs).replace(/\\/g, "/");
    escribirAtomico(p.meta, JSON.stringify({ root: this.root, rel: canonical }));
    return { id, ruta: canonical, bytes: 0, siguiente: 0, terminado: false, maxBytes: 1500000 };
  }
  leer(id) {
    const p = this.paths(id), meta = JSON.parse(fs.readFileSync(p.meta, "utf8"));
    if (meta.root !== this.root) throw new Error("La escritura pertenece a otro proyecto");
    return { ...p, ...meta, bytes: fs.statSync(p.data).size };
  }
  continuar(id, offset, texto) {
    if (typeof texto !== "string") throw new Error("contenido debe ser texto");
    const s = this.leer(id), bytes = Buffer.from(String(texto), "utf8");
    if (!Number.isInteger(offset) || offset !== s.bytes) throw new Error(`Offset incorrecto; el siguiente byte es ${s.bytes}`);
    if (bytes.includes(0)) throw new Error("La escritura solo admite texto");
    if (s.bytes + bytes.length > 1500000) throw new Error("La escritura supera el límite de 1500000 bytes; no se añadió el fragmento");
    fs.appendFileSync(s.data, bytes);
    return { id, ruta: s.rel, bytes: s.bytes + bytes.length, siguiente: s.bytes + bytes.length, terminado: false };
  }
  preparar(id, offset) {
    const s = this.leer(id);
    if (!Number.isInteger(offset) || offset !== s.bytes) throw new Error(`Offset incorrecto; el siguiente byte es ${s.bytes}`);
    const abs = resolveInside(this.root, s.rel);
    if (fs.existsSync(abs)) throw new Error("El destino apareció durante la escritura; no se sobrescribió");
    return { ...s, contenido: fs.readFileSync(s.data, "utf8") };
  }
  borrar(id) { const p = this.paths(id); fs.rmSync(p.meta, { force: true }); fs.rmSync(p.data, { force: true }); }
}
