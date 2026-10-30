'use strict';
/**
 * Mini-simulateur navigateur pour tester le portail parent avec Node.js (sans dépendance).
 * Charge les VRAIS fichiers sync-schedule.js, storage.js et app.js dans un contexte vm.
 * Simulés : DOM minimal, localStorage/sessionStorage, history, timers, API réseau et
 * la couche IndexedDB de storage.js (les fonctions de session restent celles du projet).
 */
process.env.TZ = 'Africa/Lubumbashi';
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const NOW = Date.parse('2026-10-30T08:00:00Z'); // vendredi 30/10/2026 10:00 (Lubumbashi)

class El {
  constructor(id) {
    this.id = id; this.dataset = {}; this.attrs = {}; this._classes = new Set(); this.listeners = {};
    this.value = ''; this.checked = false; this.srcObject = null; this.textContent = ''; this.className = ''; this.videoWidth = 0; this.href = '';
    const self = this;
    this.classList = {
      add: (c) => self._classes.add(c), remove: (c) => self._classes.delete(c), contains: (c) => self._classes.has(c),
      toggle: (c, force) => { const on = force === undefined ? !self._classes.has(c) : Boolean(force); if (on) self._classes.add(c); else self._classes.delete(c); return on; },
    };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  querySelector() { return new El('child'); }
  querySelectorAll() { return []; }
  closest() { return null; }
  remove() {} focus() {} setSelectionRange() {} play() { return Promise.resolve(); }
}

function createPortal({ online = true } = {}) {
  const P = { online, confirmAnswer: true, confirmCalls: [], timers: [], listeners: {}, mem: new Map(), log: [], pushed: [], toasts: [] };
  const appEl = new El('app'); let html = ''; let dynamic = {};
  Object.defineProperty(appEl, 'innerHTML', { get: () => html, set: (v) => { html = String(v); dynamic = {}; } });
  const statics = { app: appEl, 'status-pill': new El('status-pill'), 'school-name': new El('school-name'), 'logout-btn': new El('logout-btn'), 'contact-sidebar': new El('contact-sidebar'), 'contact-direction-link': new El('contact-direction-link') };
  const nav = new El('bottom-nav');
  const navButtons = ['home', 'scan', 'children'].map((page) => { const b = new El('nav-' + page); b.dataset.page = page; return b; });
  nav.querySelectorAll = () => navButtons;
  statics['bottom-nav'] = nav;
  P.nav = navButtons; P.navEl = nav; P.appEl = appEl;
  P.el = (id) => {
    if (statics[id]) return statics[id];
    if (dynamic[id]) return dynamic[id];
    if (!html.includes(`id="${id}"`)) return null;
    const e = new El(id); e.checked = new RegExp(`id="${id}"[^>]*\\schecked`).test(html);
    return (dynamic[id] = e);
  };
  P.html = () => html;

  const doc = {
    getElementById: (id) => P.el(id), querySelectorAll: () => [], addEventListener() {}, activeElement: null, title: '',
    createElement: () => { const e = new El('toast'); const orig = e.remove; e.remove = orig; return e; },
    body: { appendChild: (e) => P.toasts.push(e.textContent) },
    documentElement: { style: { setProperty() {} } },
  };
  const store = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
  P.localStorage = store(); P.sessionStorage = store();
  const history = { state: null, pushState(s) { this.state = s; P.pushed.push(s); }, replaceState(s) { this.state = s; } };
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length === 0) super(P.now); else super(...a); } static now() { return P.now; } }
  P.now = NOW;

  const sandbox = {
    console, URL, URLSearchParams, document: doc, localStorage: P.localStorage, sessionStorage: P.sessionStorage, history,
    navigator: { get onLine() { return P.online; } }, Date: FakeDate,
    setTimeout: (fn, ms) => { P.timers.push({ fn, ms }); return P.timers.length; }, clearTimeout() {}, requestAnimationFrame() {},
    addEventListener: (type, fn) => { (P.listeners[type] = P.listeners[type] || []).push(fn); },
    confirm: (msg) => { P.confirmCalls.push(msg); return P.confirmAnswer; },
    scrollTo() {},
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  P.ctx = ctx;
  for (const file of ['sync-schedule.js', 'storage.js', 'app.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });

  // Couche IndexedDB remplacée par une mémoire ; les fonctions de SESSION de storage.js restent réelles.
  const storage = vm.runInContext('ELIMU_Storage', ctx);
  storage.getMeta = async (k) => (P.mem.has(k) ? JSON.parse(P.mem.get(k)) : undefined);
  storage.setMeta = async (k, v) => { P.log.push(['set', k]); P.mem.set(k, JSON.stringify(v)); };
  storage.delete = async (store, k) => { P.log.push(['delete', k]); P.mem.delete(k); };
  P.storage = storage;

  // API réseau simulée (configurable par test).
  P.api = {
    calls: [],
    createParentSession: async () => { throw new Error('non configuré'); },
    createParentSessionFromQr: async () => { throw new Error('non configuré'); },
    restoreParentSession: async () => { throw new Error('non configuré'); },
    call: async () => ({ etablissement: {} }),
  };
  ctx.ELIMU_Api = P.api;
  P.App = vm.runInContext('App', ctx);
  P.setOnline = (v) => { P.online = v; };

  /** Affiche directement le tableau de bord (sans passer par le réseau). */
  P.show = (data, page = 'home', key = '') => {
    const A = P.App;
    A.state.data = A.normalizePayload(data); A.state.view = 'dashboard'; A.state.page = page; A.state.selectedChild = key; A.state.fetchedAt = P.now;
    A.render();
    return P.html();
  };
  return P;
}

const kid = (over = {}) => Object.assign({
  matricule: 'ELV-000001', nom: 'KAMBALE MUHINDO Jean', statut: 'ACTIF', classe: '6e A', anneeScolaire: '2026-2027',
  scolarite: { dueCents: 10000, paidCents: 8000, balanceCents: 2000, devise: 'USD' },
  frais: [], paiements: [],
  absences: { semaineDebut: '2026-10-26', semaineFin: '2026-11-01', nombre: 0, jours: [] },
}, over);

const parentData = (children, extra = {}) => Object.assign({ ok: true, enfants: children, communications: [], etablissement: { school_name: 'Ecole Test', currency: 'USD' }, syncPolicy: {} }, extra);
const session = (children, token = 'tok-1', extra = {}) => ({ ok: true, token, expiresIn: 2592000, data: parentData(children, extra) });

module.exports = { createPortal, kid, parentData, session, NOW, ROOT };
