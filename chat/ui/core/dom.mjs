/** Helpers DOM sin estado: los usan app.js, paneles y el hub. */

/**
 * @param {string} sel
 * @param {ParentNode} [root]
 * @returns {HTMLElement | null}
 */
export const $ = (sel, root = document) => /** @type {HTMLElement | null} */ (root.querySelector(sel));

/**
 * @param {string} sel
 * @param {ParentNode} [root]
 * @returns {HTMLElement[]}
 */
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * @param {string} tag
 * @param {string} [cls]
 * @param {string} [texto]
 * @returns {HTMLElement}
 */
export function el(tag, cls, texto) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (texto !== undefined) n.textContent = texto;
  return n;
}
