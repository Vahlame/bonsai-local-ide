const API_BASE = '/api';

const taskInput = document.getElementById('taskInput');
const addTaskBtn = document.getElementById('addTaskBtn');
const todoList = document.getElementById('todoList');
const doingList = document.getElementById('doingList');
const doneList = document.getElementById('doneList');
const todoCount = document.getElementById('todoCount');
const doingCount = document.getElementById('doingCount');
const doneCount = document.getElementById('doneCount');
const totalCount = document.getElementById('totalCount');

const statusMap = {
  todo: todoList,
  doing: doingList,
  done: doneList
};

const loadTasks = async () => {
  try {
    const response = await fetch(`${API_BASE}/tasks`);
    const tasks = await response.json();
    renderTasks(tasks);
  } catch (err) {
    console.error('Failed to load tasks:', err);
  }
};

const renderTasks = (tasks) => {
  const todo = tasks.filter(t => t.status === 'todo');
  const doing = tasks.filter(t => t.status === 'doing');
  const done = tasks.filter(t => t.status === 'done');

  todoList.innerHTML = '';
  doingList.innerHTML = '';
  doneList.innerHTML = '';

  todo.forEach(task => addTaskToColumn(task, todoList));
  doing.forEach(task => addTaskToColumn(task, doingList));
  done.forEach(task => addTaskToColumn(task, doneList));

  updateStats(todo.length, doing.length, done.length, tasks.length);
};

const addTaskToColumn = (task, column) => {
  const li = document.createElement('li');
  li.setAttribute('data-id', task.id);
  li.innerHTML = `
    <span class="task-title">${task.title}</span>
    <div class="controls">
      <button class="move-btn" data-status="doing">Move to Doing</button>
      <button class="move-btn" data-status="done">Move to Done</button>
      <button class="delete-btn">Delete</button>
    </div>
  `;
  column.appendChild(li);

  const moveBtns = li.querySelectorAll('.move-btn');
  moveBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const newStatus = btn.getAttribute('data-status');
      await updateTask(task.id, { status: newStatus });
      loadTasks();
    });
  });

  const deleteBtn = li.querySelector('.delete-btn');
  deleteBtn.addEventListener('click', async () => {
    await deleteTask(task.id);
    loadTasks();
  });
};

const updateTask = async (id, updates) => {
  try {
    const response = await fetch(`${API_BASE}/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    if (!response.ok) {
      throw new Error('Failed to update task');
    }
    return await response.json();
  } catch (err) {
    console.error('Failed to update task:', err);
  }
};

const deleteTask = async (id) => {
  try {
    const response = await fetch(`${API_BASE}/tasks/${id}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      throw new Error('Failed to delete task');
    }
  } catch (err) {
    console.error('Failed to delete task:', err);
  }
};

const addTask = async () => {
  const title = taskInput.value.trim();
  if (!title) return;
  try {
    const response = await fetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    if (!response.ok) {
      throw new Error('Failed to add task');
    }
    const newTask = await response.json();
    loadTasks();
    taskInput.value = '';
  } catch (err) {
    console.error('Failed to add task:', err);
  }
};

const updateStats = (todo, doing, done, total) => {
  todoCount.textContent = todo;
  doingCount.textContent = doing;
  doneCount.textContent = done;
  totalCount.textContent = total;
};

addTaskBtn.addEventListener('click', addTask);
taskInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') addTask();
});

window.addEventListener('load', loadTasks);
