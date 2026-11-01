import { createServer } from 'node:http';
import { readFile, writeFile, promises as fsPromises } from 'node:fs';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileURLToPath as getFileURL } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataFile = join(__dirname, 'tasks.json');
let tasks = [];
async function loadTasks() {
  try {
    const data = await fsPromises.readFile(dataFile, 'utf-8');
    tasks = JSON.parse(data);
  } catch (e) {
    if (e.code === 'ENOENT') {
      tasks = [];
      await fsPromises.writeFile(dataFile, '[]', 'utf-8');
    } else {
      console.error('Error loading tasks:', e);
      tasks = [];
    }
  }
}
async function saveTasks() {
  await fsPromises.writeFile(dataFile, JSON.stringify(tasks, null, 2), 'utf-8');
}
function generateId() {
  return tasks.length > 0 ? Math.max(...tasks.map(t => t.id)) + 1 : 1;
}
async function handleApi(req, res) {
  const { method, url } = req;
  const urlObj = new URL(url, `http://${req.headers.host}`);
  if (urlObj.pathname !== '/api/tasks') {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  if (body) {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  if (method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(tasks));
  } else if (method === 'POST') {
    const { title } = body;
    if (!title) {
      res.writeHead(400);
      res.end('Title required');
      return;
    }
    const newTask = { id: generateId(), title, completed: false };
    tasks.push(newTask);
    await saveTasks();
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(newTask));
  } else if (method === 'PATCH') {
    const { id, completed } = body;
    const task = tasks.find(t => t.id === id);
    if (!task) {
      res.writeHead(404);
      res.end('Task not found');
      return;
    }
    if (typeof completed === 'boolean') task.completed = completed;
    await saveTasks();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(task));
  } else if (method === 'DELETE') {
    const { id } = body;
    const index = tasks.findIndex(t => t.id === id);
    if (index === -1) {
      res.writeHead(404);
      res.end('Task not found');
      return;
    }
    tasks.splice(index, 1);
    await saveTasks();
    res.writeHead(200);
    res.end('Deleted');
  } else {
    res.writeHead(405);
    res.end('Method Not Allowed');
  }
}
async function serveStatic(req, res) {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  let path = urlObj.pathname;
  if (path === '/') path = '/index.html';
  const filePath = join(__dirname, path);
  const ext = extname(filePath);
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json'
  };
  const type = mimeTypes[ext] || 'application/octet-stream';
  try {
    const data = await fsPromises.readFile(filePath);
    res.writeHead(200, { 'Content-Type': type });
    res.end(data);
  } catch (e) {
    res.writeHead(404);
    res.end('Not Found');
  }
}
export async function startServer(port = 3000) {
  await loadTasks();
  const server = createServer(async (req, res) => {
    if (req.url.startsWith('/api/')) {
      await handleApi(req, res);
    } else {
      await serveStatic(req, res);
    }
  });
  await new Promise(resolve => server.listen(port, resolve));
  console.log(`Server running on http://localhost:${port}`);
  return server;
}
export function stopServer(server) {
  return new Promise(resolve => server.close(resolve));
}
// If run directly, start server
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
