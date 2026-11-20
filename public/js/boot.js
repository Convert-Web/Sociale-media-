/* AURUM — démarrage. Script classique, minuscule et indépendant du reste.
   Mises à jour : une fois l'application lancée, c'est elle qui propose le bouton « Mettre à jour »
   (js/update.js). Filet de sécurité : si l'application gardée sur le téléphone ne démarre pas,
   la version est vérifiée ici et la nouvelle se charge d'office. */
// Session demandée tout de suite, pendant que les scripts de l'application se téléchargent
try {
  window.__aurumSession = fetch('/api/session', { credentials: 'same-origin', headers: { 'x-aurum': '1' } });
  window.__aurumSession.catch(function () {});
} catch (e) {
  window.__aurumSession = null;
}

(function () {
  if (!('serviceWorker' in navigator)) return;
  setTimeout(function () {
    if (window.__aurumStarted || !navigator.serviceWorker.controller) return;
    navigator.serviceWorker.controller.postMessage({ type: 'check-version' });
  }, 9000);
  navigator.serviceWorker.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'updated' && !window.__aurumStarted) location.reload();
  });
})();
