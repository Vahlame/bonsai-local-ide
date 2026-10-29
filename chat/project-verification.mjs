/** Deterministic targeted test adapters. Project commands remain authoritative. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { rutaProyecto } from "./archivos-seguros.mjs";
export function verificationCommands(root, context, modified, settings = {}) {
  const tests = context.affectedTests(modified);
  const explicit = Array.isArray(settings.verification)
    ? settings.verification
        .filter(
          (c) =>
            typeof c.file === "string" &&
            Array.isArray(c.args) &&
            c.args.every((x) => typeof x === "string"),
        )
        .slice(0, 4)
    : [];
  const commands = [];
  const js = tests.filter((f) => /\.[cm]?js$/.test(f));
  if (js.length)
    commands.push({
      file: process.execPath,
      args: ["--test", ...js.slice(0, 20)],
    });
  if (!explicit.length) {
    const venv = path.join(
      root,
      ".venv",
      process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
    );
    const python =
      rutaProyecto(root, path.relative(root, venv)) && fs.existsSync(venv)
        ? venv
        : "python";
    const src = rutaProyecto(root, "src");
    // Timestamp-based .pyc caches can hide a same-size edit made within one second.
    // An unused prefix and disabled writes force fresh source without deleting user caches.
    const env = {
      PYTHONDONTWRITEBYTECODE: "1",
      PYTHONPYCACHEPREFIX: path.join(
        os.tmpdir(),
        "bonsai-source-check-" + crypto.randomUUID(),
      ),
      ...(src && fs.existsSync(src) && fs.statSync(src).isDirectory()
        ? {
            PYTHONPATH: [src, process.env.PYTHONPATH]
              .filter(Boolean)
              .join(path.delimiter),
          }
        : {}),
    };
    const pytest = [];
    for (const f of tests.filter((f) => f.endsWith(".py")).slice(0, 12)) {
      const entry = context.entries.get(f);
      if (
        entry?.imports.some(
          (i) => i === "unittest" || i.startsWith("unittest."),
        )
      )
        commands.push({
          file: python,
          args: [
            "-m",
            "unittest",
            "discover",
            "-s",
            path.posix.dirname(f),
            "-p",
            path.posix.basename(f),
          ],
          env,
        });
      else if (
        entry?.imports.some((i) => i === "pytest" || i.startsWith("pytest.")) ||
        entry?.symbols.some((s) => s.nombre.startsWith("test_"))
      )
        pytest.push(f);
    }
    if (pytest.length)
      commands.push({
        file: python,
        args: ["-m", "pytest", "-q", ...pytest],
        env,
      });
  }
  return [...commands, ...explicit];
}
