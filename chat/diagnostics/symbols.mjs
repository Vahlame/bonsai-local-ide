/**
 * Outline de símbolos, índice del proyecto y «ir a definición». Usa los helpers
 * de análisis para limpiar comentarios/cadenas y calcular líneas.
 */
import fs from "node:fs";
import path from "node:path";
import {
  CARPETAS_OMITIDAS,
  EXTENSIONES_INDICE,
  LIMITE_ARCHIVO_INDICE,
  MAX_ARCHIVOS_INDICE,
  PALABRAS_NO_METODO,
  RE_HTML_ATRIBUTO,
  RE_JS_CLASE,
  RE_JS_FUNCION,
  RE_JS_METODO,
  RE_JS_VAR,
  RE_JS_VAR_FUNCION,
  RE_PY_CLASE,
  RE_PY_FUNCION,
  iniciosDeLinea,
  lenguajeDe,
  limpiarCss,
  limpiarHtml,
  limpiarJs,
  limpiarPy,
  posicionDe,
  quitarBom,
} from "./analysis.mjs";

function buscarNombreIdentificador(linea, nombre, desde = 0) {
  let idx = linea.indexOf(nombre, Math.max(0, desde));
  while (idx >= 0) {
    const antes = idx > 0 ? linea[idx - 1] : "";
    const despues = idx + nombre.length < linea.length ? linea[idx + nombre.length] : "";
    if (!/[A-Za-z0-9_$]/.test(antes) && !/[A-Za-z0-9_$]/.test(despues)) return idx;
    idx = linea.indexOf(nombre, idx + 1);
  }
  return -1;
}

/**
 * Símbolos de JavaScript (funciones, clases, variables y métodos de clase).
 * @param {string} contenido
 * @returns {Array<{nombre: string, tipo: string, linea: number, columna: number}>}
 */
function simbolosJs(contenido) {
  /** @type {Array<{nombre: string, tipo: string, linea: number, columna: number}>} */
  const res = [];
  const limpio = limpiarJs(contenido);
  const lineas = limpio.split("\n");
  let profundidad = 0;
  /** @type {{prof: number, restantes: number} | null} */
  let clasePendiente = null;
  /** @type {{prof: number} | null} */
  let claseActiva = null;
  for (let n = 0; n < lineas.length; n += 1) {
    const cruda = lineas[n];
    const linea = cruda.endsWith("\r") ? cruda.slice(0, -1) : cruda;
    const profAntes = profundidad;
    let reconocida = false;
    const mFuncion = RE_JS_FUNCION.exec(linea);
    const mClase = mFuncion ? null : RE_JS_CLASE.exec(linea);
    const mVarFuncion = mFuncion || mClase ? null : RE_JS_VAR_FUNCION.exec(linea);
    const mVar = !mFuncion && !mClase && !mVarFuncion ? RE_JS_VAR.exec(linea) : null;
    const agregar = (nombre, tipo) => {
      const indiceNombre = buscarNombreIdentificador(linea, nombre);
      res.push({ nombre, tipo, linea: n + 1, columna: (indiceNombre < 0 ? 0 : indiceNombre) + 1 });
      reconocida = true;
    };
    if (mFuncion) agregar(mFuncion[1], "funcion");
    else if (mClase) {
      agregar(mClase[1], "clase");
      clasePendiente = { prof: profAntes + 1, restantes: 2 };
    } else if (mVarFuncion) agregar(mVarFuncion[1], "funcion");
    else if (mVar) agregar(mVar[1], "variable");
    if (!reconocida && claseActiva && profAntes === claseActiva.prof) {
      const mMetodo = RE_JS_METODO.exec(linea);
      if (mMetodo && !PALABRAS_NO_METODO.has(mMetodo[2])) {
        agregar(mMetodo[2], "metodo");
      }
    }
    // Profundidad de llaves después de esta línea (el texto ya está limpio de cadenas).
    let abre = 0;
    let cierra = 0;
    for (const c of linea) {
      if (c === "{") abre += 1;
      else if (c === "}") cierra += 1;
    }
    profundidad += abre - cierra;
    if (clasePendiente) {
      if (profundidad >= clasePendiente.prof && clasePendiente.prof > profAntes) {
        claseActiva = { prof: clasePendiente.prof };
        clasePendiente = null;
      } else {
        clasePendiente.restantes -= 1;
        if (clasePendiente.restantes < 0) clasePendiente = null;
      }
    }
    if (claseActiva && profundidad < claseActiva.prof) claseActiva = null;
  }
  return res;
}

