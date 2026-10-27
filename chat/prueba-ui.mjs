/**
 * Pruebas de los módulos de la interfaz que no necesitan navegador ni GPU:
 *   node chat/prueba-ui.mjs
 * Markdown (escape, bloques, listas, tablas, código en streaming) y resaltado de código.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Md = require("./ui/markdown.js");

/** @type {string[]} */
const failures = [];
/**
 * @param {string} name
 * @param {boolean} cond
 */
const check = (name, cond) => {
  if (!cond) failures.push(name);
};

const textOf = (html) => html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

// --- seguridad: nada de HTML crudo ni enlaces peligrosos
{
  const h = Md.render("<script>alert(1)</script> y <img src=x onerror=alert(1)>");
  check("escapa script", !h.includes("<script") && h.includes("&lt;script&gt;"));
  check("escapa img con onerror", !h.includes("<img"));
  const l = Md.render("[clic](javascript:alert(1)) [ok](https://example.com/a?b=1&c=2)");
  check("no crea enlaces javascript:", !/href="javascript/i.test(l));
  check("sí crea enlaces https seguros", /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noreferrer noopener">ok<\/a>/.test(l));
  check("escapa comillas en atributos de lenguaje", !Md.render("```\"onmouseover=\"x\ncode\n```").includes('onmouseover="x"'));
}

// --- bloques
{
  const h = Md.render("# Título\n\nUn **negrita**, *cursiva*, `código` y ~~tachado~~.\n\n- uno\n- dos\n  - hijo\n- tres\n\n3. tercero\n4. cuarto\n\n> cita\n\n---\n");
  check("encabezado", h.includes("<h1>Título</h1>"));
  check("negrita y cursiva", h.includes("<strong>negrita</strong>") && h.includes("<em>cursiva</em>"));
  check("código en línea", h.includes("<code>código</code>"));
  check("tachado", h.includes("<del>tachado</del>"));
  check("lista con sublista", /<ul><li>uno<\/li><li>dos<ul><li>hijo<\/li><\/ul><\/li><li>tres<\/li><\/ul>/.test(h));
  check("lista ordenada que empieza en 3", h.includes('<ol start="3"><li>tercero</li><li>cuarto</li></ol>'));
  check("cita y regla", h.includes("<blockquote><p>cita</p></blockquote>") && h.includes("<hr>"));
  check("saltos de línea en un párrafo", Md.render("a\nb").includes("<p>a<br>b</p>"));
}
{
  const t = Md.render("| a | b |\n|---|:-:|\n| 1 | **2** |\n| 3 |\n");
  check("tabla", t.includes("<th>a</th><th>b</th>") && t.includes("<td>1</td><td><strong>2</strong></td>") && t.includes("<td>3</td><td></td>"));
  check("la tabla va en su contenedor", t.includes('class="md-table"'));
}

// --- código
{
  const h = Md.render("Mira:\n\n```python\ndef suma(a, b):\n    # suma\n    return a + b  # 3 < 5 && x\n```\nfin");
  check("bloque de código con lenguaje", h.includes('class="md-code"') && h.includes('data-lang="python"'));
  check("palabras clave resaltadas", h.includes('<span class="t-kw">def</span>') && h.includes('<span class="t-kw">return</span>'));
  check("comentario resaltado y escapado", h.includes('<span class="t-cm"># 3 &lt; 5 &amp;&amp; x</span>') || h.includes("&lt; 5 &amp;&amp; x"));
  check("la función se marca", h.includes('<span class="t-fn">suma</span>'));
  check("botón copiar", h.includes('data-act="copy"'));
  check("el texto de después sigue", h.endsWith("<p>fin</p>"));
  check("el código conserva su texto", textOf(h.match(/<pre><code>([\s\S]*?)<\/code><\/pre>/)[1]) === "def suma(a, b):\n    # suma\n    return a + b  # 3 < 5 && x");
}
{
  const abierto = Md.render("Aquí va:\n```js\nconst x = 1;\nconsole.log(x");
  check("bloque sin cerrar (streaming) se muestra como código", abierto.includes('data-lang="js"') && abierto.includes("console"));
  check("fence con tildes", Md.render("~~~\nlinea\n~~~").includes('class="md-code"'));
  check("fence largo no se cierra con uno corto", Md.render("````\n```\ndentro\n```\n````").includes("dentro"));
}

// --- resaltado: el texto original no se pierde nunca
{
  const muestras = {
    js: "// hola\nconst a = `x ${1}`;\nfunction f(x) { return x >= 10 ? 'a' : \"b\\\"c\"; }\n/* fin */ class Foo extends Bar {}\n",
    py: "@dec\nclass A:\n    '''doc'''\n    def f(self, x=1.5):\n        return f\"{x}\" if x else None\n# c\n",
    json: "{\"a\": [1, 2.5e3, true, null], \"b\": {\"c\": \"d\"}}",
    html: "<!doctype html>\n<!-- c --><div class=\"a\" id='b'>hola <b>x</b></div>\n<script>const a = 1; // js\n</script><style>p { color: #fff; margin: 0 4px }</style><br/>",
    css: "@media (max-width: 600px) { .a > b, #c::after { margin: -2px 1.5rem; color: #1a2b3c } } /* x */",
    sh: "# c\nGet-ChildItem -Path $env:TEMP -Recurse | Where-Object { $_.Length -gt 5 }\nif [ -f \"$f\" ]; then echo ${x}; fi\n",
    sql: "SELECT a, COUNT(*) FROM t WHERE x = 'o''k' -- c\nGROUP BY a LIMIT 10;\n",
    rust: "fn main() { let mut x: i32 = 5; println!(\"{}\", x); } // fin\n",
  };
  for (const [lang, code] of Object.entries(muestras)) {
    const out = Md.highlight(code, lang);
    check(`resaltado ${lang}: no pierde texto`, textOf(out) === code);
    check(`resaltado ${lang}: algo se resalta`, /<span class="t-/.test(out));
  }
  check("lenguaje desconocido: solo escapa", Md.highlight("<a> & b", "zzz") === "&lt;a&gt; &amp; b");
  check("json distingue claves y valores", Md.highlight(`{"k": "v"}`, "json").includes(`<span class="t-fn">"k"</span>`) && Md.highlight(`{"k": "v"}`, "json").includes(`<span class="t-st">"v"</span>`));
  check("html resalta etiquetas y atributos", Md.highlight('<div class="x">', "html").includes('<span class="t-tag">div</span>') && Md.highlight('<div class="x">', "html").includes('<span class="t-at">class</span>'));
  check("html resalta el JS de <script>", Md.highlight("<script>const a = 1;</script>", "html").includes('<span class="t-kw">const</span>'));
  check("sql no distingue mayúsculas", Md.highlight("select 1 from t", "sql").includes('<span class="t-kw">select</span>'));
  check("powershell resalta cmdlets", Md.highlight("Get-ChildItem", "ps1").includes('<span class="t-fn">Get-ChildItem</span>'));
}

// --- robustez y rendimiento
{
  for (const raro of ["", "```", "```\n", "|", "| a |\n|---|", "- ", "1.", "**", "`", "[", "](", "> ", "#", "\u0000", "x".repeat(5000)]) {
    let ok = true;
    try { Md.render(raro); Md.highlight(raro, "js"); } catch { ok = false; }
    check(`no falla con ${JSON.stringify(raro.slice(0, 12))}`, ok);
  }
  const grande = "const x = 'hola'; // c\nfunction f(a, b) { return a + b; }\n".repeat(4000);
  const t0 = Date.now();
  Md.highlight(grande, "js");
  const ms = Date.now() - t0;
  check(`resalta ${Math.round(grande.length / 1000)} KB en menos de 600 ms (tardó ${ms})`, ms < 600);
  check("más de 300 KB no se resalta (solo se escapa)", !Md.highlight("a".repeat(300_001), "js").includes("<span"));
}

if (failures.length) {
  process.stderr.write(`FALLÓ:\n- ${failures.join("\n- ")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("prueba ui ok\n");
}
