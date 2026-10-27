/**
 * Tareas LARGAS y COMPLICADAS contra el agente completo, con TODA la salida cruda grabada.
 *
 * Monta tres piezas:
 *   1. un PROXY entre el ui-server y llama-server que graba verbatim cada petición y cada
 *      frame SSE de la respuesta (aquí está "toda la salida y el formato del modelo");
 *   2. el ui-server REAL de bonsai, con estado y carpeta de trabajo TEMPORALES;
 *   3. seis tareas que NO salen a la primera (hay que ejecutar, leer el error y corregir),
 *      cada una con su propia verificación independiente del modelo.
 *
 * No se le dice al modelo cómo llamar a las herramientas: solo viajan los esquemas en `tools`.
 *
 *   node chat\medir-agente.mjs --puerto 8080 --modelo bolding_v1
 *   node chat\medir-agente.mjs --puerto 8080 --modelo override6 --tareas lru-ttl,parser
 *   node chat\medir-agente.mjs --puerto 8080 --modelo override6 --pensar 2048
 *
 * Artefactos en salida\formato\:
 *   agente-<modelo>-<sello>.jsonl   una línea por tarea: eventos SSE + crudo del proxy + verificación
 *   agente-<modelo>-<sello>.md      informe legible
 */

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.dirname(HERE);
const SALIDA = process.env.BONSAI_SALIDA ? path.resolve(process.env.BONSAI_SALIDA) : path.join(PROJECT, "salida");
const DESTINO = path.join(SALIDA, "formato");

/**
 * El Python de uv, con orden NUMÉRICO descendente (igual que chat/ui-server.mjs). Sin esto,
 * `python` no está en el PATH del sistema y la verificación fallaría sin ser culpa del modelo.
 * @returns {string}
 */
function pythonExe() {
  const root = path.join(process.env.APPDATA || "", "uv", "python");
  if (!fs.existsSync(root)) return "python";
  /** @param {string} dir */
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
  return homes[0] ? path.join(homes[0], "python.exe") : "python";
}

const PYTHON = pythonExe();

/** Puerto libre. */
const libre = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = /** @type {import("node:net").AddressInfo} */ (s.address()).port;
    s.close(() => resolve(p));
  });
});

/**
 * Tareas largas. `preparar` siembra el proyecto, `verificar` decide si quedó bien.
 * @type {Array<{id: string, prompt: string, preparar?: (dir: string) => void, verificar: (dir: string) => Promise<{ok: boolean, nota: string}>}>}
 */