/**
 * Símbolos de Python (`def` y `class`).
 * @param {string} contenido
 * @returns {Array<{nombre: string, tipo: string, linea: number, columna: number}>}
 */
function simbolosPy(contenido) {
  /** @type {Array<{nombre: string, tipo: string, linea: number, columna: number}>} */
  const res = [];
  const lineas = limpiarPy(contenido).split("\n");
  for (let n = 0; n < lineas.length; n += 1) {
    const linea = lineas[n].endsWith("\r") ? lineas[n].slice(0, -1) : lineas[n];
    const mFuncion = RE_PY_FUNCION.exec(linea);
    if (mFuncion) {
      const indice = buscarNombreIdentificador(linea, mFuncion[2]);
      res.push({ nombre: mFuncion[2], tipo: "funcion", linea: n + 1, columna: (indice < 0 ? 0 : indice) + 1 });
      continue;
    }
    const mClase = RE_PY_CLASE.exec(linea);
    if (mClase) {
      const indice = buscarNombreIdentificador(linea, mClase[2]);
      res.push({ nombre: mClase[2], tipo: "clase", linea: n + 1, columna: (indice < 0 ? 0 : indice) + 1 });
    }
  }
  return res;
}

/**
 * Devuelve el índice tras la comilla de cierre de una cadena JSON, o -1.
 * @param {string} texto
 * @param {number} inicio
 * @returns {number}
 */
function finDeCadenaJson(texto, inicio) {
  let i = inicio + 1;
  while (i < texto.length) {
    const c = texto[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === '"') return i + 1;
    if (c === "\n") return -1;
    i += 1;
  }
  return -1;
}

/**
 * Índice tras un valor JSON (útil para saltar valores anidados).
 * @param {string} texto
 * @param {number} desde
 * @returns {number} índice o -1 si no se puede delimitar
 */
function indiceTrasValorJson(texto, desde) {
  const n = texto.length;
  let i = desde;
  const saltar = () => {
    while (i < n && /\s/.test(texto[i])) i += 1;
  };
  saltar();
  const c = texto[i];
  if (c === '"') {
    const fin = finDeCadenaJson(texto, i);
    return fin < 0 ? -1 : fin;
  }
  if (c === "{" || c === "[") {
    let prof = 0;
    while (i < n) {
      const ch = texto[i];
      if (ch === '"') {
        const fin = finDeCadenaJson(texto, i);
        if (fin < 0) return -1;
        i = fin;
        continue;
      }
      if (ch === "{" || ch === "[") prof += 1;
      else if (ch === "}" || ch === "]") {
        prof -= 1;
        if (prof === 0) return i + 1;
      }
      i += 1;
    }
    return -1;
  }
  while (i < n && texto[i] !== "," && texto[i] !== "}" && texto[i] !== "]") i += 1;
  return i;
}

/**
 * Claves de primer nivel de un objeto JSON (con línea/columna).
 * @param {string} contenido
 * @returns {Array<{nombre: string, tipo: string, linea: number, columna: number}>}
 */
