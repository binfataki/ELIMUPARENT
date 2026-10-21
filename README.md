# ELIMU — Portail parent

Dépôt autonome du portail parent ELIMU.

Le portail s’ouvre directement depuis `index.html`, utilise son propre dossier `assets/` et lit les données publiées par Apps Script en lecture seule.

Le fichier `config.js` contient l’URL Apps Script de l’établissement. Le fichier `portal-config.js` contient la configuration propre aux sessions parents.

Le portail parent ne propose pas d’actualisation manuelle. Après connexion, une lecture automatique est programmée autour de 06:00, 09:00, 12:00 et 15:00 (heure d’Afrique/Lubumbashi), avec un décalage de 0 à 60 minutes par parent pour éviter un pic simultané vers Apps Script. Entre deux fenêtres, le portail affiche le dernier snapshot local déjà enregistré.
