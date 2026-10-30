/**
 * Pruebas de la memoria global entre chats: persistencia atómica, deduplicación,
 * presupuesto, relevancia, edición/borrado, detección de secretos y extracción
 * conservadora. No necesita GPU ni servidor.
 *
 *   node chat/prueba-memoria-global.mjs
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BonsaiChat } from "./bonsai-chat.mjs";
import { estimateTokens, selectContext, systemText } from "./context.mjs";
import { candidatosDeMemoria, crearMemoriaGlobal } from "./memoria-global.mjs";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bonsai-memoria-global-"));
try {
  const mg = crearMemoriaGlobal({ stateDir: temp });
  assert.equal(mg.total, 0);
  assert.ok(mg.archivo.startsWith(temp), "el archivo debe vivir en el estado temporal");
  assert.ok(!fs.existsSync(mg.archivo), "no debe crear archivo hasta la primera nota");

  const preferencia = mg.agregar("Prefiero TypeScript y pruebas con node:test en este proyecto.", {
    tags: ["preferencias", "typescript"],
  });
  assert.equal(mg.total, 1);
  assert.ok(fs.existsSync(mg.archivo), "la primera nota debe persistirse");
  const duplicada = mg.agregar("prefiero   typescript y pruebas con node:test en este proyecto", {
    tags: ["dup"],
  });
  assert.equal(duplicada.duplicada, true);
  assert.equal(mg.total, 1, "la deduplicación no debe crear otra nota");
  assert.ok(duplicada.tags.includes("dup"), "las etiquetas nuevas se fusionan");

  const fijada = mg.agregar("El proyecto usa pnpm y nunca npm.", { fijada: true, tags: ["paquetes"] });
  mg.agregar("La base de datos de producción es PostgreSQL 16.", { tags: ["db"] });

  // Relevancia: solo lo que comparte palabras con el pedido (más las fijadas).
  const seleccion = mg.seleccionar("¿Cómo instalo una dependencia con pnpm en este proyecto?", { presupuesto: 480 });
  assert.ok(seleccion.texto.includes("pnpm"), "debe incluir la nota relevante");
  assert.ok(!seleccion.texto.includes("PostgreSQL"), "no debe inyectar una nota no relacionada");
  assert.ok(seleccion.tokens <= 480);
  assert.ok(seleccion.entradas.includes(fijada.id), "las fijadas viajan siempre");

  const soloFijadas = mg.seleccionar("hola", { presupuesto: 480 });
  assert.ok(soloFijadas.texto.includes("pnpm"));
  assert.ok(!soloFijadas.texto.includes("PostgreSQL"));
  assert.ok(soloFijadas.entradas.length < mg.total, "un saludo no debe inyectar toda la memoria");

  assert.equal(mg.seleccionar("pnpm", { presupuesto: 0 }).texto, "", "presupuesto 0 apaga la inyección");

  // Presupuesto: aunque haya muchas notas relevantes, el bloque no se pasa.
  for (let i = 0; i < 8; i += 1) {
    mg.agregar(`Tema ${i}: en este proyecto usamos la convención de nombres número ${i} para los módulos internos y sus pruebas.`, {
      tags: ["tema", `tema-${i}`],
    });
  }
  const ajustado = mg.seleccionar("tema convención módulos internos", { presupuesto: 160 });
  assert.ok(ajustado.tokens <= 160, `el bloque debe caber: ${ajustado.tokens} > 160`);
  assert.ok(ajustado.entradas.length < mg.total, "el presupuesto debe recortar notas");

  // Editar, fijar y borrar.
  const editada = mg.editar(fijada.id, { texto: "El proyecto usa pnpm; npm está prohibido.", fijada: false, tags: ["paquetes", "regla"] });
  assert.equal(editada.fijada, false);
  assert.ok(editada.tags.includes("regla"));
  assert.ok(mg.listar().some((entrada) => entrada.id === fijada.id && /npm/.test(entrada.texto)));
  assert.equal(mg.borrar(editada.id), true);
  assert.equal(mg.obtener(editada.id), null);
  assert.equal(mg.borrar("mg_no_existe_000000"), false);

  // Persistencia entre instancias (simula reiniciar el IDE).
  const antes = mg.total;
  const otra = crearMemoriaGlobal({ stateDir: temp });
  assert.equal(otra.total, antes, "las notas deben sobrevivir al reinicio");

  // Corrupción: se conserva aparte, se arranca vacío y se puede volver a escribir.
  // Se quita también el .bak para probar el caso sin respaldo válido.
  fs.rmSync(`${mg.archivo}.bak`, { force: true });
  fs.writeFileSync(mg.archivo, "{ esto no es json", "utf8");
  const recuperada = crearMemoriaGlobal({ stateDir: temp });
  assert.equal(recuperada.total, 0);
  assert.match(String(recuperada.resumen().aviso), /ilegible/);
  assert.ok(fs.readdirSync(temp).some((nombre) => nombre.includes(".corrupto-")), "el archivo malo debe conservarse aparte");
  recuperada.agregar("Decidimos usar SQLite para el estado local.", { fijada: true });
  assert.equal(recuperada.total, 1);

  // Secretos: no se guardan.
  assert.throws(() => recuperada.agregar("La api key = sk-abcdefghijklmnopqrstuv"), /secreto/);
  assert.throws(() => recuperada.agregar("x"), /corta/);

  // Extracción conservadora: preferencias sí; órdenes del turno y preguntas no.
  const candidatos = candidatosDeMemoria("Recuerda que prefiero TypeScript. Arregla el botón ahora. Mi nombre es Ana y trabajo en Acme. ¿Cuál es el test?");
  assert.ok(candidatos.some((texto) => /TypeScript/i.test(texto)), JSON.stringify(candidatos));
  assert.ok(candidatos.some((texto) => /Ana/i.test(texto)), JSON.stringify(candidatos));
  assert.ok(!candidatos.some((texto) => /botón/i.test(texto)), "una orden transitoria no es memoria");
  assert.ok(!candidatos.some((texto) => /test\?/i.test(texto)), "una pregunta no es memoria");
  assert.equal(candidatosDeMemoria("corrige el test y ejecuta npm test").length, 0);
  assert.equal(candidatosDeMemoria("recuerda que mi token = abcdef123456").length, 0, "un secreto no se captura");

  // Integración con el mensaje de sistema y con el presupuesto del chat.
  const bloque = recuperada.seleccionar("SQLite", { presupuesto: 480 }).texto;
  assert.match(bloque, /MEMORIA GLOBAL/);
  const sistema = systemText("", "", "", bloque);
  assert.match(sistema, /MEMORIA GLOBAL/);
  assert.match(sistema, /SQLite/);
  const plan = selectContext({
    turns: [{ role: "user", content: "¿Qué base de datos usamos?" }],
    memory: "",
    historyCap: 5000,
    countText: estimateTokens,
    globalMemory: bloque,
  });
  assert.match(plan.messages[0].content, /MEMORIA GLOBAL/);

  const chat = new BonsaiChat({ host: "127.0.0.1", port: 1, historyCap: 4096, timingsPath: null });
  chat.globalMemory = bloque;
  chat.globalMemoryIds = ["mg_prueba"];
  chat.globalMemoryBudget = 480;
  const snapshot = chat.budgetSnapshot(100);
  assert.equal(snapshot.globalMemoryBudget, 480);
  assert.ok(snapshot.globalMemoryTokens > 0);
  assert.equal(snapshot.globalMemoryEntries, 1);

  console.log(`memoria global ok: ${recuperada.total} nota(s), bloque de ${estimateTokens(bloque)} tok, presupuesto 480`);
} finally {
  assert.ok(temp.startsWith(os.tmpdir()));
  fs.rmSync(temp, { recursive: true, force: true });
}
