Kane App 1.8.1 — Remplissage génératif simplifié

- Un seul parcours dans Edition : sélectionner une zone, ouvrir Remplissage génératif, décrire le changement, puis Ajouter le dessin. Les menus et la barre contextuelle ouvrent le même panneau Dessin IA.
- Réutilisation des réglages de Studio IA > Créer : modèle, LoRA et poids actifs, styles, invite négative, étapes, CFG et échantillonneur. La description précédente du Studio n’est plus recopiée : une ancienne scène de personnage ne contamine plus directement la demande locale.
- Force à 50 % par défaut, avec trois choix : douce 40 %, équilibrée 50 %, marquée 60 %. Migration de l’ancienne valeur de 85 %. Un seul résultat par défaut, options et variantes repliées.
- Inpaint sur la sélection, résultat sur un nouveau calque masqué et annulation en une étape. Hires, scripts et retouche automatique des visages ne s’appliquent pas à ce remplissage local. Ctrl+Entrée démarre ou interrompt.
- Lorsque la traduction du Studio est activée, une traduction française indisponible bloque la génération avec un message explicatif. Les balises LoRA sont conservées pendant la traduction.
- Supprimer garde son comportement de suppression locale. La liste des LoRA actifs et un lien vers le Studio restent accessibles dans les réglages repliés. Un LoRA de personnage ou un style peut toujours influencer le résultat.

Validation : parcours Electron du Studio et de la suite, migration depuis les anciennes préférences, forces 40/50/60 %, partage des LoRA et réglages, traduction, masques, annulation, raccourcis et mise en page. Réponses Forge et ComfyUI simulées ; aucune comparaison de qualité sur GPU réel.

Installateur et canal de mise à jour Kanevas conservés pour les installations existantes.
