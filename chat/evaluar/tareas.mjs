/**
 * Tareas con las que se evalúa la app de punta a punta (ver ejecutar.mjs).
 * Cada tarea prepara una carpeta de trabajo, le pide algo al agente como lo haría un usuario y
 * comprueba el resultado con código propio (no con el modelo): ejecuta lo que escribió, lo
 * compara con valores esperados y mira qué herramientas usó.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

/** @returns {string} carpeta de Python de uv, igual que la busca la app (orden NUMÉRICO) */
function pythonHome() {
  const root = path.join(process.env.APPDATA || "", "uv", "python");
  if (!fs.existsSync(root)) return "";
  // Ordenadas como texto, "3.9.13" va después de "3.10.0" y el reverse dejaba el Python más
  // viejo el primero: el evaluador validaría con un intérprete distinto del que usa la app.
  const version = (dir) => path.basename(dir).split(".").map((n) => Number.parseInt(n, 10) || 0);
  const homes = fs.readdirSync(root)
    .map((name) => path.join(root, name))
    .filter((dir) => fs.existsSync(path.join(dir, "python.exe")))
    .sort((a, b) => {
      const x = version(a);
      const y = version(b);
      for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
        const d = (y[i] || 0) - (x[i] || 0);
        if (d) return d;
      }
      return 0;
    });
  return homes.find((dir) => fs.existsSync(path.join(dir, "Lib", "site-packages", "pip"))) || homes[0] || "";
}

const HOME = pythonHome();
const PYTHON = HOME ? path.join(HOME, "python.exe") : "python";

/**
 * @param {string} dir
 * @param {string[]} args
 * @param {{input?: string, timeout?: number}} [opts]
 */
export function py(dir, args, opts = {}) {
  const r = spawnSync(PYTHON, args, { cwd: dir, encoding: "utf8", timeout: opts.timeout ?? 20000, input: opts.input, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
  return { code: r.status ?? -1, out: `${r.stdout || ""}`, err: `${r.stderr || ""}` };
}

/**
 * @param {string} dir
 * @param {string[]} args
 */
export function node(dir, args) {
  const r = spawnSync(process.execPath, args, { cwd: dir, encoding: "utf8", timeout: 30000 });
  return { code: r.status ?? -1, out: `${r.stdout || ""}`, err: `${r.stderr || ""}` };
}

/**
 * @param {string} dir
 * @param {string} rel
 * @returns {string | null}
 */
function leer(dir, rel) {
  const abs = path.join(dir, rel);
  return fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : null;
}

/**
 * @param {string} dir
 * @param {Record<string, string>} files
 */
function escribir(dir, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body, "utf8");
  }
}

const sha = (text) => crypto.createHash("sha1").update(text).digest("hex");

/** @typedef {{texto: string, acciones: Array<{kind: string, title: string, state: string, detail: string, code?: number}>}} Resultado */
/** @typedef {{id: string, titulo: string, nivel: "facil"|"medio"|"dificil", prompt: string, maxMin?: number, setup?: (dir: string) => void, check: (dir: string, res: Resultado) => {ok: boolean, notas: string[]}}} Tarea */

const usoDe = (res, kind) => res.acciones.filter((a) => a.kind === kind);

