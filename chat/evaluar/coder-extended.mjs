/** Wider retrieval and additional real language/toolchain paths; still synthetic fixtures. */
import { CODER_TAREAS } from "./coder-tareas.mjs";
const noise = {};
for (let i = 0; i < 40; i++) {
  const id = String(i).padStart(2, "0");
  noise[`src/http/headers/archive-${id}.mjs`] =
    `// Utilidades históricas para cabeceras HTTP.\n` +
    Array.from(
      { length: 6 },
      (_, n) =>
        `export function readHeadersArchive${id}_${n}(value) {\n  return String(value);\n}\n`,
    ).join("\n");
}
const headerSource =
  Array.from(
    { length: 28 },
    (_, i) =>
      `// Regla documentada ${i + 1}: conservar compatibilidad de cabeceras HTTP.`,
  ).join("\n") +
  "\n" +
  Array.from(
    { length: 8 },
    (_, i) =>
      `export function headerHelper${i}(value) { return String(value); }`,
  ).join("\n") +
  "\nexport function parseHeaders(text) {\n  const result = {};\n  for (const line of text.split(/\\r?\\n/)) {\n    const colon = line.indexOf(':');\n    if (colon < 0) continue;\n    const key = line.slice(0, colon).toLowerCase();\n    result[key] = line.slice(colon + 1).trim();\n  }\n  return result;\n}\n";
export const CODER_EXTENDIDAS = [
  ...CODER_TAREAS,
  {
    id: "wide-headers",
    prompt:
      "parseHeaders debe limpiar espacios alrededor del nombre de las cabeceras HTTP, conservar sus valores y convertir nombres a minúsculas. Encuentra el código vigente entre los módulos existentes y corrige solo lo necesario. Verifica los tests.",
    files: {
      ...noise,
      "src/http/headers/parser.mjs": headerSource,
      "src/index.mjs":
        "export {parseHeaders} from './http/headers/parser.mjs';\n",
      "test/headers.test.mjs":
        "import assert from 'node:assert/strict';\nimport {parseHeaders} from '../src/index.mjs';\nassert.deepEqual(parseHeaders(' X-Mode : fast\\r\\nAccept: application/json'),{'x-mode':'fast',accept:'application/json'});\n",
    },
    oracle:
      "import {parseHeaders} from './src/index.mjs'; assert.deepEqual(parseHeaders(' A : one:two\\n\\nInvalid\\nB:  3  '),{a:'one:two',b:'3'}); assert.deepEqual(parseHeaders(''),{});",
  },
  {
    id: "python-api",
    language: "python",
    prompt:
      "El checkout debe devolver un importe entero en céntimos usando sum_cents del módulo de moneda existente. Conserva checkout(prices), corrige la implementación y ejecuta los tests afectados.",
    files: {
      "shop/__init__.py": "",
      "shop/currency.py":
        "def sum_cents(prices):\n    return sum(round(value * 100) for value in prices)\n",
      "shop/cart.py": "def checkout(prices):\n    return sum(prices)\n",
      "tests/test_cart.py":
        "import unittest\nfrom shop.cart import checkout\n\nclass CartTest(unittest.TestCase):\n    def test_total(self):\n        self.assertEqual(checkout([10.25, 2.50]), 1275)\n    def test_empty(self):\n        self.assertEqual(checkout([]), 0)\n",
    },
    oracle:
      "from shop.cart import checkout\nfrom shop.currency import sum_cents\nassert checkout([1.25,2.5]) == 375\nassert checkout([0.101,0.101]) == sum_cents([0.101,0.101])\nassert isinstance(checkout([1]),int)\n",
  },
  {
    id: "typescript-api",
    language: "typescript",
    prompt:
      "checkout(prices) debe devolver céntimos enteros usando cents de #currency. Conserva su tipo público number y las exportaciones actuales. Corrige el error de tipos y comprueba los tests.",
    files: {
      "package.json": JSON.stringify({
        type: "module",
        imports: { "#currency": "./src/currency.ts" },
        scripts: { test: "node --test test/cart.test.mjs" },
      }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          allowImportingTsExtensions: true,
        },
        include: ["src/**/*.ts"],
      }),
      "src/currency.ts":
        "export function cents(price: number): number { return Math.round(price * 100); }\n",
      "src/cart.ts":
        "export function checkout(prices: number[]): number { return prices.reduce((sum, value) => sum + value, 0).toFixed(2); }\n",
      "test/cart.test.mjs":
        "import assert from 'node:assert/strict';\nimport {checkout} from '../src/cart.ts';\nassert.equal(checkout([1.25,2.5]),375);\nassert.equal(checkout([]),0);\n",
    },
    oracle:
      "import {checkout} from './src/cart.ts'; assert.equal(checkout([0.105,0.105]),22); assert.equal(typeof checkout([1]),'number');",
  },
];
