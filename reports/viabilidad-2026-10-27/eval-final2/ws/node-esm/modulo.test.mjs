import test from 'node:test';
import assert from 'node:assert/strict';
import { slugify } from './modulo.mjs';

test('devuelve vacío para entradas vacías o no válidas', () => {
  assert.equal(slugify(''), '');
  assert.equal(slugify(null), '');
  assert.equal(slugify(undefined), '');
  assert.equal(slugify(123), '123');
});

test('pasa a minúsculas', () => {
  assert.equal(slugify('Hello World'), 'hello-world');
  assert.equal(slugify('HELLO'), 'hello');
});

test('reemplaza espacios por guiones', () => {
  assert.equal(slugify('Mi Primera Frase'), 'mi-primera-frase');
  assert.equal(slugify('a\tb\n  c'), 'a-b-c');
});

test('elimina signos de puntuación', () => {
  assert.equal(slugify('¡Hola, Mundo!'), 'hola-mundo');
  assert.equal(slugify('Café: 2024. #1'), 'cafe-2024-1');
  assert.equal(slugify('¿Qué tal?'), 'que-tal');
});

test('colapsa múltiples espacios/símbolos en un solo guion', () => {
  assert.equal(slugify('  spaced   out  '), 'spaced-out');
  assert.equal(slugify('a!@#b'), 'a-b');
});

test('no deja guiones al principio ni al final', () => {
  assert.equal(slugify('!!!bang'), 'bang');
  assert.equal(slugify('bang!!!'), 'bang');
  assert.equal(slugify('---texto---'), 'texto');
});

test('normaliza acentos', () => {
  assert.equal(slugify('Crème Brûlée'), 'creme-brulee');
  assert.equal(slugify('naïve résumé'), 'naive-resume');
});
