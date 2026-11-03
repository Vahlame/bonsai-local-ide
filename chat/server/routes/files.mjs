/** Rutas de archivos, adjuntos, búsqueda y diagnósticos. */
import fs from "node:fs";
import path from "node:path";
import { readBody, fileInside } from "../http.mjs";
import { leerJson } from "../contracts.mjs";
import { LIMITE_TEXTO, decodificarRecorteUtf8, leerPrimerosBytes } from "../../lecturas.mjs";
import { aplicarRespuesta, construirMensajes, contarLineas, recorteLineas } from "../../editar.mjs";
import { unifiedDiff } from "../../actions.mjs";
import { buscarEstructural, buscarTexto } from "../../code-search.mjs";
import { buscarDefinicion, diagnosticarArchivo, diagnosticarTexto, simbolos } from "../../diagnosticos.mjs";
import { escribirAtomico } from "../../archivos-seguros.mjs";
import { clipText } from "../text.mjs";

/** ETag barato para el polling del editor: tamaño + mtime, sin hashear. */
function etagDe(st) {
  return `"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`;
}

/**
 * @param {Record<string, any>} ctx
 */
export function createFilesRoutes(ctx) {
  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {URL} url
   * @returns {Promise<boolean>}
   */
  return async function handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/workspace") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(ctx.workspacePayload()));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/workspace") {
      if (ctx.busy) {
        res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" }).end("espera a que termine el turno");
        return true;
      }
      const raw = await leerJson(req, "trabajo");
      const pick = raw.pick === true;
      const given = typeof raw.path === "string" ? raw.path.trim() : "";
      let next = given;
      if (pick) {
        next = await ctx.pickFolder(ctx.workspaceRoot);
        if (!next) {
          res.writeHead(204).end();
          return true;
        }
      }
      if (!next) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("falta la carpeta");
        return true;
      }
      ctx.setWorkspace(next);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(ctx.workspacePayload()));
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/file") {
      const rel = url.searchParams.get("path") || "";
      const abs = fileInside(ctx.workspaceRoot, rel);
      if (!abs) {
        res.writeHead(404).end("no está");
        return true;
      }
      let st;
      try {
        st = fs.statSync(abs);
      } catch {
        res.writeHead(404).end("no está");
        return true;
      }
      if (!st.isFile()) {
        res.writeHead(404).end("no está");
        return true;
      }
      const etag = etagDe(st);
      if (req.headers["if-none-match"] === etag) {
        res.writeHead(304, { ETag: etag, "Cache-Control": "no-store" });
        res.end();
        return true;
      }
      // stat ANTES de leer: antes se hacía readFileSync de un archivo enorme para
      // recortarlo a 2 MB después, bloqueando el event loop. Ahora solo se leen los
      // primeros 2 MB (y se recorta en un límite UTF-8 válido).
      const cortado = st.size > LIMITE_TEXTO;
      const buf = cortado ? leerPrimerosBytes(abs, LIMITE_TEXTO) : fs.readFileSync(abs);
      if (buf.includes(0)) {
        res.writeHead(415).end("no es texto");
        return true;
      }
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        ETag: etag,
        "X-Bonsai-Bytes": String(st.size),
        "X-Bonsai-Truncado": cortado ? "1" : "0",
      });
      res.end(cortado ? decodificarRecorteUtf8(buf) : buf.toString("utf8"));
      return true;
    }
    // ---------------------------------------------------------- guardar archivo
    if (req.method === "POST" && url.pathname === "/api/file") {
      // El editor puede mandar archivos de hasta 2 MB: el limite por defecto de
      // readBody (200 KB, pensado para mensajes) los cortaria antes de poder
      // contestar un 413 limpio.
      const raw = await leerJson(req, "archivo", 2_500_000);
      const rel = raw.path;
      const contenido = raw.content;
      const crear = raw.create === true;
      if (!rel || contenido === null) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("faltan path o content");
        return true;
      }
      const abs = fileInside(ctx.workspaceRoot, rel);
      if (!abs) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("ruta no permitida");
        return true;
      }
      if (ctx.undoStore.enCarpetaProtegida(rel)) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("esa carpeta esta protegida");
        return true;
      }
      const bytes = Buffer.byteLength(contenido, "utf8");
      if (bytes > 2_000_000) {
        res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" }).end("archivo demasiado grande (2 MB)");
        return true;
      }
      const existe = (() => {
        try { return fs.statSync(abs); } catch { return null; }
      })();
      if (existe && !existe.isFile()) {
        res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" }).end("en esa ruta hay una carpeta, no un archivo");
        return true;
      }
      if (!existe && !crear) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("no existe (usa create para crearlo)");
        return true;
      }
      let antes = null;
      if (existe) {
        // El editor nunca edita archivos de más de 2 MB (los abre recortados y no los
        // guarda). Comprobar el tamaño con stat evita leer entero un archivo enorme solo
        // para descubrir que no se puede guardar.
        if (existe.size > LIMITE_TEXTO) {
          res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" }).end("el archivo en disco supera 2 MB y no se puede editar desde el editor; usa el agente");
          return true;
        }
        const previo = fs.readFileSync(abs);
        if (previo.length > LIMITE_TEXTO) {
          res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" }).end("el archivo creció mientras se guardaba; vuelve a abrirlo");
          return true;
        }
        if (previo.includes(0)) {
          res.writeHead(415, { "Content-Type": "text/plain; charset=utf-8" }).end("no es texto");
          return true;
        }
        antes = previo.toString("utf8");
      }
      if (typeof raw.before === "string" && antes !== raw.before) {
        res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" }).end("El archivo cambio en disco. Tus cambios siguen en el editor; revisa la version nueva antes de guardar.");
        return true;
      }
      const undoId = ctx.undoStore.guardar({ tipo: "texto", rel, antes, despues: contenido });
      if (!undoId) throw new Error("No se pudo preparar la copia para deshacer; el archivo no se cambió");
      try {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        if (!fileInside(ctx.workspaceRoot, rel)) throw new Error("ruta no permitida");
        escribirAtomico(abs, contenido);
      } catch (err) {
        ctx.undoStore.descartar(undoId);
        throw err;
      }
      let etag = "";
      try { etag = etagDe(fs.statSync(abs)); } catch { /* el archivo se acaba de escribir */ }
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", ...(etag ? { ETag: etag } : {}) });
      res.end(JSON.stringify({ ok: true, rel, bytes, undo: undoId }));
      return true;
    }
    // ------------------------------------------------------------ deshacer
    if (req.method === "POST" && url.pathname === "/api/undo") {
      const raw = await leerJson(req, "deshacer");
      const forzar = raw.force === true;
      // Revertir TODO lo que escribió el agente en el turno en curso o en el último.
      if (raw && raw.turno === true) {
        if (!ctx.undoDelTurno.length) {
          res.writeHead(409, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "no hay escrituras del agente que revertir" }));
          return true;
        }
        const pendientes = ctx.undoDelTurno.slice().reverse();
        /** @type {Array<{id: string, rel: string, motivo: string}>} */
        const conflictos = [];
        for (const id of pendientes) {
          const visto = ctx.undoStore.aplicar(id, forzar, true);
          if (!visto.ok) conflictos.push({ id, rel: visto.rel || "", motivo: visto.motivo || "no se puede" });
        }
        if (conflictos.length && !forzar) {
          res.writeHead(409, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "alguno de los archivos cambio desde entonces", conflictos }));
          return true;
        }
        /** @type {string[]} */
        const revertidos = [];
        for (const id of pendientes) {
          const hecho = ctx.undoStore.aplicar(id, forzar);
          if (hecho.ok && hecho.rel) revertidos.push(hecho.rel);
        }
        ctx.undoDelTurno.length = 0;
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, revertidos }));
        return true;
      }
      const id = raw && typeof raw.id === "string" ? raw.id : "";
      const hecho = ctx.undoStore.aplicar(id, forzar);
      if (!hecho.ok) {
        res.writeHead(hecho.code, { "Content-Type": "text/plain; charset=utf-8" }).end(hecho.motivo || "no se pudo deshacer");
        return true;
      }
      const enTurno = ctx.undoDelTurno.indexOf(id);
      if (enTurno >= 0) ctx.undoDelTurno.splice(enTurno, 1);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, rel: hecho.rel }));
      return true;
    }
    // ------------------------------------------ nuevo / renombrar / borrar
    if (req.method === "POST" && url.pathname === "/api/fs") {
      const raw = JSON.parse(await readBody(req));
      const op = raw && typeof raw.op === "string" ? raw.op : "";
      const limpia = (valor) => String(valor || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
      const rel = limpia(raw && raw.path);
      const destino = limpia(raw && raw.to);
      if (!rel) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("falta la ruta");
        return true;
      }
      const abs = fileInside(ctx.workspaceRoot, rel);
      if (!abs) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("ruta no permitida");
        return true;
      }
      if (ctx.undoStore.enCarpetaProtegida(rel)) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("esa carpeta esta protegida");
        return true;
      }
      if (op === "nuevo" || op === "carpeta") {
        if (fs.existsSync(abs)) {
          res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" }).end("ya existe");
          return true;
        }
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        if (!fileInside(ctx.workspaceRoot, rel)) throw new Error("ruta no permitida");
        let undoId = "";
        if (op === "carpeta") {
          fs.mkdirSync(abs, { recursive: true });
        } else {
          undoId = ctx.undoStore.guardar({ tipo: "texto", rel, antes: null, despues: "" });
          if (!undoId) throw new Error("No se pudo preparar la copia para deshacer; el archivo no se creó");
          try {
            if (!fileInside(ctx.workspaceRoot, rel)) throw new Error("ruta no permitida");
            escribirAtomico(abs, "");
          } catch (err) { ctx.undoStore.descartar(undoId); throw err; }
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, op, rel, undo: undoId }));
        return true;
      }
      if (op === "renombrar") {
        if (!destino) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("falta el destino");
          return true;
        }
        const absDestino = fileInside(ctx.workspaceRoot, destino);
        if (!absDestino || ctx.undoStore.enCarpetaProtegida(destino)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("ruta no permitida");
          return true;
        }
        if (!fs.existsSync(abs)) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("no existe");
          return true;
        }
        if (fs.existsSync(absDestino)) {
          res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" }).end("ya existe el destino");
          return true;
        }
        fs.mkdirSync(path.dirname(absDestino), { recursive: true });
        if (!fileInside(ctx.workspaceRoot, rel) || !fileInside(ctx.workspaceRoot, destino)) throw new Error("ruta no permitida");
        fs.renameSync(abs, absDestino);
        const undoId = ctx.undoStore.guardar({ tipo: "renombrado", rel, destino });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, op, rel, to: destino, undo: undoId }));
        return true;
      }
      if (op === "borrar") {
        if (!fs.existsSync(abs)) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("no existe");
          return true;
        }
        const carpeta = fs.statSync(abs).isDirectory();
        let undoId = "";
        if (!carpeta) {
          // Se guarda copia solo si es un texto de tamaño razonable: comprobar el tamaño
          // antes evita leer un archivo enorme para descubrir que no cabe en el undo.
          const st = fs.statSync(abs);
          if (st.size <= LIMITE_TEXTO) {
            const buf = fs.readFileSync(abs);
            if (!buf.includes(0)) undoId = ctx.undoStore.guardar({ tipo: "texto", rel, antes: buf.toString("utf8"), despues: null });
          }
        }
        fs.rmSync(abs, { recursive: true, force: true });
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true, op, rel, carpeta, undo: undoId || false }));
        return true;
      }
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("operacion desconocida");
      return true;
    }
    // ------------------------------------------- edición en línea (Ctrl+K)
    if (req.method === "POST" && url.pathname === "/api/edit") {
      const raw = JSON.parse(await readBody(req));
      const rel = raw && typeof raw.path === "string" ? raw.path.trim().replace(/\\/g, "/") : "";
      const instruccion = raw && typeof raw.instruccion === "string" ? raw.instruccion.trim().slice(0, 2000) : "";
      const start = Number.parseInt(String(raw && raw.start), 10);
      const end = Number.parseInt(String(raw && raw.end), 10);
      if (!rel || !instruccion || !Number.isFinite(start) || !Number.isFinite(end)) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("faltan path, start, end o instruccion");
        return true;
      }
      if (ctx.busy) {
        res.writeHead(409, { "Content-Type": "text/plain; charset=utf-8" }).end("espera a que termine el turno");
        return true;
      }
      const abs = fileInside(ctx.workspaceRoot, rel);
      if (!abs || ctx.undoStore.enCarpetaProtegida(rel)) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" }).end("ruta no permitida");
        return true;
      }
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("no existe");
        return true;
      }
      // Edición en línea: el archivo se manda al modelo entero, así que se limita el
      // tamaño ANTES de leerlo (antes se hacía readFileSync de cualquier tamaño).
      if (fs.statSync(abs).size > LIMITE_TEXTO) {
        res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" }).end("archivo demasiado grande para editar en línea (2 MB)");
        return true;
      }
      const buf = fs.readFileSync(abs);
      if (buf.includes(0)) {
        res.writeHead(415, { "Content-Type": "text/plain; charset=utf-8" }).end("no es texto");
        return true;
      }
      const texto = buf.toString("utf8");
      const total = contarLineas(texto);
      const desde = Math.min(Math.max(1, start), total);
      const hasta = Math.min(Math.max(desde, end), total);
      const mensajes = construirMensajes({ rel, texto, start: desde, end: hasta, instruccion });
      ctx.busy = true;
      const ac = new AbortController();
      ctx.chat.active = ac;
      const previoTool = ctx.chat.toolChoice;
      const previoPush = ctx.chat.push;
      const previoThink = ctx.chat.thinkBudget;
      ctx.chat.toolChoice = "none";
      // El razonamiento (si el usuario lo encendió) aquí solo gasta tiempo: es un
      // reemplazo mecánico de unas líneas.
      ctx.chat.thinkBudget = 0;
      ctx.chat.push = null;
      try {
        // Sin herramientas (tool_choice "none"): el modelo solo devuelve el reemplazo.
        const salida = await ctx.chat.streamSlice(mensajes, 1200, false, ac.signal);
        const aplicado = aplicarRespuesta({ texto, start: desde, end: hasta, respuesta: salida.chunk });
        // `base` es el contenido EXACTO sobre el que se generó la propuesta: la UI lo
        // manda como precondición `before` al aceptar. Sin esto, guardar una propuesta
        // tardía pisaba los cambios hechos en disco/editor mientras se esperaba.
        const inicioReal = Number.isInteger(aplicado.start) ? aplicado.start : desde;
        const finReal = Number.isInteger(aplicado.end) ? aplicado.end : hasta;
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          ok: true,
          rel,
          base: texto,
          start: inicioReal,
          end: finReal,
          lineasAplicadas: aplicado.lineasAplicadas,
          seleccion: typeof aplicado.seleccion === "string" ? aplicado.seleccion : recorteLineas(texto, inicioReal, finReal),
          propuesta: aplicado.propuesta,
          texto: aplicado.texto,
          borra: aplicado.borra,
          cambia: aplicado.texto !== texto,
          diff: clipText(unifiedDiff(rel, texto, aplicado.texto), 8000),
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Respuesta vacía: no es un 502 del modelo, es una propuesta que no se aplica.
        const estado = err && typeof err === "object" && /** @type {{status?: number}} */ (err).status === 422 ? 422 : 502;
        const motivo = err && typeof err === "object" && typeof /** @type {{motivo?: unknown}} */ (err).motivo === "string"
          ? /** @type {{motivo: string}} */ (err).motivo
          : (estado === 422 ? message : `el modelo no pudo editar: ${message}`);
        res.writeHead(estado, { "Content-Type": "text/plain; charset=utf-8" }).end(motivo);
      } finally {
        ctx.chat.toolChoice = previoTool;
        ctx.chat.push = previoPush;
        ctx.chat.thinkBudget = previoThink;
        ctx.chat.active = null;
        ctx.busy = false;
      }
      return true;
    }
    // -------------------------------------------------- adjuntar imágenes
    if (req.method === "POST" && url.pathname === "/api/attach") {
      const raw = JSON.parse(await readBody(req, 12_000_000));
      const nombre = (raw && typeof raw.nombre === "string" ? raw.nombre : "imagen.png")
        .replace(/[\\/]+/g, "-")
        .replace(/[^\w.\- ]+/g, "_")
        .slice(-80);
      const bruto = raw && typeof raw.datos === "string" ? raw.datos : "";
      const base64 = bruto.replace(/^data:[^;,]*;base64,/i, "").replace(/\s+/g, "");
      if (!base64) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("faltan los datos de la imagen");
        return true;
      }
      // Buffer.from(..., "base64") NO lanza: ignora en silencio los caracteres que no
      // reconoce. El catch que había aquí era inalcanzable, así que una imagen corrupta
      // se guardaba (y con visión se le mandaba al modelo) como si estuviera bien.
      // Se valida el alfabeto antes de decodificar y así el 400 sí es alcanzable.
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("base64 no valido");
        return true;
      }
      const datos = Buffer.from(base64, "base64");
      if (!datos.length || datos.length > 8_000_000) {
        res.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" }).end("la imagen tiene que pesar menos de 8 MB");
        return true;
      }
      const ext = /\.(png|jpe?g|gif|webp|bmp)$/i.test(nombre) ? "" : ".png";
      const archivo = `${Date.now().toString(36)}-${nombre}${ext}`;
      fs.mkdirSync(ctx.ADJUNTOS_DIR, { recursive: true });
      fs.writeFileSync(path.join(ctx.ADJUNTOS_DIR, archivo), datos);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, archivo, bytes: datos.length, vision: Boolean(ctx.chat.vision) }));
      return true;
    }
    // ------------------------------------------------- buscar en el proyecto
    if (req.method === "GET" && url.pathname === "/api/search") {
      const q = (url.searchParams.get("q") || "").trim();
      const limite = Math.min(Math.max(Number(url.searchParams.get("limit")) || 60, 1), 200);
      if (q.length < 2) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "hacen falta 2 caracteres", resultados: [] }));
        return true;
      }
      const busqueda = await buscarTexto(ctx.workspaceRoot, q, { max: limite });
      const resultados = busqueda.ok
        ? busqueda.resultados.map(({ archivo, linea, texto }) => ({ rel: archivo, linea, texto }))
        : ctx.buscarEnProyecto(q, limite);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ q, motor: busqueda.ok ? busqueda.motor : "node-fallback", resultados }));
      return true;
    }
    // Búsqueda estructural (ast-grep) para JS/TS/TSX/HTML/CSS.
    if (req.method === "GET" && url.pathname === "/api/search/estructural") {
      const q = (url.searchParams.get("q") || "").trim();
      const lang = (url.searchParams.get("lang") || "ts").trim();
      if (q.length < 2) {
        res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "hacen falta 2 caracteres", resultados: [] }));
        return true;
      }
      const datos = await buscarEstructural(ctx.workspaceRoot, q, lang, { max: 80 });
      res.writeHead(datos.ok ? 200 : 400, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(datos));
      return true;
    }
    // ------------------------------------------ diagnósticos / esquema / definición
    if (req.method === "GET" && url.pathname === "/api/diag") {
      const rel = String(url.searchParams.get("path") || "").trim().replace(/\\/g, "/");
      const abs = rel ? fileInside(ctx.workspaceRoot, rel) : null;
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("no existe ese archivo");
        return true;
      }
      const diagnosticos = await diagnosticarArchivo(abs);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ diagnosticos: diagnosticos.map((d) => ({ ...d, archivo: rel })) }));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/diag") {
      const raw = JSON.parse(await readBody(req));
      const rel = String(raw && raw.path ? raw.path : "").trim().replace(/\\/g, "/");
      const texto = raw && typeof raw.texto === "string" ? raw.texto.slice(0, LIMITE_TEXTO) : "";
      if (!rel) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("falta path");
        return true;
      }
      const diagnosticos = diagnosticarTexto(rel, texto);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ diagnosticos }));
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/simbolos") {
      const rel = String(url.searchParams.get("path") || "").trim().replace(/\\/g, "/");
      const abs = rel ? fileInside(ctx.workspaceRoot, rel) : null;
      if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("no existe ese archivo");
        return true;
      }
      const st = fs.statSync(abs);
      const texto = st.size <= LIMITE_TEXTO ? fs.readFileSync(abs, "utf8") : "";
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ simbolos: simbolos(rel, texto) }));
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/definir") {
      const raw = await leerJson(req, "definir");
      const palabra = String(raw.palabra || "").trim().slice(0, 200);
      const rel = String(raw.path || "").trim().replace(/\\/g, "/");
      const indice = palabra ? await ctx.indiceProyecto() : null;
      const definicion = indice ? buscarDefinicion(palabra, indice, rel) : null;
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify({ definicion }));
      return true;
    }
    return false;
  };
}
