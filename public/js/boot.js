/* AURUM — démarrage : vérifie la version de l'application gardée sur le téléphone.
   Script classique, minuscule et indépendant du reste : même si une ancienne version
   gardée ne démarrait pas, la vérification a lieu et la version suivante se charge. */
(function () {
  if (!('serviceWorker' in navigator)) return;
  var asked = false;
  function check() {
    if (asked || !navigator.serviceWorker.controller) return;
    asked = true;
    navigator.serviceWorker.controller.postMessage({ type: 'check-version' });
  }
  // Appelé par l'application une fois démarrée ; sinon, au bout de 8 secondes
  window.__aurumBooted = check;
  setTimeout(check, 8000);
  navigator.serviceWorker.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'updated') return;
    // Nouvelle version : rechargée au prochain retour sur l'application (jamais en pleine saisie)
    var reload = function () {
      if (document.visibilityState === 'visible' && !document.querySelector('.modal, textarea:focus, input:focus')) location.reload();
    };
    if (!document.querySelector('.shell')) return reload();
    document.addEventListener('visibilitychange', reload);
  });
})();