function simbolosJson(contenido) {
  const texto = quitarBom(contenido);
  const inicios = iniciosDeLinea(texto);
  /** @type {Array<{nombre: string, tipo: string, linea: number, columna: number}>} */
  const res = [];
  let i = 0;
  const n = texto.length;
  const saltar = () => {
    while (i < n && /\s/.test(texto[i])) i += 1;
  };
  saltar();
  if (texto[i] !== "{") return res;
  i += 1;
  while (i < n) {
    saltar();
    if (texto[i] === "}") break;
    if (texto[i] !== '"') break;
    const inicioCadena = i;
    const finCadena = finDeCadenaJson(texto, i);
    if (finCadena < 0) break;
    let nombre;
    try {
      nombre = JSON.parse(texto.slice(inicioCadena, finCadena));
    } catch {
      nombre = texto.slice(inicioCadena + 1, finCadena - 1);
    }
    i = finCadena;
    saltar();
    if (texto[i] !== ":") break;
    i += 1;
    const pos = posicionDe(inicios, inicioCadena);
    res.push({ nombre: String(nombre), tipo: "clave", linea: pos.linea, columna: pos.columna });
    const siguiente = indiceTrasValorJson(texto, i);
    if (siguiente < 0) break;
    i = siguiente;
    saltar();
    if (texto[i] === ",") {
      i += 1;
      continue;
    }
    break;
  }
  return res;
}

/**
 * Símbolos HTML: atributos `id` y `name`.
 * @param {string} contenido
 * @returns {Array<{nombre: string, tipo: string, linea: number, columna: number}>}
 */
function simbolosHtml(contenido) {
  const texto = quitarBom(contenido);
  const limpio = limpiarHtml(texto);
  const inicios = iniciosDeLinea(texto);
  /** @type {Array<{nombre: string, tipo: string, linea: number, columna: number}>} */
  const res = [];
  RE_HTML_ATRIBUTO.lastIndex = 0;
  let m;
  while ((m = RE_HTML_ATRIBUTO.exec(limpio)) !== null) {
    const nombre = m[2] ?? m[3] ?? m[4] ?? "";
    if (!nombre) continue;
    const desplazamiento = m[0].indexOf(m[1]);
    const pos = posicionDe(inicios, m.index + Math.max(0, desplazamiento));
    res.push({ nombre, tipo: m[1], linea: pos.linea, columna: pos.columna });
  }
  return res;
}

/**
 * Símbolos CSS: selectores y at-reglas (el texto antes de cada "{").
 * @param {string} contenido
 * @returns {Array<{nombre: string, tipo: string, linea: number, columna: number}>}
 */
function simbolosCss(contenido) {
  const texto = quitarBom(contenido);
  const limpio = limpiarCss(texto);
  const inicios = iniciosDeLinea(texto);
  /** @type {Array<{nombre: string, tipo: string, linea: number, columna: number}>} */
  const res = [];
  let desde = 0;
  for (let i = 0; i < limpio.length; i += 1) {
    const c = limpio[i];
    if (c === "{") {
      const bruto = limpio.slice(desde, i);
      const nombre = bruto.trim().replace(/\s+/g, " ");
      if (nombre) {
        let k = 0;
        while (k < bruto.length && /\s/.test(bruto[k])) k += 1;
        const pos = posicionDe(inicios, desde + k);
        res.push({ nombre, tipo: nombre.startsWith("@") ? "at-regla" : "selector", linea: pos.linea, columna: pos.columna });
      }
      desde = i + 1;
    } else if (c === "}" || c === ";") {
      desde = i + 1;
    }
  }
  return res;
}

/**
 * Outline de símbolos de un archivo.
 * @param {string} rel ruta o nombre del archivo (solo importa la extensión)
 * @param {string} texto
 * @returns {Array<{nombre: string, tipo: string, linea: number, columna: number}>}
 */
