/* Portail parent — déclencheurs de mouvement. Lecture seule : ce script ne modifie ni les
   données, ni l'état de l'application, ni les appels réseau. */
(function () {
  "use strict";
  var body = document.body;
  var app = document.getElementById("app");
  if (!app) return;

  function currentView() {
    try { return typeof App !== "undefined" && App.state ? App.state.view : null; } catch (e) { return null; }
  }

  // Animation d'entrée seulement à la première image et à chaque changement d'écran
  // (connexion → tableau, déconnexion). Les actualisations automatiques restent silencieuses.
  var lastView = null, clearTimer = 0;
  new MutationObserver(function () {
    var view = currentView();
    if (view === lastView) return;
    lastView = view;
    body.setAttribute("data-motion", "on");
    window.clearTimeout(clearTimer);
    clearTimer = window.setTimeout(function () { body.removeAttribute("data-motion"); }, 450);
  }).observe(app, { childList: true });

  // Animation d'ouverture d'un bloc repliable : seulement si la personne vient de le toucher
  // (la restauration automatique des blocs ouverts après actualisation ne rejoue rien).
  var lastTouch = 0;
  document.addEventListener("click", function (event) {
    if (event.target.closest && event.target.closest("summary")) lastTouch = Date.now();
  }, true);
  document.addEventListener("toggle", function (event) {
    var node = event.target;
    if (!node || node.tagName !== "DETAILS" || !node.open || Date.now() - lastTouch > 400) return;
    node.classList.add("m-opened");
    window.setTimeout(function () { node.classList.remove("m-opened"); }, 220);
  }, true);
})();


