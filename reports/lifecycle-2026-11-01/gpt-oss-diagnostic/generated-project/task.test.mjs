import { test, expect } from 'node:test';
import { startServer, stopServer } from './server.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataFile = join(dirname(fileURLToPath(import.meta.url)), 'tasks.json');
// helper to reset tasks file
async function resetTasks() {
  await writeFile(dataFile, '[]', 'utf-8');
}

beforeAll(async () => {
  await resetTasks();
  global.server = await startServer(0); // use random port
});

afterAll(async () => {
  await stopServer(global.server);
});

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  return { status: res.status, data };
}

const baseUrl = `http://localhost:${global.server.address().port}`;

test('create task', async () => {
  const { status, data } = await fetchJson(`${baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Test task' })
  });
  expect(status).toBe(201);
  expect(data).toHaveProperty('id');
  expect(data.title).toBe('Test task');
  expect(data.completed).toBe(false);
});

test('list tasks', async () => {
  const { status, data } = await fetchJson(`${baseUrl}/api/tasks`);
  expect(status).toBe(200);
  expect(data).toBeInstanceOf(Array);
  expect(data.length).toBe(1);
  expect(data[0].title).toBe('Test task');
});

test('complete task', async () => {
  // get the task id
  const { data: list } = await fetchJson(`${baseUrl}/api/tasks`);
  const id = list[0].id;
  const { status, data } = await fetchJson(`${baseUrl}/api/tasks`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, completed: true })
  });
  expect(status).toBe(200);
  expect(data.completed).toBe(true);
});

test('delete task', async () => {
  const { data: list } = await fetchJson(`${baseUrl}/api/tasks`);
  const id = list[0].id;
  const { status } = await fetchJson(`${baseUrl}/api/tasks`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  });
  expect(status).toBe(200);
  const { status: status2, data: list2 } = await fetchJson(`${baseUrl}/api/tasks`);
  expect(list2.length).toBe(0);
});
