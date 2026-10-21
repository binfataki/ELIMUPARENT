// Ces portails sont volontairement consultés en ligne. Cette petite migration
// désinscrit un éventuel ancien service worker PWA du même dossier, afin qu'il
// ne puisse plus servir des scripts ou des données périmés.
(function () {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.getRegistrations().then(function (registrations) {
    return Promise.all(registrations.map(function (registration) {
      return registration.unregister();
    }));
  }).catch(function () {});
})();