export const TAREAS = [
  {
    id: "lru-ttl",
    prompt: "Crea lru.py con una clase LRUCache(capacidad) que además caduque entradas por tiempo (ttl en segundos): get(clave), put(clave, valor) y un método para saber si una clave sigue viva. Escribe test_lru.py con unittest que compruebe el desalojo del menos usado Y la caducidad por TTL, y ejecuta los tests hasta que pasen todos.",
    verificar: (dir) => correr(dir, PYTHON, ["-c", "import time,sys;sys.path.insert(0,'.');from lru import LRUCache;c=LRUCache(2);c.put('a',1);c.put('b',2);c.put('c',3);assert c.get('a') is None, 'debio desalojar a';assert c.get('b')==2;t=LRUCache(4,ttl=0.3);t.put('x',9);time.sleep(0.45);assert t.get('x') is None, 'no caduco';print('OK')"]),
  },
  {
    id: "parser",
    prompt: "Crea expr.py con un analizador descendente recursivo y una función evaluar(texto) que evalúe expresiones aritméticas con + - * / paréntesis, menos unario y números decimales, respetando precedencia. Añade test_expr.py con unittest (incluye casos límite: unario, paréntesis anidados, división decimal) y ejecútalo hasta que pase.",
    verificar: (dir) => correr(dir, PYTHON, ["-c", "import sys;sys.path.insert(0,'.');from expr import evaluar;casos={'2+3*4':14,'(2+3)*4':20,'-3+5':2,'10/4':2.5,'2*(3+(4-1))':12,'--3':3};[__import__('sys').exit('mal: '+k) for k,v in casos.items() if abs(evaluar(k)-v)>1e-9];print('OK')"]),
  },
  {
    id: "arreglar-bugs",
    prompt: "En fechas.py hay tres fallos: cuenta mal los días entre dos fechas, la comparación de fechas está invertida en un caso y hay una mutación que estropea el resultado al llamar dos veces. test_fechas.py falla. Encuentra y corrige los tres y deja la suite en verde.",
    preparar: (dir) => {
      fs.writeFileSync(path.join(dir, "fechas.py"), [
        "from datetime import date",
        "",
        "def dias_entre(a, b):",
        "    \"\"\"Días entre dos fechas (positivo si b es posterior).\"\"\"",
        "    return (a - b).days",
        "",
        "def es_posterior(a, b):",
        "    return a < b",
        "",
        "_cache = {}",
        "",
        "def sumar_dias(d, n):",
        "    _cache[d] = n",
        "    return date.fromordinal(d.toordinal() + n)",
        "",
        "def sumar_dias_cache(d, n):",
        "    if d in _cache:",
        "        n = _cache[d]",
        "    _cache[d] = n",
        "    return date.fromordinal(d.toordinal() + n)",
        "",
      ].join("\n"), "utf8");
      fs.writeFileSync(path.join(dir, "test_fechas.py"), [
        "import unittest",
        "from datetime import date",
        "from fechas import dias_entre, es_posterior, sumar_dias_cache",
        "",
        "class T(unittest.TestCase):",
        "    def test_dias(self):",
        "        self.assertEqual(dias_entre(date(2026, 1, 1), date(2026, 1, 11)), 10)",
        "        self.assertEqual(dias_entre(date(2026, 1, 11), date(2026, 1, 1)), -10)",
        "",
        "    def test_posterior(self):",
        "        self.assertTrue(es_posterior(date(2026, 3, 1), date(2026, 1, 1)))",
        "        self.assertFalse(es_posterior(date(2026, 1, 1), date(2026, 3, 1)))",
        "",
        "    def test_cache_no_contamina(self):",
        "        d = date(2026, 5, 1)",
        "        self.assertEqual(sumar_dias_cache(d, 1), date(2026, 5, 2))",
        "        self.assertEqual(sumar_dias_cache(d, 5), date(2026, 5, 6))",
        "",
        "if __name__ == '__main__':",
        "    unittest.main()",
        "",
      ].join("\n"), "utf8");
    },
    verificar: (dir) => correr(dir, PYTHON, ["-m", "unittest", "-q"]),
  },
  {
    id: "csv-sucio",
    prompt: "notas.csv tiene comillas, comas dentro de comillas, un BOM, líneas vacías y acentos. Crea limpio.py que lo lea con el módulo csv y escriba resumen.json con {\"alumnos\": N, \"nota_media\": M} (media con dos decimales). Ejecútalo y comprueba que el JSON es correcto.",
    preparar: (dir) => {
      fs.writeFileSync(path.join(dir, "notas.csv"), "\uFEFFnombre,nota,ciudad\r\n\"García, Ana\",8.5,Sevilla\r\n\r\n\"Muñoz, Luis\",6,Madrid\r\n\"Ortiz, José\",9.25,\"Sevilla, centro\"\r\n", "utf8");
    },
    verificar: (dir) => correr(dir, PYTHON, ["-c", "import json;d=json.load(open('resumen.json',encoding='utf-8'));assert d['alumnos']==3, d;assert abs(d['nota_media']-7.92)<0.02, d;print('OK')"]),
  },
  {
    id: "dijkstra",
    prompt: "grafo.json tiene un grafo dirigido con pesos. Crea rutas.py con una función camino(origen, destino) que devuelva la lista de nodos de la ruta de coste mínimo (algoritmo de Dijkstra) y otra coste(origen, destino). Añade test_rutas.py con unittest y ejecútalo.",
    preparar: (dir) => {
      fs.writeFileSync(path.join(dir, "grafo.json"), JSON.stringify({
        A: { B: 4, C: 2 },
        B: { C: 5, D: 10 },
        C: { E: 3 },
        D: { F: 11 },
        E: { D: 4 },
        F: {},
      }), "utf8");
    },
    verificar: (dir) => correr(dir, PYTHON, ["-c", "import sys;sys.path.insert(0,'.');from rutas import camino,coste;assert camino('A','D')==['A','C','E','D'], camino('A','D');assert coste('A','D')==9, coste('A','D');assert camino('A','F')==['A','C','E','D','F'];print('OK')"]),
  },
  {
    id: "multi-archivo",
    prompt: "banco.py tiene una clase Banco con depósito, retiro y transferencia, y ya funciona. Divídela en tres módulos (cuenta.py, banco.py, errores.py) manteniendo la misma interfaz pública, y deja test_banco.py en verde. Ejecuta los tests hasta que pasen.",
    preparar: (dir) => {
      fs.writeFileSync(path.join(dir, "banco.py"), [
        "class SaldoInsuficiente(Exception):",
        "    pass",
        "",
        "class Cuenta:",
        "    def __init__(self, titular, saldo=0):",
        "        self.titular = titular",
        "        self.saldo = saldo",
        "",
        "    def ingresar(self, cantidad):",
        "        if cantidad <= 0:",
        "            raise ValueError('cantidad invalida')",
        "        self.saldo += cantidad",
        "        return self.saldo",
        "",
        "    def retirar(self, cantidad):",
        "        if cantidad > self.saldo:",
        "            raise SaldoInsuficiente(self.titular)",
        "        self.saldo -= cantidad",
        "        return self.saldo",
        "",
        "class Banco:",
        "    def __init__(self):",
        "        self.cuentas = {}",
        "",
        "    def abrir(self, titular, saldo=0):",
        "        self.cuentas[titular] = Cuenta(titular, saldo)",
        "        return self.cuentas[titular]",
        "",
        "    def transferir(self, de, a, cantidad):",
        "        if de not in self.cuentas or a not in self.cuentas:",
        "            raise ValueError('cuenta desconocida')",
        "        self.cuentas[de].retirar(cantidad)",
        "        self.cuentas[a].ingresar(cantidad)",
        "        return self.cuentas[a].saldo",
        "",
      ].join("\n"), "utf8");
      fs.writeFileSync(path.join(dir, "test_banco.py"), [
        "import unittest",
        "from banco import Banco, SaldoInsuficiente",
        "",
        "class T(unittest.TestCase):",
        "    def test_flujo(self):",
        "        b = Banco()",
        "        b.abrir('ana', 100)",
        "        b.abrir('luis', 0)",
        "        self.assertEqual(b.transferir('ana', 'luis', 40), 40)",
        "        self.assertEqual(b.cuentas['ana'].saldo, 60)",
        "",
        "    def test_sin_saldo(self):",
        "        b = Banco()",
        "        b.abrir('ana', 10)",
        "        with self.assertRaises(SaldoInsuficiente):",
        "            b.cuentas['ana'].retirar(50)",
        "",
        "if __name__ == '__main__':",
        "    unittest.main()",
        "",
      ].join("\n"), "utf8");
    },
    verificar: (dir) => correr(dir, PYTHON, ["-m", "unittest", "-q"]),
  },
  {
    id: "proyecto-completo",
    prompt: "Monta un mini gestor de tareas COMPLETO y funcionando, con estos archivos: (1) almacen.py, con clases Tarea y Almacen (anadir, listar, completar, borrar) que persistan en tareas.json con escritura atomica y funcionen aunque el archivo no exista; (2) api.py, un servidor HTTP con http.server en el puerto 8099 con GET /tareas, POST /tareas, POST /tareas/<id>/completar y DELETE /tareas/<id>, todo JSON (el alta recibe {\"titulo\": \"...\"} y devuelve la tarea con su id); (3) cli.py, cliente con urllib que anada, liste y complete tareas contra esa API; (4) test_almacen.py y test_api.py con unittest; (5) README.md diciendo como arrancarlo. Ejecuta los tests, arranca la API en el 8099, pruebala con el cli y deja los tests en verde.",
    verificar: async (dir) => {
      const tests = await correr(dir, PYTHON, ["-m", "unittest", "-q"]);
      if (!tests.ok) return { ok: false, nota: `los tests fallan: ${tests.nota}` };
      const api = spawn(PYTHON, ["api.py"], { cwd: dir, windowsHide: true });
      let log = "";
      api.stdout?.on("data", (b) => (log += b.toString()));
      api.stderr?.on("data", (b) => (log += b.toString()));
      try {
        let vivo = false;
        for (let i = 0; i < 40; i += 1) {
          const r = await pedir("http://127.0.0.1:8099/tareas");
          if (r.status === 200) {
            vivo = true;
            break;
          }
          await new Promise((r2) => setTimeout(r2, 250));
        }
        if (!vivo) return { ok: false, nota: `la API no responde en el 8099: ${log.slice(-300)}` };
        const alta = await pedir("http://127.0.0.1:8099/tareas", { titulo: "comprar pan" });
        const lista = await pedir("http://127.0.0.1:8099/tareas");
        let id = "";
        try {
          id = String(JSON.parse(alta.body).id ?? "");
        } catch {
          id = "";
        }
        if (!id) {
          try {
            const filas = JSON.parse(lista.body);
            id = String((Array.isArray(filas) ? filas[0] : {}).id ?? "");
          } catch {
            id = "";
          }
        }
        const completo = id ? await pedir(`http://127.0.0.1:8099/tareas/${id}/completar`, {}) : { status: 0, body: "sin id" };
        const borrado = id ? await pedir(`http://127.0.0.1:8099/tareas/${id}`, undefined, "DELETE") : { status: 0, body: "sin id" };
        return {
          // 201 (Created) es la respuesta CORRECTA al crear: exigir 200 exacto marcaba como
          // fallo una API que funciona (pasó con override6: alta=201 y todo lo demás 200).
          ok: (alta.status === 200 || alta.status === 201) && lista.body.includes("comprar pan") && completo.status === 200 && borrado.status === 200,
          nota: `alta=${alta.status} lista=${lista.status} completar=${completo.status} borrar=${borrado.status} · ${log.slice(-160)}`,
        };
      } finally {
        api.kill();
      }
    },
  },
];

