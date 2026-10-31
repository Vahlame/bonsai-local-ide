import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1';
const DATA_FILE = path.join(__dirname, 'data.json');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json'
};

function readTasks() {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function writeTasks(tasks) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2), 'utf-8');
}

function createTask(title, status = 'todo', priority = 'medium') {
  return {
    id: crypto.randomUUID(),
    title,
    status,
    priority,
    createdAt: new Date().toISOString()
  };
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // Serve static files
  if (pathname === '/' || pathname === '/index.html') {
    const filePath = path.join(__dirname, 'public', 'index.html');
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  if (pathname.startsWith('/public/')) {
    const filePath = path.join(__dirname, pathname);
    const ext = path.extname(filePath);
    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
    return;
  }

  // API Routes
  const apiPrefix = '/api';
  if (pathname.startsWith(apiPrefix)) {
    const apiPath = pathname.slice(apiPrefix.length);

    // GET /api/tasks
    if (req.method === 'GET' && apiPath === '/tasks') {
      const tasks = readTasks();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tasks));
      return;
    }

    // GET /api/stats
    if (req.method === 'GET' && apiPath === '/stats') {
      const tasks = readTasks();
      const stats = {
        todo: tasks.filter(t => t.status === 'todo').length,
        doing: tasks.filter(t => t.status === 'doing').length,
        done: tasks.filter(t => t.status === 'done').length,
        total: tasks.length
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
      return;
    }

    // POST /api/tasks
    if (req.method === 'POST' && apiPath === '/tasks') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { title, status, priority } = JSON.parse(body || '{}');
          if (!title) throw new Error('Title is required');
          
          const tasks = readTasks();
          const newTask = createTask(title, status || 'todo', priority || 'medium');
          tasks.push(newTask);
          writeTasks(tasks);
          
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(newTask));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // PATCH /api/tasks/:id
    if (req.method === 'PATCH' && apiPath.startsWith('/tasks/')) {
      const id = apiPath.split('/')[2];
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const updates = JSON.parse(body || '{}');
          const tasks = readTasks();
          const index = tasks.findIndex(t => t.id === id);
          
          if (index === -1) {
            res.writeHead(404);
            res.end('Not Found');
            return;
          }

          // Validate status if provided
          if (updates.status && !['todo', 'doing', 'done'].includes(updates.status)) {
            throw new Error('Invalid status');
          }

          tasks[index] = { ...tasks[index], ...updates };
          writeTasks(tasks);
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(tasks[index]));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // DELETE /api/tasks/:id
    if (req.method === 'DELETE' && apiPath.startsWith('/tasks/')) {
      const id = apiPath.split('/')[2];
      const tasks = readTasks();
      const newTasks = tasks.filter(t => t.id !== id);
      
      if (tasks.length === newTasks.length) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      
      writeTasks(newTasks);
      res.writeHead(204);
      res.end();
      return;
    }
  }

  // 404 for everything else
  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}/`);
});
