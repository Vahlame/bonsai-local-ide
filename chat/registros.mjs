import fs from "node:fs";
import path from "node:path";

// Limit both line count and retained line length; a single 64 MiB line must not
// be materialized in memory. Decode UTF-8 across chunk boundaries via Node streams.
export async function consultarRegistro(dir, id, desde = 1, consulta = "", signal) {
  if (!/^[a-f0-9]{32}$/.test(String(id))) throw new Error("Identificador de registro inválido");
  const file = path.join(dir, `${id}.log`);
  const start = Math.max(1, Number.isInteger(desde) ? desde : 1);
  const query = String(consulta || "").toLowerCase().slice(0, 200);
  const found = [];
  let line = 1, head = "", tail = "", match = !query, hadText = false;
  const collect = part => {
    if (!part) return;
    hadText = true;
    if (head.length < 500) head += part.slice(0, 500-head.length);
    if (query && !match) match = (tail + part).toLowerCase().includes(query);
    if (query) tail = query.length > 1 ? (tail + part).slice(-(query.length-1)) : "";
  };
  const finishLine = () => {
    if (line >= start && match) found.push(`${line}: ${head.replace(/\r$/, "")}`);
    line++; head = ""; tail = ""; match = !query; hadText = false;
  };
  const stream = fs.createReadStream(file,{encoding:"utf8",highWaterMark:64*1024,signal});
  for await (const chunk of stream) {
    let from = 0;
    for (;;) {
      const end = chunk.indexOf("\n", from);
      if (end < 0) { collect(chunk.slice(from)); break; }
      collect(chunk.slice(from,end)); finishLine(); from = end+1;
      if (found.length >= 80) { stream.destroy(); break; }
    }
    if (found.length >= 80) break;
  }
  if (hadText && found.length < 80) finishLine();
  return `Registro ${id}; lectura hasta la línea ${line-1}. ${found.length ? found.join("\n") : "Sin coincidencias."}\nPara continuar usa desde ${line}.`;
}
