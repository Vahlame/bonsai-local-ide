import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CodeContext, parseCode } from "./code-context.mjs";
import { CoderTask, CODER_CONFIG } from "./coder-harness.mjs";
import { verificationCommands } from "./project-verification.mjs";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-python-coder-"));
const write = (rel, text) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
};
try {
  write("src/shop/__init__.py", "");
  write("src/shop/money.py", "def total(values):\n    return sum(values)\n");
  write(
    "src/shop/cart.py",
    "from . import money as currency\n\ndef checkout(values):\n    return currency.total(values)\n",
  );
  write(
    "tests/test_cart.py",
    "import unittest\nfrom shop.cart import checkout\n\nclass CartTest(unittest.TestCase):\n    def test_cart(self):\n        self.assertEqual(checkout([10,20]),30)\n",
  );
  write(
    "tests/test_other.py",
    "import unittest\nclass Other(unittest.TestCase):\n    def test_other(self):\n        self.fail('must not run unrelated tests')\n",
  );
  const parsed = await parseCode(
    "imports.py",
    "# import wrong.module\nimport pkg.one as alias\nfrom ..shared import total as sum_values\n",
  );
  assert.equal(parsed.parser, "tree-sitter");
  assert.ok(parsed.imports.includes("pkg.one"));
  assert.ok(parsed.imports.includes("..shared"));
  assert.ok(!parsed.imports.some((s) => s.includes("wrong")));
  const compact = await parseCode(
    "compact.py",
    'def compact(x): return "implementation-must-not-be-in-map"\n',
  );
  assert.equal(compact.symbols[0].signature, "def compact(x):");
  const c = await new CodeContext(root, CODER_CONFIG).refresh();
  assert.ok(
    c.entries
      .get("src/shop/cart.py")
      .dependencies.includes("src/shop/money.py"),
  );
  assert.deepEqual(c.affectedTests(["src/shop/money.py"]), [
    "tests/test_cart.py",
  ]);
  const commands = verificationCommands(root, c, ["src/shop/money.py"]);
  assert.equal(commands.length, 1);
  assert.ok(commands[0].args.includes("unittest"));
  const task = await new CoderTask({
    root,
    goal: "Corrige la suma del carrito",
  }).start();
  write("src/shop/money.py", "def total(values):\n    return len(values)\n");
  let result = await task.verify();
  assert.equal(result.ok, false);
  assert.match(result.summary, /AssertionError/);
  assert.equal(task.state.repairs, 1);
  write("src/shop/money.py", "def total(values):\n    return sum(values)\n");
  result = await task.verify();
  assert.equal(result.ok, true, result.summary);
  assert.equal(task.state.tests.length, 1);
  assert.ok(!task.state.tests.some((t) => t.command.includes("test_other")));
  console.log(
    "Python AST imports, src packages, affected unittest and automatic repair verification passed.",
  );
} finally {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep))
    throw new Error("Unexpected cleanup root");
  fs.rmSync(root, { recursive: true, force: true });
}
