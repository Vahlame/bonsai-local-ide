import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Reject links at every existing component, including dangling links and junctions.
// The selected root itself may be a link; its descendants may not be.
export function rutaSegura(root, rel) {
  if (typeof rel !== "string" || !rel || rel.includes("\0") || path.isAbsolute(rel)) return null;
  const parts = rel.replace(/\\/g, "/").split("/");
  if (parts.some((p) => p === ".." || (process.platform === "win32" && (p.includes(":") || (/[. ]$/.test(p) && p !== ".") || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))))) return null;
  const base = path.resolve(root);
  const abs = path.resolve(base, rel);
  const relative = path.relative(base, abs);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  let current = base;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return null;
    } catch (err) {
      if (err.code === "ENOENT") break;
      return null;
    }
  }
  return abs;
}

// Flush a temporary sibling before replacing the destination. A failure leaves
// the original untouched, and cleanup never deletes the destination.
export function escribirAtomico(abs, contenido) {
  const dir = path.dirname(abs);
  const tmp = path.join(dir, `.bonsai-${crypto.randomBytes(12).toString("hex")}.tmp`);
  let fd;
  try {
    let mode = 0o666;
    try { mode = fs.statSync(abs).mode & 0o777; } catch (err) { if (err.code !== "ENOENT") throw err; }
    fd = fs.openSync(tmp, "wx", mode);
    fs.writeFileSync(fd, contenido);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, abs);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch (err) { if (err.code !== "ENOENT") throw err; }
  }
}
