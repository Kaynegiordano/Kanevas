Kanevas 1.7.0 — Le projet relie les ateliers

Un accueil Projet et une bibliothèque commune relient désormais l’illustration, sa génération, son animation et son montage.

- Navigation commune : Projet, Édition, Studio IA, Animation, Vidéo et Workflows. Studio utilise des noms d’actions : Créer, Transformer, Agrandir…
- Plusieurs projets locaux, renommables et retrouvés à la prochaine ouverture. Importer copie les médias ; capturer conserve un aperçu et le document avec ses calques. Les versions précédentes restent accessibles.
- Les générations du Studio sont archivées automatiquement avec leurs paramètres. La bibliothèque est accessible dans tous les espaces et permet aussi l’ajout en calque au document actif.
- Animation : reprise du projet Wallpaper, mise à jour de l’image source en conservant les zones lorsque les dimensions correspondent, sauvegarde de l’ancienne scène et récupération des boucles exportées. Parcours Zones → Animer → Aperçu → Exporter.
- Vidéo : un montage KaneClip par projet, enregistrement automatique, reprise après redémarrage et remplacement d’un média en conservant les événements, les coupes et les effets.
- Workflows : chargement d’un workflow ComfyUI et insertion directe d’une image dans LoadImage, avec choix du nœud s’il y en a plusieurs. Récupération des images et vidéos produites dans la bibliothèque.
- Thème partagé dans les ateliers intégrés et panneau Activité commun pour les transferts, générations et rendus signalés.

Les animations restent enregistrées dans Wallpaper Animator et liées au projet Kanevas. Les workflows exigent leurs modèles et nœuds ComfyUI. La coordination automatique de la mémoire GPU entre moteurs ne fait pas partie de cette version.

Validation : parcours Electron dans un profil temporaire avec les vrais préchargements, stockage, passerelles et timeline KaneClip ; réponses des moteurs et métadonnées ffprobe simulées. Reprise après rechargement, versions, annulation, incompatibilité de dimensions et mises en page 1024/1440 px vérifiées. Tests Studio/Édition conservés.
