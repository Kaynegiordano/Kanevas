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
