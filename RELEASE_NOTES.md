Kane App / Kanevas 1.9.4 — Sélection Magique dans Animation

- Répare Magique, l'outil de sélection automatique SAM : sous Windows, l'adaptateur remplaçait subprocess.Popen par une fonction, ce qui empêchait le chargement de Torch/SAM avec une erreur TypeError.
- L'adaptateur conserve maintenant une vraie classe Popen et continue de diriger les workers Animation vers la gestion commune de la VRAM.

Validation : vrai modèle SAM dans une fenêtre Kane App et son cadre Animation, masque non vide appliqué à la zone, retrait, annulation et GPU libéré ; tests de l'adaptateur, des workers et de la réservation GPU. Vérification du paquet construit et de la version installée.
