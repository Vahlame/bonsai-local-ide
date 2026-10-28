/**
 * Pruebas de seguridad del renderizador de Markdown (BUG-07):
 *   node chat/prueba-markdown-seguro.mjs
 *
 *  1. Las URLs de los enlaces solo pueden ser http/https y no pueden meter comillas
 *     ni entidades que decodifiquen a comillas dentro de `href="..."`.
 *  2. El RegExp de cierre de fence se compila una vez por bloque, no por cada linea.
 *
 * No necesita navegador ni GPU: solo el modulo chat/ui/markdown.js.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Md = require("./ui/markdown.js");

/** Todos los `<a ...>` del HTML generado. */
const anclas = (html) => [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
const hrefDe = (tag) => /** @type {RegExpMatchArray} */ (tag.match(/href="([^"]*)"/))[1];

/**
 * Todo enlace generado debe ser exactamente `<a href="..." target="_blank"
 * rel="noreferrer noopener">`, sin comillas ni entidades de comilla en el href.
 * @param {string} caso
 * @param {string} html
 * @param {number} permitidos
 */
function comprobarAnclas(caso, html, permitidos) {
  const tags = anclas(html);
  assert.equal(tags.length, permitidos, `${caso}: numero de enlaces`);
  for (const tag of tags) {
    assert.match(tag, /^<a href="[^"]*" target="_blank" rel="noreferrer noopener">$/, `${caso}: atributos inesperados en ${tag}`);
    assert.doesNotMatch(hrefDe(tag), /&(?:quot|#0*34|#x0*22|#0*39|#x0*27|apos);/i, `${caso}: entidad de comilla en el href`);
    assert.doesNotMatch(hrefDe(tag), /["'<>]/, `${caso}: comilla o etiqueta cruda en el href`);
  }
}

// ------------------------------------------------- inyeccion de atributos
{
  // El vector descrito: la comilla del texto Markdown acaba (escapada) dentro del href.
  const inyeccion = `[clic](https://example.com/"onmouseover="alert(1))`;
  const h = Md.render(inyeccion);
  comprobarAnclas("URL con comillas dobles", h, 0);
  assert.doesNotMatch(h, /<a[^>]*onmouseover/i, "no se crea un enlace con onmouseover");
  assert.doesNotMatch(h, /<[^>]*\sonmouseover\s*=/i, "no aparece un atributo onmouseover");

  // El mismo intento con entidades ya escritas por el usuario: `esc()` las vuelve a
  // escapar (`&amp;quot;`), asi que solo decodifican UNA vez y no son una comilla
  // real; el enlace puede existir pero el atributo tiene que quedar bien formado.
  for (const url of [`https://a.com/&quot;onload=&quot;x`, `https://a.com/&#34;onload=&#34;x`, `https://a.com/&#x22;onload=&#x22;x`]) {
    const r = Md.render(`[x](${url})`);
    comprobarAnclas(`URL con entidad (${url})`, r, 1);
    assert.doesNotMatch(hrefDe(anclas(r)[0]), /&quot;|&#34;|&#x22;/i, "el href no contiene una comilla decodificable");
  }

  // Comilla simple y etiquetas dentro del texto del enlace: el label se escapa.
  const label = Md.render(`[<img src=x onerror=alert(1)>](https://ok.example/)`);
  comprobarAnclas("label con HTML", label, 1);
  assert.doesNotMatch(label, /<img/i, "el label no inyecta HTML");

  // URL suelta (autolink) con comillas: tampoco puede acabar en un atributo roto.
  comprobarAnclas("URL suelta con comillas", Md.render(`mira https://a.com/"onmouseover="alert(1) ya`), 0);

  // Esquemas peligrosos: ni siquiera se convierten en enlace.
  for (const url of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "file:///C:/Windows/win.ini"]) {
    const r = Md.render(`[x](${url})`);
    comprobarAnclas(`esquema peligroso (${url.split(":")[0]})`, r, 0);
    assert.doesNotMatch(r, /href="(?:javascript|data|vbscript|file):/i);
  }

  // Un enlace normal http/https sigue saliendo igual (incluido & en la query).
  const normal = Md.render("[ok](https://example.com/a?b=1&c=2)");
  comprobarAnclas("enlace normal", normal, 1);
  assert.equal(hrefDe(anclas(normal)[0]), "https://example.com/a?b=1&amp;c=2");
  comprobarAnclas("enlace http", Md.render("[ok](http://example.com/x)"), 1);

  // El HTML crudo sigue escapado.
  const crudo = Md.render("<script>alert(1)</script> y <img src=x onerror=alert(1)>");
  assert.doesNotMatch(crudo, /<script|<img/i);
}

// ------------------------------------------------- fences de codigo
{
  // Fences anidados: un bloque de 4 backticks contiene lineas de 3 backticks.
  const anidado = Md.render("````markdown\n```js\nconsole.log(1)\n```\n````\nfin");
  assert.equal((anidado.match(/class="md-code"/g) || []).length, 1, "un solo bloque de codigo");
  assert.match(anidado, /console\.log/);
  assert.match(anidado, /<p>fin<\/p>/);

  // Fences de tildes y cierre con mas marcas de las de apertura.
  for (const bloque of ["~~~\ncodigo\n~~~", "```\ncodigo\n````", "~~~~\ncodigo\n~~~~~"]) {
    const r = Md.render(bloque);
    assert.equal((r.match(/class="md-code"/g) || []).length, 1, `un bloque para ${JSON.stringify(bloque.slice(0, 4))}`);
    assert.match(r, /codigo/);
  }

  // Respuesta aun en streaming (sin cierre): el bloque se renderiza igual.
  const sinCierre = Md.render("```\nsin terminar");
  assert.equal((sinCierre.match(/class="md-code"/g) || []).length, 1);

  // Inyeccion en el lenguaje del fence.
  const langRaro = Md.render('```"onmouseover="x\ncode\n```');
  assert.doesNotMatch(langRaro, /onmouseover/i);

  // BUG-07 (parte 2): el RegExp de cierre NO se compila en cada iteracion del while.
  // Se cuentan las llamadas a `new RegExp` durante el render de un bloque de 40 lineas.
  const RegExpReal = globalThis.RegExp;
  let compiladas = 0;
  // @ts-ignore - sustituto de RegExp para contar instancias
  globalThis.RegExp = function (...args) {
    compiladas += 1;
    return new RegExpReal(...args);
  };
  let largo;
  try {
    largo = Md.render("```js\n" + Array.from({ length: 40 }, (_, i) => `const x${i} = ${i};`).join("\n") + "\n```");
  } finally {
    globalThis.RegExp = RegExpReal;
  }
  assert.match(largo, /x0/);
  assert.match(largo, /x39/);
  assert.ok(compiladas <= 1, `el cierre de fence se compila por bloque, no por linea (compiladas=${compiladas})`);
}

console.log("prueba markdown seguro ok");
