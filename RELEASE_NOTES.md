Kane App / Kanevas 1.9.0 — Copies des moteurs et import Lora isolé

- Correction de l’import Lora : déposer ou choisir plusieurs images les ajoute seulement au projet d’entraînement. Les dépôts du Studio ne remontent plus dans Edition.
- Préférences > Applications intégrées > Migration vers Kanevas : copie des moteurs Studio, ComfyUI, Animation et sd-scripts, environnements Python, extensions, nœuds et données. Réparation des chemins et lanceurs dans les copies, comparaisons SHA256, tests Python et bascule contrôlée.
- Montage utilise également un FFmpeg copié, vérifié et accompagné de sa licence. Les services intégrés peuvent réutiliser ce binaire.
- Après activation, les moteurs et l’atelier Lora sont pilotés depuis les copies Kanevas. Une ancienne instance sur le même port est signalée au lieu d’être reprise implicitement. Les moteurs doivent être arrêtés pour la bascule.
- Retour à la configuration précédente disponible. Les modèles communs, caches Hugging Face et Python Windows de base restent partagés. Les copies sont rangées dans KanevasData, séparément de l’installateur et du dépôt Git.

Aucune installation source n’est supprimée. Le rapport garde deletionAllowed à false, même après activation : les entraînements complets, workflows vidéo et rendus sur les projets personnels doivent encore être validés avant tout retrait de Forge, ComfyUI, Animation ou KaneClip.

Validation : tests Electron de l’import Lora et de l’interface de migration ; tests de copie, réparation des chemins, intégrité, corruption détectée, verrou et restauration des réglages. Contrôles réels : génération txt2img et img2img, workflow image ComfyUI avec nœuds personnalisés chargés, lecture des projets Animation et LoRA, encodage H.264 avec le FFmpeg copié. Les résultats sont consignés dans KanevasData/validation et dans le rapport local. Ils ne constituent pas une validation de tous les modèles, extensions et projets personnels.

Les installateurs et le canal de mise à jour restent nommés Kanevas.
