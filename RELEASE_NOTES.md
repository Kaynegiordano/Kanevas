Kane App 1.8.0 — Zoom du Studio et interface flat

- « Mon atelier » devient Kane App. Navigation : Projet, Edition, Studio IA, Animation, Animation Vidéo, Montage. Montage est placé en dernier.
- Style plus plat dans l’application et les ateliers intégrés, surfaces unies et accents discrets. Les couleurs de chaque espace se personnalisent dans Préférences et sont conservées au redémarrage.
- Zoom à la molette dans les sources et résultats du Studio, boutons − / +, Ajuster et 100 %. Glisser déplace l’image ; dans les masques et croquis, bouton central ou Espace + glisser déplace sans peindre. Le zoom ne modifie pas les pixels générés.
- « Découper » utilise l’image active du Studio, même sans document ouvert dans Edition, et exporte ses panneaux. « Entraîner un LoRA » est renommé « Lora ».
- Clic droit sur un espace > Arrêter : arrêt du moteur Studio, sauvegarde des zones d’Animation, sauvegarde du montage et annulation des rendus avant déchargement. L’arrêt explicite d’un moteur externe vérifie l’identité du processus.
- Préférences > Configurer le moteur local : runtime Python et modèles séparés, option pour réutiliser ou non le Forge de KaneOS. Les autres applications gardent leur dossier KaneOS.

Le backend de génération reste actuellement basé sur Forge : cette version prépare une configuration séparée, sans installer ni copier un runtime. Ne retirez les fichiers de Forge qu’après avoir préparé un moteur distinct fonctionnel.

Les installateurs et le canal de mise à jour restent nommés Kanevas pour préserver la compatibilité des installations existantes.

Validation : tests Electron du zoom, de la peinture et de la découpe, navigation et couleurs jusque dans les trois cadres intégrés, arrêt/reprise de Montage et rechargement des projets. Interface Wallpaper réelle avec serveur de test ; réponses Forge, ComfyUI et métadonnées ffprobe simulées. Configuration persistante et identification des processus testées séparément. Mises en page 1000/1024/1440 px contrôlées.
