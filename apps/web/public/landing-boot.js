// Runs before first paint (CSP allows no inline script): the hero's entrance and the moments' guard.
var d = document.documentElement;
d.classList.add("m-enter", "mo-js");
setTimeout(function () { d.classList.add("m-enter-done"); }, 700);
setTimeout(function () { d.classList.add("mo-safe"); }, 2500);
