// Configuration CENTRALE de l'établissement client.
// Les trois portails (parent, professeur, direction) utilisent cette même
// adresse. Le pilote ELIMU possède une autre configuration, séparée.
window.ELIMU_ESTABLISHMENT_CONFIG = {
  appsScriptUrl: "https://script.google.com/macros/s/AKfycbwqZ58kTrzBdqF1-Y92lo4Jv30F-O_5Tt2C8YYaImhBdi1O7xtx6jYzMvLZybQbnjFi/exec",
  configVersion: "2026-10-19-pwa-appscript"
};

window.ELIMU_APPS_SCRIPT_URL = window.ELIMU_ESTABLISHMENT_CONFIG.appsScriptUrl;
window.ELIMU_getCentralAppsScriptUrl = function () {
  return window.ELIMU_ESTABLISHMENT_CONFIG.appsScriptUrl;
};


