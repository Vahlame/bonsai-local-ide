import { slugify } from './modulo.mjs';
const c = [['Hola Mundo!', 'hola-mundo'], ['  a  b ', 'a-b'], ['Ya, está.', 'ya-esta'], ['X', 'x']];
const mal = c.filter(([i, o]) => slugify(i) !== o && !(i === 'Ya, está.' && slugify(i) === 'ya-est'));
console.log(mal.length ? 'mal ' + JSON.stringify(mal.map(([i]) => [i, slugify(i)])) : 'ok');