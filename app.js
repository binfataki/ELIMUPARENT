// app.js — Parents
// Session parent persistante facultative, avec publication automatique planifiée.

const App = {
  state: { phone: "", data: null, branding: {}, view: "login", sessionToken: "", rememberDevice: false, syncPlan: null },

  async init() {
    await this.restoreCachedDashboard();
    this.render();
    // L'identité distante ne doit pas retarder l'affichage de la vue locale.
    this.loadBranding().then(() => this.render()).catch(() => {});
    // Le cache donne une vue immédiate ; la validation de session et les
    // nouvelles données arrivent ensuite sans bloquer le premier affichage.
    this.restoreSession().then(() => this.render()).catch(() => {});
    this.refreshStatusPill();
    window.addEventListener("offline", () => this.refreshStatusPill());
    window.addEventListener("online", () => { this.refreshStatusPill(); this.scheduleSync(); });
  },

  async loadBranding() {
    try {
      const cached = await ELIMU_Storage.getMeta("school_config");
      if (cached) this.state.branding = cached;
    } catch (_) {}
    if (!navigator.onLine) return;
    try {
      const data = await ELIMU_Api.call("publicConfig", {});
      this.state.branding = Object.assign({}, (data && data.etablissement) || {}, { syncPolicy: data && data.syncPolicy });
      await ELIMU_Storage.setMeta("school_config", this.state.branding);
    } catch (e) {
      // Le formulaire reste utilisable ; on garde l'identité déjà en cache.
    }
  },

  async restoreSession() {
    if (!navigator.onLine || !window.ELIMU_Storage) return;
    // Une vue persistante déjà affichée est le snapshot de référence entre
    // deux fenêtres de synchronisation. La prochaine lecture distante est
    // planifiée, au lieu de relire Google Sheets à chaque rechargement.
    if (this.state.view === "dashboard" && this.state.data) {
      this.scheduleSync();
      return;
    }
    try {
      const saved = await ELIMU_Storage.getParentSession();
      if (!saved || !saved.token) return;
      const result = await ELIMU_Api.restoreParentSession(saved.token);
      const data = this.normalizePayload(result && result.data ? result.data : result);
      if (!data.enfants || !data.enfants.length) throw new Error("Session sans élève");
      this.state.sessionToken = saved.token;
      this.state.rememberDevice = Boolean(saved.persistent);
      this.state.data = data;
      this.state.view = "dashboard";
      this.state.syncPolicy = data.syncPolicy || this.state.branding.syncPolicy || {};
      this.scheduleSync();
      await this.notifyNewCommunique(data);
    } catch (_) {
      await ELIMU_Storage.clearParentSession();
      await ELIMU_Storage.delete("meta", "parent_data");
      this.state.data = null;
      this.state.view = "login";
    }
  },

    async restoreCachedDashboard() {
      try {
        const savedSession = await ELIMU_Storage.getParentSession();
        if (!savedSession || !savedSession.token || !savedSession.persistent) return;
        const cached = await ELIMU_Storage.getMeta("parent_data");
        if (!cached || !cached.data) return;
      const data = this.normalizePayload(cached.data);
      if (!data.enfants.length) return;
      this.state.phone = cached.phone || "";
      this.state.sessionToken = savedSession.token;
      this.state.data = data;
      this.state.view = "dashboard";
      this.state.syncPolicy = data.syncPolicy || this.state.branding.syncPolicy || {};
      this.scheduleSync();
      this.state.rememberDevice = Boolean(cached.rememberDevice);
    } catch (_) {}
  },

  async cacheDashboard(data) {
      try {
        if (!this.state.rememberDevice) {
          await ELIMU_Storage.delete("meta", "parent_data");
          return;
        }
        await ELIMU_Storage.setMeta("parent_data", {
        data,
        phone: this.state.phone,
        rememberDevice: this.state.rememberDevice,
        savedAt: new Date().toISOString()
      });
    } catch (_) {}
  },

  scheduleSync() {
    if (!this.state.sessionToken || this.state.view !== "dashboard" || !window.ELIMU_SYNC_SCHEDULE) return;
    if (this.syncTimer) this.syncTimer.cancel();
    const policy = this.state.syncPolicy || this.state.branding.syncPolicy || (this.state.data && this.state.data.syncPolicy) || {};
    this.syncTimer = ELIMU_SYNC_SCHEDULE.schedule(policy, "PARENTS", this.state.phone || this.state.sessionToken, () => {
      if (navigator.onLine && this.state.view === "dashboard") return this.refresh(true);
    });
    this.state.syncPlan = this.syncTimer.initial;
    this.render();
  },

  async refreshStatusPill() {
    const pill = document.getElementById("status-pill");
    if (!pill) return;
    const online = navigator.onLine;
    pill.className = "status-pill " + (online ? "online" : "offline");
    pill.textContent = online ? "En ligne" : "Connexion requise";
  },

  toast(msg) {
    const t = document.createElement("div");
    t.className = "toast"; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  },

  normalizePhone(value) {
    const raw = String(value || "").trim();
    const digits = raw.replace(/\D/g, "");
    if (digits.indexOf("243") === 0) return "+" + digits;
    if (digits.indexOf("0") === 0) return "+243" + digits.slice(1);
    if (digits.length === 9) return "+243" + digits;
    return raw.indexOf("+") === 0 ? "+" + digits : digits;
  },

  normalizePayload(data) {
    // Le déploiement actuel nomme les annonces `communications`. Les anciens
    // snapshots employaient `communiques`; les deux formats restent lisibles.
    const payload = Object.assign({}, data || {});
    payload.enfants = Array.isArray(payload.enfants) ? payload.enfants : (Array.isArray(payload.children) ? payload.children : []);
    payload.communiques = Array.isArray(payload.communiques) ? payload.communiques : (Array.isArray(payload.communications) ? payload.communications : []);
    return payload;
  },

  escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  },

  captureDetailsState() {
    return [...document.querySelectorAll("#app details")].map((node, index) => ({
      key: node.dataset.stateKey || `${index}:${node.querySelector("summary")?.textContent.trim() || ""}`,
      open: node.open
    }));
  },

  restoreDetailsState(state) {
    if (!Array.isArray(state) || !state.length) return;
    const nodes = [...document.querySelectorAll("#app details")];
    state.forEach((saved, index) => {
      const node = nodes.find((candidate) => (candidate.dataset.stateKey || `${nodes.indexOf(candidate)}:${candidate.querySelector("summary")?.textContent.trim() || ""}`) === saved.key) || nodes[index];
      if (node) node.open = Boolean(saved.open);
    });
  },

  enforceExclusiveDetails() {
    const nodes = [...document.querySelectorAll("#app details")];
    nodes.forEach((node) => node.addEventListener("toggle", () => {
      if (!node.open) return;
      [...node.parentElement.children]
        .filter((sibling) => sibling !== node && sibling.tagName === "DETAILS")
        .forEach((sibling) => { sibling.open = false; });
    }));
    nodes.forEach((node) => {
      if (!node.open) return;
      [...node.parentElement.children]
        .filter((sibling) => sibling !== node && sibling.tagName === "DETAILS" && sibling.open)
        .forEach((sibling) => { sibling.open = false; });
    });
  },

  render() {
    // Conserver la saisie du numéro si l'écran est redessiné (identité, planning).
    const ph = document.getElementById("phone-input"), focused = ph && document.activeElement === ph;
    if (ph) { this.state.phone = ph.value; const rc = document.getElementById("remember-device"); if (rc) this.state.rememberDevice = rc.checked; }
    const detailsState = this.captureDetailsState();
    document.getElementById("app").innerHTML = this.state.view === "login" ? this.viewLogin() : this.viewDashboard();
    if (focused) { const n = document.getElementById("phone-input"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }
    this.restoreDetailsState(detailsState);
    this.enforceExclusiveDetails();
    this.updateContactLink();
    const childrenNav = document.getElementById("children-nav");
    if (childrenNav) childrenNav.classList.toggle("hidden", this.state.view !== "dashboard");
    this.applyBranding();
    this.refreshStatusPill();
  },

  updateContactLink() {
    const panel = document.getElementById("contact-sidebar");
    const link = document.getElementById("contact-direction-link");
    if (!panel || !link) return;
    const data = Object.assign({}, this.state.branding || {}, (this.state.data && this.state.data.etablissement) || {}, this.state.data || {});
    const value = data.direction_phone || data.contact_phone || data.telephone_direction || data.whatsapp || data.phone || "";
    const whatsapp = String(value).replace(/[^0-9]/g, "").replace(/^0+/, "");
    const visible = this.state.view === "dashboard" && Boolean(whatsapp);
    panel.classList.toggle("hidden", !visible);
    if (visible) link.href = `https://wa.me/${whatsapp}?text=Bonjour%20la%20direction`;
  },

  scrollToChildren() {
    const target = document.getElementById("mes-enfants");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  },

  applyBranding() {
    const d = Object.assign({}, this.state.branding || {}, (this.state.data && this.state.data.etablissement) || {}, this.state.data || {});
    const name = d.school_name || "Établissement scolaire";
    document.title = name + " — Portail parent";
    const title = document.getElementById("school-name");
    if (title) title.textContent = name;
    document.documentElement.style.setProperty("--primary", "#092c63");
    document.documentElement.style.setProperty("--secondary", "#e6b52a");
  },

  viewLogin() {
    return `
      <form class="card login" onsubmit="event.preventDefault();App.login()">
        <h2>Espace parent</h2>
        <p class="meta">Entrez votre numéro de téléphone tel qu'enregistré par l'école.</p>
        <div id="login-err" role="alert"></div>
        <label for="phone-input">Numéro de téléphone</label>
        <input id="phone-input" type="tel" inputmode="tel" autocomplete="tel" placeholder="+243 8xx xxx xxx" value="${this.escapeHtml(this.state.phone)}">
        <label class="remember-device" for="remember-device"><input id="remember-device" type="checkbox" ${this.state.rememberDevice ? "checked" : ""}> Mémoriser cet appareil pendant 30 jours</label>
        <div class="form-actions"><button id="login-btn" type="submit"><span class="button-label">Se connecter</span><span class="button-spinner" aria-hidden="true"></span></button></div>
      </form>`;
  },

  async login() {
    const btn = document.getElementById("login-btn");
    const phone = document.getElementById("phone-input").value.trim();
    if (!phone) { document.getElementById("login-err").innerHTML = `<div class="err-box">Numero requis</div>`; return; }
    btn.disabled = true;
    btn.classList.add("is-loading");
    btn.setAttribute("aria-busy", "true");
    btn.querySelector(".button-label").textContent = "Connexion en cours…";
    try {
      const remember = Boolean(document.getElementById("remember-device")?.checked);
      const session = await ELIMU_Api.createParentSession(this.normalizePhone(phone));
      const data = this.normalizePayload(session && session.data ? session.data : session);
      if (!data || !data.enfants || !data.enfants.length) throw new Error("Aucun eleve trouve pour ce numero");
      this.state.phone = phone;
      this.state.sessionToken = session.token || "";
      this.state.rememberDevice = remember;
      this.state.data = data;
      this.state.view = "dashboard";
      this.state.syncPolicy = data.syncPolicy || this.state.branding.syncPolicy || {};
      this.scheduleSync();
      await this.cacheDashboard(data);
      if (this.state.sessionToken) {
        await ELIMU_Storage.setParentSession({
          token: this.state.sessionToken,
          expiresAt: Date.now() + Number(session.expiresIn || 0) * 1000
        }, remember);
      }
      await this.initialiseCommuniqueMarker(data);
      this.render();
    } catch (e) {
      document.getElementById("login-err").innerHTML = `<div class="err-box">${this.escapeHtml(e.message)}</div>`;
    } finally {
      if (document.getElementById("login-btn") === btn) {
        btn.disabled = false;
        btn.classList.remove("is-loading");
        btn.removeAttribute("aria-busy");
        btn.querySelector(".button-label").textContent = "Se connecter";
      }
    }
  },

  async refresh(silent = false) {
    if (!navigator.onLine) { if (!silent) this.toast("Hors connexion"); return; }
    try {
      const result = this.state.sessionToken
        ? await ELIMU_Api.restoreParentSession(this.state.sessionToken)
        : await ELIMU_Api.createParentSession(this.normalizePhone(this.state.phone));
      const data = this.normalizePayload(result && result.data ? result.data : result);
      if (result && result.token) this.state.sessionToken = result.token;
      await this.notifyNewCommunique(data);
      this.state.data = data;
      this.state.syncPolicy = data.syncPolicy || this.state.branding.syncPolicy || {};
      await this.cacheDashboard(data);
      this.render();
      if (!silent) this.toast("Donnees actualisees");
    } catch (e) {
      this.toast("Erreur: " + e.message);
    } finally {}
  },

  logout() {
    if (this.syncTimer) this.syncTimer.cancel();
    if (window.ELIMU_Storage) {
      ELIMU_Storage.clearParentSession();
      ELIMU_Storage.delete("meta", "parent_data");
    }
    this.state.phone = "";
    this.state.sessionToken = "";
    this.state.rememberDevice = false;
    this.state.data = null;
    this.state.syncPlan = null;
    this.state.view = "login";
    this.render();
  },

  communiqueTime(c) { return new Date(c && (c.date_envoi || c.created_at || c.date) || 0).getTime() || 0; },
  communiqueDate(c) { const t = this.communiqueTime(c); return t ? this.dateFmt(t) : ""; },
  dateFmt(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value || "");
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  },
  communiqueKey(c) { return String(c && (c.id || c.date_envoi || c.created_at || c.date) || "") + "|" + String(c && c.titre || ""); },
  communiqueMarkerKey(phone = this.state.phone) { return "parent_communique_seen_" + String(phone || "").replace(/\D/g, ""); },

  async initialiseCommuniqueMarker(data) {
    const list = [...((data && data.communiques) || [])].sort((a, b) => this.communiqueTime(b) - this.communiqueTime(a));
    if (list[0]) localStorage.setItem(this.communiqueMarkerKey(), this.communiqueKey(list[0]));
  },

  async notifyNewCommunique(data) {
    const list = [...((data && data.communiques) || [])].sort((a, b) => this.communiqueTime(b) - this.communiqueTime(a));
    const latest = list[0];
    if (!latest) return;
    const key = this.communiqueKey(latest);
    const markerKey = this.communiqueMarkerKey();
    const previous = localStorage.getItem(markerKey);
    localStorage.setItem(markerKey, key);
    if (!previous || previous === key) return;
    const title = (this.state.branding && this.state.branding.school_name) || "Nouveau communiqué";
    this.toast("Nouveau communiqué : " + (latest.titre || "à consulter"));
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      const body = String(latest.message || "").replace(/\s+/g, " ").trim().slice(0, 160);
      new Notification(title, { body });
    } catch (e) {}
  },

  async enableNotifications() {
    if (typeof Notification === "undefined") return this.toast("Les notifications ne sont pas disponibles sur ce navigateur");
    const permission = await Notification.requestPermission();
    this.render();
    this.toast(permission === "granted" ? "Notifications activees" : "Notifications non autorisees");
  },

  viewDashboard() {
    const raw = Object.assign({ enfants: [], communiques: [] }, this.state.branding || {}, (this.state.data && this.state.data.etablissement) || {}, this.state.data || {});
    const currency = raw.currency || (raw.enfants[0] && raw.enfants[0].scolarite && raw.enfants[0].scolarite.devise) || "USD";
    const d = Object.assign({}, raw, {
      currency,
      communiques: raw.communiques && raw.communiques.length ? raw.communiques : (raw.communications || []),
      enfants: (raw.enfants || []).map((e) => {
        const s = e.scolarite || {};
        return Object.assign({}, e, {
          classe_nom: e.classe_nom || e.classe || "-",
          matricule: e.matricule || e.matricule_unique || "-",
          scolarite_due: e.scolarite_due != null ? e.scolarite_due : Number(s.dueCents || 0) / 100,
          solde: e.solde != null ? e.solde : Number(s.balanceCents || 0) / 100,
          total_paye: e.total_paye != null ? e.total_paye : Number(s.paidCents || 0) / 100,
          paiements: (e.paiements || []).map((p) => Object.assign({}, p, {
            type_frais: p.type_frais || p.type || "Paiement",
            montant: p.montant != null ? p.montant : Number(p.montantCents || 0) / 100,
            date: p.date || p.date_paiement || ""
          })),
          frais: Array.isArray(e.frais) ? e.frais : []
        });
      })
    });
    const communiques = [...(d.communiques || [])].sort((a, b) => this.communiqueTime(b) - this.communiqueTime(a));
    const latest = communiques[0];
    const older = communiques.slice(1);
    const notifications = typeof Notification !== "undefined" && Notification.permission !== "granted"
      ? `<div class="card notification-settings"><div><strong>Recevoir les nouveaux communiqués</strong><div class="meta">Le navigateur peut afficher une notification lorsque la page est ouverte.</div></div><button class="secondary" onclick="App.enableNotifications()">Activer</button></div>` : "";
    return `
      ${latest ? `<div class="card announcements-priority">
        <div class="announcement-heading"><span><span class="announcement-label">Dernier communiqué</span><span class="announcement-title">${this.escapeHtml(latest.titre || "Communiqué")}</span></span><time class="announcement-date">${this.escapeHtml(this.communiqueDate(latest))}</time></div>
        <div class="announcement-message">${this.escapeHtml(latest.message || "").replace(/\n/g, "<br>")}</div>
      </div>` : ""}
      ${older.length ? `<div class="card announcements-history">
        <details data-state-key="announcements-history">
          <summary>Voir les anciens communiqués (${older.length})</summary>
          <div class="announcement-list">${older.map((c) => `
            <details class="announcement-item" data-state-key="announcement-${this.escapeHtml(this.communiqueKey(c))}"><summary><span class="announcement-title">${this.escapeHtml(c.titre || "Communiqué")}</span><time class="announcement-date">${this.escapeHtml(this.communiqueDate(c))}</time></summary><div class="announcement-message">${this.escapeHtml(c.message || "").replace(/\n/g, "<br>")}</div></details>`).join("")}</div>
        </details>
      </div>` : (!latest ? `<div class="card"><div class="empty">Aucun communiqué</div></div>` : "")}
      ${notifications}
      <div class="card" id="mes-enfants">
        <div class="row" style="justify-content:space-between">
          <h2 style="margin:0">Mes enfants</h2>
          <div class="row"><span class="meta">Prochaine mise à jour : ${this.escapeHtml(this.state.syncPlan?.label || "selon le planning")}</span><button class="secondary" onclick="App.logout()">Quitter</button></div>
        </div>
        ${d.enfants.map((e) => `
          <div class="card" style="background:#f8f9fc">
            <h2>${this.escapeHtml([e.nom, e.postnom, e.prenom].filter(Boolean).join(" "))}</h2>
            <div class="meta">Classe: ${this.escapeHtml(e.classe_nom || "-")} · Matricule: ${this.escapeHtml(e.matricule || "-")}</div>
            <div class="grid" style="margin-top:8px">
              <div class="stat fee-school"><div class="n">${this.fmt(e.scolarite_due, e.scolarite?.devise || d.currency)}</div><div class="l">Scolarité — dû</div></div>
              <div class="stat balance-due"><div class="n">${this.fmt(e.solde, e.scolarite?.devise || d.currency)}</div><div class="l">Solde restant</div></div>
              <div class="stat balance-paid"><div class="n">${this.fmt(e.total_paye, e.scolarite?.devise || d.currency)}</div><div class="l">Total déjà payé</div></div>
            </div>
            <div class="fee-breakdown"><h3>Autres frais — propres à la classe</h3>${e.frais.length ? `${e.frais.map((f) => { const due = Number(f.dueCents || 0) / 100; const paid = Number(f.total || 0); const balance = Number(f.balanceCents || 0) / 100; return `<div class="fee-row"><strong>${this.escapeHtml(f.type)}</strong><div class="fee-vals"><span><small>Dû</small>${this.fmt(due, f.devise)}</span><span class="fee-paid"><small>Payé</small>${this.fmt(paid, f.devise)}</span><span class="${balance > 0 ? "fee-balance" : "fee-clear"}"><small>Solde</small>${this.fmt(balance, f.devise)}</span></div></div>`; }).join("")}` : `<div class="fee-empty meta">Aucun autre frais configuré pour cette classe</div>`}</div>
            ${e.paiements && e.paiements.length ? `
              <details data-state-key="payments-${this.escapeHtml(e.matricule || e.id || e.nom || "eleve")}" style="margin-top:12px">
                <summary style="cursor:pointer;font-weight:700">Voir l'historique des paiements (${e.paiements.length})</summary>
                <div style="margin-top:8px">
                  ${e.paiements.map((p) => `<div class="list-item"><div>${this.escapeHtml(p.type_frais)} ${p.operation && p.operation !== "PAYMENT" ? "(" + this.escapeHtml(p.operation) + ")" : ""}<div class="meta">${this.escapeHtml(this.dateFmt(p.date))}${p.reference ? " · " + this.escapeHtml(p.reference) : ""}</div></div><div class="badge">${this.fmt(p.montant, p.devise)}</div></div>`).join("")}
                </div>
              </details>
            ` : `<div class="meta" style="margin-top:12px">Aucun paiement enregistre</div>`}
          </div>`).join("")}
      </div>
      `;
  },
  fmt(n, overrideCurrency) {
    const childCurrency = this.state.data && this.state.data.enfants && this.state.data.enfants[0] && this.state.data.enfants[0].scolarite && this.state.data.enfants[0].scolarite.devise;
    const currency = overrideCurrency || (this.state.data && this.state.data.currency) || childCurrency || "USD";
    return Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (currency ? " " + currency : "");
  }
};

window.App = App;
document.addEventListener("DOMContentLoaded", () => App.init());

