const API_BASE = '/api/tasks';

async function fetchTasks() {
  const res = await fetch(API_BASE);
  return res.json();
}

async function fetchStats() {
  const res = await fetch('/api/stats');
  return res.json();
}

function createTaskElement(task) {
  const li = document.createElement('li');
  li.className = 'task';
  li.dataset.id = task.id;
  li.textContent = task.title;
  li.title = `Priority: ${task.priority}\nCreated: ${new Date(task.createdAt).toLocaleString()}`;

  li.addEventListener('click', () => cycleStatus(task.id));
  const delBtn = document.createElement('button');
  delBtn.textContent = '✕';
  delBtn.className = 'delete-btn';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTask(task.id);
  });
  li.appendChild(delBtn);
  return li;
}

function cycleStatus(id) {
  // Get current status
  const task = currentTasks.find(t => t.id === id);
  if (!task) return;
  const next = { todo: 'doing', doing: 'done', done: 'todo' }[task.status];
  updateTask(id, { status: next });
}

async function addTask(title) {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title })
  });
  if (res.ok) {
    const task = await res.json();
    currentTasks.push(task);
    renderTasks();
    renderStats();
  }
}

async function updateTask(id, updates) {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates)
  });
  if (res.ok) {
    const updated = await res.json();
    const idx = currentTasks.findIndex(t => t.id === id);
    if (idx !== -1) currentTasks[idx] = updated;
    renderTasks();
    renderStats();
  }
}

async function deleteTask(id) {
  const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
  if (res.ok) {
    currentTasks = currentTasks.filter(t => t.id !== id);
    renderTasks();
    renderStats();
  }
}

function renderTasks() {
  const todoList = document.getElementById('todo-list');
  const doingList = document.getElementById('doing-list');
  const doneList = document.getElementById('done-list');
  todoList.innerHTML = '';
  doingList.innerHTML = '';
  doneList.innerHTML = '';
  for (const task of currentTasks) {
    const el = createTaskElement(task);
    if (task.status === 'todo') todoList.appendChild(el);
    else if (task.status === 'doing') doingList.appendChild(el);
    else if (task.status === 'done') doneList.appendChild(el);
  }
}

function renderStats() {
  const statsEl = document.getElementById('stats-content');
  fetchStats().then(stats => {
    statsEl.textContent = `Total: ${stats.total} | Todo: ${stats.todo} | Doing: ${stats.doing} | Done: ${stats.done}`;
  });
}

let currentTasks = [];

document.addEventListener('DOMContentLoaded', async () => {
  currentTasks = await fetchTasks();
  renderTasks();
  renderStats();

  const addBtn = document.getElementById('add-task-btn');
  const input = document.getElementById('new-task-title');
  addBtn.addEventListener('click', () => {
    const title = input.value.trim();
    if (title) {
      addTask(title);
      input.value = '';
    }
  });
});
