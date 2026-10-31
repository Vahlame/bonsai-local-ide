document.addEventListener('DOMContentLoaded', () => {
  const taskInput = document.getElementById('task-input');
  const addBtn = document.getElementById('add-btn');
  const board = document.getElementById('board');
  const statsContainer = document.getElementById('stats');

  // Load initial data
  loadTasks();
  loadStats();

  // Event Listeners
  addBtn.addEventListener('click', addTask);
  taskInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addTask();
  });

  // Delegate events for dynamic elements
  board.addEventListener('click', handleBoardClick);

  async function loadTasks() {
    try {
      const res = await fetch('/api/tasks');
      const tasks = await res.json();
      renderTasks(tasks);
    } catch (e) {
      console.error('Error loading tasks', e);
    }
  }

  async function loadStats() {
    try {
      const res = await fetch('/api/stats');
      const stats = await res.json();
      renderStats(stats);
    } catch (e) {
      console.error('Error loading stats', e);
    }
  }

  function renderTasks(tasks) {
    const lists = {
      todo: document.getElementById('list-todo'),
      doing: document.getElementById('list-doing'),
      done: document.getElementById('list-done')
    };

    // Clear lists
    Object.values(lists).forEach(el => el.innerHTML = '');

    tasks.forEach(task => {
      const card = document.createElement('div');
      card.className = 'task-card';
      card.dataset.id = task.id;
      
      const title = document.createElement('div');
      title.className = 'task-title';
      title.textContent = task.title;
      
      const priority = document.createElement('span');
      priority.className = 'task-priority';
      priority.textContent = `[${task.priority}]`;
      
      const controls = document.createElement('div');
      controls.className = 'task-controls';

      // Add buttons based on status
      if (task.status !== 'doing') {
        const moveBtn = document.createElement('button');
        moveBtn.textContent = '→';
        moveBtn.title = 'Mover a Doing';
        moveBtn.dataset.action = 'move-to-doing';
        controls.appendChild(moveBtn);
      }
      
      if (task.status !== 'done') {
        const moveBtn = document.createElement('button');
        moveBtn.textContent = '✓';
        moveBtn.title = 'Mover a Done';
        moveBtn.dataset.action = 'move-to-done';
        controls.appendChild(moveBtn);
      }

      if (task.status !== 'todo') {
        const moveBtn = document.createElement('button');
        moveBtn.textContent = '←';
        moveBtn.title = 'Mover a Todo';
        moveBtn.dataset.action = 'move-to-todo';
        controls.appendChild(moveBtn);
      }

      const delBtn = document.createElement('button');
      delBtn.textContent = '×';
      delBtn.title = 'Eliminar';
      delBtn.dataset.action = 'delete';
      controls.appendChild(delBtn);

      card.appendChild(title);
      card.appendChild(priority);
      card.appendChild(controls);
      lists[task.status].appendChild(card);
    });
  }

  function renderStats(stats) {
    const spans = statsContainer.querySelectorAll('b');
    spans[0].textContent = stats.total;
    spans[1].textContent = stats.todo;
    spans[2].textContent = stats.doing;
    spans[3].textContent = stats.done;
  }

  async function addTask() {
    const title = taskInput.value.trim();
    if (!title) return;

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });
      if (res.ok) {
        taskInput.value = '';
        loadTasks();
        loadStats();
      }
    } catch (e) {
      console.error('Error adding task', e);
    }
  }

  async function handleBoardClick(e) {
    const btn = e.target.closest('button');
    if (!btn) return;

    const card = btn.closest('.task-card');
    if (!card) return;

    const id = card.dataset.id;
    const action = btn.dataset.action;

    if (action === 'delete') {
      try {
        await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
        loadTasks();
        loadStats();
      } catch (e) {
        console.error('Error deleting', e);
      }
    } else if (action.startsWith('move-to-')) {
      const newStatus = action.split('-')[2]; // todo, doing, done
      try {
        await fetch(`/api/tasks/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus })
        });
        loadTasks();
        loadStats();
      } catch (e) {
        console.error('Error moving task', e);
      }
    }
  }
});
