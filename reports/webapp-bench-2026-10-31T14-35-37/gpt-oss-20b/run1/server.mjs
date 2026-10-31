import { createServer } from 'http';
import { readFile, writeFile, access, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DATA_FILE = join(__dirname, 'data.json');
const PUBLIC_DIR = join(__dirname, 'public');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Simple MIME type mapping
const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function ensureDataFile() {
  try {
    await access(DATA_FILE);
  } catch {
    await writeFile(DATA_FILE, '[]', 'utf8');
  }
}

async function loadData() {
  await ensureDataFile();
  const content = await readFile(DATA_FILE, 'utf8');
  try {
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveData(data) {
  await writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getNextId(data) {
  return data.reduce((max, t) => Math.max(max, t.id), 0) + 1;
}

function getStats(data) {
  const stats = { todo: 0, doing: 0, done: 0, total: data.length };
  for (const t of data) {
    if (t.status === 'todo') stats.todo++;
    else if (t.status === 'doing') stats.doing++;
    else if (t.status === 'done') stats.done++;
  }
  return stats;
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const method = req.method;
  const pathname = url.pathname;

  if (pathname === '/api/tasks' && method === 'GET') {
    const data = await loadData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  if (pathname === '/api/tasks' && method === 'POST') {
    const body = await parseBody(req);
    const title = body.title?.trim();
    if (!title) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Title is required' }));
      return;
    }
    const data = await loadData();
    const newTask = {
      id: getNextId(data),
      title,
      status: body.status === 'doing' || body.status === 'done' ? body.status : 'todo',
      priority: typeof body.priority === 'number' ? body.priority : 0,
      createdAt: new Date().toISOString(),
    };
    data.push(newTask);
    await saveData(data);
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(newTask));
    return;
  }

  const taskIdMatch = pathname.match(/^\/api\/tasks\/(\d+)$/);
  if (taskIdMatch) {
    const id = parseInt(taskIdMatch[1], 10);
    const data = await loadData();
    const index = data.findIndex(t => t.id === id);
    if (index === -1) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found' }));
      return;
    }

    if (method === 'PATCH') {
      const body = await parseBody(req);
      const task = data[index];
      if (body.title !== undefined) task.title = body.title.trim();
      if (body.status && ['todo', 'doing', 'done'].includes(body.status)) task.status = body.status;
      if (body.priority !== undefined) task.priority = body.priority;
      await saveData(data);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(task));
      return;
    }

    if (method === 'DELETE') {
      data.splice(index, 1);
      await saveData(data);
      res.writeHead(204);
      res.end();
      return;
    }
  }

  if (pathname === '/api/stats' && method === 'GET') {
    const data = await loadData();
    const stats = getStats(data);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }

  // If no API route matched
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

async function serveStatic(req, res) {
  let pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  if (pathname === '/') pathname = '/index.html';
  const filePath = join(PUBLIC_DIR, pathname);
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
}

const server = createServer(async (req, res) => {
  if (req.url.startsWith('/api/')) {
    await handleApi(req, res);
  } else {
    await serveStatic(req, res);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running at http://127.0.0.1:${PORT}/`);
});
