document.addEventListener('DOMContentLoaded', () => {
  const taskForm = document.getElementById('taskForm');
  const titleInput = document.getElementById('title');
  const tasksUl = document.getElementById('tasks');

  async function fetchTasks() {
    const res = await fetch('/api/tasks');
    const data = await res.json();
    renderTasks(data);
  }

  function renderTasks(tasks) {
    tasksUl.innerHTML = '';
    tasks.forEach(task => {
      const li = document.createElement('li');
      li.className = 'task' + (task.completed ? ' completed' : '');
      const span = document.createElement('span');
      span.textContent = task.title;
      const btnDone = document.createElement('button');
      btnDone.textContent = task.completed ? '✓' : '✔';
      btnDone.addEventListener('click', async () => {
        if (!task.completed) {
          await fetch(`/api/tasks/${task.id}`, { method: 'PATCH' });
          await fetchTasks();
        }
      });
      const btnDel = document.createElement('button');
      btnDel.textContent = '🗑';
      btnDel.addEventListener('click', async () => {
        await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
        await fetchTasks();
      });
      li.appendChild(span);
      li.appendChild(btnDone);
      li.appendChild(btnDel);
      tasksUl.appendChild(li);
    });
  }

  taskForm.addEventListener('submit', async e => {
    e.preventDefault();
    const title = titleInput.value.trim();
    if (!title) return;
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    titleInput.value = '';
    await fetchTasks();
  });

  fetchTasks();
});
