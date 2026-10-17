Kane App / Kanevas 1.9.3 — Import Animation et sorties communes

- Animation : bouton « Ouvrir une image… » visible dans la barre de l'atelier. Sélection et glisser-déposer utilisent le même import Kane App, sans prompt() incompatible avec Electron et sans ouvrir un document dans Edition.
- Les images sont décodées avant création ; une image illisible affiche une erreur. Les zones existantes sont conservées lors des transferts et changements de source.
- Sorties communes sous C:\KaneOS\output : studio, animation, comfyui, montage et lora. Edition propose output/edition par défaut ; les exports manuels conservent la possibilité de choisir un autre emplacement.
- Animation range projets et exports sous output/animation. Les anciens projets sont copiés sans suppression ni écrasement. Studio conserve ses paramètres et sauvegarde son ancienne configuration de sortie.
- Montage propose output/montage pour les rendus. Les nouveaux LoRA sont rangés dans output/lora et accessibles aux modèles de Studio sans duplication.

Validation : ouverture d'une image 128×64 dans une vraie fenêtre Kane App avec le véritable moteur Animation migré, lecture de la source et aucun document Edition créé ; sélection de fichier, dépôt et image invalide dans le cadre intégré ; sauvegarde Studio et dossier Montage par les vrais ponts Electron ; configuration Studio sauvegardée et catalogue LoRA relié. Parcours Studio, double-clic, VRAM et suite intégrée vérifiés sur le paquet construit.
