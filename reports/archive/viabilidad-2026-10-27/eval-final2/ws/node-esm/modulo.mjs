export function slugify(texto) {
  if (texto == null) return '';

  // 1. Normalizar acentos (á -> a) y a minúsculas.
  let slug = String(texto)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  // 2. Cualquier carácter no alfanumérico (ni ñ, ni espacio) se convierte en guión.
  slug = slug.replace(/[^a-z0-9ñ-]/gi, '-');

  // 3. Colapsar guiones/espacios repetidos en uno solo.
  slug = slug.replace(/[\s-]+/g, '-');

  // 4. Eliminar guiones al inicio y al final (sin depender de String.trim('-')).
  while (slug.startsWith('-')) slug = slug.slice(1);
  while (slug.endsWith('-')) slug = slug.slice(0, -1);

  return slug;
}
