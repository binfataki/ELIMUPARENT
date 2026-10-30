// app.js — Parents
// Session parent persistante facultative, avec publication automatique planifiée.
//
// Pages (SPA) : home (communiqués) · children (MES ENFANTS) · child (fiche) ·
// absences (détail de la semaine) · scan (QR). La limite de 42 heures concerne
// uniquement l'affichage des paiements : aucun calcul financier n'est modifié ici.

const App = {
  state: { phone: "", data: null, branding: {}, view: "login", page: "home", selectedChild: "", loginMode: "qr", qrLoading: false, scanOpen: false, sessionToken: "", rememberDevice: false, syncPlan: null, fetchedAt: 0 },

  PAYMENT_WINDOW_HOURS: 42,
  // Tolérance sur l'heure de l'appareil (paiement daté légèrement dans le futur).
  PAYMENT_FUTURE_SKEW_MS: 6 * 60 * 60 * 1000,
  PAGES: ["home", "children", "child", "absences"],
  // Codes serveur qui signifient que la session n'est plus valable : seuls ces
  // cas effacent la session et le cache local (jamais une simple panne réseau).
  SESSION_ERROR_CODES: ["SESSION_INVALIDE", "ACCES_REFUSE", "PARENT_NON_CONFIGURE"],

  async init() {
    this.bindEvents();
    await this.restoreCachedDashboard();
    this.render();
    // L'identité distante ne doit pas retarder l'affichage de la vue locale.
    this.loadBranding().then(() => this.render()).catch(() => {});
    // Le cache donne une vue immédiate ; la validation de session et les
    // nouvelles données arrivent ensuite sans bloquer le premier affichage.
    this.restoreSession().then(() => this.render()).catch(() => {});
    this.refreshStatusPill();
    window.addEventListener("offline", () => this.refreshStatusPill());
    window.addEventListener("online", () => { this.refreshStatusPill(); this.scheduleSync(); this.catchUpIfNeeded(); });
  },

  bindEvents() {
    if (this._eventsBound) return;
    this._eventsBound = true;
    const app = document.getElementById("app");
    // Délégation : les clés d'enfants ne sont jamais collées dans du JavaScript inline.
    if (app) app.addEventListener("click", (event) => {
      const target = event.target && event.target.closest ? event.target.closest("[data-open-child],[data-open-absences]") : null;
      if (!target) return;
      const child = target.getAttribute("data-open-child");
      if (child !== null) return this.openChild(child);
      this.openAbsences(target.getAttribute("data-open-absences"));
    });
    // Bouton « retour » du téléphone : navigue dans l'application et coupe la caméra.
    window.addEventListener("popstate", (event) => {
      if (this.state.view !== "dashboard") return;
      const saved = event.state || {};
      const page = this.PAGES.indexOf(saved.page) >= 0 ? saved.page : "home";
      this.navigate(page, saved.key, { fromHistory: true });
      if (page === "scan") setTimeout(() => this.startQrScanner(), 0);
    });
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
    // deux fenêtres de synchronisation. Si le dernier créneau prévu est déjà
    // passé alors que le portail était fermé, une seule lecture de rattrapage
    // est faite à l'ouverture ; sinon la prochaine lecture reste planifiée.
    if (this.state.view === "dashboard" && this.state.data) {
      this.scheduleSync();
      await this.catchUpIfNeeded();
      return;
    }
    try {
      const saved = await ELIMU_Storage.getParentSession();
      if (!saved || !saved.token) return;
      const result = await ELIMU_Api.restoreParentSession(saved.token);
      const data = this.normalizePayload(result && result.data ? result.data : result);
      if (!data.enfants || !data.enfants.length) throw Object.assign(new Error("Session sans élève"), { code: "SESSION_INVALIDE" });
      this.state.sessionToken = saved.token;
      this.state.rememberDevice = Boolean(saved.persistent);
      this.state.data = data;
      this.state.fetchedAt = Date.now();
      this.state.view = "dashboard";
      this.state.page = "home";
      this.state.syncPolicy = data.syncPolicy || this.state.branding.syncPolicy || {};
      this.scheduleSync();
      await this.notifyNewCommunique(data);
    } catch (e) {
      // Une panne réseau ou un service momentanément indisponible ne doit jamais
      // effacer la session ni le cache hors connexion.
      if (!e || this.SESSION_ERROR_CODES.indexOf(e.code) < 0) return;
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
      this.state.fetchedAt = Date.parse(cached.savedAt) || 0;
      this.state.view = "dashboard";
      this.state.page = "home";
      this.state.syncPolicy = data.syncPolicy || this.state.branding.syncPolicy || {};
      this.scheduleSync();
      this.state.rememberDevice = Boolean(cached.rememberDevice);
    } catch (_) {}
  },

  async cacheDashboard(data) {
    this.state.fetchedAt = Date.now();
    try {
      if (!this.state.rememberDevice) {
        await ELIMU_Storage.delete("meta", "parent_data");
        return;
      }
      await ELIMU_Storage.setMeta("parent_data", {
        data,
        phone: this.state.phone,
        rememberDevice: this.state.rememberDevice,
        savedAt: new Date(this.state.fetchedAt).toISOString()
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

  // Vrai si le dernier créneau de synchronisation de ce parent est déjà passé
  // et que le snapshot local est plus ancien que ce créneau.
  needsCatchUp() {
    if (!this.state.sessionToken || this.state.view !== "dashboard" || !window.ELIMU_SYNC_SCHEDULE || !ELIMU_SYNC_SCHEDULE.lastSlot) return false;
    const last = ELIMU_SYNC_SCHEDULE.lastSlot("PARENTS", this.state.phone || this.state.sessionToken, new Date());
    if (!last) return false;
    return Number(this.state.fetchedAt || 0) < new Date(last).getTime();
  },

  async catchUpIfNeeded() {
    if (!navigator.onLine || !this.needsCatchUp()) return;
    await this.refresh(true);
  },

  async refreshStatusPill() {
    const pill = document.getElementById("status-pill");
    if (!pill) return;
    const online = navigator.onLine;
    pill.className = "status-pill " + (online ? "online" : "offline");
    pill.textContent = online ? "En ligne" : "Hors ligne";
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
    if (ph) this.state.phone = ph.value;
    const rememberPhone = document.getElementById("remember-device"), rememberQr = document.getElementById("remember-device-qr");
    if (rememberPhone) this.state.rememberDevice = rememberPhone.checked;
    if (rememberQr) this.state.rememberDevice = rememberQr.checked;
    const detailsState = this.captureDetailsState();
    document.getElementById("app").innerHTML = this.state.view === "login" ? this.viewLogin() : this.viewDashboard();
    if (focused) { const n = document.getElementById("phone-input"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }
    this.restoreDetailsState(detailsState);
    this.enforceExclusiveDetails();
    this.updateContactLink();
    const logoutButton = document.getElementById("logout-btn");
    if (logoutButton) logoutButton.classList.toggle("hidden", this.state.view !== "dashboard");
    const bottomNav = document.getElementById("bottom-nav");
    if (bottomNav) {
      bottomNav.classList.toggle("hidden", this.state.view !== "dashboard");
      const scanNav = document.getElementById("scan-nav");
      if (scanNav) {
        scanNav.classList.toggle("scan-open", Boolean(this.state.scanOpen));
        scanNav.setAttribute("aria-expanded", this.state.scanOpen ? "true" : "false");
        scanNav.innerHTML = this.state.scanOpen
          ? `<video id="qr-video" autoplay playsinline muted aria-label="Caméra de scan"></video><span class="scan-nav-help" id="qr-help">Cadrez le QR code</span>`
          : `<span aria-hidden="true">▣</span><small>Scan</small>`;
      }
      // Fiche et absences appartiennent à la section « Mes enfants ».
      const section = { child: "children", absences: "children" }[this.state.page] || this.state.page;
      bottomNav.querySelectorAll("[data-page]").forEach((button) => {
        const active = button.dataset.page === section;
        button.classList.toggle("active", active);
        button.setAttribute("aria-current", active ? "page" : "false");
      });
    }
    this.applyBranding();
    this.refreshStatusPill();
    this.syncScannerAfterRender();
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

  // ───────────── Navigation ─────────────
  // Point d'entrée unique. Le scan n'existe que sur l'écran de connexion :
  // toute navigation dans le portail coupe donc la caméra par sécurité.
  navigate(page, key, options = {}) {
    this.stopQrScanner(false);
    this.state.scanOpen = false;
    this.state.page = page;
    if (key !== undefined && key !== null) this.state.selectedChild = String(key);
    if (!options.fromHistory) this.pushHistory(page, this.state.selectedChild);
    this.render();
    try { if (typeof window.scrollTo === "function") window.scrollTo(0, 0); } catch (_) {}
  },

  pushHistory(page, key) {
    try {
      const current = window.history.state || {};
      if (current.page === page && (current.key || "") === (key || "")) return;
      window.history.pushState({ page, key: key || "" }, "", "#" + page);
    } catch (_) {}
  },

  childKey(child) { return String(child && (child.matricule || child.matricule_unique || child.id || child.nom) || ""); },
  childByKey(key) { return ((this.state.data && this.state.data.enfants) || []).find((child) => this.childKey(child) === String(key)) || null; },
  goHome() { this.navigate("home"); },
  showChildren() { this.navigate("children"); },
  openChild(key) { this.navigate("child", key); },
  openAbsences(key) { this.navigate("absences", key); },
  openScanner() {
    if (this.state.view !== "dashboard") return;
    if (this.state.scanOpen) {
      this.stopQrScanner(true);
      this.state.scanOpen = false;
      this.render();
      return;
    }
    this.state.scanOpen = true;
    this.render();
    setTimeout(() => this.startQrScanner(), 0);
  },

  confirmLogout() {
    const message = "Se déconnecter de cet appareil ? Les données enregistrées sur ce téléphone seront effacées.";
    if (typeof window.confirm !== "function" || window.confirm(message)) this.logout();
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

  // ───────────── Connexion ─────────────
  viewQrLoading() {
    return `
      <section class="card login qr-loading" aria-live="polite" aria-busy="true">
        <div class="loading-spinner" aria-hidden="true"></div>
        <h2>Lecture de la carte…</h2>
        <p class="meta">Le QR code a bien été scanné. Vérification de votre accès en cours.</p>
      </section>`;
  },

  viewLogin() {
    if (this.state.qrLoading) return this.viewQrLoading();
    if (this.state.loginMode === "phone") return `
      <form class="card login" onsubmit="event.preventDefault();App.login()">
        <button class="secondary login-back" type="button" onclick="App.showQrLogin()">← Scanner la carte</button>
        <h2>Espace parent</h2>
        <p class="meta">Entrez votre numéro de téléphone tel qu'enregistré par l'école.</p>
        <div id="login-err" role="alert"></div>
        <label for="phone-input">Numéro de téléphone</label>
        <input id="phone-input" type="tel" inputmode="tel" autocomplete="tel" placeholder="+243 8xx xxx xxx" value="${this.escapeHtml(this.state.phone)}">
        <label class="remember-device" for="remember-device"><input id="remember-device" type="checkbox" ${this.state.rememberDevice ? "checked" : ""}> Mémoriser cet appareil pendant 30 jours</label>
        <div class="form-actions"><button id="login-btn" type="submit"><span class="button-label">Se connecter</span><span class="button-spinner" aria-hidden="true"></span></button></div>
      </form>`;
    return `
      <section class="card login qr-login">
        <h2>Espace parent</h2>
        <p class="meta">Scannez la carte de votre enfant pour accéder directement à vos enfants.</p>
        <div id="login-err" role="alert"></div>
        <button class="qr-primary-button" type="button" onclick="App.startQrScanner()" aria-label="Scanner la carte de l'enfant pour se connecter"><span class="qr-viewfinder" aria-hidden="true"><span class="qr-button-icon">▣</span></span><strong>Scanner la carte de l'enfant</strong><small>Appuyez ici pour ouvrir la caméra</small></button>
        <label class="remember-device" for="remember-device-qr"><input id="remember-device-qr" type="checkbox" ${this.state.rememberDevice ? "checked" : ""}> Mémoriser cet appareil pendant 30 jours</label>
        <div id="qr-scanner" class="qr-scanner hidden" aria-live="polite">
          <video id="qr-video" autoplay playsinline muted></video>
          <div class="qr-frame" aria-hidden="true"></div>
          <p id="qr-help" class="meta">Cadrez le QR code de la carte.</p>
          <button class="secondary" type="button" onclick="App.stopQrScanner(true)">Fermer la caméra</button>
          <div class="qr-manual"><label for="qr-manual-input">Si la caméra n'est pas disponible</label><div class="row"><input id="qr-manual-input" placeholder="ELV-000001 ou QR complet"><button type="button" onclick="App.loginWithQr(document.getElementById('qr-manual-input').value)">Valider</button></div></div>
        </div>
        <button class="phone-login-button" type="button" onclick="App.showPhoneLogin()">Se connecter avec le numéro de téléphone</button>
      </section>`;
  },

  showPhoneLogin() { this.stopQrScanner(false); this.state.loginMode = "phone"; this.render(); },
  showQrLogin() { this.stopQrScanner(false); this.state.loginMode = "qr"; this.render(); },

  extractMatricule(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw);
      for (const key of ["matricule", "student_id", "id"]) {
        if (url.searchParams.get(key)) return url.searchParams.get(key).trim();
      }
    } catch (_) {}
    const match = raw.match(/(?:^|:|[/=])((?:ELV|STU)[-_][A-Z0-9-]+)/i);
    return match ? match[1] : raw.split(":").pop().trim();
  },

  // ───────────── Scanner QR ─────────────
  attachQrStream() {
    const video = document.getElementById("qr-video");
    if (!video || !this.qrStream) return;
    if (video.srcObject !== this.qrStream) {
      video.srcObject = this.qrStream;
      try { const played = video.play && video.play(); if (played && played.catch) played.catch(() => {}); } catch (_) {}
    }
  },

  // Après un rendu, la caméra doit suivre l'écran : reliée à la nouvelle balise
  // vidéo si elle existe encore, coupée si l'écran n'en contient plus.
  syncScannerAfterRender() {
    if (!this.qrStream) return;
    if (!document.getElementById("qr-video")) { this.stopQrScanner(false); return; }
    const scanner = document.getElementById("qr-scanner");
    if (scanner) scanner.classList.remove("hidden");
    this.attachQrStream();
  },

  async startQrScanner() {
    const video = document.getElementById("qr-video");
    const help = document.getElementById("qr-help");
    if (!video) return;
    if (!navigator.mediaDevices?.getUserMedia) { if (help) help.textContent = "Caméra indisponible. Utilisez la saisie manuelle ci-dessous."; return; }
    try {
      if (!this.qrStream) this.qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      // L'utilisateur a pu quitter l'écran pendant la demande d'autorisation.
      if (!document.getElementById("qr-video")) { this.stopQrScanner(false); return; }
      this.attachQrStream();
      if ("BarcodeDetector" in window) {
        this.qrDetector = new BarcodeDetector({ formats: ["qr_code"] });
        this.qrScanActive = true;
        const scanId = this.qrScanId = (this.qrScanId || 0) + 1;
        const scan = async () => {
          if (!this.qrScanActive || this.qrScanId !== scanId) return;
          const current = document.getElementById("qr-video");
          if (current && current.videoWidth) {
            try {
              const codes = await this.qrDetector.detect(current);
              if (codes && codes[0]?.rawValue) { this.qrScanActive = false; await this.loginWithQr(codes[0].rawValue, true); return; }
            } catch (_) {}
          }
          requestAnimationFrame(scan);
        };
        requestAnimationFrame(scan);
      } else if (help) help.textContent = "La détection automatique n'est pas disponible. Saisissez le matricule sous la caméra.";
    } catch (_) { if (help) help.textContent = "Caméra refusée ou indisponible. Saisissez le matricule de la carte."; }
  },

  stopQrScanner(reset = false) {
    this.qrScanActive = false;
    this.qrScanId = (this.qrScanId || 0) + 1;
    if (this.qrStream) this.qrStream.getTracks().forEach((track) => track.stop());
    this.qrStream = null;
    const video = document.getElementById("qr-video");
    if (video) video.srcObject = null;
    const scanner = document.getElementById("qr-scanner");
    if (reset && scanner) scanner.classList.add("hidden");
  },

  sameFamily(a, b) {
    const keys = (d) => ((d && d.enfants) || []).map((child) => this.childKey(child)).filter(Boolean);
    const right = keys(b);
    return keys(a).some((key) => right.indexOf(key) >= 0);
  },

  async loginWithQr(value, scanned = false) {
    const matricule = this.extractMatricule(value);
    const err = document.getElementById("login-err");
    if (!matricule) { if (err) err.innerHTML = `<div class="err-box">Scannez une carte valide.</div>`; return; }
    if (this.state.qrLoading) return;
    if (scanned && navigator.vibrate) navigator.vibrate(80);
    const box = document.getElementById("remember-device-qr");
    if (box) this.state.rememberDevice = box.checked;
    // Un parent déjà connecté qui scanne une carte ne perd ni sa session
    // persistante ni son cache : le mode de mémorisation est conservé et rien
    // n'est effacé avant d'avoir reçu les nouvelles données.
    const loggedIn = this.state.view === "dashboard" && Boolean(this.state.data);
    this.qrScanActive = false;
    const help = document.getElementById("qr-help");
    if (help) help.textContent = "Vérification de la carte…";
    this.stopQrScanner(false);
    this.state.qrLoading = true;
    this.render();
    try {
      const session = await ELIMU_Api.createParentSessionFromQr(matricule);
      const data = this.normalizePayload(session && session.data ? session.data : session);
      if (!data?.enfants?.length) throw new Error("Aucun enfant associé à cette carte");
      const sameFamily = loggedIn && this.sameFamily(this.state.data, data);
      if (loggedIn && !sameFamily) {
        const ask = "Cette carte appartient à une autre famille. Voulez-vous changer de compte sur cet appareil ?";
        const accepted = typeof window.confirm === "function" ? window.confirm(ask) : false;
        if (!accepted) { this.state.qrLoading = false; this.navigate("home"); this.toast("Compte inchangé"); return; }
      }
      const remember = Boolean(this.state.rememberDevice);
      this.state.qrLoading = false;
      this.state.scanOpen = false;
      this.state.phone = sameFamily ? this.state.phone : "";
      this.state.sessionToken = session.token || (sameFamily ? this.state.sessionToken : "");
      this.state.rememberDevice = remember && Boolean(this.state.sessionToken);
      this.state.data = data;
      this.state.view = "dashboard";
      this.state.page = "home";
      this.state.syncPolicy = data.syncPolicy || this.state.branding.syncPolicy || {};
      this.scheduleSync();
      if (!this.state.sessionToken && loggedIn) await ELIMU_Storage.clearParentSession();
      await this.cacheDashboard(data);
      if (this.state.sessionToken) await ELIMU_Storage.setParentSession({ token: this.state.sessionToken, expiresAt: Date.now() + Number(session.expiresIn || 0) * 1000 }, this.state.rememberDevice);
      if (sameFamily) await this.notifyNewCommunique(data); else await this.initialiseCommuniqueMarker(data);
      // Après un scan réussi, l'entrée « Scan » de l'historique devient l'accueil.
      try { window.history.replaceState({ page: "home", key: "" }, "", "#home"); } catch (_) {}
      this.render();
    } catch (e) {
      this.state.qrLoading = false;
      this.render();
      const loginError = document.getElementById("login-err");
      const qrHelp = document.getElementById("qr-help");
      if (loginError) loginError.innerHTML = `<div class="err-box">${this.escapeHtml(e.message)}</div>`;
      if (qrHelp) qrHelp.textContent = "Carte non reconnue. Réessayez ou utilisez le numéro de téléphone.";
    }
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
      this.state.page = "home";
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
    this.stopQrScanner(false);
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
    this.state.fetchedAt = 0;
    this.state.view = "login";
    this.state.page = "home";
    this.state.loginMode = "qr";
    this.render();
  },

  // ───────────── Communiqués ─────────────
  communiqueTime(c) { return new Date(c && (c.date_envoi || c.created_at || c.date) || 0).getTime() || 0; },
  communiqueDate(c) { const t = this.communiqueTime(c); return t ? this.dateFmt(t) : ""; },
  dateFmt(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value || "");
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  },
  dateTimeShort(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} à ${p(d.getHours())}:${p(d.getMinutes())}`;
  },
  // AAAA-MM-JJ → JJ/MM/AAAA
  dateShort(iso) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || "");
  },
  // AAAA-MM-JJ → « Lundi 27 octobre 2026 »
  dayLabel(iso) {
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return String(iso || "");
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
    const text = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    return text.charAt(0).toUpperCase() + text.slice(1);
  },
  todayIso() {
    const d = new Date(), p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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

  // ───────────── Vues ─────────────
  viewDashboard() {
    if (this.state.qrLoading) return this.viewQrLoading();
    if (this.state.page === "children") return this.viewChildren();
    if (this.state.page === "child") return this.viewChild();
    if (this.state.page === "absences") return this.viewAbsences();
    return this.viewHomeNew();
  },

  // Paiement affiché seulement s'il date de moins de 42 h. Défense côté portail
  // pour un snapshot gardé hors connexion : les données elles-mêmes ne sont pas
  // modifiées et les calculs financiers n'utilisent jamais cette liste.
  isRecentPayment(p) {
    const t = new Date(p && p.date).getTime();
    if (!Number.isFinite(t)) return false;
    const age = Date.now() - t;
    return age <= this.PAYMENT_WINDOW_HOURS * 60 * 60 * 1000 && age >= -this.PAYMENT_FUTURE_SKEW_MS;
  },

  normalizeAbsences(value) {
    const src = value || {};
    const seen = {}, days = [];
    (Array.isArray(src.jours) ? src.jours : []).forEach((day) => {
      const date = String(day && day.date || "").slice(0, 10);
      // Seul le statut actuel compte : un jour corrigé en PRESENT n'est pas une absence.
      if (!date || seen[date] || String(day.statut || "ABSENT").trim().toUpperCase() !== "ABSENT") return;
      seen[date] = true;
      days.push({ date, statut: "ABSENT", updatedAt: day.updatedAt || "" });
    });
    days.sort((a, b) => a.date.localeCompare(b.date));
    return { semaineDebut: src.semaineDebut || "", semaineFin: src.semaineFin || "", nombre: Array.isArray(src.jours) ? days.length : Number(src.nombre || 0), jours: days };
  },

  normalizedChildren() {
    const raw = Object.assign({ enfants: [] }, this.state.data || {});
    return (raw.enfants || []).map((e, index) => {
      const s = e.scolarite || {};
      const due = e.scolarite_due != null ? Number(e.scolarite_due) : Number(s.dueCents || 0) / 100;
      const balance = e.solde != null ? Number(e.solde) : Number(s.balanceCents || 0) / 100;
      let paid = 0;
      if (e.total_paye != null) paid = Number(e.total_paye);
      else if (s.paidCents != null) paid = Number(s.paidCents) / 100;
      else if (e.scolarite_due != null && e.solde != null) paid = due - balance; // ancien format sans total payé
      return Object.assign({}, e, {
        key: this.childKey(e) || ("enfant-" + index),
        classe_nom: e.classe_nom || e.classe || "-",
        matricule: e.matricule || e.matricule_unique || "-",
        scolarite_due: due,
        solde: balance,
        total_paye: paid,
        paiements: (e.paiements || []).map((p) => Object.assign({}, p, {
          type_frais: p.type_frais || p.type || "Paiement",
          montant: p.montant != null ? p.montant : Number(p.montantCents || 0) / 100,
          date: p.date || p.date_paiement || ""
        })).filter((p) => this.isRecentPayment(p))
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        frais: Array.isArray(e.frais) ? e.frais : [],
        absences: this.normalizeAbsences(e.absences)
      });
    });
  },

  childName(e) { return [e.nom, e.postnom, e.prenom].filter(Boolean).join(" ") || "Enfant"; },
  selectedChildData() { return this.normalizedChildren().find((child) => child.key === this.state.selectedChild) || null; },

  absenceSummary(abs) {
    const count = Number(abs && abs.nombre || 0), plural = count > 1 ? "s" : "";
    const period = abs && abs.semaineDebut ? `${this.dateShort(abs.semaineDebut)} au ${this.dateShort(abs.semaineFin)}` : "";
    // Un snapshot gardé hors connexion peut dater d'une semaine passée : on l'indique.
    const stale = Boolean(abs && abs.semaineFin) && abs.semaineFin < this.todayIso();
    let label;
    if (stale) label = count ? `${count} jour${plural} d’absence (semaine du ${period})` : `Aucune absence (semaine du ${period})`;
    else label = count ? `${count} jour${plural} d’absence cette semaine` : "Aucune absence cette semaine";
    return { count, stale, period, label };
  },

  updatedLine() {
    const t = Number(this.state.fetchedAt || 0);
    if (!t) return "";
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    return `<p class="updated-line meta">${offline ? "Hors connexion · " : ""}Dernière mise à jour : ${this.escapeHtml(this.dateTimeShort(t))}</p>`;
  },

  viewHomeNew() {
    const raw = Object.assign({ communiques: [] }, this.state.branding || {}, (this.state.data && this.state.data.etablissement) || {}, this.state.data || {});
    const list = [...(raw.communiques && raw.communiques.length ? raw.communiques : (raw.communications || []))].sort((a, b) => this.communiqueTime(b) - this.communiqueTime(a));
    const latest = list[0], older = list.slice(1);
    const notifications = typeof Notification !== "undefined" && Notification.permission !== "granted"
      ? `<div class="card notification-settings"><div><strong>Recevoir les nouveaux communiqués</strong><div class="meta">Le navigateur peut afficher une notification lorsque la page est ouverte.</div></div><button class="secondary" onclick="App.enableNotifications()">Activer</button></div>` : "";
    // Les retours à la ligne sont rendus par white-space: pre-wrap (CSS), sans <br>.
    const childrenCta = `<button class="children-cta" type="button" onclick="App.showChildren()"><span class="children-cta-icon" aria-hidden="true">♙</span><span class="children-cta-text"><strong>MES ENFANTS</strong><small>Finances, absences et paiements</small></span><span class="child-arrow" aria-hidden="true">›</span></button>`;
    return `${childrenCta}<section class="page-heading"><span class="eyebrow">Accueil</span><h2>Communiqués de l’établissement</h2><p class="meta">Les informations importantes sont regroupées ici.</p></section>${latest ? `<div class="card announcements-priority"><div class="announcement-heading"><span><span class="announcement-label">Dernier communiqué</span><span class="announcement-title">${this.escapeHtml(latest.titre || "Communiqué")}</span></span><time class="announcement-date">${this.escapeHtml(this.communiqueDate(latest))}</time></div><div class="announcement-message">${this.escapeHtml(latest.message || "")}</div></div>` : `<div class="card"><div class="empty">Aucun communiqué disponible.</div></div>`}${older.length ? `<div class="card announcements-history"><details><summary>Voir les anciens communiqués (${older.length})</summary><div class="announcement-list">${older.map((c) => `<details class="announcement-item"><summary><span class="announcement-title">${this.escapeHtml(c.titre || "Communiqué")}</span><time class="announcement-date">${this.escapeHtml(this.communiqueDate(c))}</time></summary><div class="announcement-message">${this.escapeHtml(c.message || "")}</div></details>`).join("")}</div></details></div>` : ""}${notifications}${this.updatedLine()}`;
  },

  viewChildren() {
    const children = this.normalizedChildren();
    const heading = `<section class="page-heading"><span class="eyebrow">Famille</span><h2>MES ENFANTS</h2><p class="meta">${children.length > 1 ? "Sélectionnez un enfant pour consulter sa situation." : "Ouvrez la fiche pour consulter la situation de votre enfant."}</p></section>`;
    if (!children.length) return `${heading}<div class="card"><div class="empty">Aucun enfant n’est associé à cet accès.</div></div>`;
    const avatar = (e) => `<span class="child-avatar">${this.escapeHtml(this.childName(e).slice(0, 1).toUpperCase())}</span>`;
    if (children.length === 1) {
      // Un seul enfant : une carte détaillée avec l'essentiel, ouverte sur la fiche.
      const e = children[0], currency = e.scolarite?.devise || "USD", abs = this.absenceSummary(e.absences);
      return `${heading}<div class="children-list single"><button class="child-card child-card-featured" type="button" data-open-child="${this.escapeHtml(e.key)}">${avatar(e)}<span class="child-card-text"><strong>${this.escapeHtml(this.childName(e))}</strong><span>Classe : ${this.escapeHtml(e.classe_nom)}${e.matricule !== "-" ? ` · Matricule : ${this.escapeHtml(e.matricule)}` : ""}</span><span class="child-card-facts"><span><small>Solde restant</small>${this.fmt(e.solde, currency)}</span><span><small>Absences</small>${this.escapeHtml(abs.label)}</span></span></span><span class="child-arrow" aria-hidden="true">›</span></button></div>${this.updatedLine()}`;
    }
    return `${heading}<div class="children-list">${children.map((e) => `<button class="child-card" type="button" data-open-child="${this.escapeHtml(e.key)}">${avatar(e)}<span class="child-card-text"><strong>${this.escapeHtml(this.childName(e))}</strong><span>${this.escapeHtml(e.classe_nom)}</span></span><span class="child-arrow" aria-hidden="true">›</span></button>`).join("")}</div>${this.updatedLine()}`;
  },

  viewChild() {
    const e = this.selectedChildData();
    if (!e) return `<button class="back-link" type="button" onclick="App.showChildren()">← MES ENFANTS</button><div class="card"><div class="empty">Enfant introuvable.</div></div>`;
    const currency = e.scolarite?.devise || "USD", abs = this.absenceSummary(e.absences);
    const facts = [["Classe", e.classe_nom], ["Matricule", e.matricule], ["Année scolaire", e.anneeScolaire || e.annee_scolaire || ""]]
      .filter((fact) => fact[1] && fact[1] !== "-");
    return `<button class="back-link" type="button" onclick="App.showChildren()">← MES ENFANTS</button><section class="page-heading"><span class="eyebrow">Fiche de l’enfant</span><h2>${this.escapeHtml(this.childName(e))}</h2><dl class="child-facts">${facts.map((fact) => `<div><dt>${fact[0]}</dt><dd>${this.escapeHtml(fact[1])}</dd></div>`).join("")}</dl></section><button class="absence-indicator ${abs.count ? "has-absence" : "no-absence"}" type="button" data-open-absences="${this.escapeHtml(e.key)}"><span class="absence-text"><strong>${this.escapeHtml(abs.label)}</strong><span class="meta">Voir le détail des présences</span></span><span class="child-arrow" aria-hidden="true">›</span></button><section class="card"><h3 class="section-title">Situation financière</h3><div class="grid"><div class="stat fee-school"><div class="n">${this.fmt(e.scolarite_due, currency)}</div><div class="l">Frais scolaires</div></div><div class="stat balance-paid"><div class="n">${this.fmt(e.total_paye, currency)}</div><div class="l">Montant payé</div></div><div class="stat balance-due"><div class="n">${this.fmt(e.solde, currency)}</div><div class="l">Solde restant</div></div></div></section><section class="card"><h3 class="section-title">Frais connexes</h3>${e.frais.length ? e.frais.map((f) => `<div class="fee-row"><strong>${this.escapeHtml(f.type)}</strong><div class="fee-vals"><span><small>Dû</small>${this.fmt(Number(f.dueCents || 0) / 100, f.devise)}</span><span class="fee-paid"><small>Payé</small>${this.fmt(Number(f.total || 0), f.devise)}</span><span class="${Number(f.balanceCents || 0) > 0 ? "fee-balance" : "fee-clear"}"><small>Solde</small>${this.fmt(Number(f.balanceCents || 0) / 100, f.devise)}</span></div></div>`).join("") : `<div class="empty">Aucun frais connexe configuré.</div>`}</section><section class="card"><h3 class="section-title">Paiements récents</h3><p class="meta section-note">Paiements des dernières ${this.PAYMENT_WINDOW_HOURS} heures.</p>${e.paiements.length ? e.paiements.map((p) => `<div class="list-item"><div>${this.escapeHtml(p.type_frais)}<div class="meta">${this.escapeHtml(this.dateFmt(p.date))}</div></div><div class="badge">${this.fmt(p.montant, p.devise)}</div></div>`).join("") : `<div class="empty">Aucun paiement enregistré au cours des dernières ${this.PAYMENT_WINDOW_HOURS} heures.</div>`}</section>${this.updatedLine()}`;
  },

  viewAbsences() {
    const e = this.selectedChildData();
    if (!e) return `<button class="back-link" type="button" onclick="App.showChildren()">← MES ENFANTS</button><div class="card"><div class="empty">Enfant introuvable.</div></div>`;
    const abs = this.absenceSummary(e.absences), days = e.absences.jours;
    const period = abs.period ? `Semaine du ${abs.period}` : "Semaine en cours";
    return `<button class="back-link" type="button" data-open-child="${this.escapeHtml(e.key)}">← Fiche de l’enfant</button><section class="page-heading"><span class="eyebrow">Présences</span><h2>Absences de la semaine</h2><p class="meta">${this.escapeHtml(this.childName(e))} · ${this.escapeHtml(period)}</p></section><div class="card">${days.length ? days.map((day) => `<div class="list-item absence-day"><strong>${this.escapeHtml(this.dayLabel(day.date))}</strong><span class="badge danger-badge">Absent</span></div>`).join("") : `<div class="empty">${abs.stale ? "Aucune absence enregistrée pour la dernière semaine synchronisée." : "Aucune absence enregistrée pour cette semaine."}</div>`}${abs.stale ? `<p class="stale-note meta">Ces informations datent de la dernière synchronisation. La semaine en cours apparaîtra à la prochaine mise à jour.</p>` : ""}</div>${this.updatedLine()}`;
  },

  fmt(n, overrideCurrency) {
    const childCurrency = this.state.data && this.state.data.enfants && this.state.data.enfants[0] && this.state.data.enfants[0].scolarite && this.state.data.enfants[0].scolarite.devise;
    const currency = overrideCurrency || (this.state.data && this.state.data.currency) || childCurrency || "USD";
    return Number(n || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (currency ? " " + currency : "");
  }
};

window.App = App;
document.addEventListener("DOMContentLoaded", () => App.init());
