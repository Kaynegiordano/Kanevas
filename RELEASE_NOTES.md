# 1.13.1 — Animation : la scène va dans « a poster »

- Sortie Scène : « a poster » contient la scène Wallpaper Engine et plus aucun fond Web ; Wallpaper Engine la reconnaît comme une scène.
- L’aperçu Web de l’atelier passe dans « work\apercu web ». En sortie Web, « a poster » reçoit le fond Web comme avant.
- Les interactions (Appliquer) ne recouvrent jamais une scène.

# 1.13.0 — Plus fluide, palette de commandes, VRAM libérée

- Copies de secours sans gel : calques encodés en parallèle hors de l’interface, calques inchangés non réencodés (gel 690 → 40 ms sur une image 4K à 3 calques).
- Montage (KaneClip 1.4.2) : plus aucun calcul quand rien ne bouge, même masqué ; inclut le rendu 4K de KaneClip 1.4.1.
- Jauge VRAM : un seul relevé continu du pilote au lieu d’un processus toutes les 3 secondes.
- Clic sur la jauge VRAM : libérer la mémoire graphique (Studio, ComfyUI) maintenant ou après 10 min / 30 min / 1 h sans génération. Modèle rechargé à la génération suivante.
- Palette de commandes (Ctrl+Maj+P ou la loupe) : menus, outils, espaces, fichiers récents et réglages en quelques lettres, sans accents.
- Animation et ComfyUI s’ouvrent dès qu’ils sont prêts ; mise à jour de ComfyUI plus rapide (pip seulement si ses dépendances changent).

# 1.12.18 — Montage : Atelier créatif et sous-titres

- KaneClip 1.4 intégré : cinq looks éditables, intensité et mouvements progressifs sur les plans sélectionnés.
- Sous-titres SRT : importer, corriger, caler, rechercher, styliser et exporter ; incrustation dans la vidéo.
- Ctrl+K : palette d’actions avec recherche et navigation au clavier.
- Lecture et timeline : index des événements et affichage limité aux clips visibles ; temps de composition et désactivation temporaire des effets d’aperçu.
- Inclut le moniteur Source/Programme, le montage par insertion/remplacement, le rasoir et les améliorations de l’édition 1.12.17.

# 1.12.17 — Montage : KaneClip 1.3

- Moniteur Source / Programme et disposition Dérushage.
- Montage par insertion ou remplacement sur pistes vidéo/audio ciblées.
- Rasoir, levée et extraction de plage ; suppression ondulée corrigée.
- Effets réglables dans Propriétés et gestionnaire de marqueurs.
- Vérifications en profil isolé avec média synthétique et export réel.

Kane App / Kanevas 1.12.16 — Un clic = plein écran

- Studio IA : un simple clic sur le résultat l'ouvre en plein écran (avant : double-clic).
- Pendant une génération, un clic sur l'aperçu en direct montre la dernière image terminée en plein écran ; la génération continue derrière.

Kane App / Kanevas 1.12.15 — Chercher dans l'invite

