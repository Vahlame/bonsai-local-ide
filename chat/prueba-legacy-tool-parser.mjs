/** Verifica la fachada legacy, su flag, métricas y fecha de retirada. */
import assert from "node:assert/strict";
import {
  LEGACY_TOOL_PARSER_RETIRO,
  legacyCommands,
  legacyImpliedAction,
  legacyIndexScope,
  legacyReads,
  legacySearches,
  legacyWrites,
  metricasLegacyToolParser,
} from "./legacy-tool-parser.mjs";

const antes = metricasLegacyToolParser();
assert.equal(antes.habilitado, true);
assert.equal(antes.retiro, LEGACY_TOOL_PARSER_RETIRO);
assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(LEGACY_TOOL_PARSER_RETIRO));

assert.deepEqual(legacyCommands("```ejecutar\nnode -e \"console.log(1)\"\n```"), ['node -e "console.log(1)"']);
assert.equal(legacyReads("```leer a.txt```")[0], "a.txt");
assert.equal(legacySearches("```buscar clima```")[0], "clima");
assert.equal(legacyIndexScope("```indice src```"), "src");
assert.equal(legacyImpliedAction("Voy a buscar documentación.").query.length > 0, true);
assert.equal(legacyWrites("```archivo a.txt\nhola\n```", "crea", { soloExplicitas: true })[0].rel, "a.txt");

const despues = metricasLegacyToolParser();
assert.ok(despues.llamadas > antes.llamadas, "las llamadas se cuentan");
assert.ok(despues.resultados > antes.resultados, "los resultados se cuentan");
assert.ok(despues.porHerramienta.commands >= 1);

process.env.BONSAI_LEGACY_TOOL_PARSER = "0";
try {
  assert.equal(metricasLegacyToolParser().habilitado, false);
  assert.deepEqual(legacyCommands("```ejecutar\nnode -e 1\n```"), []);
  assert.deepEqual(legacyReads("```leer a.txt```"), []);
  assert.deepEqual(legacySearches("```buscar clima```"), []);
  assert.equal(legacyIndexScope("```indice src```"), "");
  assert.deepEqual(legacyImpliedAction("Voy a buscar documentación."), { command: "", query: "" });
  assert.ok(metricasLegacyToolParser().bloqueadas >= 5);
} finally {
  delete process.env.BONSAI_LEGACY_TOOL_PARSER;
}

console.log("Legacy parser: flag, métricas y fecha de retirada verificados.");
