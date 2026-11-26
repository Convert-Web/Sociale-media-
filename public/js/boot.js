/* AURUM — démarrage. Script classique, minuscule et indépendant du reste.
   Mises à jour : une fois l'application lancée, elle se met à jour d'elle-même (js/update.js).
   Filet de sécurité : si l'application gardée sur le téléphone ne démarre pas, la version est
   vérifiée ici et la nouvelle se charge d'office. */
// Session demandée tout de suite, pendant que les scripts de l'application se téléchargent
try {
  window.__vibzSession = fetch('/api/session', { credentials: 'same-origin', headers: { 'x-vibz': '1' } });
  window.__vibzSession.catch(function () {});
} catch (e) {
  window.__vibzSession = null;
}
// Hauteur réelle de l'écran (iOS 26 peut compter la barre d'état en trop dans les unités vh)
(function () {
  var set = function () {
    document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px');
  };
  set();
  window.addEventListener('resize', set);
  window.addEventListener('orientationchange', function () {
    setTimeout(set, 250);
  });
})();
// Thème choisi (Système, Clair, Sombre) appliqué avant le premier affichage
try {
  var theme = localStorage.getItem('vibz:theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch (e) {
  /* stockage indisponible */
}

(function () {
  if (!('serviceWorker' in navigator)) return;
  setTimeout(function () {
    if (window.__vibzStarted || !navigator.serviceWorker.controller) return;
    navigator.serviceWorker.controller.postMessage({ type: 'check-version' });
  }, 9000);
  navigator.serviceWorker.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'updated' && !window.__vibzStarted) location.reload();
  });
})();
