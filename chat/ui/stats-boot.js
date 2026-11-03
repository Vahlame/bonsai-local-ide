const statsLine = document.querySelector("#stats-line");
let statsEnCurso = false;

async function loadStats() {
  if (statsEnCurso || document.hidden) return;
  statsEnCurso = true;
  try {
    const res = await fetch("/api/stats");
    if (!res.ok || !statsLine) return;
    const data = await res.json();
    const sec = Number(data.seconds) || 0;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    const tiempo = min ? `${min} min ${rem} s` : `${sec} s`;
    const archivos = data.saved?.count ?? 0;
    statsLine.textContent = `${data.turns ?? 0} turnos · ${archivos} archivos · memoria ${data.memory ?? 0} tok · sesión ${tiempo}`;
  } catch {
    /* el siguiente intervalo reintenta */
  } finally {
    statsEnCurso = false;
  }
}

loadStats();
setInterval(loadStats, 5000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadStats();
});
