# Kanevas

Éditeur d'images de bureau inspiré de Photoshop (Electron + Canvas, 100 % local).

## Lancer
- `Kanevas.vbs`, ou `Lancer Kanevas.cmd`.
- Un fichier passé en argument (ou glissé sur la fenêtre) est ouvert.

## Version web
https://kaynegiordano.github.io/Kanevas/ : le dossier `app/` publié sur GitHub Pages à chaque push sur `main`
(`.github/workflows/pages.yml`). Ouvrir et enregistrer passent par le navigateur ; l'IA locale, les
sauvegardes de secours et les mises à jour restent propres à l'application de bureau. Les polices du PC
sont proposées dans Chrome et Edge (bouton « Polices du PC » de l'outil Texte, après autorisation du site).

## Outils récents
- **Rectangle** : un seul outil, avec ses angles réglables (un rayon pour les quatre, ou un par angle avec le
  bouton de liaison). Ils restent modifiables après coup dans Propriétés > Angles, tant que ses points n'ont
  été que déplacés.
- **Lasso magnétique** (L) : cliquer, puis suivre le bord ; les points s'accrochent au contour le plus net
  (Largeur, Contraste, Fréquence). Clic : point d'ancrage, double-clic ou Entrée : fermer, Retour arrière : annuler le point.
- **Image dans un texte ou une forme** : Calque > Insérer une image dans le calque… (ou menu contextuel du
  calque), ou Édition > Coller dans le calque (Ctrl+Alt+Maj+V). L'image couvre le calque actif et lui est
  écrêtée. Alt+clic sur un calque, ou le bouton d'écrêtage sous la liste, crée ou libère un masque d'écrêtage.
- **Pièce** (J, avec les correcteurs) : entourer la zone, puis la faire glisser. Source : la zone est réparée avec
  la texture de l'endroit d'arrivée ; Destination : elle y est recopiée. La texture se fond dans la lumière locale.
- **Calques de remplissage** dynamiques (Calque > Nouveau calque de remplissage) : couleur unie, dégradé (linéaire,
  radial, angle, réfléchi, losange), motif (damier, rayures, pois, grille, diagonales, grain). Réglables à tout
  moment dans Propriétés ; « Pixelliser » en fait un calque de pixels.
- **Correction sélective** (Image > Réglages, ou calque de réglage) : cyan, magenta, jaune, noir par gamme de
  couleurs (rouges… noirs), méthode relative ou absolue.
- **Atténuer** (Édition, Ctrl+Maj+F) juste après un filtre ou un réglage : opacité et mode de fusion du résultat.
  **Ctrl+F** répète le dernier filtre avec ses réglages, **Ctrl+Alt+F** le rouvre avec sa boîte.
- **Instantanés** (bouton appareil photo du panneau Historique) : figer un état, le rétablir plus tard (annulable).
- **Sélection > Agrandir / Sélection similaire** : ajoute les couleurs proches de la sélection (tolérance de la
  baguette magique), contiguës ou dans toute l'image.

## IA générative et nouveautés façon Photoshop 2026 (1.0.6)
- **Outil Suppression** (J, avec les correcteurs) : peindre sur ce qui doit disparaître ; au relâchement, l'IA locale
  LaMa (licence Apache 2.0, 208 Mo, téléchargée une fois après accord) reconstitue le fond. « Échantillonner tous les
  calques » permet de travailler sur un calque vide. Sans modèle : correcteur localisé.
- **Supprimer avec l'IA** (Édition, Maj+Suppr) : la sélection est remplacée par les alentours, dans un nouveau calque
  « Suppression » avec masque (rien n'est détruit).
- **Remplissage génératif** (Édition, Ctrl+Maj+Alt+G, ou la barre contextuelle) : une invite décrit ce qu'il faut
  générer dans la sélection ; la génération passe par **Forge** (Stable Diffusion local lancé par Kane OS, avec son
  modèle actif). 1 à 4 variantes, à parcourir avec ‹ › dans la barre contextuelle, « Générer encore » en ajoute.
  Le résultat est un calque avec masque de fusion. Invite vide : remplissage par LaMa, sans Forge.
- **Développement génératif** (Image) : agrandit l'image à un format (16:9, 1:1, 4:5…) ou d'une marge, la zone neuve
  est générée (Forge avec invite, sinon LaMa) dans un calque placé au-dessus de l'arrière-plan. Une seule étape d'historique.
- **Super résolution IA** (Image) : ×2, ×3 ou ×4 avec les modèles ESRGAN de Forge (4x-UltraSharp…), dans un nouveau
  document ; la transparence est conservée.
- **Harmoniser** (Calque, menu du calque, barre contextuelle) : accorde la lumière, le contraste et la dominante de
  couleur du calque à ce qu'il y a dessous (mesures en Lab sur le calque et son voisinage), avec aperçu.
- **Pinceau de réglage** (B, avec le pinceau) : on peint un réglage (éclaircir, assombrir, contraste, saturer,
  désaturer, réchauffer, refroidir, noir et blanc) ; il vit dans un calque de réglage dont on peint le masque,
  modifiable ensuite dans Propriétés. Alt efface.
- **Barre des tâches contextuelle** (Affichage) : sous l'image, les actions utiles selon la situation (sélection,
  calque généré et ses variantes, calque de pixels) et une invite de génération directe.
- **Invites en français** (1.0.7) : les modèles d'image ne comprennent que l'anglais ; en français, anima dessinait
  une fille au hasard qui remplissait la zone. L'invite est maintenant traduite sur le PC par Opus-MT fr→en
  (Helsinki-NLP, licence CC-BY 4.0, 113 Mo téléchargés une fois, `translate.cjs`) ; la boîte affiche « Envoyé à
  Forge : … ». Les verbes d'ordre (« ajoute », « dessine »…) sont retirés.
- **Réglages selon le modèle actif de Forge** : pour anima, préfixe `newest, year 2026, safe`, échantillonneur ER SDE,
  planificateur simple. Si l'invite ne demande pas de personnage, « girl, woman, man, person… » passent en négatif.
  Force par défaut 85 % (l'objet se fond mieux dans l'image), 30 étapes, CFG 4,5, bords adoucis.
- **Panneau IA, une « mini Forge »** (1.1.0, onglet IA à côté de Propriétés ; Édition > Générer une image…) :
  invite (traduite si elle est en français, aperçu de ce qui part), modèle, VAE et encodeur de texte de Forge,
  **LoRA** en grille avec leurs aperçus (poids conseillé et mot déclencheur lus dans leur fiche `.json`, recherche,
  LoRA d'une autre base grisés), préréglages d'échantillonnage de Forge (`style_presets.json`) et préréglages
  Kanevas enregistrés (modèle + LoRA + réglages), échantillonneur, planificateur, étapes, CFG, variantes, force,
  graine (au hasard, ou reprise de la dernière image). Boutons : Générer dans la sélection, **Nouvelle image**
  (txt2img dans un calque, à la taille de la sélection ou de l'image), Développer. Un autre modèle que celui chargé
  dans Forge est utilisé le temps de la requête (Forge revient ensuite au sien, sauf « Garder ce modèle chargé »).
- `KANEVAS_PROFILE=<dossier>` : lance Kanevas avec un dossier de données séparé (essais automatisés pendant que
  l'application habituelle est ouverte).
- Forge est appelé par le processus principal, uniquement sur une adresse locale (127.0.0.1 par défaut, réglable dans
  Paramètres avancés). Rien ne part en ligne.

## Img2Img dans le Studio IA
- **Img2Img** retrouve son onglet dans le Studio, avec une image source et un aperçu des résultats côte à côte.
  Importer une image par clic ou glisser-déposer, ou utiliser **Envoyer vers Img2Img / Inpaint** depuis l'Édition.
- Depuis txt2img, Extras, PNG Info ou la Galerie, **Envoyer vers Img2Img / Inpaint** transfère l'image et ses paramètres.
  La source reste choisie lorsque l'on change de document dans l'Édition ou d'onglet dans le Studio.
- **Inpaint, Sketch et Inpaint sketch restent dans le Studio** : peindre sur l'image source avec le pinceau
  ou la gomme, régler la taille et la couleur, annuler/rétablir les traits, effacer ou inverser le masque.
  L'import d'un masque et le traitement par lots sont également accessibles dans cet onglet.
- L'Édition ne contient plus de panneau Img2Img. Son bouton **Envoyer au Studio** copie l'image et ses paramètres ;
  peindre ou générer dans le Studio ne modifie pas le document de l'Édition.
- Générer conserve les résultats dans le Studio. **Ouvrir le résultat dans l'Édition** crée un document ;
  **Ajouter en calque** revient au document actif ; **Envoyer vers Img2Img** reprend le résultat comme source
  sans créer de documents supplémentaires.
- **Graine aléatoire à chaque génération** : les graines des images restent consultables dans leurs informations,
  mais un import ou un transfert ne les fixe pas pour la génération suivante.
- **Ctrl+Entrée** démarre ou interrompt la génération dans tout le Studio, y compris depuis les champs de texte.
  Pendant la préparation, le même raccourci annule le lancement.
- Vérification des parcours sans moteur réel : `node_modules/.bin/electron tools/test-studio.cjs`
  (profil temporaire et réponses Forge simulées).

## Édition ⇄ Studio IA, LoRA, Train LoRA (1.4.0 — ancien parcours)
- **img2img passe dans l'Édition** : le panneau IA de l'Édition est remplacé par le panneau **img2img** de Forge (mêmes
  réglages que dans le Studio : Resize mode, Inpaint, Soft inpainting, Denoising, ADetailer, MultiDiffusion, scripts…),
  avec ses modes img2img / Sketch / Inpaint / Inpaint sketch / Inpaint upload / Batch, juste à côté de la toile.
  L'onglet img2img du Studio est retiré.
- **Envoi dans les deux sens** : du Studio, 🖼️ / 🎨 ouvrent l'image dans l'Édition (panneau img2img ou Inpaint) ;
  de l'Édition, « Envoyer au Studio IA » (panneau img2img et menu IA) renvoie le document tel qu'il est vers la sortie
  de txt2img (✨ hires, 💾, Send to…), Extras ou PNG Info, ou ses paramètres vers txt2img.
- **Refiner** retiré.
- **LoRA personnalisables comme dans Forge** : bouton 🛠️ sur chaque carte (Description, Stable Diffusion version,
  Activation text, Preferred weight, Negative prompt, Notes, aperçu à partir d'une image générée ou du document),
  écrit dans le même `<lora>.json` que Forge ; le negative text s'ajoute à l'invite négative ; étiquettes des LoRA
  actifs sous l'invite avec leur poids ; Ctrl+↑ / Ctrl+↓ dans l'invite change le poids comme dans Forge.
- **Train LoRA refait** : l'Atelier LoRA devient un onglet du Studio qui reprend l'onglet de Forge carte par carte
  (Project, Preset, Captions, Training settings, Free VRAM, Start / Stop / Refresh progress, extinction du PC),
  import d'un dossier source, légendes modifiables, progression en direct, LoRA produits à essayer dans txt2img ;
  les générations attendent la fin d'un entraînement (comme Forge).
- Menu IA de l'Édition simplifié : les commandes en double avec le Studio sont retirées (nouvelle image, image → image,
  agrandir et détailler, IA en direct) ; restent les outils de retouche (remplissage génératif, suppression, développement,
  super résolution, harmoniser).

## Studio IA = la page de Forge (1.3.0)
- Le Studio IA reprend l'interface de Forge (thème Modern UI de Kane OS) : rail à gauche (txt2img, img2img, Extras,
  PNG Info, Train LoRA, ImgCut, Settings), barre Checkpoint / VAE / Text Encoder / Diffusion in Low Bits / VRAM,
  Prompt et Negative Prompt avec compteur, Generate orange (Interrupt / Skip), Styles, onglets Generation /
  Checkpoints / Lora (cartes, puces de dossiers, tri), mêmes réglages, mêmes noms et même ordre que Forge.
- Réglages repris tels quels : Sampling Method / Schedule Type / Steps, Preset (le même fichier que Forge), Hires. fix
  complet, Refiner, Width / Height / Batch, FORMAT ANIMA / 1024, Shift, CFG Scale, Seed + Extra, ADetailer (4 onglets,
  Detection, Mask Preprocessing, Inpainting), Never OOM, MultiDiffusion, Soft inpainting, scripts (X/Y/Z plot, Prompt
  matrix, Prompts from file, Loopback, SD upscale). Valeurs par défaut lues dans Forge.
- img2img : sous-onglets img2img / Sketch / Inpaint / Inpaint sketch / Inpaint upload / Batch ; l'image d'entrée est le
  document Kanevas (toile et outils dans l'onglet), le masque se peint sur « Zone IA », le croquis sur « Croquis IA ».
  Resize mode, Mask blur, Mask mode, Masked content, Inpaint area et padding envoyés à Forge comme dans son interface.
- Sorties comme Forge : images enregistrées par Forge dans ses dossiers output, boutons 📂 💾 🗃️ 🖼️ 🎨 📐 ✨, infotexte,
  Send to entre onglets ; Extras (Upscaler 1 / 2) et PNG Info (Send to txt2img / img2img / inpaint / extras).

## Studio IA autonome (1.2.0)
- **Moteur intégré** : Kanevas démarre lui-même le moteur de Forge quand on entre dans le Studio IA ou qu'on génère
  (`launch.py` du dossier de Forge, profil de Kane OS, `--nowebui --port 7862 --server-name 127.0.0.1`, prêt en
  ~10 s). Si le Forge de Kane OS tourne déjà (7860), il est réutilisé. Voyant « IA » dans la barre de titre :
  démarrer, arrêter, journal, profil (RTX 5080 / portable 8 Go), démarrage automatique. Le moteur est arrêté en
  quittant ; un moteur resté actif après un plantage est repris et peut être arrêté.
- **Studio IA** (bascule Édition ⇄ Studio IA dans la barre de titre, F6) : tous les réglages de Forge dans une
  colonne à gauche, barre de modes au-dessus de l'image, galerie des résultats à droite.
  - **Créer** : txt2img, dans un nouveau document (ou un calque).
  - **Transformer** : img2img de toute l'image (ou de la sélection), force réglable.
  - **Retoucher la zone peinte** : « Peindre la zone » crée le calque rouge **Zone IA** ; on peint ce qui doit
    changer (gomme, effacer, inverser, sélection → zone), on décrit le résultat, Générer : seule la zone change.
  - **Croquis** : « Peindre le croquis » crée le calque **Croquis IA** ; on peint grossièrement formes et couleurs,
    Forge en fait une vraie image à cet endroit.
  - **Agrandir** : ESRGAN puis MultiDiffusion.
- Réglages Forge ajoutés : **hires fix** (agrandissement, agrandisseur, étapes, force, CFG), **refiner**, **lots**
  (nombre de lots × images par lot), **graine de variation**, retouche (**contenu masqué**, zone seule + marge ou
  image entière, flou du masque, **soft inpainting**), **Never OOM**, interrompre / passer.
- **Galerie** : chaque image générée (vignette, ouvrir, ajouter en calque, transformer, réutiliser les réglages,
  copier, infos) ; **enregistrement automatique** avec les paramètres dans `C:\KaneOS\output\kanevas\<type>\<date>`
  (jamais dans Images : souvent un dossier OneDrive, où la création récursive de dossiers de Node boucle sans fin).

## Studio Forge (1.1.0)
Kanevas pilote le Forge local comme un « mini Forge », avec en plus tout l'éditeur autour (menu **IA**, panneau **IA**).
- **Nouvelle image** (Ctrl+Alt+N) : txt2img dans un **nouveau document** (taille, formats, « comme l'image »), l'image
  en cours n'est jamais touchée. Variantes ‹ ›, « Générer encore ». Aussi : image dans un calque ou dans la sélection.
- **Image → image** : l'image (ou la sélection) retravaillée selon l'invite et la force, dans un calque au-dessus.
- **ADetailer** : détecteurs de Forge (visages, mains, yeux Eyeful…), jusqu'à 3, invite / force / confiance ; à chaque
  génération, ou **Retoucher (ADetailer)** seul sur l'image en cours (comme « Skip img2img »), dans un calque.
- **Agrandir et détailler** : agrandissement ESRGAN (×1,5 / ×2 / ×3) puis image vers image par tuiles
  (**MultiDiffusion**, Mixture of Diffusers), dans un nouveau document (calque agrandi + calque détaillé).
- **Shift** (anima) envoyé comme dans Forge (3), préréglages de Forge avec leur Shift et leur taille.
- **Aperçu en direct** de l'image qui se forme pendant chaque génération (option de Forge).
- **PNG Info** (Fichier ou IA) : les paramètres d'un PNG de Forge sont lus à l'ouverture et réécrits à l'export PNG ;
  « Envoyer au panneau IA » reprend invite, LoRA, réglages, graine, taille, modèle.
- **IA en direct** : pendant que vous dessinez, Forge repeint l'image dans une fenêtre flottante (image vers image,
  peu d'étapes, graine fixe ; ~1 s par rendu en 640 px) ; « Poser en calque » garde un rendu.
- **Atelier LoRA** (IA > Atelier LoRA, ou bouton du panneau) : projets de l'entraîneur de Forge (mêmes dossiers),
  images depuis des fichiers, un dossier, l'image en cours, la sélection ou les documents ouverts ; légendes WD14
  automatiques, modifiables, ajout / retrait d'un tag partout ; type (style, personnage, vêtement…) et préréglage de
  l'entraîneur ; modèle de base (anima Base conseillé), époques, répétitions, dim, taux, résolution, multi-résolutions,
  options avancées ; lancement (le modèle de Forge est déchargé d'abord), progression, échantillons, arrêt ;
  sauvegardes à **essayer** directement dans le panneau IA. La recette et les préréglages sont ceux de
  `forge_lora_trainer`, appelé par `lora_bridge.py` avec le Python du venv de Forge.
- **Découper pour les réseaux** (Image, remplace ImgCut) : carrousel (Instagram 4:5, Story 9:16, X 3:4, 2:3, carré,
  personnalisé, auto) ou **grille du profil** 3 colonnes numérotée dans l'ordre de publication ; aperçu en direct,
  cadrage en faisant glisser l'aperçu, fond blanc, noir ou flou de l'image ; export numéroté dans un dossier.

## Performances (grandes images)
- Seule la zone modifiée est recomposée (élargie de la portée des styles de calque), par tuiles de 512 px dans de
  petits canevas de travail. Un réglage dépendant du voisinage (Camera Raw : clarté, voile…) recompose tout.
- Affichage progressif façon Photoshop : quand une recomposition serait longue (réglages sur une grande image,
  opacité ou visibilité d'un calque…), l'écran montre aussitôt un aperçu basse résolution (copies réduites des
  calques, en cache) ; la pleine résolution est calculée par tranches pendant les pauses. Export, pipette et
  échantillonnage utilisent toujours la composition exacte.
- Pinceau : l'aperçu et le report sur le calque ne touchent que les nouvelles touches ; l'historique ne garde
  que le rectangle modifié, copié au relâchement ; les tampons du pinceau sont réutilisés d'un trait à l'autre.
- Zoom arrière : l'écran, le navigateur et l'histogramme lisent une pyramide de copies réduites (1/2, 1/4…)
  de la composition, mise à jour par zones ; vignettes des calques réduites par moitiés successives.
- Filtres lourds réécrits (1.0.6), résultats identiques au pixel près : Flou de surface et Réduction du bruit
  répartis sur les cœurs du processeur (workers, `js/kernels.js` + `js/filter-worker.js`), Médiane à médiane
  suivie, Minimum / Maximum en van Herk (coût constant quel que soit le rayon). Mesuré : Flou de surface ×6 à ×7,
  Médiane ×7 à ×13, Maximum rayon 50 : 5,4 s → 0,14 s (1,5 Mpx). La bibliothèque PSD n'est chargée qu'au premier PSD.
  Les tâches longues continuent quand la fenêtre est masquée.
- Banc d'essai : `tools/bench.js` (à charger dans la page de `app/` servie avec le dossier racine), qui vérifie
  aussi que la composition partielle égale une composition complète. Sur 6000×4000 px à 5 calques (réglage
  Teinte/Saturation, ombre portée), mesuré dans Electron jusqu'à la fin du travail du GPU : pinceau 787 → 19 ms
  par mouvement, curseur d'un réglage > 1 s → 21 ms, affichage en zoom arrière 63 → 16 ms.
- Retouche (tampon, correcteurs, pièce, flou, netteté, doigt, densité, éponge) : recomposition limitée aux
  touches, le calque sert de source sans copie, l'historique ne sauvegarde que la zone touchée (par tuiles de
  256 px pour les outils qui modifient le calque au fil du trait). Les grands canevas sont lus au travers d'une
  copie de la zone, pour rester sur la carte graphique. `tools/bench-retouch.js` : en usage réel sur 6000×4000,
  tampon 20 → 99 images/s, correcteur localisé 21 → 107, goutte d'eau 11 → 33.

## IA locale (détourage)
« Sélectionner le sujet », « Supprimer l'arrière-plan » et l'outil « Sélection d'objet » utilisent BiRefNet
(licence MIT) via onnxruntime-node (DirectML sinon processeur). Le modèle est téléchargé au premier usage,
après confirmation, dans `%APPDATA%\Kanevas\models` (ou le dossier de données historique KaneShop si déjà présent) (léger 224 Mo ou complet 973 Mo ; Édition > Modèles d'IA).

## Formats
- **.ksp** : format natif, garde tout (calques de texte modifiables, calques de réglage, masques, styles, repères).
- **.psd** : lecture et écriture via ag-psd : groupes, masques, modes de fusion, opacité, écrêtage, styles,
  calques de réglage (14 types), formes vectorielles (avec repli pixel si besoin).
- **TIFF CMJN** en export (séparation simple, sans profil ICC) ; épreuve écran CMJN et alerte de gamut (Ctrl+Y / Ctrl+Maj+Y).
- 16 bits par couche : non pris en charge (le moteur Canvas travaille en 8 bits).
- PNG, JPEG, WebP, GIF, BMP, SVG, AVIF en lecture ; PNG / JPEG / WebP en export.

## Organisation
```
main.js / preload.js     processus Electron (fenêtre, fichiers, polices)
app/index.html           page
app/css/style.css        thèmes Sombre / Graphite / Clair
app/js/                  cœur : document, calques, sélection, historique, rendu, réglages, filtres, pinceau, E/S
app/js/tools/            outils (sélection, peinture, retouche, transformation, texte, formes…)
app/js/ui/               panneaux, menus, boîtes de dialogue, sélecteur de couleurs
app/vendor/ag-psd.js     bibliothèque PSD (MIT, voir ag-psd-LICENSE.txt)
```

## Installer sur une autre machine
`Lancer Kanevas.cmd` installe les dépendances au besoin. Les versions récentes de npm bloquent les scripts
d'installation : le binaire d'Electron est alors récupéré par `node node_modules\electron\install.js`.

## Tester sans Electron
`python -m http.server 8742 --directory app` puis http://127.0.0.1:8742 (ouverture/enregistrement
passent alors par le navigateur).

Palette par défaut : **Givre**, harmonisée avec KaneOS (gris clair, blanc, bleu #2f6fdb). Les thèmes Sombre et Graphite restent disponibles dans les préférences. Les anciens documents .ksp restent compatibles.


## Protection du travail
Les sauvegardes de secours sont activées par défaut : après 5 secondes d'inactivité et contrôle toutes les 30 secondes (intervalle réglable dans les préférences). Elles restent séparées de vos projets dans le sous-dossier recovery des données de Kanevas. Deux générations sont conservées par document, avec écriture temporaire et validation avant restauration.
Après un arrêt inattendu, une fenêtre propose de récupérer les documents non enregistrés. « Plus tard » conserve les copies ; Fichier > Récupérer des documents permet de les retrouver. Une sauvegarde manuelle réussie ou une fermeture volontaire du document retire sa copie de secours. Une erreur de disque est signalée dans la barre d'état.

## Réglages modifiables
Image > Réglages et Camera Raw créent par défaut un calque de réglage, sans modifier les pixels du calque source. Le réglage est écrêté au calque actif quand celui-ci le permet ; une sélection devient son masque. Double-cliquez sur sa vignette, ou choisissez « Modifier le réglage… » dans ses propriétés ou son menu contextuel. Annuler rétablit le réglage précédent ; OK crée une étape d'historique.
Les ombres, lueurs, contours et incrustations restent modifiables avec « Style de calque… » ou le badge fx. Enregistrez en .ksp pour conserver l'intégralité des réglages ; les exports PNG/JPEG sont des images aplaties. Les filtres pixel et les réglages appliqués à un masque restent des opérations sur les pixels. Le mode historique est disponible en décochant « Créer des réglages modifiables ».

## Réglage des outils au geste
Maintenir Alt + bouton droit dans la zone de travail : glisser horizontalement pour la taille, verticalement pour la dureté. Un cercle rouge et les valeurs montrent l’empreinte. Relâcher pour conserver, Échap pour revenir aux valeurs précédentes. Disponible sur les outils de peinture et de retouche, et la sélection rapide (taille seulement). Le crayon reste à bord dur. Alt + clic gauche garde la pipette ou la définition de source du tampon/correcteur. [ ] et Maj+[ ] restent disponibles.


## Installateur et mises à jour
- **Installer** : télécharger `Kanevas-Setup-x.y.z.exe` depuis les [Releases](https://github.com/Kaynegiordano/Kanevas/releases) (installation par utilisateur, sans droits administrateur).
- **Mises à jour** : Kanevas vérifie les releases GitHub 8 secondes après le démarrage ; Aide > Rechercher des mises à jour… le fait à la demande. Rien n'est téléchargé sans accord, puis « Redémarrer et installer ». Ne fonctionne que dans la version installée.
- **Publier une version** : changer `version` dans `package.json` (et la même dans le journal des changements ci-dessous), puis `Publier une version.cmd`. Il construit l'installateur (`npm run dist`) et crée la release GitHub avec `Kanevas-Setup-x.y.z.exe`, `.blockmap` et `latest.yml` (ce dernier est indispensable aux mises à jour).

## Journal des versions
- **1.0.0** : première version publique, installateur Windows et mises à jour GitHub.
- **1.0.1** : correction de l'icône (multi-tailles, identifiant de barre des tâches aligné sur l'installateur).
- **1.0.2** : rectangle à angles réglables, lasso magnétique, image insérée dans un texte ou une forme, pictos d'outils redessinés, polices du PC dans la version web.
- **1.0.3** : grandes images bien plus fluides (composition par zones, affichage progressif, pyramide de zoom), outil Pièce, calques de remplissage dynamiques, Correction sélective, Atténuer, Ctrl+F, instantanés, Agrandir / Sélection similaire.
- **1.0.4** : retouche fluide sur les grandes images (tampon de duplication, correcteurs, pièce, flou, netteté, doigt, densité, éponge).
- **1.0.5** : Electron 44.7.2 (correctifs de sécurité de Chromium).
- **1.0.6** : façon Photoshop 2026 : outil Suppression et Supprimer avec l'IA (LaMa local), remplissage et développement génératifs et super résolution (via Forge), Harmoniser, pinceau de réglage, barre des tâches contextuelle ; filtres lourds bien plus rapides ; accents réparés dans les noms des modèles d'IA.
- **1.0.7** : génération Forge corrigée : invites en français traduites en anglais sur le PC (fini les filles au hasard), réglages adaptés au modèle anima, force 85 %, invite envoyée affichée ; jointure du développement génératif plus douce.
- **1.1.0** : Studio Forge : nouvelle image dans un nouveau document, image → image, ADetailer (et retouche seule), agrandir et détailler (MultiDiffusion), Shift, aperçu en direct, PNG Info, IA en direct, atelier LoRA (entraîneur de Forge), découpe pour les réseaux (carrousel, grille du profil), menu IA.
- **1.4.1** : Studio IA → Édition : l'invite telle que tapée (français, LoRA), l'invite négative, les styles, l'échantillonnage, la graine et ADetailer passent au panneau img2img (et reviennent avec « Ses paramètres vers txt2img »).
- **1.4.0** : img2img dans l'Édition (panneau de Forge), envoi Édition ⇄ Studio IA, Refiner retiré, fiches LoRA (🛠️) et poids, Train LoRA refait comme l'onglet de Forge.
- **1.3.0** : le Studio IA devient la page de Forge : mêmes onglets, réglages, noms et ordre ; img2img / Sketch / Inpaint sur la toile Kanevas ; Extras, PNG Info, scripts.
- **1.2.0** : Studio IA autonome : moteur de Forge démarré par Kanevas, espace Studio IA (Créer, Transformer, Retoucher la zone peinte, Croquis, Agrandir), hires fix, refiner, lots, graine de variation, options de retouche, soft inpainting, Never OOM, galerie et enregistrement automatique.
