// api.js — Gestionnaire
// Enveloppe unique pour parler au backend Apps Script.
// Utilise text/plain pour eviter le preflight CORS (limitation connue d'Apps Script Web App).

const ELIMU_Api = {
  async call(action, payload) {
    const url = window.ELIMU_getAppsScriptUrl();
    if (!url || url.indexOf("A_REMPLACER") !== -1) {
      throw new Error("Connexion non configuree.");
    }
    const body = JSON.stringify(Object.assign({
      action,
      schoolId: window.ELIMU_CONFIG.schoolId,
      role: window.ELIMU_CONFIG.role
    }, payload || {}));
    const readOnly = !["updateLicense", "registerInstallation"].includes(action);
    const target = readOnly ? url + "?" + new URLSearchParams(JSON.parse(body)) : url;
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
    let res;
    try {
      res = await fetch(target, Object.assign({ signal: ctl.signal }, readOnly ? {} : {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body
      }));
    } catch (e) {
      throw new Error(e.name === "AbortError" ? "Le service n'a pas répondu. Réessayez dans un instant." : "Connexion impossible. Vérifiez votre réseau.");
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      throw new Error("Erreur reseau (" + res.status + ")");
    }
    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); }
    catch (_) { throw new Error("Le service de l'établissement a renvoyé une réponse invalide. Vérifiez l'URL /exec et le déploiement Apps Script."); }
    if (!data.ok) {
      const serverError = new Error(data.message || data.error || "Erreur serveur");
      serverError.code = String(data.error || "");
      throw serverError;
    }
    return Object.prototype.hasOwnProperty.call(data, "result") ? data.result : data;
  },

  async createParentSession(telephone) {
    return this.call("parentSessionCreate", { telephone });
  },

  async createParentSessionFromQr(qr) {
    return this.call("parentQrSessionCreate", { qr });
  },

  async restoreParentSession(token) {
    return this.call("parentSessionLookup", { token });
  },

  isOnline() {
    return navigator.onLine;
  }
};

window.ELIMU_Api = ELIMU_Api;
