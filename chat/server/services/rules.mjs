/**
 * Reglas de proyecto compatibles con Cursor: BONSAI.md, AGENTS.md,
 * .cursorrules y .cursor/rules/*.mdc|*.md.
 *
 * Las rutas pasan siempre por `fileInside` y la lectura está acotada: una regla
 * enlazada fuera del proyecto no se sigue.
 */
import fs from "node:fs";
import path from "node:path";

const MAX_REGLA_BYTES = 128 * 1024;
const MAX_REGLA_TEXTO = 8000;

/**
 * @param {{
 *   getRoot: () => string,
 *   fileInside: (root: string, rel: string) => string | null,
 *   readLimited: (abs: string, limite: number) => {ok: boolean, texto: string},
 *   takeHeadByTokens: (texto: string, tope: number, contar: (texto: string) => number) => string,
 *   estimateTokens: (texto: string) => number,
 *   rulesCapTokens: number,
 * }} ctx
 */
export function createRulesService(ctx) {
  /** @param {string} rel @returns {string} */
  function leerRegla(rel) {
    const abs = ctx.fileInside(ctx.getRoot(), rel);
    if (!abs) return "";
    const leido = ctx.readLimited(abs, MAX_REGLA_BYTES);
    return leido.ok ? leido.texto.slice(0, MAX_REGLA_TEXTO) : "";
  }

  /**
   * @returns {{fuentes: string[], texto: string}}
   */
  function leerReglas() {
    /** @type {string[]} */
    const fuentes = [];
    /** @type {string[]} */
    const trozos = [];
    for (const nombre of ["BONSAI.md", "AGENTS.md", ".cursorrules"]) {
      const txt = leerRegla(nombre);
      if (txt.trim()) {
        trozos.push(`# ${nombre}\n${txt}`);
        fuentes.push(nombre);
      }
    }

    const dirRel = ".cursor/rules";
    const dirAbs = ctx.fileInside(ctx.getRoot(), dirRel);
    let esCarpeta = false;
    try {
      esCarpeta = Boolean(dirAbs) && fs.statSync(/** @type {string} */ (dirAbs)).isDirectory();
    } catch {
      esCarpeta = false;
    }
    if (!esCarpeta) return { fuentes, texto: trozos.join("\n\n") };

    let entradas = [];
    try {
      entradas = fs.readdirSync(/** @type {string} */ (dirAbs), { withFileTypes: true });
    } catch {
      entradas = [];
    }
    for (const e of entradas) {
      if (!/\.(mdc|md)$/i.test(e.name)) continue;
      try {
        let txt = leerRegla(`${dirRel}/${e.name}`);
        if (!txt) continue;
        const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
        let siempre = true;
        if (m) {
          // `alwaysApply: false` sin `globs` => la regla no se aplica sola.
          siempre = !/alwaysApply:\s*false/i.test(m[1]);
          txt = txt.slice(m[0].length);
        }
        if (!siempre || !txt.trim()) continue;
        trozos.push(`# .cursor/rules/${e.name}\n${txt}`);
        fuentes.push(`.cursor/rules/${e.name}`);
      } catch {
        /* ilegible */
      }
    }
    return { fuentes, texto: trozos.join("\n\n") };
  }

  /**
   * Reglas listas para el mensaje de sistema, recortadas al tope. Estables por
   * carpeta: no rompen la caché del prompt entre turnos.
   * @returns {string}
   */
  function reglasParaModelo() {
    const { texto } = leerReglas();
    if (!texto.trim()) return "";
    return ctx.takeHeadByTokens(texto, ctx.rulesCapTokens, ctx.estimateTokens);
  }

  return { leerReglas, reglasParaModelo };
}