/**
 * @param {string} dir
 * @param {string} cmd
 * @param {string[]} args
 * @returns {Promise<{ok: boolean, nota: string}>}
 */
function correr(dir, cmd, args) {
  return new Promise((resolve) => {
    const hijo = spawn(cmd, args, { cwd: dir, windowsHide: true, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
    let salida = "";
    hijo.stdout?.on("data", (b) => (salida += b.toString("utf8")));
    hijo.stderr?.on("data", (b) => (salida += b.toString("utf8")));
    hijo.on("error", (e) => resolve({ ok: false, nota: `no se pudo lanzar ${cmd}: ${e.message}` }));
    hijo.on("close", (code) => resolve({ ok: code === 0, nota: salida.trim().slice(-400) || `código ${code}` }));
  });
}

/**
 * @param {string} url
 * @param {unknown} [cuerpo]
 * @param {string} [metodo]
 * @returns {Promise<{status: number, body: string}>}
 */
function pedir(url, cuerpo, metodo) {
  return new Promise((resolve) => {
    const datos = cuerpo === undefined ? "" : JSON.stringify(cuerpo);
    const u = new URL(url);
    const req = http.request({
      host: u.hostname,
      port: u.port,
      method: metodo || (cuerpo === undefined ? "GET" : "POST"),
      path: u.pathname + u.search,
      headers: { host: u.host, ...(datos ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(datos)) } : {}) },
    }, (res) => {
      let t = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (t += c));
      res.on("end", () => resolve({ status: res.statusCode || 0, body: t }));
    });
    req.on("error", (e) => resolve({ status: 0, body: String(e.message) }));
    req.setTimeout(2000, () => req.destroy(new Error("tiempo de conexión agotado")));
    if (datos) req.write(datos);
    req.end();
  });
}