export function simbolos(rel, texto) {
  try {
    const lenguaje = lenguajeDe(rel);
    if (!lenguaje || typeof texto !== "string") return [];
    const contenido = quitarBom(texto);
    if (!contenido.trim()) return [];
    /** @type {Array<{nombre: string, tipo: string, linea: number, columna: number}>} */
    let res = [];
    switch (lenguaje) {
      case "js":
        res = simbolosJs(contenido);
        break;
      case "py":
        res = simbolosPy(contenido);
        break;
      case "json":
        res = simbolosJson(contenido);
        break;
      case "html":
        res = simbolosHtml(contenido);
        break;
      case "css":
        res = simbolosCss(contenido);
        break;
      default:
        return [];
    }
    return res.sort((a, b) => a.linea - b.linea || a.columna - b.columna);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// API: índice de símbolos del proyecto e «ir a definición»
// ---------------------------------------------------------------------------

/**
 * Normaliza una ruta a la forma relativa con separadores "/".
 * @param {string} root
 * @param {string} entrada
 * @returns {string} ruta relativa, o "" si queda fuera del proyecto
 */
function normalizarRel(root, entrada) {
  const absoluta = path.isAbsolute(entrada) ? entrada : path.resolve(root, entrada);
  const rel = path.relative(root, absoluta);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return "";
  return rel.split(path.sep).join("/");
}

/**
 * Recorre el proyecto y devuelve rutas relativas de archivos indexables.
 * @param {string} root
 * @param {{maxArchivos: number, omitir: Set<string>}} opciones
 * @returns {string[]}
 */
function recorrerProyecto(root, opciones) {
  /** @type {string[]} */
  const encontrados = [];
  /** @type {string[]} */
  const pendientes = [""];
  while (pendientes.length > 0 && encontrados.length < opciones.maxArchivos) {
    const relDir = /** @type {string} */ (pendientes.pop());
    let entradas;
    try {
      entradas = fs.readdirSync(path.join(root, relDir), { withFileTypes: true });
    } catch {
      continue;
    }
    entradas.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entrada of entradas) {
      if (encontrados.length >= opciones.maxArchivos) break;
      if (entrada.name.startsWith(".")) continue;
      const rel = relDir ? `${relDir}/${entrada.name}` : entrada.name;
      if (entrada.isDirectory()) {
        if (!opciones.omitir.has(entrada.name)) pendientes.push(rel);
        continue;
      }
      if (!entrada.isFile()) continue; // symlinks y similares: no se siguen
      if (!EXTENSIONES_INDICE.has(path.extname(entrada.name).toLowerCase())) continue;
      encontrados.push(rel);
    }
  }
  return encontrados;
}

/**
 * Construye el índice de símbolos del proyecto: nombre -> definiciones.
 * ES SINCRÓNICO (con topes para no bloquear demasiado); puede tardar en proyectos
 * enormes, así que conviene cachear el resultado o pasar `archivos`.
 * @param {string} root carpeta del proyecto
 * @param {string[] | Set<string> | null} [archivos] lista explícita de rutas; si falta se recorre `root`
 * @param {{maxArchivos?: number, maxBytes?: number, omitir?: Set<string>}} [opciones]
 * @returns {Map<string, Array<{archivo: string, linea: number, columna: number, tipo: string}>>}
 */
export function indiceSimbolos(root, archivos = null, opciones = {}) {
  const indice = new Map();
  try {
    const raiz = path.resolve(String(root || "."));
    const maxArchivos = Number.isFinite(opciones.maxArchivos) ? /** @type {number} */ (opciones.maxArchivos) : MAX_ARCHIVOS_INDICE;
    const maxBytes = Number.isFinite(opciones.maxBytes) ? /** @type {number} */ (opciones.maxBytes) : LIMITE_ARCHIVO_INDICE;
    const omitir = opciones.omitir instanceof Set ? opciones.omitir : CARPETAS_OMITIDAS;
    /** @type {string[]} */
    let lista;
    if (archivos && typeof archivos[Symbol.iterator] === "function") {
      lista = [];
      for (const entrada of archivos) {
        const rel = normalizarRel(raiz, String(entrada));
        if (!rel) continue;
        if (!EXTENSIONES_INDICE.has(path.extname(rel).toLowerCase())) continue;
        lista.push(rel);
        if (lista.length >= maxArchivos) break;
      }
    } else {
      lista = recorrerProyecto(raiz, { maxArchivos, omitir });
    }
    for (const rel of lista) {
      const abs = path.join(raiz, rel.split("/").join(path.sep));
      try {
        const st = fs.statSync(abs);
        if (!st.isFile() || st.size > maxBytes || st.size === 0) continue;
        const buf = fs.readFileSync(abs);
        if (buf.includes(0)) continue; // binario
        const texto = quitarBom(buf.toString("utf8"));
        for (const simbolo of simbolos(rel, texto)) {
          const listaSimbolos = indice.get(simbolo.nombre);
          const entrada = { archivo: rel, linea: simbolo.linea, columna: simbolo.columna, tipo: simbolo.tipo };
          if (listaSimbolos) listaSimbolos.push(entrada);
          else indice.set(simbolo.nombre, [entrada]);
        }
      } catch {
        /* archivo ilegible: se omite */
      }
    }
  } catch {
    /* proyecto ilegible: índice vacío */
  }
  return indice;
}

/**
 * Devuelve las definiciones de `palabra` desde un índice (Map) o un objeto equivalente.
 * @param {Map<string, Array<object>> | Record<string, Array<object>> | null} indice
 * @param {string} palabra
 * @returns {Array<{archivo: string, linea: number, columna: number, tipo: string}>}
 */
function entradasDeIndice(indice, palabra) {
  if (!indice) return [];
  try {
    if (typeof indice.get === "function") {
      const lista = indice.get(palabra);
      return Array.isArray(lista) ? lista : [];
    }
    const lista = indice[palabra];
    return Array.isArray(lista) ? lista : [];
  } catch {
    return [];
  }
}

/**
 * Cercanía entre dos rutas relativas: más segmentos comunes = más cerca.
 * @param {string} actual
 * @param {string} candidato
 * @returns {number}
 */
function cercaniaArchivo(actual, candidato) {
  const da = path.posix.dirname(actual).split("/").filter(Boolean);
  const dc = path.posix.dirname(candidato).split("/").filter(Boolean);
  let comunes = 0;
  while (comunes < da.length && comunes < dc.length && da[comunes] === dc[comunes]) comunes += 1;
  return comunes * 1000 - Math.abs(da.length - dc.length);
}

/**
 * «Ir a definición»: busca la mejor definición de una palabra en el índice.
 * Prioriza el archivo actual y, entre homónimos, el mismo directorio y las rutas más
 * cercanas. Ignora palabras de menos de 2 caracteres.
 * @param {string} palabra
 * @param {Map<string, Array<object>> | Record<string, Array<object>> | null} indice
 * @param {string} [archivoActual]
 * @returns {{archivo: string, linea: number, columna: number, tipo: string} | null}
 */
export function buscarDefinicion(palabra, indice, archivoActual = "") {
  try {
    const buscada = String(palabra || "").trim();
    if (buscada.length < 2) return null;
    const entradas = entradasDeIndice(indice, buscada).filter(
      (entrada) => entrada && typeof entrada.archivo === "string" && Number.isFinite(Number(entrada.linea))
    );
    if (entradas.length === 0) return null;
    // El índice usa rutas relativas al proyecto; si llega una absoluta se compara por sufijo.
    const actual = String(archivoActual || "").replace(/\\/g, "/").replace(/^\.\//, "");
    const actualAbsoluta = /^(?:[A-Za-z]:\/|\/)/.test(actual);
    const esArchivoActual = (archivo) =>
      actual !== "" && (archivo === actual || (actualAbsoluta && actual.endsWith(`/${archivo}`)));
    const candidatos = entradas.map((entrada) => ({
      archivo: entrada.archivo,
      linea: Number(entrada.linea),
      columna: Number(entrada.columna) || 1,
      tipo: String(entrada.tipo || ""),
    }));
    // Para medir cercanía con una ruta absoluta, se descarta el prefijo hasta el archivo
    // del índice que coincida (así se comparan directorios relativos al proyecto).
    const actualRelativo = actualAbsoluta
      ? candidatos.find((candidato) => esArchivoActual(candidato.archivo))?.archivo || ""
      : actual;
    candidatos.sort((a, b) => {
      const aActual = esArchivoActual(a.archivo);
      const bActual = esArchivoActual(b.archivo);
      if (aActual !== bActual) return aActual ? -1 : 1;
      if (actualRelativo !== "") {
        const ca = cercaniaArchivo(actualRelativo, a.archivo);
        const cb = cercaniaArchivo(actualRelativo, b.archivo);
        if (ca !== cb) return cb - ca;
      }
      if (a.archivo.length !== b.archivo.length) return a.archivo.length - b.archivo.length;
      return a.linea - b.linea || a.columna - b.columna;
    });
    return candidatos[0];
  } catch {
    return null;
  }
}
