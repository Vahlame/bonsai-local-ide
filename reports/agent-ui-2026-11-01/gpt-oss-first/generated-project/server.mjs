import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname } from 'node:path';

const dataFile = fileURLToPath(new URL('./data.json', import.meta.url));

async function loadTasks() {
  try {
    const data = await readFile(dataFile, 'utf-8');
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

async function saveTasks(tasks) {
  await writeFile(dataFile, JSON.stringify(tasks, null, 2));
}

function generateId() {
  return Date.now().toString();
}

export async function startServer(port = 3000) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (!url.pathname.startsWith('/api/tasks')) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
      }

      const tasks = await loadTasks();
      const method = req.method;
      const parts = url.pathname.split('/').filter(Boolean);

      if (method === 'GET' && parts.length === 2 && parts[0] === 'api' && parts[1] === 'tasks') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(tasks));
        return;
      }

      if (method === 'POST' && parts.length === 2) {
        let body = '';
        for await (const chunk of req) body += chunk;
        const { title } = JSON.parse(body || '{}');
        if (!title) {
          res.statusCode = 400;
          res.end('Title required');
          return;
        }
        const newTask = { id: generateId(), title, completed: false };
        tasks.push(newTask);
        await saveTasks(tasks);
        res.statusCode = 201;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(newTask));
        return;
      }

      if ((method === 'PATCH' || method === 'DELETE') && parts.length === 3) {
        const id = parts[2];
        const idx = tasks.findIndex(t => t.id === id);
        if (idx === -1) {
          res.statusCode = 404;
          res.end('Task not found');
          return;
        }
        if (method === 'PATCH') {
          tasks[idx].completed = true;
          await saveTasks(tasks);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(tasks[idx]));
          return;
        }
        if (method === 'DELETE') {
          tasks.splice(idx, 1);
          await saveTasks(tasks);
          res.statusCode = 204;
          res.end();
          return;
        }
      }

      res.statusCode = 405;
      res.end('Method Not Allowed');
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });
  return new Promise((resolve, reject) => {
    server.listen(port, () => resolve(server));
  });
}

// If run directly, start the server
if (process.argv[1] && process.argv[1].endsWith('server.mjs')) {
  startServer();
}
