import assert from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { startServer } from '../server.mjs';
import { rm, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname } from 'node:path';

// Helper to clear data file
const dataFile = fileURLToPath(new URL('../data.json', import.meta.url));

async function clearDataFile() {
  try {
    await rm(dataFile, { force: true });
  } catch (e) {}
}

describe('Task API', () => {
  let server;
  let port;
  before(async () => {
    await clearDataFile();
    server = await startServer(0); // 0 -> random port
    port = server.address().port;
  });

  after(() => {
    server.close();
    return clearDataFile();
  });

  it('should create a new task', async () => {
    const res = await fetch(`http://localhost:${port}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test task' })
    });
    assert.strictEqual(res.status, 201);
    const body = await res.json();
    assert.match(body.id, /[0-9]+/);
    assert.strictEqual(body.title, 'Test task');
    assert.strictEqual(body.completed, false);
  });

  it('should list tasks', async () => {
    const res = await fetch(`http://localhost:${port}/api/tasks`);
    assert.strictEqual(res.status, 200);
    const tasks = await res.json();
    assert(Array.isArray(tasks));
    assert(tasks.length >= 1);
    assert.strictEqual(tasks[0].title, 'Test task');
  });

  it('should complete a task', async () => {
    // get tasks
    const listRes = await fetch(`http://localhost:${port}/api/tasks`);
    const tasks = await listRes.json();
    const taskId = tasks[0].id;
    const res = await fetch(`http://localhost:${port}/api/tasks/${taskId}`, {
      method: 'PATCH'
    });
    assert.strictEqual(res.status, 200);
    const updated = await res.json();
    assert.strictEqual(updated.completed, true);
  });

  it('should delete a task', async () => {
    const listRes = await fetch(`http://localhost:${port}/api/tasks`);
    const tasks = await listRes.json();
    const taskId = tasks[0].id;
    const res = await fetch(`http://localhost:${port}/api/tasks/${taskId}`, {
      method: 'DELETE'
    });
    assert.strictEqual(res.status, 204);
    const afterRes = await fetch(`http://localhost:${port}/api/tasks`);
    const afterTasks = await afterRes.json();
    assert.strictEqual(afterTasks.length, 0);
  });
});
