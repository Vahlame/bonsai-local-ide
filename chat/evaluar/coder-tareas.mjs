/** Fixtures pequeñas, offline y sin dependencias. El oráculo nunca se envía al agente. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import os from "node:os";
import crypto from "node:crypto";
import { typeScriptProject } from "../code-intelligence.mjs";

const test = (expression) =>
  `import assert from 'node:assert/strict';\n${expression}\n`;
export const CODER_TAREAS = [
  {
    id: "single-bug",
    prompt:
      "Corrige el cálculo del precio con descuento en src/price.mjs. Conserva la API y comprueba los tests.",
    files: {
      "src/price.mjs":
        "export function discounted(price, percent) { return price * percent / 100; }\n",
      "test/price.test.mjs": test(
        "import {discounted} from '../src/price.mjs'; assert.equal(discounted(80,25),60);",
      ),
    },
    oracle:
      "import {discounted as f} from './src/price.mjs'; assert.equal(f(100,0),100); assert.equal(f(50,100),0);",
  },
  {
    id: "discover",
    prompt:
      "Los slugs conservan espacios al inicio y final. Encuentra la implementación, corrígela y comprueba que sigue convirtiendo espacios internos en guiones.",
    files: {
      "src/text/slug.mjs":
        "export function slug(s) { return s.toLowerCase().replace(/\\s+/g, '-'); }\n",
      "src/index.mjs": "export {slug} from './text/slug.mjs';\n",
      "test/slug.test.mjs": test(
        "import {slug} from '../src/index.mjs'; assert.equal(slug('  Hello World  '),'hello-world');",
      ),
    },
    oracle:
      "import {slug as f} from './src/index.mjs'; assert.equal(f(' A B '),'a-b'); assert.equal(f(''), '');",
  },
  {
    id: "cross-file",
    prompt:
      "Añade soporte a Fahrenheit en convert(value, unit). Usa fahrenheitToCelsius del módulo units, expórtala desde index y conserva Celsius. Revisa los tests.",
    files: {
      "src/units.mjs":
        "export function fahrenheitToCelsius(f) { return (f-32)*5/9; }\n",
      "src/convert.mjs":
        "export function convert(value, unit) { if (unit === 'C') return value; throw new Error('Unknown unit'); }\n",
      "src/index.mjs": "export {convert} from './convert.mjs';\n",
      "test/convert.test.mjs": test(
        "import {convert} from '../src/index.mjs'; assert.equal(convert(32,'F'),0); assert.equal(convert(8,'C'),8);",
      ),
    },
    oracle:
      "import {convert, fahrenheitToCelsius as f} from './src/index.mjs'; assert.equal(convert(212,'F'),100); assert.equal(f(32),0); assert.throws(()=>convert(1,'K'));",
  },
  {
    id: "failing-test",
    prompt:
      "Ejecuta node --test test/range.test.mjs y corrige la implementación a partir del fallo. No cambies el test.",
    files: {
      "src/range.mjs":
        "export const range = n => Array.from({length:n+1},(_,i)=>i);\n",
      "test/range.test.mjs": test(
        "import {range} from '../src/range.mjs'; assert.deepEqual(range(3),[0,1,2]); assert.deepEqual(range(0),[]);",
      ),
    },
    oracle:
      "import {range as f} from './src/range.mjs'; assert.deepEqual(f(1),[0]); assert.deepEqual(f(5),[0,1,2,3,4]);",
  },
  {
    id: "existing-api",
    prompt:
      "Implementa total(items) en src/cart.mjs usando money.roundMoney del módulo existente para redondear el total a dos decimales. No dupliques esa función.",
    files: {
      "src/money.mjs":
        "export const roundMoney = n => Math.round((n + Number.EPSILON) * 100) / 100;\n",
      "src/cart.mjs": "export function total(items) { return 0; }\n",
      "test/cart.test.mjs": test(
        "import {total} from '../src/cart.mjs'; assert.equal(total([0.1,0.2]),0.3);",
      ),
    },
    oracle:
      "import {total} from './src/cart.mjs'; assert.equal(total([]),0); assert.equal(total([1.005]),1.01); assert.match(await (await import('node:fs/promises')).readFile('src/cart.mjs','utf8'),/import.*roundMoney/);",
  },
  {
    id: "compatibility",
    prompt:
      "Permite que greet acepte además un objeto con name. Conserva la llamada existente con string y su valor por defecto. Comprueba la API.",
    files: {
      "src/greet.mjs":
        "export function greet(name = 'World') { return `Hello ${name}!`; }\n",
      "test/greet.test.mjs": test(
        "import {greet} from '../src/greet.mjs'; assert.equal(greet({name:'Ana'}),'Hello Ana!'); assert.equal(greet('Ada'),'Hello Ada!'); assert.equal(greet(),'Hello World!');",
      ),
    },
    oracle:
      "import {greet} from './src/greet.mjs'; assert.equal(greet({name:'B'}),'Hello B!'); assert.equal(greet('X'),'Hello X!'); assert.equal(greet(),'Hello World!');",
  },
  {
    id: "repair-patch",
    prompt:
      "Implementa clamp(n, min, max) en src/clamp.mjs y ejecuta los tests. Si una edición o validación falla, repara el código antes de terminar.",
    injectFault: true,
    files: {
      "src/clamp.mjs": "export function clamp(n, min, max) { return n; }\n",
      "test/clamp.test.mjs": test(
        "import {clamp} from '../src/clamp.mjs'; assert.equal(clamp(-2,0,10),0); assert.equal(clamp(12,0,10),10);",
      ),
    },
    oracle:
      "import {clamp} from './src/clamp.mjs'; assert.equal(clamp(5,0,10),5); assert.equal(clamp(1,2,3),2);",
  },
];

export function prepararCoder(tarea, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const files = {
    ...(tarea.language === "python"
      ? {
          "pyproject.toml":
            '[project]\nname = "coder-fixture"\nversion = "0.0.0"\n',
        }
      : {
          "package.json": JSON.stringify({
            type: "module",
            scripts: { test: "node --test test/*.test.mjs" },
          }),
        }),
    ...tarea.files,
  };
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
  }
}

export function validarCoder(tarea, dir) {
  if (tarea.language === "python") return validarPython(tarea, dir);
  const ejecutar = (args) =>
    spawnSync(process.execPath, args, {
      cwd: dir,
      encoding: "utf8",
      timeout: 20000,
      windowsHide: true,
    });
  const publicTests = [];
  const scan = (relative) => {
    const absolute = path.join(dir, relative);
    if (!fs.existsSync(absolute)) return;
    for (const e of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue;
      const file = relative + "/" + e.name;
      if (e.isDirectory()) scan(file);
      else if (/\.[cm]?[jt]s$/.test(file)) publicTests.push(file);
      if (publicTests.length > 100)
        throw new Error("Benchmark test file limit exceeded");
    }
  };
  scan("test");
  const tests = ejecutar([
    "--test",
    ...new Set([
      ...Object.keys(tarea.files).filter((f) => f.startsWith("test/")),
      ...publicTests,
    ]),
  ]);
  const oracle = ejecutar(["--input-type=module", "-e", test(tarea.oracle)]);
  const originalTests = Object.entries(tarea.files).filter(([f]) =>
    f.startsWith("test/"),
  );
  const testsUnchanged = originalTests.every(
    ([f, s]) =>
      fs.existsSync(path.join(dir, f)) &&
      fs.readFileSync(path.join(dir, f), "utf8") === s,
  );
  // Run immutable copies of the original assertions independently of the edited
  // tests. Adding a legitimate case is allowed; weakening tests cannot fool us.
  const originalChecks = originalTests.map(([rel, source]) =>
    ejecutar([
      "--input-type=module",
      "-e",
      source.replace(
        /(from\s*|import\s*)(['"])(\.\.?\/[^'"]+)\2/g,
        (_, prefix, quote, spec) =>
          prefix +
          JSON.stringify(
            pathToFileURL(path.resolve(dir, path.dirname(rel), spec)).href,
          ),
      ),
    ]),
  );
  const originalTestsPassing = originalChecks.every((r) => r.status === 0);
  const preservedTests = /no cambies (?:el )?test/i.test(tarea.prompt)
    ? testsUnchanged
    : originalTests.every(([rel]) => fs.existsSync(path.join(dir, rel))) &&
      originalTestsPassing;
  const syntax = Object.keys(tarea.files)
    .filter((f) => f.startsWith("src/"))
    .map((f) => ejecutar(["--check", f]));
  const types =
    tarea.language === "typescript"
      ? typeScriptProject(dir, {
          entries: new Map(Object.keys(tarea.files).map((f) => [f, {}])),
        })
      : null;
  const typeErrors = types ? types.diagnostics() : [];
  return {
    ok:
      tests.status === 0 &&
      oracle.status === 0 &&
      originalTestsPassing &&
      preservedTests &&
      syntax.every((r) => r.status === 0) &&
      typeErrors.length === 0,
    typecheckPassing: types ? typeErrors.length === 0 : null,
    testsPassing: tests.status === 0,
    syntaxPassing: syntax.every((r) => r.status === 0),
    preservedTests,
    testsUnchanged,
    originalTestsPassing,
    log: `${tests.stdout}${tests.stderr}${oracle.stdout}${oracle.stderr}${typeErrors.map((d) => d.text).join("\n")}`,
  };
}

function validarPython(tarea, dir) {
  const env = {
    ...process.env,
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONPYCACHEPREFIX: path.join(
      os.tmpdir(),
      "bonsai-oracle-" + crypto.randomUUID(),
    ),
  };
  const run = (args) =>
    spawnSync("python", args, {
      cwd: dir,
      env,
      encoding: "utf8",
      timeout: 20000,
      windowsHide: true,
    });
  const tests = run(["-m", "unittest", "discover", "-s", "tests"]);
  const oracle = run(["-c", tarea.oracle]);
  const originals = Object.entries(tarea.files).filter(
    ([f]) => f.startsWith("tests/") && f.endsWith(".py"),
  );
  const originalTestsPassing = originals.every(
    ([, source]) =>
      run(["-c", source + "\nif __name__ == '__main__': unittest.main()\n"])
        .status === 0,
  );
  const testsUnchanged = originals.every(
    ([f, s]) =>
      fs.existsSync(path.join(dir, f)) &&
      fs.readFileSync(path.join(dir, f), "utf8") === s,
  );
  const preservedTests =
    originals.every(([f]) => fs.existsSync(path.join(dir, f))) &&
    originalTestsPassing;
  const syntax = run([
    "-c",
    "import ast,pathlib,sys; [ast.parse(pathlib.Path(f).read_text(encoding='utf-8'),filename=f) for f in sys.argv[1:]]",
    ...Object.keys(tarea.files).filter((f) => f.endsWith(".py")),
  ]);
  return {
    ok:
      tests.status === 0 &&
      oracle.status === 0 &&
      preservedTests &&
      syntax.status === 0,
    testsPassing: tests.status === 0,
    syntaxPassing: syntax.status === 0,
    typecheckPassing: null,
    preservedTests,
    testsUnchanged,
    originalTestsPassing,
    log: `${tests.stdout}${tests.stderr}${oracle.stdout}${oracle.stderr}${syntax.stderr}`,
  };
}
