try {
  document.documentElement.dataset.theme = localStorage.getItem("bonsai-theme") || "slate";
} catch {
  document.documentElement.dataset.theme = "slate";
}
