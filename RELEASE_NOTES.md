Kane App / Kanevas 1.9.2 — VRAM commune et double-clic Studio

- Double-clic Studio réparé : la capture du pointeur pour déplacer les images empêchait le double-clic réel d’atteindre l’image. La capture commence uniquement lors du déplacement et le cadre reçoit le double-clic. Un clic sur l’image agrandie la garde ouverte ; clic autour ou Échap ferme l’aperçu.
- La jauge VRAM se trouve dans une barre inférieure commune à Projet, Edition, Studio IA, Animation, Animation Vidéo et Montage.
- Elle lit directement le pilote NVIDIA toutes les trois secondes, sans dépendre de Studio ni de Kane OS. La mesure couvre les applications qui utilisent la carte graphique ; le survol détaille chaque carte.
- Les erreurs et mesures périmées affichent « Indisponible » au lieu de conserver un ancien chiffre. La lecture reprend automatiquement après une erreur ou au retour dans la fenêtre.
- La jauge devient orange à partir de 90 % d'utilisation. Les lectures sont groupées et limitées dans le temps, sans fenêtre console.

Validation : double-clic et clics transmis par Chromium sur les résultats et la source Img2Img, déplacement et fermeture de l’aperçu ; lecture réelle de la RTX 5080 par le processus principal et le pont Electron ; rafraîchissement automatique sans moteur actif ; erreur, récupération et mesure périmée ; jauge visible dans les six espaces, y compris les cadres intégrés et les fenêtres de 1024 px. Parcours Studio/Edition et suite intégrée vérifiés sur les sources et le paquet installé.

Les installateurs et le canal de mise à jour restent nommés Kanevas.
