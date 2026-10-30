'use strict';
// Lancer, depuis ce dossier : node --test        (Node.js 20+, aucune dépendance)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPortal, kid, parentData, session, NOW, ROOT } = require('./portal-env.js');

const hoursAgo = (h) => new Date(NOW - h * 3600e3).toISOString();
const pay = (id, h, over = {}) => Object.assign({ id, date: hoursAgo(h), type: 'SCOLARITE', montantCents: 2000, devise: 'USD', operation: 'PAYMENT' }, over);
const week = (jours) => ({ semaineDebut: '2026-10-26', semaineFin: '2026-11-01', nombre: jours.length, jours: jours.map((d) => ({ date: d, statut: 'ABSENT', updatedAt: '' })) });
const phoneLogin = async (P, remember, token = 'tok-phone', children = [kid()]) => {
  P.api.createParentSession = async () => session(children, token);
  P.App.state.loginMode = 'phone'; P.App.render();
  P.el('phone-input').value = '0970000001'; P.el('remember-device').checked = remember;
  await P.App.login();
};

// ───────────── Accueil (communiqués) ─────────────
test('accueil sans communiqué : message clair, pas de tableau financier', () => {
  const P = createPortal();
  const html = P.show(parentData([kid()]), 'home');
  assert.match(html, /Aucun communiqué disponible\./);
  assert.ok(!html.includes('Situation financière') && !html.includes('Solde restant'));
});

test('accueil avec plusieurs communiqués : le plus récent en priorité, anciens dépliables, sans <br> parasite', () => {
  const P = createPortal();
  const html = P.show(parentData([kid()], { communications: [
    { titre: 'Ancien 1', message: 'a', date: '2026-10-01T08:00:00' },
    { titre: 'Dernier', message: 'Ligne 1\nLigne 2', date: '2026-10-29T08:00:00' },
    { titre: 'Ancien 2', message: 'b', date: '2026-10-10T08:00:00' },
  ] }), 'home');
  assert.match(html, /Dernier communiqué[\s\S]*Dernier/);
  assert.match(html, /Voir les anciens communiqués \(2\)/);
  assert.ok(html.indexOf('Ancien 1') > html.indexOf('Dernier') && html.indexOf('Ancien 2') > html.indexOf('Dernier'));
  assert.ok(!html.includes('<br>'), 'pre-wrap gère déjà les retours à la ligne');
  assert.ok(html.includes('Ligne 1\nLigne 2'));
});

test('anciennes réponses : children / communiques / nom-postnom-prenom / classe_nom / montant / solde', () => {
  const P = createPortal();
  const legacy = { children: [{ matricule: 'ELV-7', nom: 'MBAYO', postnom: 'KALALA', prenom: 'Paul', classe_nom: '5e B', scolarite_due: 200, solde: 50,
    paiements: [{ type_frais: 'SCOLARITE', montant: 30, date_paiement: hoursAgo(2) }, { type_frais: 'SCOLARITE', montant: 99, date_paiement: hoursAgo(100) }] }],
    communiques: [{ titre: 'Rentrée', message: 'ok', date_envoi: '2026-10-20T08:00:00' }] };
  const home = P.show(legacy, 'home');
  assert.match(home, /Rentrée/);
  const c = P.App.normalizedChildren()[0];
  assert.equal(c.classe_nom, '5e B');
  assert.equal(c.scolarite_due, 200);
  assert.equal(c.solde, 50);
  assert.equal(c.total_paye, 150, 'ancien format : payé = dû − solde');
  assert.deepEqual(c.paiements.map((p) => p.montant), [30], 'montant / date_paiement lus, 100 h masqué');
  assert.deepEqual(JSON.parse(JSON.stringify(c.absences)), { semaineDebut: '', semaineFin: '', nombre: 0, jours: [] });
  const html = P.show(legacy, 'child', 'ELV-7');
  assert.match(html, /MBAYO KALALA Paul/);
});

