// Configuration CENTRALE de l'établissement client.
// Les trois portails (parent, professeur, direction) utilisent cette même
// adresse. Le pilote ELIMU possède une autre configuration, séparée.
window.ELIMU_ESTABLISHMENT_CONFIG = {
  appsScriptUrl: "https://script.google.com/macros/s/AKfycbxwkltTyiKnKO_BZbeK8e4rX8n_Oi0-emXotrqSMHn9Gbqc2HFL73SCKAxuq-5_uX-j/exec",
  configVersion: "2026-10-19-pwa-appscript"
};

window.ELIMU_APPS_SCRIPT_URL = window.ELIMU_ESTABLISHMENT_CONFIG.appsScriptUrl;
window.ELIMU_getCentralAppsScriptUrl = function () {
  return window.ELIMU_ESTABLISHMENT_CONFIG.appsScriptUrl;
};