/** @type {Tarea[]} */
export const TAREAS = [
  {
    id: "hola-py",
    titulo: "Crear un script y ejecutarlo",
    nivel: "facil",
    prompt: "Crea un archivo hola.py que imprima exactamente el texto Hola, Bonsai (sin punto al final). Ejecútalo para comprobarlo.",
    check(dir) {
      if (leer(dir, "hola.py") === null) return { ok: false, notas: ["no existe hola.py"] };
      const r = py(dir, ["hola.py"]);
      return { ok: r.out.trim() === "Hola, Bonsai", notas: [`salida: ${JSON.stringify(r.out.trim())}`] };
    },
  },
  {
    id: "fizzbuzz",
    titulo: "Función + tests con unittest",
    nivel: "facil",
    prompt: "Escribe fizzbuzz.py con una función fizzbuzz(n) que devuelva la lista de textos de 1 a n (\"Fizz\" si es múltiplo de 3, \"Buzz\" si lo es de 5, \"FizzBuzz\" si de ambos y el número como texto en otro caso). Escribe también test_fizzbuzz.py con unittest y ejecuta los tests.",
    check(dir) {
      if (leer(dir, "fizzbuzz.py") === null) return { ok: false, notas: ["no existe fizzbuzz.py"] };
      const prueba = "from fizzbuzz import fizzbuzz\nr = fizzbuzz(15)\nassert len(r) == 15 and r[0] == '1' and r[2] == 'Fizz' and r[4] == 'Buzz' and r[14] == 'FizzBuzz', r\nprint('ok')";
      const a = py(dir, ["-c", prueba]);
      const t = leer(dir, "test_fizzbuzz.py") === null ? { code: 1, out: "", err: "no existe test_fizzbuzz.py" } : py(dir, ["-m", "unittest", "-q"]);
      return { ok: a.out.trim() === "ok" && t.code === 0, notas: [a.out.trim() === "ok" ? "función ok" : `función mal: ${a.err.slice(-160)}`, t.code === 0 ? "tests ok" : `tests mal: ${t.err.slice(-160)}`] };
    },
  },
  {
    id: "bug-ultimos",
    titulo: "Arreglar un bug con tests que fallan",
    nivel: "medio",
    setup(dir) {
      escribir(dir, {
        "utils.py": "def ultimos(lista, n):\n    \"\"\"Devuelve los últimos n elementos de la lista.\"\"\"\n    return lista[-n + 1:]\n\n\ndef maximo(lista):\n    \"\"\"Devuelve el mayor elemento o None si la lista está vacía.\"\"\"\n    if not lista:\n        return None\n    return max(lista)\n",
        "test_utils.py": "import unittest\nfrom utils import ultimos, maximo\n\n\nclass TestUtils(unittest.TestCase):\n    def test_ultimos(self):\n        self.assertEqual(ultimos([1, 2, 3, 4, 5], 2), [4, 5])\n        self.assertEqual(ultimos([1, 2, 3], 3), [1, 2, 3])\n        self.assertEqual(ultimos([1, 2, 3], 1), [3])\n\n    def test_maximo(self):\n        self.assertEqual(maximo([3, 9, 2]), 9)\n        self.assertIsNone(maximo([]))\n\n\nif __name__ == \"__main__\":\n    unittest.main()\n",
      });
      fs.writeFileSync(path.join(dir, ".sha-test"), sha(fs.readFileSync(path.join(dir, "test_utils.py"), "utf8")));
    },
    prompt: "Los tests de test_utils.py fallan. Arregla el bug en utils.py sin tocar los tests y vuelve a ejecutarlos.",
    check(dir) {
      const t = py(dir, ["-m", "unittest", "-q"]);
      const intacto = sha(leer(dir, "test_utils.py") || "") === (leer(dir, ".sha-test") || "");
      return { ok: t.code === 0 && intacto, notas: [t.code === 0 ? "tests ok" : `tests mal: ${t.err.slice(-160)}`, intacto ? "tests sin tocar" : "TOCÓ los tests"] };
    },
  },
  {
    id: "renombrar",
    titulo: "Renombrar una función en varios archivos",
    nivel: "medio",
    setup(dir) {
      escribir(dir, {
        "calc.py": "def calc_total(items):\n    \"\"\"Suma precio * cantidad de cada item.\"\"\"\n    return sum(i[\"precio\"] * i[\"cant\"] for i in items)\n",
        "main.py": "from calc import calc_total\n\nitems = [{\"precio\": 5, \"cant\": 3}, {\"precio\": 10, \"cant\": 2}]\nprint(\"Total:\", calc_total(items))\n",
        "informe.py": "from calc import calc_total\n\n\ndef informe(items):\n    return f\"Informe: {calc_total(items)}\"\n",
        "README.md": "# Tienda\n\nUsa `calc_total(items)` para obtener el total.\n",
      });
    },
    prompt: "Renombra la función calc_total a calcular_total en todos los archivos del proyecto (README incluido) y comprueba que main.py sigue imprimiendo lo mismo.",
    check(dir) {
      const viejo = ["calc.py", "main.py", "informe.py", "README.md"].filter((f) => (leer(dir, f) || "").includes("calc_total"));
      const r = py(dir, ["main.py"]);
      const i = py(dir, ["-c", "from informe import informe; print(informe([{'precio': 5, 'cant': 3}]))"]);
      return { ok: viejo.length === 0 && r.out.trim() === "Total: 35" && i.out.trim() === "Informe: 15", notas: [viejo.length ? `sigue calc_total en: ${viejo.join(", ")}` : "sin restos", `main: ${JSON.stringify(r.out.trim())}`] };
    },
  },
  {
    id: "html-contador",
    titulo: "Página HTML interactiva en un archivo",
    nivel: "facil",
    prompt: "Crea contador.html con un botón que diga \"Sumar\" y un número que empieza en 0 y aumenta en 1 cada vez que se pulsa el botón. Todo en un solo archivo, sin librerías.",
    check(dir) {
      const html = leer(dir, "contador.html");
      if (html === null) return { ok: false, notas: ["no existe contador.html"] };
      const checks = {
        boton: /<button[^>]*>\s*Sumar\s*<\/button>/i.test(html),
        script: /<script[\s>]/i.test(html),
        incrementa: /\+\+|\+=\s*1|=\s*\w+\s*\+\s*1|textContent\s*=\s*\w+\s*\+\s*1/.test(html),
        cierre: /<\/html>/i.test(html),
        cero: />\s*0\s*</.test(html) || /=\s*0\b/.test(html),
      };
      const mal = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
      return { ok: mal.length === 0, notas: [mal.length ? `falta: ${mal.join(", ")}` : "estructura ok"] };
    },
  },
  {
    id: "json-resumen",
    titulo: "Leer datos, calcular y escribir JSON",
    nivel: "medio",
    setup(dir) {
      const ventas = [
        { producto: "manzana", unidades: 3, precio: 10 }, { producto: "pera", unidades: 2, precio: 15 },
        { producto: "manzana", unidades: 5, precio: 10 }, { producto: "uva", unidades: 4, precio: 7 },
        { producto: "pera", unidades: 1, precio: 15 }, { producto: "uva", unidades: 6, precio: 7 },
        { producto: "manzana", unidades: 1, precio: 10 }, { producto: "kiwi", unidades: 9, precio: 4 },
      ];
      escribir(dir, { "ventas.json": JSON.stringify(ventas, null, 2) });
    },
    prompt: "Lee ventas.json y genera resumen.json con el total de ingresos por producto (unidades * precio) y el total general, con este formato: {\"por_producto\": {\"manzana\": 0, ...}, \"total_general\": 0}. Hazlo con un script de Python y ejecútalo.",
    check(dir) {
      const raw = leer(dir, "resumen.json");
      if (raw === null) return { ok: false, notas: ["no existe resumen.json"] };
      let j;
      try { j = JSON.parse(raw); } catch { return { ok: false, notas: ["resumen.json no es JSON válido"] }; }
      const esperado = { manzana: 90, pera: 45, uva: 70, kiwi: 36 };
      const pp = j.por_producto || {};
      const bien = Object.entries(esperado).every(([k, v]) => Number(pp[k]) === v) && Number(j.total_general) === 241;
      return { ok: bien, notas: [bien ? "totales correctos" : `obtenido: ${raw.replace(/\s+/g, " ").slice(0, 160)}`] };
    },
  },
  {
    id: "explicar-codigo",
    titulo: "Leer un archivo y explicarlo (sin escribir)",
    nivel: "facil",
    setup(dir) {
      escribir(dir, { "algoritmo.py": "def buscar(lista, objetivo):\n    bajo, alto = 0, len(lista) - 1\n    while bajo <= alto:\n        medio = (bajo + alto) // 2\n        if lista[medio] == objetivo:\n            return medio\n        if lista[medio] < objetivo:\n            bajo = medio + 1\n        else:\n            alto = medio - 1\n    return -1\n" });
    },
    prompt: "Explícame en 3 frases qué hace la función de algoritmo.py y cuál es su complejidad.",
    check(dir, res) {
      const texto = res.texto;
      const ok = /b[uú]squeda binaria|binary search/i.test(texto) && /log/i.test(texto);
      const escribio = usoDe(res, "write").length > 0;
      return { ok: ok && !escribio, notas: [ok ? "explicación correcta" : `texto: ${texto.slice(0, 160)}`, escribio ? "escribió archivos sin que se pidiera" : "no modificó nada"] };
    },
  },
  {
    id: "docstrings",
    titulo: "Editar un archivo existente sin romperlo",
    nivel: "medio",
    setup(dir) {
      escribir(dir, { "modulo.py": "def suma(a, b):\n    return a + b\n\n\ndef es_par(n):\n    return n % 2 == 0\n\n\ndef invertir(texto):\n    return texto[::-1]\n\n\ndef contar_vocales(texto):\n    return sum(1 for c in texto.lower() if c in \"aeiou\")\n" });
    },
    prompt: "Añade un docstring breve en español a cada función de modulo.py sin cambiar su comportamiento.",
    check(dir) {
      const prueba = "import ast, sys\nfrom modulo import suma, es_par, invertir, contar_vocales\nt = ast.parse(open('modulo.py', encoding='utf8').read())\nfn = [n for n in t.body if isinstance(n, ast.FunctionDef)]\nassert len(fn) == 4, len(fn)\nsin = [n.name for n in fn if not ast.get_docstring(n)]\nassert not sin, sin\nassert suma(2, 3) == 5 and es_par(4) and not es_par(3) and invertir('abc') == 'cba' and contar_vocales('Hola Mundo') == 4\nprint('ok')";
      const r = py(dir, ["-c", prueba]);
      return { ok: r.out.trim() === "ok", notas: [r.out.trim() === "ok" ? "docstrings y comportamiento ok" : r.err.slice(-200)] };
    },
  },
  {
    id: "csv-stats",
    titulo: "Script que procesa un CSV",
    nivel: "medio",
    setup(dir) {
      escribir(dir, { "datos.csv": "nombre,edad,ciudad\nAna,31,Madrid\nLuis,45,Sevilla\nMar,28,Madrid\nPablo,39,Bilbao\nIrene,52,Sevilla\nJosé,23,Madrid\nElena,34,Bilbao\nRaúl,41,Madrid\n" });
    },
    prompt: "Escribe stats.py que lea datos.csv y muestre la edad media (con 2 decimales), la edad mínima, la máxima y cuántas personas hay por ciudad. Ejecútalo.",
    check(dir) {
      if (leer(dir, "stats.py") === null) return { ok: false, notas: ["no existe stats.py"] };
      const r = py(dir, ["stats.py"]);
      const out = r.out;
      const checks = { media: /36[.,]6[23]/.test(out), min: /\b23\b/.test(out), max: /\b52\b/.test(out), madrid: /Madrid\D{0,6}4/.test(out), sevilla: /Sevilla\D{0,6}2/.test(out), bilbao: /Bilbao\D{0,6}2/.test(out) };
      const mal = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
      return { ok: r.code === 0 && mal.length === 0, notas: [mal.length ? `falta en la salida: ${mal.join(", ")}` : "salida correcta", `código ${r.code}`] };
    },
  },
  {
    id: "lru-cache",
    titulo: "Estructura de datos con comportamiento exacto",
    nivel: "dificil",
    prompt: "Implementa en lru.py una clase LRUCache(capacidad) con los métodos get(clave) y put(clave, valor). get devuelve -1 si la clave no existe. Cuando se supera la capacidad se elimina la clave usada hace más tiempo (tanto get como put cuentan como uso). Escribe tests en test_lru.py con unittest y ejecútalos.",
    check(dir) {
      if (leer(dir, "lru.py") === null) return { ok: false, notas: ["no existe lru.py"] };
      const prueba = "from lru import LRUCache\nc = LRUCache(2)\nc.put(1, 1); c.put(2, 2)\nassert c.get(1) == 1\nc.put(3, 3)\nassert c.get(2) == -1\nc.put(4, 4)\nassert c.get(1) == -1 and c.get(3) == 3 and c.get(4) == 4\nc.put(3, 30)\nassert c.get(3) == 30\nprint('ok')";
      const r = py(dir, ["-c", prueba]);
      const t = leer(dir, "test_lru.py") === null ? { code: 1, err: "no existe test_lru.py" } : py(dir, ["-m", "unittest", "-q"]);
      return { ok: r.out.trim() === "ok" && t.code === 0, notas: [r.out.trim() === "ok" ? "comportamiento ok" : `mal: ${r.err.slice(-160)}`, t.code === 0 ? "sus tests pasan" : `sus tests fallan: ${t.err.slice(-120)}`] };
    },
  },
  {
    id: "node-esm",
    titulo: "Módulo JavaScript con node:test",
    nivel: "medio",
    prompt: "Crea un módulo ES modulo.mjs que exporte una función slugify(texto) (minúsculas, sin signos de puntuación y con guiones en lugar de espacios, sin guiones al principio ni al final) y modulo.test.mjs con tests de node:test. Ejecuta los tests con `node --test`.",
    check(dir) {
      if (leer(dir, "modulo.mjs") === null) return { ok: false, notas: ["no existe modulo.mjs"] };
      const prueba = "import { slugify } from './modulo.mjs';\nconst c = [['Hola Mundo!', 'hola-mundo'], ['  a  b ', 'a-b'], ['Ya, está.', 'ya-esta'], ['X', 'x']];\nconst mal = c.filter(([i, o]) => slugify(i) !== o && !(i === 'Ya, está.' && slugify(i) === 'ya-est'));\nconsole.log(mal.length ? 'mal ' + JSON.stringify(mal.map(([i]) => [i, slugify(i)])) : 'ok');";
      fs.writeFileSync(path.join(dir, ".prueba.mjs"), prueba);
      const r = node(dir, [".prueba.mjs"]);
      const t = leer(dir, "modulo.test.mjs") === null ? { code: 1, err: "no existe modulo.test.mjs", out: "" } : node(dir, ["--test"]);
      return { ok: r.out.trim() === "ok" && t.code === 0, notas: [r.out.trim() === "ok" ? "slugify ok" : (r.out.trim() || r.err.slice(-160)), t.code === 0 ? "node --test pasa" : "node --test falla"] };
    },
  },
  {
    id: "sqlite",
    titulo: "Base de datos con sqlite3",
    nivel: "medio",
    prompt: "Con Python y sqlite3 crea la base inventario.db con la tabla productos(id, nombre, stock), inserta 4 productos (tornillo 120, tuerca 3, arandela 40, clavo 2) y muestra por pantalla los que tengan stock menor que 5. Ejecuta el script.",
    check(dir, res) {
      if (leer(dir, "inventario.db") === null) return { ok: false, notas: ["no existe inventario.db"] };
      const consulta = "import sqlite3\nc = sqlite3.connect('inventario.db')\nrows = c.execute('select nombre, stock from productos order by nombre').fetchall()\nprint(rows)";
      const r = py(dir, ["-c", consulta]);
      const filas = r.out.trim();
      const datosOk = /tornillo/.test(filas) && /tuerca/.test(filas) && /arandela/.test(filas) && /clavo/.test(filas) && /120/.test(filas);
      const salida = usoDe(res, "cmd").map((a) => a.detail).join("\n");
      const muestra = /tuerca/.test(salida) && /clavo/.test(salida);
      return { ok: datosOk && muestra, notas: [datosOk ? "datos ok" : `filas: ${filas.slice(0, 120)}`, muestra ? "mostró los de stock bajo" : "no se vio la salida esperada"] };
    },
  },
  {
    id: "error-recuperable",
    titulo: "Ejecutar, ver el error y corregirlo",
    nivel: "medio",
    setup(dir) {
      escribir(dir, { "app.py": "datos = {\"a\": 1, \"b\": 2, \"c\": 3}\ntotal = sum(datos.valores())\nprint(\"Total:\", total)\n" });
    },
    prompt: "Ejecuta app.py; si falla, arréglalo hasta que funcione.",
    check(dir) {
      const r = py(dir, ["app.py"]);
      return { ok: r.out.trim() === "Total: 6", notas: [`salida: ${JSON.stringify(r.out.trim())}`, r.err.slice(-100)] };
    },
  },
  {
    id: "paquete",
    titulo: "Varios archivos que se importan entre sí",
    nivel: "medio",
    prompt: "Crea un paquete calculadora/ con __init__.py y ops.py (funciones suma, resta, multiplica y divide; divide debe lanzar ValueError si el divisor es 0) y un main.py en la raíz que use el paquete e imprima el resultado de suma(2, 3), multiplica(4, 5) y divide(10, 4). Ejecuta main.py.",
    check(dir) {
      const prueba = "from calculadora.ops import suma, resta, multiplica, divide\nassert suma(2, 3) == 5 and resta(5, 2) == 3 and multiplica(4, 5) == 20 and divide(10, 4) == 2.5\ntry:\n    divide(1, 0)\n    raise SystemExit('no lanzó')\nexcept ValueError:\n    print('ok')";
      const a = py(dir, ["-c", prueba]);
      const m = leer(dir, "main.py") === null ? { code: 1, out: "", err: "no existe main.py" } : py(dir, ["main.py"]);
      const imprime = /\b5\b/.test(m.out) && /\b20\b/.test(m.out) && /2[.,]5/.test(m.out);
      return { ok: a.out.trim() === "ok" && m.code === 0 && imprime, notas: [a.out.trim() === "ok" ? "paquete ok" : `paquete mal: ${a.err.slice(-140)}`, imprime ? "main imprime los 3 resultados" : `main: ${m.out.slice(0, 80)}`] };
    },
  },
  {
    id: "regex-fechas",
    titulo: "Función con casos límite",
    nivel: "medio",
    prompt: "Escribe fechas.py con una función extraer_fechas(texto) que devuelva la lista de fechas con formato dd/mm/aaaa que aparezcan en el texto (en orden). Pruébala con un ejemplo ejecutando el archivo.",
    check(dir) {
      if (leer(dir, "fechas.py") === null) return { ok: false, notas: ["no existe fechas.py"] };
      const prueba = "from fechas import extraer_fechas\nt = 'Nació el 05/03/1990, se mudó el 12/11/2015 y vuelve el 01/01/2030. Código 123/45/6789 no cuenta.'\nr = extraer_fechas(t)\nassert r == ['05/03/1990', '12/11/2015', '01/01/2030'], r\nassert extraer_fechas('sin fechas') == []\nprint('ok')";
      const r = py(dir, ["-c", prueba]);
      return { ok: r.out.trim() === "ok", notas: [r.out.trim() === "ok" ? "extrae bien" : r.err.slice(-200)] };
    },
  },
  {
    id: "solo-chat",
    titulo: "Pregunta conceptual (sin herramientas)",
    nivel: "facil",
    prompt: "Explica qué es una closure en JavaScript y dame un ejemplo corto.",
    check(dir, res) {
      const t = res.texto;
      const ok = t.length > 200 && /closure|clausura/i.test(t) && /function|=>/.test(t);
      const herramientas = res.acciones.filter((a) => ["cmd", "write", "search"].includes(a.kind)).length;
      return { ok: ok && herramientas === 0, notas: [ok ? "explicación con ejemplo" : `texto corto o sin ejemplo (${t.length} car.)`, herramientas ? `usó ${herramientas} herramientas sin necesidad` : "sin herramientas"] };
    },
  },
  {
    id: "buscar-simbolo",
    titulo: "Encontrar algo en un proyecto con varios archivos",
    nivel: "medio",
    setup(dir) {
      escribir(dir, {
        "app/main.py": "from servicios.db import conectar_db\nfrom servicios.correo import enviar\n\n\ndef arrancar():\n    conn = conectar_db('localhost')\n    enviar('hola')\n    return conn\n",
        "servicios/__init__.py": "",
        "servicios/db.py": "def conectar_db(host, puerto=5432, usuario=\"admin\"):\n    \"\"\"Abre la conexión con la base de datos.\"\"\"\n    return {\"host\": host, \"puerto\": puerto, \"usuario\": usuario}\n",
        "servicios/correo.py": "def enviar(texto, destino=\"equipo@example.com\"):\n    print(f\"enviando {texto} a {destino}\")\n",
        "utils/formato.py": "def moneda(x):\n    return f\"{x:.2f} €\"\n",
        "utils/__init__.py": "",
        "README.md": "# Servicio\n\nArranca con `python -m app.main`.\n",
      });
    },
    prompt: "¿En qué archivo está definida la función conectar_db y qué parámetros recibe?",
    check(dir, res) {
      const t = res.texto;
      const ok = /db\.py/.test(t) && /host/.test(t) && /puerto/.test(t) && /usuario/.test(t);
      return { ok, notas: [ok ? "archivo y parámetros correctos" : `respuesta: ${t.slice(0, 200)}`, `herramientas de lectura/índice: ${usoDe(res, "read").length + usoDe(res, "index").length}`] };
    },
  },
  {
    id: "editar-config",
    titulo: "Cambio puntual en un JSON",
    nivel: "facil",
    setup(dir) {
      escribir(dir, { "config.json": JSON.stringify({ nombre: "servicio", puerto: 8080, debug: true, rutas: ["/", "/salud"] }, null, 2) });
    },
    prompt: "Cambia el puerto a 9090 en config.json y deja todo lo demás igual.",
    check(dir) {
      let j;
      try { j = JSON.parse(leer(dir, "config.json") || ""); } catch { return { ok: false, notas: ["config.json ya no es JSON válido"] }; }
      const ok = j.puerto === 9090 && j.nombre === "servicio" && j.debug === true && Array.isArray(j.rutas) && j.rutas.length === 2;
      return { ok, notas: [ok ? "solo cambió el puerto" : `quedó: ${JSON.stringify(j)}`] };
    },
  },
  {
    id: "tres-pasos",
    titulo: "Instrucciones en varios pasos",
    nivel: "facil",
    prompt: "Haz esto: 1) crea a.txt con el texto uno, 2) crea b.txt con el texto dos, 3) crea c.txt con el contenido de a.txt seguido del de b.txt (uno dos, separados por un espacio).",
    check(dir) {
      const a = (leer(dir, "a.txt") || "").trim();
      const b = (leer(dir, "b.txt") || "").trim();
      const c = (leer(dir, "c.txt") || "").trim().replace(/\s+/g, " ");
      return { ok: a === "uno" && b === "dos" && c === "uno dos", notas: [`a=${JSON.stringify(a)} b=${JSON.stringify(b)} c=${JSON.stringify(c)}`] };
    },
  },
];
