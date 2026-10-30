# ELIMU — Portail parent

Dépôt autonome du portail parent ELIMU.

Avant chaque hébergement client, remplacer uniquement `assets/school-logo.png`
par le logo de l’établissement. Le favicon, l’icône PWA, l’icône de l’en-tête
et le logo affiché dans le portail utilisent tous ce même fichier. Modifier
également l’URL Apps Script dans `config.js`.

Le portail s'ouvre directement depuis `index.html`, utilise son propre dossier `assets/` et lit les données publiées par Apps Script en lecture seule. Après connexion, l'accueil affiche les communiqués ; `Mes enfants` ouvre la liste familiale, puis chaque fiche regroupe les montants financiers, les paiements récents et le suivi hebdomadaire des absences. Les paiements affichés sont limités aux 42 dernières heures ; cette limite ne concerne pas les calculs réalisés par ELIMU.

Le fichier `config.js` contient l’URL Apps Script de l’établissement. Le fichier `portal-config.js` contient la configuration propre aux sessions parents.

Le portail parent ne propose pas d’actualisation manuelle. Après connexion, une lecture automatique est programmée autour de 06:00, 09:00, 12:00 et 15:00 (heure d’Afrique/Lubumbashi), avec un décalage de 0 à 60 minutes par parent pour éviter un pic simultané vers Apps Script. Entre deux fenêtres, le portail affiche le dernier snapshot local déjà enregistré.

## Refonte mobile (30/10/2026)

- Pages : Accueil (communiqués) · MES ENFANTS · fiche enfant (finances, absences de la semaine, paiements récents) · détail des absences.
- Navigation : barre basse mobile Accueil · Mes enfants (onglet plein, plus large) ; menu latéral à partir de 1300 px. Bandeau « MES ENFANTS » en tête de l'accueil. Le bouton « retour » du téléphone navigue dans l'application. Bouton « Quitter » dans l'en-tête.
- Paiements : seuls ceux des 42 dernières heures sont **affichés** ; les soldes viennent du serveur et utilisent tout l'historique.
- Scan : le bouton central ouvre une page dédiée temporaire dans le portail connecté (grand bouton avec viseur). Après une lecture réussie, cette page se ferme automatiquement et l'accueil s'affiche ; la caméra est coupée dès qu'on navigue ou qu'on se connecte.
- Écran QR : case « Mémoriser cet appareil » (décochée par défaut).
- Rattrapage : à l'ouverture, si le dernier créneau de synchronisation du parent est passé et que le snapshot local est plus ancien, une seule lecture est faite. Les créneaux planifiés sont inchangés.
- Une panne réseau n'efface plus la session ni le cache ; seuls SESSION_INVALIDE / ACCES_REFUSE / PARENT_NON_CONFIGURE le font.

## Tests

Node.js 20+ suffit (aucune dépendance) :

    cd PARENT && node --test

Les tests chargent les vrais `app.js`, `storage.js` et `sync-schedule.js` dans un simulateur de navigateur minimal (`tests/portal-env.js`). Les contrôles de mise en page (barre basse, 44 px, ordinateur) analysent `index.html` et `styles.css` ; ils ne remplacent pas un essai sur un vrai téléphone. Le dossier `tests/` n'a pas besoin d'être publié avec le portail.
