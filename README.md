# Kanevas

Éditeur d'images de bureau inspiré de Photoshop (Electron + Canvas, 100 % local).

## Lancer
- `Kanevas.vbs`, ou `Lancer Kanevas.cmd`.
- Un fichier passé en argument (ou glissé sur la fenêtre) est ouvert.

## IA locale (détourage)
« Sélectionner le sujet », « Supprimer l'arrière-plan » et l'outil « Sélection d'objet » utilisent BiRefNet
(licence MIT) via onnxruntime-node (DirectML sinon processeur). Le modèle est téléchargé au premier usage,
après confirmation, dans `%APPDATA%\Kanevas\models` (ou le dossier de données historique KaneShop si déjà présent) (léger 224 Mo ou complet 973 Mo ; Édition > Modèles d'IA).

## Formats
- **.ksp** : format natif, garde tout (calques de texte modifiables, calques de réglage, masques, styles, repères).
- **.psd** : lecture et écriture via ag-psd : groupes, masques, modes de fusion, opacité, écrêtage, styles,
  calques de réglage (14 types), formes vectorielles (avec repli pixel si besoin).
- **TIFF CMJN** en export (séparation simple, sans profil ICC) ; épreuve écran CMJN et alerte de gamut (Ctrl+Y / Ctrl+Maj+Y).
- 16 bits par couche : non pris en charge (le moteur Canvas travaille en 8 bits).
- PNG, JPEG, WebP, GIF, BMP, SVG, AVIF en lecture ; PNG / JPEG / WebP en export.

## Organisation
```
main.js / preload.js     processus Electron (fenêtre, fichiers, polices)
app/index.html           page
app/css/style.css        thèmes Sombre / Graphite / Clair
app/js/                  cœur : document, calques, sélection, historique, rendu, réglages, filtres, pinceau, E/S
app/js/tools/            outils (sélection, peinture, retouche, transformation, texte, formes…)
app/js/ui/               panneaux, menus, boîtes de dialogue, sélecteur de couleurs
app/vendor/ag-psd.js     bibliothèque PSD (MIT, voir ag-psd-LICENSE.txt)
```

## Installer sur une autre machine
`Lancer Kanevas.cmd` installe les dépendances au besoin. Les versions récentes de npm bloquent les scripts
d'installation : le binaire d'Electron est alors récupéré par `node node_modules\electron\install.js`.

## Tester sans Electron
`python -m http.server 8742 --directory app` puis http://127.0.0.1:8742 (ouverture/enregistrement
passent alors par le navigateur).

Palette par défaut : **Givre**, harmonisée avec KaneOS (gris clair, blanc, bleu #2f6fdb). Les thèmes Sombre et Graphite restent disponibles dans les préférences. Les anciens documents .ksp restent compatibles.


## Protection du travail
Les sauvegardes de secours sont activées par défaut : après 5 secondes d'inactivité et contrôle toutes les 30 secondes (intervalle réglable dans les préférences). Elles restent séparées de vos projets dans le sous-dossier recovery des données de Kanevas. Deux générations sont conservées par document, avec écriture temporaire et validation avant restauration.
Après un arrêt inattendu, une fenêtre propose de récupérer les documents non enregistrés. « Plus tard » conserve les copies ; Fichier > Récupérer des documents permet de les retrouver. Une sauvegarde manuelle réussie ou une fermeture volontaire du document retire sa copie de secours. Une erreur de disque est signalée dans la barre d'état.

## Réglages modifiables
Image > Réglages et Camera Raw créent par défaut un calque de réglage, sans modifier les pixels du calque source. Le réglage est écrêté au calque actif quand celui-ci le permet ; une sélection devient son masque. Double-cliquez sur sa vignette, ou choisissez « Modifier le réglage… » dans ses propriétés ou son menu contextuel. Annuler rétablit le réglage précédent ; OK crée une étape d'historique.
Les ombres, lueurs, contours et incrustations restent modifiables avec « Style de calque… » ou le badge fx. Enregistrez en .ksp pour conserver l'intégralité des réglages ; les exports PNG/JPEG sont des images aplaties. Les filtres pixel et les réglages appliqués à un masque restent des opérations sur les pixels. Le mode historique est disponible en décochant « Créer des réglages modifiables ».

## Réglage des outils au geste
Maintenir Alt + bouton droit dans la zone de travail : glisser horizontalement pour la taille, verticalement pour la dureté. Un cercle rouge et les valeurs montrent l’empreinte. Relâcher pour conserver, Échap pour revenir aux valeurs précédentes. Disponible sur les outils de peinture et de retouche, et la sélection rapide (taille seulement). Le crayon reste à bord dur. Alt + clic gauche garde la pipette ou la définition de source du tampon/correcteur. [ ] et Maj+[ ] restent disponibles.


## Installateur et mises à jour
- **Installer** : télécharger `Kanevas-Setup-x.y.z.exe` depuis les [Releases](https://github.com/Kaynegiordano/Kanevas/releases) (installation par utilisateur, sans droits administrateur).
- **Mises à jour** : Kanevas vérifie les releases GitHub 8 secondes après le démarrage ; Aide > Rechercher des mises à jour… le fait à la demande. Rien n'est téléchargé sans accord, puis « Redémarrer et installer ». Ne fonctionne que dans la version installée.
- **Publier une version** : changer `version` dans `package.json` (et la même dans le journal des changements ci-dessous), puis `Publier une version.cmd`. Il construit l'installateur (`npm run dist`) et crée la release GitHub avec `Kanevas-Setup-x.y.z.exe`, `.blockmap` et `latest.yml` (ce dernier est indispensable aux mises à jour).

## Journal des versions
- **1.0.0** : première version publique, installateur Windows et mises à jour GitHub.
- **1.0.1** : correction de l'icône (multi-tailles, identifiant de barre des tâches aligné sur l'installateur).
