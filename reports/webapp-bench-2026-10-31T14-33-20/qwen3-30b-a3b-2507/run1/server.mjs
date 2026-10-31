import { createServer } from 'http';
import { readFile, writeFile, stat } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 3000;
const DATA_FILE = join(__dirname, 'data.json');

const serveStatic = (path, res) => {
  const filePath = join(__dirname, 'public', path);
  stat(filePath, (err, stats) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(500);
        res.end('Internal server error');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
  });
};

const readTasks = () => {
  return new Promise((resolve, reject) => {
    readFile(DATA_FILE, 'utf8', (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          resolve([]);
        } else {
          reject(err);
        }
      } else {
        try {
          resolve(JSON.parse(data));
        } catch (parseErr) {
          reject(parseErr);
        }
      }
    });
  });
};

const writeTasks = (tasks) => {
  return new Promise((resolve, reject) => {
    writeFile(DATA_FILE, JSON.stringify(tasks, null, 2), 'utf8', (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

const getStats = async () => {
  const tasks = await readTasks();
  const stats = { todo: 0, doing: 0, done: 0, total: 0 };
  tasks.forEach(t => {
    if (t.status === 'todo') stats.todo++;
    else if (t.status === 'doing') stats.doing++;
    else if (t.status === 'done') stats.done++;
    stats.total++;
  });
  return stats;
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === 'GET' && path === '/') {
    serveStatic('index.html', res);
    return;
  }

  if (req.method === 'GET' && path === '/api/tasks') {
    try {
      const tasks = await readTasks();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tasks));
    } catch (err) {
      res.writeHead(500);
      res.end('Internal server error');
    }
    return;
  }

  if (req.method === 'POST' && path === '/api/tasks') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { title, status = 'todo', priority = 'medium' } = JSON.parse(body);
        if (!title) {
          res.writeHead(400);
          res.end('Title is required');
          return;
        }
        const tasks = await readTasks();
        const newTask = {
          id: Date.now().toString(),
          title,
          status,
          priority,
          createdAt: new Date().toISOString()
        };
        tasks.push(newTask);
        await writeTasks(tasks);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(newTask));
      } catch (err) {
        res.writeHead(400);
        res.end('Invalid request body');
      }
    });
    return;
  }

  if (req.method === 'PATCH' && path.startsWith('/api/tasks/')) {
    const id = path.slice(13);
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const updates = JSON.parse(body);
        const tasks = await readTasks();
        const taskIndex = tasks.findIndex(t => t.id === id);
        if (taskIndex === -1) {
          res.writeHead(404);
          res.end('Task not found');
          return;
        }
        const task = tasks[taskIndex];
        const updatedTask = { ...task, ...updates };
        if (updatedTask.status && !['todo', 'doing', 'done'].includes(updatedTask.status)) {
          res.writeHead(400);
          res.end('Invalid status');
          return;
        }
        tasks[taskIndex] = updatedTask;
        await writeTasks(tasks);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updatedTask));
      } catch (err) {
        res.writeHead(400);
        res.end('Invalid request body');
      }
    });
    return;
  }

  if (req.method === 'DELETE' && path.startsWith('/api/tasks/')) {
    const id = path.slice(13);
    try {
      const tasks = await readTasks();
      const taskIndex = tasks.findIndex(t => t.id === id);
      if (taskIndex === -1) {
        res.writeHead(404);
        res.end('Task not found');
        return;
      }
      tasks.splice(taskIndex, 1);
      await writeTasks(tasks);
      res.writeHead(204);
      res.end();
    } catch (err) {
      res.writeHead(500);
      res.end('Internal server error');
    }
    return;
  }

  if (req.method === 'GET' && path === '/api/stats') {
    try {
      const stats = await getStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(stats));
    } catch (err) {
      res.writeHead(500);
      res.end('Internal server error');
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
});
