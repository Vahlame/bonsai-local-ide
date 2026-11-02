/** Pruebas de las funciones de texto extraídas a chat/server/text.mjs. */
import assert from "node:assert/strict";
import { AVISO_SEGUIR, anunciaAccion, chatTitle, clipText, hiddenTurn, looksLikeEdit, resumenDeAcciones } from "./server/text.mjs";

assert.equal(clipText("", 10), "(sin salida)");
assert.equal(clipText("hola   ", 10), "hola");
assert.equal(clipText("x".repeat(20), 10), `${"x".repeat(10)}\n…`);

assert.equal(looksLikeEdit("cambia el color"), true);
assert.equal(looksLikeEdit("explica el archivo"), false);

assert.equal(anunciaAccion("Voy a leer el archivo."), true);
assert.equal(anunciaAccion("Déjame comprobar."), true);
assert.equal(anunciaAccion("Voy a leer, ¿qué prefieres?"), false, "una pregunta no es un anuncio pendiente");
assert.equal(anunciaAccion("Hecho. Ahora calcula el total."), false);
assert.equal(anunciaAccion("x".repeat(400)), false);

assert.equal(hiddenTurn({ role: "tool", content: "resultado" }), true);
assert.equal(hiddenTurn({ role: "user", content: AVISO_SEGUIR }), true);
assert.equal(hiddenTurn({ role: "user", content: "pedido real" }), false);

const resumen = resumenDeAcciones([
  { role: "user", content: "hazlo" },
  { role: "assistant", content: "", actions: [
    { kind: "read", title: "a.txt", state: "done" },
    { kind: "write", title: "b.txt", state: "done" },
    { kind: "cmd", title: "npm test", state: "done", code: 1 },
    { kind: "write", title: "ignorado.txt", state: "denied" },
  ] },
]);
assert.match(resumen, /leí `a\.txt`/);
assert.match(resumen, /guardé `b\.txt`/);
assert.match(resumen, /ejecuté `npm test` \(código 1\)/);
assert.doesNotMatch(resumen, /ignorado/);
assert.match(resumenDeAcciones([{ role: "user", content: "nada" }]), /No llegué a terminar/);

assert.equal(chatTitle({ turns: [{ role: "tool", content: "x" }, { role: "user", content: "  Primera   pregunta  " }] }), "Primera pregunta");
assert.equal(chatTitle({ turns: [] }), "Nueva conversación");

console.log("Servidor/text: recortes, anuncios, turnos internos, resumen y título verificados.");
