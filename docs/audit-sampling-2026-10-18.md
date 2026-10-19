# Check-up du sampling de Studio — 18 octobre 2026

## Périmètre et conclusion

Audit du code de Kanevas 1.12.5 et du moteur installé dans `C:/KaneOS/KanevasData/runtimes/studio` : catalogue, préréglages, txt2img, img2img, Hires, import PNG et validation des paramètres. Aucun changement des réglages personnels, des modèles ou du code de production.

La transmission des paramètres principaux fonctionne. Plusieurs défauts permettent cependant à l'interface d'afficher un choix différent de celui réellement exploité par le moteur. Le réglage configuré pour ANIMA est SEEDS 3 / Beta57 / 22 étapes / CFG 4 / Shift 3. Cette combinaison existe bien dans le moteur ; sa supériorité visuelle n'est pas établie par cet audit.

Le moteur HTTP était arrêté lors du contrôle (connexion refusée sur 127.0.0.1:7860). Les constats portent sur les fichiers locaux, les fonctions de construction des requêtes et des tests numériques sur CPU. Aucune image de benchmark n'a été générée.

## Constats à corriger

### 1. Un ancien sampler peut être remplacé silencieusement — priorité haute

`app/js/studio.js`, fonctions `select`, `loadCat` et `payloadFor` : une valeur sauvegardée ou importée absente du catalogue est réajoutée au menu et envoyée sans validation. Le moteur local, dans `modules/sd_samplers.py:get_sampler_and_scheduler`, remplace une méthode inconnue par sa première méthode ; un scheduler inconnu devient Automatic.

Test exécuté sur la fonction réelle du moteur, sans démarrage de Forge : `Removed sampler / Removed scheduler` devient `DPM++ 2M / Automatic`. Il s'agit d'une substitution conditionnelle confirmée, pas de la preuve qu'une génération personnelle a déjà subi ce problème.

Correction proposée : distinguer les noms reconnus, alias et valeurs obsolètes ; signaler une sélection indisponible avant la génération, puis proposer un choix valide explicite. Revalider aussi après import ou application d'un préréglage.

### 2. Les méthodes masquées dans Forge réapparaissent — priorité moyenne

`main.js`, gestionnaire `forge-catalog`, reprend toutes les méthodes de `/sdapi/v1/samplers`. L'API locale renvoie `all_samplers`, et non les samplers visibles. Kanevas n'applique pas `options.hide_samplers`.

Inventaire statique : 42 samplers enregistrés, dont 10 masqués par la configuration actuelle, soit 32 visibles dans Forge. Studio peut donc reproposer LCM, DDIM, PLMS, Restart et d'autres méthodes volontairement masquées. Cela ne signifie pas que toutes les méthodes masquées sont techniquement incompatibles.

Les schedulers suivent un chemin différent : le moteur applique déjà `hide_schedulers` avant d'exposer leur catalogue. Les 19 schedulers définis donnent actuellement 18 choix, Uniform étant masqué.

Correction proposée : respecter les méthodes masquées tout en signalant une ancienne sélection conservée ; garder les métadonnées de l'API au lieu de réduire chaque méthode à son nom.

### 3. Import PNG : les choix Hires ne sont pas restaurés — priorité moyenne

`app/js/studio.js:applyInfoTo` reprend Sampler, Schedule type, Steps, Hires steps et plusieurs autres paramètres. Il ne lit ni `Hires sampler` ni `Hires schedule type`.

Reproduction ciblée : importer une fiche indiquant Euler / Normal pour la première passe et ER SDE / Beta57 pour Hires conserve les anciens choix Hires, alors que les paramètres de première passe sont bien repris. La génération suivante peut donc différer de l'image importée.

Correction proposée : restaurer les deux champs Hires et rétablir explicitement l'héritage lorsque l'image ne définit pas de choix distinct.

### 4. Les étapes saisies ne sont pas validées avant envoi — priorité moyenne

Le curseur affiche une plage 1–150, mais `slider` affecte directement la saisie numérique et `payloadFor` ne vérifie ni entier ni bornes. Tests confirmés pour 0, -1, 2,5, 151 et une valeur non numérique transmise à la construction de requête. Le résultat exact dépend ensuite de la sérialisation et de la validation du moteur ; aucune génération invalide n'a été lancée.

Correction proposée : valider un entier entre 1 et 150 pour les étapes principales ; conserver 0 comme valeur spéciale valide pour Hires (« autant que la première passe »).

## Coût réel et reproductibilité

Tests sur les fonctions numériques installées avec un débruiteur synthétique sur CPU, un schedule de flow synthétique et Beta57. Pour 22 intervalles :

| Méthode | Appels au débruiteur |
| --- | ---: |
| DPM++ 2M | 22 |
| SEEDS 2 | 43 |
| SEEDS 3 | 64 |

Ces comptes décrivent l'algorithme exécuté. Ils ne constituent ni un chronométrage GPU ni une mesure de qualité, et un appel au débruiteur ne correspond pas nécessairement à une seule passe réseau avec CFG. Présenter seulement les étapes peut rendre les différences de temps difficiles à comprendre.

SEEDS 3 porte aussi le drapeau générique `second_order`, dont `SamplerData.total_steps` estime le coût à 2 × steps, alors que la fonction effectue trois évaluations sur chaque intervalle non final. Ce compteur mérite un contrôle si des mécanismes de changement de modèle ou de conditionnement se basent dessus ; l'audit ne démontre pas d'impact visuel sur ANIMA.

Studio force actuellement `seed = -1`, y compris après import d'une image. C'est un comportement explicite déjà présent. Il empêche un comparatif rigoureux des samplers à bruit initial identique. Un éventuel mode de comparaison devrait permettre une graine fixe sans modifier le comportement aléatoire habituel.

## Points validés

- Les 8 préréglages enregistrés référencent des samplers et schedulers existants et des nombres d'étapes dans la plage principale.
- Le sampler, le scheduler et les étapes sont transmis dans les requêtes txt2img et img2img.
- Les choix Hires distincts sont transmis ; « Use same sampler/scheduler » n'est pas envoyé comme nom de méthode au moteur.
- Hires steps = 0 est conservé, conformément à son rôle d'héritage.
- Beta57 fixe alpha = 0,5 et beta = 0,7. Il est distinct de Beta, qui utilise les options configurables du moteur.
- 36 cas numériques synthétiques passent sans NaN/Inf : SEEDS 2, SEEDS 3 et DPM++ 2M, avec Beta57 et Simple, à 1, 2, 16, 22, 32 et 150 étapes. Cela ne valide pas toutes les combinaisons du catalogue ni la qualité des images.

## Validation et limites

Scripts de diagnostic et sorties dans `dist/` (ignoré par Git) : `audit-sampling-contract.cjs`, `audit-sampling-contract.txt`, `audit-sampling-numeric.py`, `audit-sampling-numeric.json`, `audit-sampling-inventory.json`. Les fonctions testées sont extraites du code réel ; leurs dépendances d'interface ou leur modèle sont simulés.

Le test Electron général existant `tools/test-studio.cjs` a également été lancé dans un profil temporaire. Il échoue sur le libellé ancien « Ouvrir le résultat dans l’Édition », devenu « Ouvrir le résultat dans Retouche ». Ce test général n'est donc pas présenté comme réussi ; les vérifications ciblées de sampling sont indépendantes de cet échec.

Ordre de travail proposé : validation des sélections et des étapes, respect des méthodes masquées, restauration complète de Hires depuis PNG, puis comparatif visuel à graine fixe. Aucun réglage « meilleur sampler » ne devrait être imposé sur la seule base de ces tests techniques.
