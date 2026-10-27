/**
 * Descarga Inter y JetBrains Mono (licencia OFL) y las deja servidas en local.
 *   node chat/ui/fuentes/bajar-fuentes.mjs
 *
 * Por que un script y no un <link> a Google: la app tiene que funcionar sin internet.
 * Este script es la unica parte que necesita red, y solo se corre cuando se quiere
 * actualizar o cambiar una tipografia. Deja los .woff2 y un fuentes.css con rutas
 * relativas, que es lo que carga index.html.
 *
 * Solo baja los subsets `latin` y `latin-ext` (con eso el espanol queda cubierto y
 * no se descargan cirilico/griego/vietnamita, que triplicarian el peso).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

// Google devuelve woff2 solo si el User-Agent es de un navegador moderno.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const FAMILIAS = [
  { nombre: "Inter", slug: "inter", pesos: "400..700", uso: "texto de la interfaz" },
  { nombre: "JetBrains Mono", slug: "jetbrains-mono", pesos: "400..600", uso: "codigo y numeros" },
];
// El subset `latin` de Google cubre TODO el espanol (la ñ, las tildes y los signos
// de apertura estan en U+0000-00FF). `latin-ext` solo anade baltico/turco/vietnamita
// y cuesta 94 KB mas: no se baja.
const SUBSETS = ["latin"];

/**
 * @param {string} url
 * @returns {Promise<string>}
 */
async function traer(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  return r.text();
}

/**
 * Parte el CSS de Google en bloques por subset usando los comentarios `/* latin *\/`.
 * @param {string} css
 * @returns {{subset: string, bloque: string}[]}
 */
function porSubset(css) {
  const out = [];
  const partes = css.split(/\/\*\s*([a-z0-9-]+)\s*\*\//i);
  for (let i = 1; i < partes.length; i += 2) {
    out.push({ subset: partes[i].trim(), bloque: partes[i + 1] || "" });
  }
  return out;
}

let cssSalida = `/* Generado por bajar-fuentes.mjs el ${new Date().toISOString().slice(0, 10)}.
   Inter y JetBrains Mono, SIL Open Font License 1.1. Servidas en local: sin CDN. */

`;

let bajados = 0;
for (const fam of FAMILIAS) {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fam.nombre).replace(/%20/g, "+")}:wght@${fam.pesos}&display=swap`;
  const css = await traer(url);
  for (const { subset, bloque } of porSubset(css)) {
    if (!SUBSETS.includes(subset)) continue;
    const m = bloque.match(/src:\s*url\((https:\/\/[^)]+\.woff2)\)/);
    if (!m) continue;
    const destino = `${fam.slug}-${subset}.woff2`;
    // El estado HTTP SÍ se comprueba: antes un 404/403 se guardaba como .woff2, se contaba
    // como éxito y la app se quedaba con una fuente corrupta sin decir nada.
    const res = await fetch(m[1], { headers: { "User-Agent": UA } });
    if (!res.ok) {
      console.error(`FALLO ${destino}: HTTP ${res.status}`);
      continue;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(path.join(AQUI, destino), bytes);
    bajados += 1;

    const peso = (bloque.match(/font-weight:\s*([^;]+);/) || [, "400"])[1].trim();
    const estilo = (bloque.match(/font-style:\s*([^;]+);/) || [, "normal"])[1].trim();
    const rango = (bloque.match(/unicode-range:\s*([^;]+);/) || [, ""])[1].trim();
    cssSalida += `@font-face {
  font-family: "${fam.nombre}";
  font-style: ${estilo};
  font-weight: ${peso};
  font-display: swap;
  src: url("./${destino}") format("woff2");
${rango ? `  unicode-range: ${rango};\n` : ""}}

`;
    console.log(`${destino.padEnd(28)} ${(bytes.length / 1024).toFixed(0).padStart(5)} KB  (${fam.uso})`);
  }
}

// El CSS se escribe DESPUÉS de comprobar que se bajó algo: antes se sobrescribía primero y, si
// Google cambiaba el formato, la app se quedaba sin @font-face y con el CSS bueno perdido.
if (!bajados) {
  console.error("No se bajo nada: se deja el fuentes.css que ya habia (revisa la red o el formato de Google Fonts).");
  process.exit(1);
}
fs.writeFileSync(path.join(AQUI, "fuentes.css"), cssSalida);
console.log(`\n${bajados} archivos + fuentes.css`);