- Studio IA : 🔍 (ou Ctrl+F dans l'invite) surligne, parcourt et remplace un mot dans l'invite et l'invite négative, comme l'extension Forge « Chercher dans le prompt ».
- 🕘 Historique des 60 dernières invites générées, avec recherche ; un clic les reprend.
- 🧹 Nettoyer : retire les tags en double, virgules et espaces en trop (Ctrl+Z annule).

Kane App / Kanevas 1.12.14 — Montage : mouvement de piste

- Montage (KaneClip 1.2.0) : curseur « Zoom » dans l'en-tête de chaque piste vidéo (double-clic = 100 %) et bouton de mouvement de piste (zoom, position, rotation, remplir le cadre) ; clic droit sur une piste : remplir, réinitialiser, transformer ses événements.

Kane App / Kanevas 1.12.13 — Montage : transformer plusieurs vidéos

- Montage (KaneClip 1.1.0) : « Transformer plusieurs événements… » (Ctrl+Maj+G, menu Outils, clic droit, Propriétés) remplit ou ajuste au cadre, zoome, tourne et recentre toute la sélection, les pistes concernées ou tout le projet en une fois, annulable.
- Espace de montage façon VEGAS Pro : dispositions, panneau Propriétés, médias classés par type.

Kane App / Kanevas 1.12.12 — Respiration douce

- Animation : case « Respiration douce de tout le personnage » (par défaut, sans zone à peindre) avec réglage d'amplitude ; le corps et les calques suivent, boucle sans à-coup, curseur Wallpaper Engine. Cliquez « Appliquer au Web ».

Kane App / Kanevas 1.12.11 — 📐 = taille exacte de la source

- Transformer : 📐 prend la taille exacte de l'image source (5568 x 3072 reste 5568 x 3072) ; curseurs étendus. Une nouvelle image reste ajustée par défaut (1856 x 1024) ; avertissement au-dessus de 2048 px avec un bouton « Réduire à… ».

Kane App / Kanevas 1.12.10 — Resize by fidèle à la source

- Transformer : « Resize by » suit la taille ajustée à la source quand 📐 est actif (5568 x 3072 : échelle 0,333 = 1856 x 1024, plus 1,0). Échelle de 0,1 à 4, avertissement au-dessus de 2048 px.

Kane App / Kanevas 1.12.9 — Taille de l'image source plus juste

- Transformer : la taille automatique garde les proportions exactes de l'image donnée (5568 x 3072 donne 1856 x 1024 au lieu de 2048 x 1128, qui recadrait). La zone Taille affiche source et taille utilisée.

Kane App / Kanevas 1.12.8 — Atelier Lora en deux colonnes

- Onglet Lora du Studio : projet, preset et légendes à gauche, réglages et entraînement à droite, au lieu d'une colonne qui laissait un grand vide à droite.
- Correction : « null » affiché en bas de l'onglet sans projet ouvert.

Kane App / Kanevas 1.12.7 — Aperçu net, Studio plus rapide, clic droit sur Lora

- Aperçu en direct net : le latent est décodé par le VAE, à la taille du résultat, et remplit la zone (avant : petite image approximative au milieu d'un grand cadre). Réglage Net / Rapide / Désactivé dans Réglages. Environ 6 % de temps en plus.
- Studio plus rapide : le dernier catalogue (modèles, LoRA, échantillonneurs) s'affiche tout de suite pendant que le moteur démarre, et le modèle est chargé en avance : la première génération n'attend plus 20 s de plus.
- Clic droit sur le bouton Lora du Studio (ou sur la carte d'entraînement) : Arrêter l'entraînement, Arrêter et relancer, Actualiser.

Kane App / Kanevas 1.12.6 — Actualiser dans l'atelier LoRA, ComfyUI à jour

- Studio IA > LoRA : le bouton Actualiser relit les projets et l'état de l'entraînement, et libère un entraînement bloqué (processus disparu ou numéro réutilisé par Windows) qui empêchait de relancer.
- Si l'entraînement en cours ne donne plus signe de vie depuis 15 minutes, l'atelier le signale ; le bouton Stop le ferme.
- ComfyUI se met à jour à chaque démarrage depuis Kanevas (git et paquets Python, retour arrière si une installation échoue), puis démarre sur la version à jour.
- Inclut les icônes 1.12.3 à 1.12.5.

Kane App / Kanevas 1.12.5 — Icône Windows au lancement

- L'icône de la fenêtre et de la barre des tâches est fournie par un fichier ICO accessible directement à Windows, en dehors de l'archive de l'application.
- Le symbole K tricolore et les dix tailles d'icône sont conservés.

Kane App / Kanevas 1.12.4 — Icône K tricolore

- La rosace est remplacée par un K géométrique corail, jaune et turquoise sur fond anthracite.
- Cette identité distingue Kanevas du K blanc sur fond bleu de Kane OS.
- Le symbole est commun à l'interface, à l'exécutable, aux raccourcis et à l'installateur Windows.

Kane App / Kanevas 1.12.3 — Nouvelle icône multicolore

- Une rosace de rubans multicolores remplace le K blanc sur fond bleu pour distinguer Kanevas de Kane OS.
- La même identité est utilisée dans la fenêtre, l'accueil, À propos, la version web, les raccourcis et l'installateur Windows.
- Icône transparente avec dix tailles natives de 16 à 256 pixels pour Windows.

Kane App / Kanevas 1.12.2 — L'espace « Edition » devient « Retouche »

- L'espace d'édition d'images s'appelle désormais Retouche, pour ne plus le confondre avec le menu Édition. Le nom est changé partout : panneau Kane App, étape du parcours (Créer · Retoucher · Animer · Monter), Studio IA, bibliothèque, Préférences et couleurs des espaces.
- Le menu Édition (annuler, copier, coller…) ne change pas.
