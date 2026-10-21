// Configuration du portail parent. Le nom, les couleurs et les données de
// l'école viennent ensuite de Google Sheets via Apps Script.
window.ELIMU_CONFIG = {
  appsScriptUrl: window.ELIMU_getCentralAppsScriptUrl(),
  schoolId: "",
  role: "PARENTS",
  configVersion: "2026-10-08-parent-session-4"
};

window.ELIMU_PARENT_SESSION_KEY = "elimu_parent_session_" + window.ELIMU_CONFIG.configVersion;

const ELIMU_URL_STORAGE_KEY = "elimu_parent_online_config";

window.ELIMU_getAppsScriptUrl = function () {
  try {
    const saved = JSON.parse(localStorage.getItem(ELIMU_URL_STORAGE_KEY) || "null");
    if (saved && saved.configVersion === window.ELIMU_CONFIG.configVersion && saved.appsScriptUrl) return saved.appsScriptUrl;
  } catch (e) {}
  return window.ELIMU_CONFIG.appsScriptUrl;
};

window.ELIMU_setAppsScriptUrl = function (url) {
  localStorage.setItem(ELIMU_URL_STORAGE_KEY, JSON.stringify({
    appsScriptUrl: url.trim(), configVersion: window.ELIMU_CONFIG.configVersion
  }));
};