async function main() {
  const argv = process.argv.slice(2);
  let puertoLlama = 8080;
  let modelo = "";
  let solo = "";
  let timeoutTurno = 900000;
  let pensar = 0;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--puerto") puertoLlama = Number(argv[++i]) || 8080;
    else if (argv[i] === "--modelo") modelo = argv[++i] || "";
    else if (argv[i] === "--tareas") solo = argv[++i] || "";
    else if (argv[i] === "--timeout") timeoutTurno = Number(argv[++i]) || 900000;
    else if (argv[i] === "--pensar") pensar = Number(argv[++i]) || 0;
    else throw new Error(`argumento desconocido: ${argv[i]}`);
  }
  if (!modelo) throw new Error("falta --modelo");
  const salud = await fetch(`http://127.0.0.1:${puertoLlama}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  if (!salud || !salud.ok) throw new Error(`no hay llama-server en ${puertoLlama}`);

  // 1. PROXY que graba todo el tráfico al modelo, verbatim.
  /** @type {Array<Record<string, unknown>>} */
  const trafico = [];
  const proxy = http.createServer((req, res) => {
    const trozos = [];
    req.on("data", (c) => trozos.push(c));
    req.on("end", () => {
      const cuerpo = Buffer.concat(trozos).toString("utf8");
      const arriba = http.request({ host: "127.0.0.1", port: puertoLlama, path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${puertoLlama}` } }, (r) => {
        res.writeHead(r.statusCode || 502, r.headers);
        /** @type {string[]} */
        const frames = [];
        r.on("data", (c) => {
          frames.push(c.toString("utf8"));
          res.write(c);
        });
        r.on("end", () => {
          trafico.push({
            url: req.url,
            peticion: cuerpo.slice(0, 6000),
            respuesta: frames.join("").slice(0, 400000),
            tipo: String(r.headers["content-type"] || ""),
          });
          res.end();
        });
        r.on("error", () => { if (!res.destroyed) res.destroy(); });
      });
      // Al cancelar el cliente también hay que cortar la petición al modelo. De otro
      // modo el stream queda abierto, conserva sockets y puede impedir salir al proxy.
      res.on("close", () => { if (!res.writableFinished) arriba.destroy(); });
      arriba.on("error", (e) => {
        // Si el modelo se cae a mitad del stream, las cabeceras YA se enviaron: volver a
        // escribirlas revienta el arnés (ERR_HTTP_HEADERS_SENT) en vez de reportar el corte.
        if (res.headersSent) {
          res.end();
          return;
        }
        res.writeHead(502).end(String(e.message));
      });
      arriba.end(cuerpo);
    });
  });
  const puertoProxy = await libre();
  await new Promise((r) => proxy.listen(puertoProxy, "127.0.0.1", () => r(undefined)));

  let ui;
  let volcado;
  let tmp;
  try {

  // 2. ui-server REAL con estado y carpeta temporales.
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-agente-"));
  const proyecto = path.join(tmp, "proyecto");
  fs.mkdirSync(proyecto, { recursive: true });
  // Con --pensar N el ui-server arranca con ese ajuste (solo se usa si el modelo lo admite).
  if (pensar > 0) {
    fs.mkdirSync(path.join(tmp, "estado"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "estado", "ui-settings.json"), JSON.stringify({ pensar }), "utf8");
  }
  const puertoUi = await libre();
  ui = spawn(process.execPath, [path.join(HERE, "ui-server.mjs"), "--port", String(puertoUi), "--llama-port", String(puertoProxy)], {
    cwd: HERE,
    env: { ...process.env, BONSAI_STATE: path.join(tmp, "estado"), BONSAI_SALIDA: path.join(tmp, "salida") },
    stdio: "ignore",
  });
  const esperar = async () => {
    for (let i = 0; i < 80; i += 1) {
      const r = await pedir(`http://127.0.0.1:${puertoUi}/api/state`);
      if (r.status === 200) return true;
      await new Promise((r2) => setTimeout(r2, 250));
    }
    return false;
  };
  const base = `http://127.0.0.1:${puertoUi}`;
  if (!(await esperar())) throw new Error("el ui-server no arrancó");
  const permitir = await pedir(`${base}/api/permit`, { mode: "all" });
  if (permitir.status !== 200) throw new Error(`no se pudieron habilitar permisos: HTTP ${permitir.status}`);

  // /api/workspace responde 409 hasta que el finally del turno anterior terminó,
  // incluidos navegador y procesos de fondo. No se borra ni verifica el proyecto
  // mientras ese turno todavía puede modificarlo.
  const esperarTurnoLibre = async () => {
    const limite = Date.now() + 30000;
    while (Date.now() < limite) {
      const r = await pedir(`${base}/api/workspace`, { path: proyecto });
      if (r.status === 200) return;
      if (r.status !== 409) throw new Error(`no se pudo preparar el proyecto: HTTP ${r.status} ${r.body}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("el turno anterior no terminó de cancelarse; se detiene la evaluación para proteger el proyecto temporal");
  };

  fs.mkdirSync(DESTINO, { recursive: true });
  const sello = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ficheroCrudo = path.join(DESTINO, `agente-${modelo}${pensar ? `-pensar${pensar}` : ""}-${sello}.jsonl`);
  const ficheroInforme = path.join(DESTINO, `agente-${modelo}${pensar ? `-pensar${pensar}` : ""}-${sello}.md`);
  volcado = fs.createWriteStream(ficheroCrudo, { flags: "a" });

  /** @type {string[]} */
  const informe = [`# Tareas largas con el agente completo · ${modelo}`, "", `- Proxy: 127.0.0.1:${puertoProxy} → llama-server 127.0.0.1:${puertoLlama}`, `- ui-server: ${base}`, `- Fecha: ${new Date().toISOString()}`, `- Razonamiento: ${pensar ? `${pensar} tokens (si el modelo lo admite)` : "apagado"}`, ""];
  const elegidas = solo ? TAREAS.filter((t) => solo.split(",").includes(t.id)) : TAREAS;

  for (const tarea of elegidas) {
    await esperarTurnoLibre();
    const reset = await pedir(`${base}/api/reset`, {});
    if (reset.status !== 204) throw new Error(`no se pudo limpiar el chat: HTTP ${reset.status}`);
    fs.rmSync(proyecto, { recursive: true, force: true });
    fs.mkdirSync(proyecto, { recursive: true });
    if (tarea.preparar) tarea.preparar(proyecto);
    trafico.length = 0;
    const t0 = Date.now();
    /** @type {Array<Record<string, any>>} */
    const eventos = [];
    let textoFinal = "";
    let errorTurno = "";
    try {
      const res = await fetch(`${base}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: tarea.prompt }),
        signal: AbortSignal.timeout(timeoutTurno),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const lector = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await lector.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl = buf.indexOf("\n");
        while (nl !== -1) {
          const linea = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          nl = buf.indexOf("\n");
          if (!linea.startsWith("data:")) continue;
          try {
            const ev = JSON.parse(linea.slice(5));
            eventos.push(ev);
            if (ev.type === "replace") textoFinal = String(ev.text || "");
            if (ev.type === "error") errorTurno = String(ev.text || "error del turno");
          } catch {
            /* trozo */
          }
        }
      }
    } catch (err) {
      errorTurno = err instanceof Error ? err.message : String(err);
      eventos.push({ type: "error", text: errorTurno });
      // Una conexión SSE cerrada no garantiza que el ui-server haya visto el
      // corte. /api/reset cancela explícitamente el AbortController del turno.
      const cancelar = await pedir(`${base}/api/reset`, {});
      if (cancelar.status !== 204) throw new Error(`no se pudo cancelar el turno: HTTP ${cancelar.status}`);
    }
    const segundos = Math.round((Date.now() - t0) / 1000);
    await esperarTurnoLibre();
    const veredicto = errorTurno
      ? { ok: false, incompleta: true, nota: `turno interrumpido: ${errorTurno}` }
      : await tarea.verificar(proyecto);
    const acciones = eventos.filter((e) => e.type === "action");
    const saltos = eventos.filter((e) => e.type === "start").length;
    const crudo = trafico.filter((t) => String(t.url).includes("chat/completions"));
    const dialectos = new Set();
    for (const t of crudo) {
      const respuesta = String(t.respuesta || "");
      if (respuesta.includes("tool_calls")) dialectos.add("nativo-tool_calls");
      if (/<tool_call>[\s\S]*?<function\s*=/i.test(respuesta)) dialectos.add("xml-funcion");
      if (/```\s*(?:ejecutar|archivo|leer|buscar|indice)/i.test(respuesta)) dialectos.add("cercas");
    }
    volcado.write(`${JSON.stringify({
      modelo,
      tarea: tarea.id,
      prompt: tarea.prompt,
      veredicto,
      segundos,
      saltos,
      dialectos: [...dialectos],
      acciones: acciones.map((a) => ({ kind: a.kind, title: a.title, state: a.state, code: a.code, detail: String(a.detail || "").slice(0, 600) })),
      textoFinal,
      crudo,
      eventos,
    })}\n`);
    const filas = [
      `## ${tarea.id} — ${veredicto.incompleta ? "⚠️ INCOMPLETA" : veredicto.ok ? "✅ OK" : "❌ FALLA"} (${segundos} s, ${saltos} saltos, ${acciones.length} acciones)`,
      "",
      `- Dialectos vistos: ${[...dialectos].join(", ") || "(ninguno)"}`,
      `- Verificación: ${veredicto.nota.replace(/\n/g, " ").slice(0, 300)}`,
      `- Acciones: ${acciones.map((a) => `${a.kind}:${a.state}(${String(a.title).slice(0, 40)})`).join(" | ").slice(0, 700)}`,
      `- Respuesta final: ${textoFinal.replace(/\n/g, " ").slice(0, 300)}`,
      "",
    ];
    informe.push(...filas);
    process.stdout.write(`${tarea.id.padEnd(16)} ${veredicto.incompleta ? "INCOMPLETA" : veredicto.ok ? "OK  " : "FALLA"} ${String(segundos).padStart(4)} s  saltos=${saltos}  acciones=${acciones.length}  dialectos=${[...dialectos].join("+") || "-"}\n`);
  }
  fs.writeFileSync(ficheroInforme, informe.join("\n"), "utf8");
  process.stdout.write(`\ncrudo: ${ficheroCrudo}\ninforme: ${ficheroInforme}\n`);
  } finally {
    if (volcado) await new Promise((resolve) => volcado.end(resolve));
    if (ui && ui.exitCode === null) {
      const cerrado = new Promise((resolve) => ui.once("exit", resolve));
      ui.kill();
      await Promise.race([cerrado, new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
    // Solo se elimina la carpeta temporal que creó este proceso, y solo una vez
    // cerrado el servidor que podía estar escribiendo en ella.
    if (tmp && (!ui || ui.exitCode !== null || ui.signalCode !== null)
        && path.dirname(path.resolve(tmp)) === path.resolve(os.tmpdir())
        && path.basename(tmp).startsWith("bonsai-agente-")) {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
