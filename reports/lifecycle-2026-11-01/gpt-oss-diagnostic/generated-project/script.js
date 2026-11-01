// Simple client to interact with the API
export async function loadTasks() {
  const res = await fetch('/api/tasks');
  return await res.json();
}
export async function addTask(title) {
  const res = await fetch('/api/tasks', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({title})});
  return await res.json();
}
export async function completeTask(id, completed) {
  const res = await fetch('/api/tasks', {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id, completed})});
  return await res.json();
}
export async function deleteTask(id) {
  const res = await fetch('/api/tasks', {method:'DELETE', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id})});
  return res.status === 200;
}
// DOM handling
if (typeof window !== 'undefined') {
  const form = document.getElementById('new-task-form');
  const input = document.getElementById('new-task-title');
  const list = document.getElementById('task-list');

  async function render() {
    const tasks = await loadTasks();
    list.innerHTML = '';
    for (const t of tasks) {
      const li = document.createElement('li');
      li.textContent = t.title;
      if (t.completed) li.classList.add('completed');
      const completeBtn = document.createElement('button');
      completeBtn.textContent = t.completed ? 'Undo' : 'Done';
      completeBtn.onclick = async () => { await completeTask(t.id, !t.completed); render(); };
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.onclick = async () => { await deleteTask(t.id); render(); };
      li.appendChild(completeBtn);
      li.appendChild(delBtn);
      list.appendChild(li);
    }
  }
  form.onsubmit = async (e) => { e.preventDefault(); await addTask(input.value); input.value=''; render(); };
  render();
}
