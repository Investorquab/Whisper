// Runs before first paint (blocking, not a module) so the page never flashes the wrong theme.
try {
  var t = localStorage.getItem("whisper-theme");
  if (t !== "light" && t !== "dark") t = matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = t;
} catch (e) {
  document.documentElement.dataset.theme = "dark";
}
