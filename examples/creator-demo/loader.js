// Picks the Whisper app for this demo at runtime, so the same page works locally and when deployed:
// ?whisper=https://… wins, a copy served by Whisper itself (/demo/) uses that origin,
// and the standalone dev server (port 4180) uses the local preview on port 4173.
(function () {
  var param = new URLSearchParams(location.search).get("whisper");
  var app = param || (location.port === "4180" ? "http://localhost:4173" : location.origin);
  var s = document.createElement("script");
  s.src = new URL("/whisper-button.js", app).toString();
  document.body.appendChild(s);
})();