// ───────────── MES ENFANTS ─────────────
test('MES ENFANTS : un seul enfant → carte détaillée ouvrant la fiche', () => {
  const P = createPortal();
  const html = P.show(parentData([kid()]), 'children');
  assert.match(html, /<h2>MES ENFANTS<\/h2>/);
  assert.equal((html.match(/data-open-child=/g) || []).length, 1);
  assert.match(html, /child-card-featured/);
  assert.match(html, /KAMBALE MUHINDO Jean/);
  assert.match(html, /Classe : 6e A/);
  assert.match(html, /Solde restant[\s\S]*20,00 USD/);
});

test('MES ENFANTS : plusieurs enfants → une carte chacun avec nom complet et classe', () => {
  const P = createPortal();
  const html = P.show(parentData([kid(), kid({ matricule: 'ELV-000002', nom: 'KAMBALE MUHINDO Marie', classe: '4e B' })]), 'children');
  assert.equal((html.match(/data-open-child=/g) || []).length, 2);
  assert.match(html, /KAMBALE MUHINDO Marie[\s\S]*4e B/);
  assert.ok(!html.includes('child-card-featured'));
  assert.ok(!html.includes('Solde restant'), 'pas de tableaux financiers dans la liste');
});

test('clé d’enfant jamais collée dans du JavaScript inline (apostrophe sans danger)', () => {
  const P = createPortal();
  const html = P.show(parentData([kid({ matricule: "ELV-'X" })]), 'children');
  assert.ok(!/onclick="App\.open/.test(html));
  assert.ok(html.includes('data-open-child="ELV-&#39;X"'));
  assert.equal(P.App.normalizedChildren()[0].key, "ELV-'X");
});

// ───────────── Fiche enfant : finances et paiements ─────────────
test('fiche : frais scolaires, montant payé et solde restant clairement affichés', () => {
  const P = createPortal();
  const html = P.show(parentData([kid()]), 'child', 'ELV-000001');
  assert.match(html, /100,00 USD<\/div><div class="l">Frais scolaires/);
  assert.match(html, /80,00 USD<\/div><div class="l">Montant payé/);
  assert.match(html, /20,00 USD<\/div><div class="l">Solde restant/);
  assert.match(html, /Classe[\s\S]*6e A/);
  assert.match(html, /Matricule[\s\S]*ELV-000001/);
  assert.match(html, /Année scolaire[\s\S]*2026-2027/);
});

test('fiche : frais connexes compacts (type, dû, payé, solde)', () => {
  const P = createPortal();
  const html = P.show(parentData([kid({ frais: [{ type: 'Uniforme', total: 15, dueCents: 3000, balanceCents: 1500, devise: 'USD', paiements: [] }] })]), 'child', 'ELV-000001');
  assert.match(html, /Uniforme[\s\S]*30,00 USD[\s\S]*15,00 USD[\s\S]*15,00 USD/);
});

test('paiement récent visible ; paiement de plus de 42 h non affiché mais conservé dans les données et le solde', () => {
  const P = createPortal();
  const data = parentData([kid({ paiements: [pay('RECENT', 5, { montantCents: 2000 }), pay('VIEUX', 60, { montantCents: 6000 })] })]);
  const html = P.show(data, 'child', 'ELV-000001');
  assert.match(html, /Paiements récents/);
  assert.match(html, /20,00 USD<\/div><\/div>/, 'le paiement de 5 h est listé');
  assert.ok(!html.includes('60,00 USD'), 'le paiement de 60 h n’est pas listé');
  assert.match(html, /80,00 USD<\/div><div class="l">Montant payé/, 'les calculs ne changent pas');
  assert.equal(P.App.state.data.enfants[0].paiements.length, 2, 'les données reçues ne sont pas modifiées');
});

test('limite 42 h : 41 h visible, 43 h masqué (défense côté portail)', () => {
  const P = createPortal();
  P.show(parentData([kid({ paiements: [pay('A', 41), pay('B', 43)] })]), 'child', 'ELV-000001');
  assert.deepEqual(P.App.normalizedChildren()[0].paiements.map((p) => p.id), ['A']);
});

test('aucun paiement récent : message explicite', () => {
  const P = createPortal();
  const html = P.show(parentData([kid({ paiements: [pay('VIEUX', 100)] })]), 'child', 'ELV-000001');
  assert.match(html, /Aucun paiement enregistré au cours des dernières 42 heures\./);
});

test('un paiement hors fenêtre reste affiché hors connexion tant qu’il a moins de 42 h, puis disparaît', () => {
  const P = createPortal();
  P.show(parentData([kid({ paiements: [pay('A', 40)] })]), 'child', 'ELV-000001');
  assert.equal(P.App.normalizedChildren()[0].paiements.length, 1);
  P.now = NOW + 5 * 3600e3; // 5 h plus tard, snapshot inchangé
  assert.equal(P.App.normalizedChildren()[0].paiements.length, 0);
});

// ───────────── Absences ─────────────
test('indicateur : aucune absence / 1 jour / 2 jours', () => {
  const P = createPortal();
  let html = P.show(parentData([kid()]), 'child', 'ELV-000001');
  assert.match(html, /Aucune absence cette semaine/);
  assert.ok(!html.includes('barre') && !html.includes('dot'), 'pas de points lumineux');
  html = P.show(parentData([kid({ absences: week(['2026-10-27']) })]), 'child', 'ELV-000001');
  assert.match(html, /1 jour d’absence cette semaine/);
  html = P.show(parentData([kid({ absences: week(['2026-10-26', '2026-10-28']) })]), 'child', 'ELV-000001');
  assert.match(html, /2 jours d’absence cette semaine/);
  assert.match(html, /<button class="absence-indicator has-absence"[^>]*data-open-absences="ELV-000001"/);
});

test('détail des absences : semaine, dates et statut « Absent » ; message si aucune', () => {
  const P = createPortal();
  let html = P.show(parentData([kid({ absences: week(['2026-10-26', '2026-10-28']) })]), 'absences', 'ELV-000001');
  assert.match(html, /Semaine du 26\/10\/2026 au 01\/11\/2026/);
  assert.match(html, /Lundi 26 octobre 2026/);
  assert.match(html, /Mercredi 28 octobre 2026/);
  assert.equal((html.match(/>Absent</g) || []).length, 2);
  html = P.show(parentData([kid()]), 'absences', 'ELV-000001');
  assert.match(html, /Aucune absence enregistrée pour cette semaine\./);
});

test('correction ABSENT → PRESENT : le snapshot suivant fait passer à 0 absence', () => {
  const P = createPortal();
  let html = P.show(parentData([kid({ absences: week(['2026-10-27']) })]), 'child', 'ELV-000001');
  assert.match(html, /1 jour d’absence/);
  // Snapshot suivant : le serveur n'envoie plus ce jour.
  html = P.show(parentData([kid({ absences: week([]) })]), 'child', 'ELV-000001');
  assert.match(html, /Aucune absence cette semaine/);
  // Défense : un jour au statut PRESENT, ou dupliqué, ne compte jamais comme absence.
  const dirty = { semaineDebut: '2026-10-26', semaineFin: '2026-11-01', nombre: 3, jours: [
    { date: '2026-10-27', statut: 'PRESENT' }, { date: '2026-10-28', statut: 'ABSENT' }, { date: '2026-10-28', statut: 'ABSENT' }] };
  P.show(parentData([kid({ absences: dirty })]), 'child', 'ELV-000001');
  assert.equal(P.App.normalizedChildren()[0].absences.nombre, 1);
});

test('snapshot de semaine passée consulté hors connexion : la période est indiquée', () => {
  const P = createPortal();
  P.now = NOW + 10 * 86400e3; // 10 jours plus tard
  const html = P.show(parentData([kid({ absences: week(['2026-10-27']) })]), 'child', 'ELV-000001');
  assert.match(html, /1 jour d’absence \(semaine du 26\/10\/2026 au 01\/11\/2026\)/);
  assert.ok(!html.includes('d’absence cette semaine'));
  assert.match(P.show(parentData([kid({ absences: week(['2026-10-27']) })]), 'absences', 'ELV-000001'), /dernière synchronisation/);
});

// ───────────── Connexion QR / téléphone / sessions ─────────────
test('connexion par QR : tableau de bord, session temporaire par défaut', async () => {
  const P = createPortal();
  P.App.render();
  P.api.createParentSessionFromQr = async (m) => { P.api.lastQr = m; return session([kid()], 'tok-qr'); };
  await P.App.loginWithQr('https://ecole.example/carte?matricule=ELV-000001', true);
  assert.equal(P.api.lastQr, 'ELV-000001', 'extractMatricule réutilisé');
  assert.equal(P.App.state.view, 'dashboard');
  assert.equal(P.App.state.page, 'home');
  const s = await P.storage.getParentSession();
  assert.equal(s.token, 'tok-qr'); assert.equal(s.persistent, false);
  assert.ok(!P.mem.has('parent_data'), 'rien de persistant sans « mémoriser »');
});

test('connexion par QR avec « Mémoriser cet appareil » : session et cache persistants', async () => {
  const P = createPortal();
  P.App.render();
  assert.ok(P.html().includes('id="remember-device-qr"'));
  assert.ok(!/id="remember-device-qr"[^>]*checked/.test(P.html()), 'décochée par défaut');
  P.el('remember-device-qr').checked = true;
  P.api.createParentSessionFromQr = async () => session([kid()], 'tok-qr');
  await P.App.loginWithQr('ELV-000001');
  const s = await P.storage.getParentSession();
  assert.equal(s.persistent, true);
  assert.ok(P.mem.has('parent_data'));
});

test('extractMatricule : URL, préfixe et saisie directe', () => {
  const { App } = createPortal();
  assert.equal(App.extractMatricule('https://x.cd/?student_id=ELV-12'), 'ELV-12');
  assert.equal(App.extractMatricule('ELIMU:ELV-000123'), 'ELV-000123');
  assert.equal(App.extractMatricule('  ELV-5 '), 'ELV-5');
  assert.equal(App.extractMatricule(''), '');
});

test('connexion par téléphone : session persistante si demandé', async () => {
  const P = createPortal();
  await phoneLogin(P, true);
  assert.equal(P.App.state.view, 'dashboard');
  const s = await P.storage.getParentSession();
  assert.equal(s.token, 'tok-phone'); assert.equal(s.persistent, true);
  assert.equal(JSON.parse(P.mem.get('parent_data')).data.enfants[0].matricule, 'ELV-000001');
});

test('connexion par téléphone : le numéro est normalisé et un numéro inconnu affiche une erreur', async () => {
  const P = createPortal();
  P.api.createParentSession = async (tel) => { P.api.lastPhone = tel; throw new Error('Numéro non reconnu'); };
  P.App.state.loginMode = 'phone'; P.App.render();
  P.el('phone-input').value = '0970 000 001';
  await P.App.login();
  assert.equal(P.api.lastPhone, '+243970000001');
  assert.equal(P.App.state.view, 'login');
  assert.match(P.el('login-err').innerHTML || '', /./);
});

test('session persistante CONSERVÉE après un scan (même famille)', async () => {
  const P = createPortal();
  await phoneLogin(P, true);
  const before = JSON.parse(P.mem.get('parent_data')).savedAt;
  P.log.length = 0; P.now += 60e3;
  P.api.createParentSessionFromQr = async () => session([kid()], 'tok-qr');
  await P.App.loginWithQr('ELV-000001', true);
  const s = await P.storage.getParentSession();
  assert.equal(s.persistent, true, 'toujours persistante');
  assert.equal(s.token, 'tok-qr');
  assert.equal(P.App.state.rememberDevice, true);
  assert.deepEqual(P.log.filter((l) => l[0] === 'delete'), [], 'ni session ni cache supprimés');
  const after = JSON.parse(P.mem.get('parent_data'));
  assert.ok(after.savedAt > before, 'cache mis à jour, pas supprimé');
  assert.equal(after.rememberDevice, true);
  assert.equal(P.confirmCalls.length, 0, 'même famille : aucune confirmation');
  assert.equal(P.App.state.page, 'home');
  assert.equal(P.App.state.phone, '0970000001', 'identité de synchronisation conservée');
});

test('scan d’une carte d’une AUTRE famille : confirmation ; refus = rien ne change', async () => {
  const P = createPortal();
  await phoneLogin(P, true);
  const other = kid({ matricule: 'ELV-000099', nom: 'AUTRE FAMILLE Luc' });
  P.api.createParentSessionFromQr = async () => session([other], 'tok-autre');
  P.confirmAnswer = false; P.log.length = 0;
  await P.App.loginWithQr('ELV-000099', true);
  assert.equal(P.confirmCalls.length, 1);
  assert.equal(P.App.state.data.enfants[0].matricule, 'ELV-000001');
  assert.equal((await P.storage.getParentSession()).token, 'tok-phone');
  assert.deepEqual(P.log.filter((l) => l[0] === 'delete'), []);
  assert.equal(P.App.state.view, 'dashboard');
  assert.equal(P.App.state.qrLoading, false);
});

test('scan d’une autre famille acceptée : changement de compte, la session reste persistante', async () => {
  const P = createPortal();
  await phoneLogin(P, true);
  P.api.createParentSessionFromQr = async () => session([kid({ matricule: 'ELV-000099', nom: 'AUTRE FAMILLE Luc' })], 'tok-autre');
  P.confirmAnswer = true;
  await P.App.loginWithQr('ELV-000099', true);
  const s = await P.storage.getParentSession();
  assert.equal(s.token, 'tok-autre'); assert.equal(s.persistent, true);
  assert.equal(P.App.state.data.enfants[0].matricule, 'ELV-000099');
  assert.equal(P.App.state.phone, '');
});

test('garde-fou : un échec de lecture de carte n’altère jamais une session connectée', async () => {
  const P = createPortal();
  await phoneLogin(P, true);
  P.api.createParentSessionFromQr = async () => { throw new Error('Cette carte n’est pas reconnue par l’établissement.'); };
  P.log.length = 0;
  await P.App.loginWithQr('ELV-INCONNU');
  assert.equal(P.App.state.view, 'dashboard');
  assert.equal(P.App.state.data.enfants[0].matricule, 'ELV-000001');
  assert.deepEqual(P.log.filter((l) => l[0] === 'delete'), []);
});

test('l’écran de chargement s’affiche pendant la vérification de la carte (connexion)', async () => {
  const P = createPortal();
  P.App.render();
  let seen = '';
  P.api.createParentSessionFromQr = async () => { seen = P.html(); return session([kid()], 'tok-qr'); };
  await P.App.loginWithQr('ELV-000001');
  assert.match(seen, /Lecture de la carte…/);
});

test('session restaurée sans réseau : panne réseau ne supprime ni session ni cache ; session invalide, si', async () => {
  const P = createPortal();
  P.mem.set('parent_session', JSON.stringify({ token: 'tok-old', expiresAt: NOW + 1e9 }));
  P.api.restoreParentSession = async () => { throw new Error('Connexion impossible. Vérifiez votre réseau.'); };
  await P.App.restoreSession();
  assert.ok(P.mem.has('parent_session'), 'panne réseau : la session reste enregistrée');
  assert.equal(P.App.state.view, 'login');
  P.api.restoreParentSession = async () => { throw Object.assign(new Error('Session parent invalide.'), { code: 'SESSION_INVALIDE' }); };
  await P.App.restoreSession();
  assert.ok(!P.mem.has('parent_session'), 'session refusée par le serveur : effacée');
});

test('cache hors connexion : dernier snapshot affiché, indication « Hors connexion », aucun appel réseau', async () => {
  const P = createPortal({ online: false });
  P.mem.set('parent_session', JSON.stringify({ token: 'tok-old', expiresAt: NOW + 1e9 }));
  P.mem.set('parent_data', JSON.stringify({ data: parentData([kid({ paiements: [pay('R', 3), pay('V', 50)] })]), phone: '', rememberDevice: true, savedAt: hoursAgo(5) }));
  let called = 0; P.api.restoreParentSession = async () => { called++; return {}; };
  await P.App.restoreCachedDashboard();
  await P.App.restoreSession();
  assert.equal(called, 0);
  assert.equal(P.App.state.view, 'dashboard');
  P.App.state.page = 'children'; P.App.render();
  assert.match(P.html(), /KAMBALE MUHINDO Jean/);
  assert.match(P.html(), /Hors connexion · Dernière mise à jour : 30\/10\/2026 à 05:00/);
  P.App.state.page = 'child'; P.App.state.selectedChild = 'ELV-000001'; P.App.render();
  assert.equal(P.App.normalizedChildren()[0].paiements.length, 1, 'le paiement de 50 h n’est plus affiché hors connexion');
  assert.equal(P.el('status-pill').textContent, 'Hors ligne');
});

test('rattrapage à l’ouverture : une seule lecture si le dernier créneau est passé', async () => {
  const P = createPortal();
  P.mem.set('parent_session', JSON.stringify({ token: 'tok', expiresAt: NOW + 1e9 }));
  P.mem.set('parent_data', JSON.stringify({ data: parentData([kid()]), phone: '0970000001', rememberDevice: true, savedAt: hoursAgo(48) }));
  let calls = 0; P.api.restoreParentSession = async () => { calls++; return session([kid()], 'tok'); };
  await P.App.restoreCachedDashboard();
  assert.equal(P.App.needsCatchUp(), true);
  await P.App.restoreSession();
  assert.equal(calls, 1);
  assert.equal(P.App.needsCatchUp(), false, 'snapshot frais : plus de rattrapage');
  await P.App.catchUpIfNeeded();
  assert.equal(calls, 1);
});

test('pas de rattrapage si le snapshot est postérieur au dernier créneau', async () => {
  const P = createPortal();
  P.App.state.sessionToken = 't'; P.App.state.view = 'dashboard'; P.App.state.fetchedAt = NOW;
  assert.equal(P.App.needsCatchUp(), false);
  P.App.state.fetchedAt = NOW - 48 * 3600e3;
  assert.equal(P.App.needsCatchUp(), true);
});

test('planification existante inchangée : prochain créneau toujours calculé', () => {
  const { ctx } = createPortal();
  const plan = require('node:vm').runInContext('ELIMU_SYNC_SCHEDULE.plan({}, "PARENTS", "0970000001", new Date())', ctx);
  assert.ok(plan.nextAt && new Date(plan.nextAt).getTime() > NOW);
  assert.ok(plan.lastAt && new Date(plan.lastAt).getTime() <= NOW);
  assert.equal(plan.slotMinutes, 60);
});

// ───────────── Navigation et caméra ─────────────
function withCamera(P) {
  const track = { stopped: 0, stop() { this.stopped++; } };
  P.App.qrStream = { getTracks: () => [track] };
  return track;
}

test('le scan principal ouvre directement la caméra sur l’écran de connexion', () => {
  const P = createPortal();
  P.App.render();
  assert.match(P.html(), /id="qr-scanner" class="qr-scanner"/);
  assert.match(P.html(), /id="qr-video"/);
  assert.match(P.html(), /Ouverture de la caméra/);
  assert.ok(!read('index.html').includes('data-page="scan"'));
});

test('écran de connexion : le scan reste disponible (caméra et saisie manuelle)', () => {
  const P = createPortal();
  P.App.render();
  const html = P.html();
  assert.match(html, /onclick="App\.startQrScanner\(\)"/);
  assert.match(html, /id="qr-video"/);
  assert.match(html, /id="qr-manual-input"/);
  assert.match(html, /Se connecter avec le numéro de téléphone/);
});

test('naviguer dans le portail coupe toujours la caméra (Accueil, Mes enfants, fiche, absences)', () => {
  for (const leave of [(A) => A.goHome(), (A) => A.showChildren(), (A) => A.openChild('ELV-000001'), (A) => A.openAbsences('ELV-000001')]) {
    const P = createPortal();
    P.show(parentData([kid()]), 'home');
    const track = withCamera(P);
    leave(P.App);
    assert.equal(track.stopped, 1);
    assert.equal(P.App.qrStream, null);
  }
});

test('connexion : la caméra s’arrête au passage au numéro de téléphone, à la fermeture et après un scan réussi', async () => {
  let P = createPortal();
  P.App.render(); let track = withCamera(P);
  P.App.showPhoneLogin();
  assert.equal(track.stopped, 1);

  P = createPortal();
  P.App.render(); track = withCamera(P);
  P.App.stopQrScanner(true);
  assert.equal(track.stopped, 1);

  P = createPortal();
  P.App.render(); track = withCamera(P);
  P.api.createParentSessionFromQr = async () => session([kid()], 'tok-qr');
  await P.App.loginWithQr('ELV-000001', true);
  assert.equal(track.stopped, 1);
  assert.equal(P.App.state.view, 'dashboard');
});

test('bouton retour du téléphone (popstate) coupe la caméra et ramène à l’accueil', () => {
  const P = createPortal();
  P.App.bindEvents(); // normalement appelé par init()
  P.show(parentData([kid()]), 'children');
  const track = withCamera(P);
  P.listeners.popstate.forEach((fn) => fn({ state: { page: 'home', key: '' } }));
  assert.equal(track.stopped, 1);
  assert.equal(P.App.state.page, 'home');
});

test('filet de sécurité : un rendu du tableau de bord ne laisse jamais la caméra allumée ; déconnexion aussi', () => {
  let P = createPortal();
  P.show(parentData([kid()]), 'home');
  let track = withCamera(P);
  P.App.render();
  assert.equal(track.stopped, 1);

  P = createPortal();
  P.show(parentData([kid()]), 'home');
  track = withCamera(P);
  P.App.logout();
  assert.equal(track.stopped, 1);
});

test('connexion : un rendu pendant le scan garde la caméra reliée à l’écran', () => {
  const P = createPortal();
  P.App.render();
  const track = withCamera(P);
  P.App.render(); // actualisation planifiée ou identité chargée pendant le scan
  assert.equal(track.stopped, 0);
  assert.ok(P.html().includes('id="qr-video"'));
});

test('navigation : Accueil et Mes enfants, fiche et absences restent dans « Mes enfants »', () => {
  const P = createPortal();
  const active = () => P.nav.filter((b) => b.classList.contains('active')).map((b) => b.dataset.page);
  P.show(parentData([kid()]), 'home');
  assert.deepEqual(active(), ['home']);
  P.App.showChildren(); assert.deepEqual(active(), ['children']);
  P.App.openChild('ELV-000001'); assert.deepEqual(active(), ['children']);
  P.App.openAbsences('ELV-000001'); assert.deepEqual(active(), ['children']);
  assert.equal(P.nav.find((b) => b.dataset.page === 'children').getAttribute('aria-current'), 'page');
  assert.equal(P.navEl.classList.contains('hidden'), false);
  assert.equal(P.el('logout-btn').classList.contains('hidden'), false);
  assert.deepEqual(P.pushed.map((s) => s.page), ['children', 'child', 'absences']);
  P.App.logout();
  assert.equal(P.navEl.classList.contains('hidden'), true);
  assert.equal(P.el('logout-btn').classList.contains('hidden'), true);
});

test('accueil : accès direct « MES ENFANTS » en premier, avant les communiqués', () => {
  const P = createPortal();
  const html = P.show(parentData([kid()], { communications: [{ titre: 'Info', message: 'm', date: '2026-10-29T08:00:00' }] }), 'home');
  assert.match(html, /^<button class="children-cta" type="button" onclick="App\.showChildren\(\)">/);
  assert.ok(html.indexOf('MES ENFANTS') < html.indexOf('Communiqués de l’établissement'));
  assert.ok(html.indexOf('MES ENFANTS') < html.indexOf('Dernier communiqué'));
  // et l'accueil sans communiqué garde son message clair
  assert.match(P.show(parentData([kid()]), 'home'), /MES ENFANTS[\s\S]*Aucun communiqué disponible\./);
});

test('déconnexion volontaire : confirmation, puis session et cache effacés', async () => {
  const P = createPortal();
  await phoneLogin(P, true);
  P.confirmAnswer = false; P.App.confirmLogout();
  assert.equal(P.App.state.view, 'dashboard');
  P.confirmAnswer = true; P.App.confirmLogout();
  await new Promise((r) => setImmediate(r));
  assert.equal(P.App.state.view, 'login');
  assert.ok(!P.mem.has('parent_session') && !P.mem.has('parent_data'));
});

// ───────────── Disposition mobile / ordinateur (analyse statique de index.html et styles.css) ─────────────
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const css = read('styles.css').replace(/\s+/g, ' ');
const html = read('index.html');

test('barre basse mobile : Accueil + Mes enfants, sans scan après connexion', () => {
  const nav = html.match(/<nav id="bottom-nav"[\s\S]*?<\/nav>/)[0];
  const pages = [...nav.matchAll(/data-page="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(pages, ['home', 'children']);
  assert.match(nav, /data-page="children" class="children-nav-btn"[^>]*onclick="App.showChildren\(\)"/);
  assert.match(css, /\.bottom-nav\{position:fixed;left:0;right:0;bottom:0;[^}]*grid-template-columns:1fr 1\.5fr/);
  assert.match(css, /\.bottom-nav button\.children-nav-btn,\.bottom-nav button\.children-nav-btn\.active\{background:var\(--primary\);color:#fff;/);
  assert.match(html, /viewport-fit=cover/);
});

test('barre basse fixée en bas de l’écran, sans masquer le contenu', () => {
  assert.match(css, /safe-area-inset-bottom/);
  const m = css.match(/main\{padding-bottom:calc\((\d+)px \+ env\(safe-area-inset-bottom\)\)\}/);
  assert.ok(m && Number(m[1]) >= 92, 'le contenu défile au-dessus de la barre');
  const fab = css.match(/\.contact-fab\{bottom:calc\((\d+)px/);
  assert.ok(fab && Number(fab[1]) >= 80, 'le bouton WhatsApp est au-dessus de la barre');
  assert.ok(!css.includes('scan-nav'), 'pas de zone Scan dans le portail connecté');
});

test('connexion : bouton de scan centré, grand et bien visible', () => {
  const P = createPortal();
  P.App.render();
  assert.match(P.html(), /<div id="qr-scanner" class="qr-scanner"/);
  assert.match(P.html(), /id="qr-video"/);
  assert.match(css, /\.qr-login\{text-align:center;/);
  assert.match(css, /\.qr-primary-button\{flex-direction:column;[^}]*min-height:220px;margin:18px auto 6px;[^}]*max-width:420px;text-align:center;border:2px solid var\(--secondary\)/);
  assert.match(css, /\.qr-viewfinder\{[^}]*animation:qr-pulse/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.qr-viewfinder\{animation:none\}/);
});

test('cibles tactiles d’au moins 44 px', () => {
  assert.match(css, /button\{min-height:44px;/);
  assert.match(css, /\.topbar-action\{min-height:44px;/);
  assert.match(css, /\.back-link\{min-height:44px;/);
  assert.match(css, /\.bottom-nav button\{min-height:52px;/);
  assert.match(css, /button\.absence-indicator\{width:100%;min-height:64px;/);
});

test('affichage ordinateur : menu latéral à partir de 1300 px, grille de cartes à partir de 640 px', () => {
  const desktop = css.trim().match(/@media \(min-width:1300px\)\{(.*)\}$/)[1];
  assert.match(desktop, /\.bottom-nav\{left:calc\(50% - 450px - 210px\);[^}]*top:112px;[^}]*grid-template-columns:1fr/);
  assert.match(desktop, /\.bottom-nav button:hover/);
  assert.match(desktop, /\.bottom-nav button\.children-nav-btn,\.bottom-nav button\.children-nav-btn\.active,\.bottom-nav button\.children-nav-btn:hover\{background:var\(--primary\);color:#fff\}/);
  assert.match(css, /@media \(min-width:640px\)\{ \.children-list:not\(\.single\)\{grid-template-columns:repeat\(auto-fill,minmax\(300px,1fr\)\)\}/);
});

test('reduced-motion et identité visuelle conservés', () => {
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(read('motion.css'), /prefers-reduced-motion:reduce/);
  assert.match(html, /assets\/school-logo\.png/);
  assert.match(html, /id="school-name"/);
});

test('api.js conserve le code d’erreur serveur (pour distinguer session invalide et panne réseau)', async () => {
  const vm = require('node:vm');
  const ctx = vm.createContext({ console, URLSearchParams, AbortController, setTimeout, clearTimeout, JSON });
  ctx.window = ctx;
  ctx.ELIMU_getAppsScriptUrl = () => 'https://script.example/exec';
  ctx.ELIMU_CONFIG = { schoolId: '', role: 'PARENTS' };
  ctx.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ ok: false, error: 'SESSION_INVALIDE', message: 'Session parent invalide.' }) });
  vm.runInContext(read('api.js'), ctx);
  const Api = vm.runInContext('ELIMU_Api', ctx);
  await assert.rejects(() => Api.restoreParentSession('x'), (e) => e.code === 'SESSION_INVALIDE' && /invalide/.test(e.message));
});
