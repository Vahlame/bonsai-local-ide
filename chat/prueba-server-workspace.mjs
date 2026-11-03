/** Pruebas de las operaciones de carpeta extraídas a chat/server/workspace.mjs. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileInside } from "./server/http.mjs";
import { rutaProyecto } from "./archivos-seguros.mjs";
import { resolveInside } from "./actions.mjs";
import { estimateTokens, takeHeadByTokens } from "./context.mjs";
import { leerTextoAcotado } from "./lecturas.mjs";
import { SKIP_DIR, SKIP_EXT, createWorkspaceTools, fileDelta, listWorkspace, snapshotFiles } from "./server/workspace.mjs";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-workspace-"));
try {
  const root = path.join(tmp, "proyecto");
  const adjuntos = path.join(tmp, "adjuntos");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules", "x"), { recursive: true });
  fs.mkdirSync(path.join(root, ".oculto"), { recursive: true });
  fs.mkdirSync(adjuntos, { recursive: true });
  fs.writeFileSync(path.join(root, "src", "app.js"), "export const valor = 1;\n", "utf8");
  fs.writeFileSync(path.join(root, "nota.txt"), "hola nota\n", "utf8");
  fs.writeFileSync(path.join(root, "grande.bin"), Buffer.alloc(2_000_000));
  fs.writeFileSync(path.join(root, "node_modules", "x", "index.js"), "no\n", "utf8");
  fs.writeFileSync(path.join(root, ".oculto", "x.js"), "no\n", "utf8");
  fs.writeFileSync(path.join(adjuntos, "foto.png"), Buffer.from([137, 80, 78, 71]));

  const listado = listWorkspace(root, "", [], 0).map((f) => f.rel);
  assert.deepEqual(listado, ["nota.txt", "src/app.js"], "solo archivos visibles y soportados");
  assert.ok(SKIP_DIR.has("node_modules") && SKIP_EXT.has(".gguf"));

  fs.mkdirSync(path.join(root, "bin"), { recursive: true });
  fs.writeFileSync(path.join(root, "bin", "x.js"), "no\n", "utf8");
  const antes = snapshotFiles(root);
  assert.ok(antes.has("nota.txt") && !antes.has("node_modules/x/index.js") && !antes.has("bin/x.js"));
  fs.writeFileSync(path.join(root, "nota.txt"), "hola nota cambiada\n", "utf8");
  fs.writeFileSync(path.join(root, "nuevo.txt"), "nuevo\n", "utf8");
  fs.rmSync(path.join(root, "src", "app.js"));
  const delta = fileDelta(antes, snapshotFiles(root));
  assert.match(delta, /modificado nota\.txt/);
  assert.match(delta, /nuevo nuevo\.txt/);
  assert.match(delta, /borrado src\/app\.js/);

  // La caché del snapshot solo se usa antes de un comando; el posterior fuerza
  // una lectura nueva para no perder cambios del comando.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const cacheA = snapshotFiles(root, { cache: true });
  const cacheB = snapshotFiles(root, { cache: true });
  assert.equal(cacheA, cacheB, "la caché reutiliza el snapshot");
  fs.writeFileSync(path.join(root, "nuevo.txt"), "nuevo cambiado\n", "utf8");
  const fresco = snapshotFiles(root, { force: true });
  assert.notEqual(fresco.get("nuevo.txt"), cacheA.get("nuevo.txt"), "force relee el archivo");

  let raizActiva = root;
  const tools = createWorkspaceTools({
    getRoot: () => raizActiva,
    adjuntosDir: adjuntos,
    fileInside,
    rutaProyecto,
    resolveInside,
    readLimited: (abs, limite) => leerTextoAcotado(abs, limite),
    takeHeadByTokens,
    estimateTokens,
  });

  assert.equal(tools.relCanonica("./nota.txt"), "nota.txt");
  assert.equal(tools.relCanonica("../fuera.txt"), "");
  assert.deepEqual(tools.filesNamedIn("revisa src/app.js y nota.txt"), ["nota.txt"], "solo archivos existentes");
  assert.match(tools.repoIndex(""), /Índice del repositorio/);
  assert.doesNotMatch(tools.repoIndex(".git"), /Índice/);

  const conArchivo = tools.attachFiles("pedido", ["nota.txt", "../fuera.txt"]);
  assert.match(conArchivo, /Archivo nota\.txt:\nhola nota cambiada/);
  assert.doesNotMatch(conArchivo, /fuera/);
  const conSnippet = tools.attachSnippets("pedido", [{ rel: "nota.txt", text: "hola nota", start: 1, end: 1 }]);
  assert.match(conSnippet, /Selección nota\.txt:1-1:\nhola nota/);
  const conImagen = tools.attachImagenes("pedido", ["foto.png", "../fuera.png"]);
  assert.match(conImagen, /adjuntó 1 imagen/);
  assert.doesNotMatch(conImagen, /fuera\.png/);

  const pdf = path.join(root, "salida.pdf");
  fs.writeFileSync(pdf, "%PDF-1.7\n");
  assert.match(tools.pdfReady("nuevo salida.pdf (8 bytes)"), /%PDF/);
  fs.writeFileSync(pdf, "no es pdf");
  assert.match(tools.pdfReady("modificado salida.pdf (9 bytes)"), /no empieza por %PDF/);

  raizActiva = path.join(tmp, "otra");
  fs.mkdirSync(raizActiva);
  fs.writeFileSync(path.join(raizActiva, "otro.txt"), "otro\n", "utf8");
  assert.match(tools.attachFiles("pedido", ["otro.txt"]), /Archivo otro\.txt:\notro/);

  console.log("Servidor/workspace: listado, instantáneas, adjuntos, índice y rutas verificados.");
} finally {
  assert.equal(path.dirname(tmp), os.tmpdir());
  assert.ok(path.basename(tmp).startsWith("bonsai-workspace-"));
  fs.rmSync(tmp, { recursive: true, force: true });
}
