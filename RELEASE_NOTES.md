Kane App 1.8.2 — Aperçus plein écran et mémoire d’Animation

- Studio IA : Image entière réinitialise zoom et déplacement pour retrouver toute l’image dans son cadre. 100 % conserve la taille réelle. Cliquer sur le pourcentage au-dessus de l’image ou sur ⛶ ouvre l’aperçu plein écran ; cliquer autour, Fermer ou Échap le referme sans modifier le zoom du cadre.
- Remplissage génératif : le document garde son prompt initial et ses paramètres, y compris après changement de variante et renvoi vers le Studio. Les paramètres de retouche restent associés au résultat et à son calque.
- Correction du voile de dépôt « Déposer pour importer », qui pouvait rester visible après un glisser-déposer. Ce voile était un indicateur d’interface, sans ajout aux pixels de l’image.
- Animation : « Animation automatique » remplace « Proposer les mouvements ». Les gestes reposent déjà sur les articulations DWPose quand elles sont disponibles, sinon sur un squelette estimé dans la zone peinte.
- Réservation du moteur IA pendant les tâches Animation et la segmentation. Checkpoint du Studio déchargé avant et après ; les générations concurrentes sont refusées et les états réseau incertains ne sont pas considérés comme terminés.
- Animation lancée par Kane App : adaptateur de ses scripts Python, SAM libéré après segmentation, LaMa/ViTMatte libérés avant le chargement de la diffusion, checkpoint actif du Studio conservé pour le rebouchage puis déchargé. Les fichiers du backend installé restent inchangés.

Si Animation tournait déjà depuis KaneOS ou une autre fenêtre, l’arrêter par clic droit sur Animation > Arrêter puis la rouvrir dans Kane App pour utiliser aussi le nouvel adaptateur de modèles.

Validation : parcours Electron du Studio et de la suite, vrais ponts du cadre Animation et du preload, tests des réservations GPU et de leurs erreurs, nettoyage Python sur modèles simulés. Le vrai backend Python a été lancé sur un port de test et ses presets relus. Pas de génération GPU réelle, de mesure de VRAM récupérée ou d’évaluation visuelle des gestes. Installateur Kanevas et canal de mise à jour conservés.
