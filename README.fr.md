> The README is machine-generated, if you find issues please submit a PR.
>
> Ce README a été généré automatiquement ; si vous constatez des problèmes, merci de soumettre une pull request.

<p align="center">
  <img src="./icons/android-chrome-512x512.png" alt="WaySlice">
</p>

<h1 align="center">WaySlice</h1>

<p align="center">
  <strong>Telemetry for every way. Sliced.</strong><br><strong>Tout parcours devient télémétrie ; toute télémétrie se découpe et s’analyse.</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a><br>Français | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.it.md">Italiano</a>
</p>

WaySlice est un analyseur open source, 100 % front-end, pour les traces GPX/FIT/TCX/KML/KMZ. Les
statistiques sur la trace entière ne disent pas grand-chose : ce que vous voulez savoir, c'est
comment vous vous êtes sorti de la longue montée, de la descente technique, des 5 derniers km de
la course. WaySlice permet d'isoler n'importe quel secteur et de l'analyser pour lui-même, comme
on lit la télémétrie d'une course automobile ou les enregistreurs de données de vol (QAR) de
l'aviation :

```text
Trace → Choisir un secteur → Analyser le secteur
```

<p align="center"><img src="./screenshots/overview.jpg" alt="image"></p>

<p align="center"><a href="./screenshots/README.fr.md">Plus de captures d’écran</a></p>

Nouveau sur le vocabulaire ? Commencez par la section [Terminologie](#terminologie) — toutes les
autres sections emploient ces mots exactement au sens défini ici.

## Sommaire

- [Terminologie](#terminologie)
- [Fonctionnalités](#fonctionnalités)
- [Formats pris en charge](#formats-pris-en-charge)
- [Prise en main](#prise-en-main)
  - [Analyser un secteur](#analyser-un-secteur)
- [Confidentialité](#confidentialité)
- [Systèmes d'unités](#systèmes-dunités)
- [Notes de conception](#notes-de-conception)
- [Tests](#tests)
- [Contribuer](#contribuer)
  - [Structure du projet](#structure-du-projet)
  - [Ajouter une langue à l'interface](#ajouter-une-langue-à-linterface)
  - [Ajouter ou modifier des fonds de carte](#ajouter-ou-modifier-des-fonds-de-carte)
  - [Remplacer les icônes du site](#remplacer-les-icônes-du-site)
  - [Ajouter une traduction du README](#ajouter-une-traduction-du-readme)
- [Feuille de route](#feuille-de-route)
- [Licence](#licence)
- [Remerciements](#remerciements)
- [Soutiens](#soutiens)

## Terminologie

Ces termes ont un sens fixe dans ce README comme dans l'interface. Quand un mot apparaît avec une
majuscule, il faut le prendre exactement au sens suivant :

| Terme | Signification |
|------|---------|
| Trace (Track) | Un itinéraire enregistré, chargé depuis un seul fichier : une liste ordonnée de points de trace. |
| Point de trace (Track point) | Une mesure unique le long de la trace : la position, plus l'altitude, l'horodatage, la fréquence cardiaque, la cadence, la puissance et la température quand le fichier les fournit. |
| **Secteur (Sector)** | Le concept central de WaySlice. Un secteur est la portion d'une trace comprise entre un point de début et un point de fin que vous choisissez. Les bornes peuvent se placer n'importe où entre deux points de trace (par interpolation). La trace entière est aussi un secteur : c'est la « Trace entière » par défaut. Chaque métrique est calculée pour le secteur courant. |
| Poignée de secteur (Sector handle) | La pastille déplaçable qui fixe une borne du secteur : vert = début, rouge = fin. Les poignées apparaissent à la fois sur la carte et sur le profil altimétrique et restent synchronisées. |
| Dénivelé positif / négatif (Elevation gain / loss) | Cumul des montées / descentes à l'intérieur du secteur, après le filtre de bruit de 3 m (voir [Notes de conception](#notes-de-conception)). |
| VAM / VDM | Vitesse d'Ascension / de Descente en Mètres par heure : vitesse verticale en m/h, calculée uniquement sur le temps réellement passé à monter / descendre. |
| Temps en mouvement (Moving time) | Temps écoulé moins les pauses : une pause est une vitesse inférieure à 0,5 km/h maintenue 10 s ou plus. |
| GAP | Allure corrigée de la pente (grade-adjusted pace) : l'allure du secteur divisée par le facteur de pente de Minetti (2002) — l'allure sur le plat à effort égal. |
| Distance d'effort (Effort distance) | Distance horizontale + dénivelé positif ÷ 100 : chaque 100 m de montée compte pour 1 km. |
| Distance 3D (3D distance) | La distance qui suit le terrain : somme par segment de √(horizontal² + vertical²), présentée séparément de la distance horizontale. |
| Pente (Grade) | La raideur en un point ou sur un tronçon : variation verticale ÷ distance horizontale, affichée en % (positif = montée, négatif = descente). |
| Allure (Pace) | Le temps par unité de distance : min/km ou min/mi. |
| Waypoint | Un lieu nommé stocké dans le fichier de trace lui-même (balises `<wpt>` GPX, `<Point>` KML). |
| Fond de carte (Basemap) | La source de tuiles cartographiques dessinée sous votre trace. Par défaut OpenStreetMap. |

## Fonctionnalités

- **Carte + profil altimétrique.** Faites glisser les poignées du secteur sur l'une ou l'autre
  surface. Les deux restent synchronisées en temps réel, et une borne peut se placer n'importe où
  entre deux points de trace, interpolation comprise.
- **Waypoints sur la carte et le profil.** Les waypoints GPX (`<wpt>`) et KML (`<Point>`) sont
  affichés sous forme d'épingles avec leur nom en info-bulle — activez-les avec le bouton épingle
  sous « Cadrer sur la trace ». Survoler une épingle marque le point correspondant sur le profil
  altimétrique, et cliquer dessus centre la carte dessus sans changer le niveau de zoom.
- **Zoom molette du profil (bureau), zoom par pincement (tactile).** Survolez le profil altimétrique
  et faites défiler pour zoomer son axe distance/temps autour du curseur ; Maj + glisser pour
  déplacer ; sur tactile, un doigt déplace et un pincement à deux doigts fait de même. Double-cliquer n'importe où sur
  le profil — ou double-taper au doigt — restaure la trace entière.
- **Découpage auto.** Le bouton ciseaux de l'en-tête construit une liste de secteurs pour toute la
  trace : découpage aux waypoints (de CP en CP), à distance fixe (1 km / 5 km / personnalisé — en
  miles quand l'impérial est actif), ou à la pente en tronçons de montée / descente. Chaque ligne affiche numéro, plage, pastille de type (montée, descente, plat ou mixte, selon le
  dénivelé), puis temps, allure et fréquence cardiaque ; sur écran étroit la ligne se coupe en
  deux, la pastille porte son texte et les données s'alignent sur le début de la plage ; déplier
  une ligne révèle les
  détails du secteur — distance 3D, distance d'effort, dénivelé positif/négatif, GAP, VAM/VDM — et
  y fait passer le secteur principal.
- **Métriques du secteur.** Distance horizontale et 3D, distance d'effort, dénivelé positif/négatif,
  pentes, temps écoulé et temps en mouvement, allure, vitesse, GAP, plus fréquence cardiaque,
  cadence, puissance et température quand le fichier les contient. Quand des données manquent,
  vous obtenez *Indisponible*, pas 0.
- **Analyse à deux variables.** L'icône de nuage de points à côté des commandes du profil ouvre
  une carte de densité 2D pour toute paire valide de grandeurs — fréquence cardiaque, vitesse,
  allure, GAP, cadence, puissance, température, pente, altitude. L'analyse suit le secteur
  sélectionné, et chaque grandeur prend ses valeurs dans le mécanisme du panneau de métriques
  lui-même : fréquence cardiaque, cadence et puissance retirent les lectures en pause et
  reçoivent le lissage à 5 points du panneau, la température reste brute (pauses incluses), la
  pente utilise les fenêtres de gradient de 50 m du panneau, et la famille vitesse est la
  série de vitesse maximale du panneau pour le secteur. Le survol lit le
  X, le Y et la densité relative de la cellule. Thèmes, unités et langues s'appliquent en direct,
  et un module de graphique dédié garde fluides même les traces de 100 000 points. Sur tactile, deux doigts zooment et déplacent, un doigt parcourt les
  données, un double-tap ramène l'intervalle complet.
- **Export.** Téléchargez le secteur courant — ses métriques en csv, txt ou md, ses points de trace en
  fichier GPX. Les exports suivent la langue et le système d'unités actifs au moment du clic.
- **Unités métriques / impériales.** Changez d'unités d'affichage à tout moment. Le métrique est la
  valeur par défaut et votre choix est stocké localement.
- **Multilingue.** English, Français, 日本語, 한국어, Deutsch, Español et Italiano sont
  intégrés. Chaque langue supplémentaire tient dans un seul fichier de données (voir [Contribuer](#contribuer)).
- **Confidentialité par l'architecture.** Il n'y a aucun code d'envoi. Votre fichier est lu via la
  File API, puis analysé et rendu dans votre navigateur.
- **Aucune étape de build.** De simples modules ES. À lire, exécuter et modifier tels quels.

## Formats pris en charge

| Format | Géométrie | Altitude | Horodatage |
|--------|----------|-----------|------------|
| `.gpx` | `<trk><trkseg><trkpt>` (multi-segments) | ✅ | ✅ |
| `.fit` | Fichiers d'activité binaires Garmin FIT | ✅ | ✅ |
| `.tcx` | XML TrainingCenterDatabase | ✅ | ✅ |
| `.kml` | `LineString` + `gx:Track` | ✅ (depuis les coordonnées) | ✅ (`gx:Track` / `<when>`) |
| `.kmz` | ZIP → KML (`DecompressionStream` natif, sans bibliothèque) | ✅ | ✅ |

Le décodage FIT est assuré par la bibliothèque [fit-parser](https://github.com/jimmykane/fit-parser)
(MIT) fournie dans `vendor/fit-parser/` ; le TCX est lu par un analyseur DOM intégré. Les extensions
capteurs GPX sont lues sans tenir compte du préfixe de namespace : TrackPointExtension Garmin
(fréquence cardiaque, cadence, température, vitesse, distance) et les trois variantes courantes de
puissance (`<power>` nu, `PowerInWatts`, `ns3:Watts`). Tous les formats convergent vers le même
modèle de point de trace : les métriques de secteur se comportent identiquement quelle que soit la
source.

## Prise en main

**Try it: https://wayslice.com**

N'importe quel serveur de fichiers statiques convient. Il n'y a rien à construire :

```bash
# Python
python -m http.server 8080

# ou Node
npx serve .
```

Ouvrez ensuite <http://localhost:8080> et déposez un fichier GPX/FIT/TCX/KML/KMZ.

> Ouvrir `index.html` directement en `file://` ne fonctionne pas : les navigateurs bloquent les
> imports de modules ES sur les URL `file://`.

### Analyser un secteur

1. Déposez votre trace. Toute la trace est sélectionnée par défaut.
2. **Faites glisser les poignées vertes/rouges du secteur** sur la carte ou sur le profil
   altimétrique. Vous pouvez aussi cliquer sur la trace ou le profil pour déplacer la borne la plus
   proche, ou glisser sur le profil pour sélectionner une nouvelle plage. Sur tactile, un doigt
   déplace le profil zoomé et un pincement zoome — les changements de secteur se font via les poignées.
3. Chaque changement recalcule le secteur instantanément : distance, distance 3D, dénivelé
   positif/négatif, pentes, allure/vitesse, kilomètre le plus rapide / le plus lent.
4. Au clavier : donnez le focus à une poignée et utilisez les flèches (Maj = ×10, Début/Fin =
   saut). `Échap` ferme les menus.
5. Les appareils tactiles utilisent des gestes coopératifs : un doigt fait défiler la page, deux
   doigts déplacent et zooment la carte (un rappel s'affiche sur la carte).
6. Secteurs tout prêts : le bouton `Découpage auto` de l'en-tête construit une liste de secteurs
   pour toute la trace — par waypoint, à distance fixe ou à la pente.

## Confidentialité

- Votre trace n'est traitée **que** dans votre navigateur : analyse → calculs → rendu, tout en
  local.
- Les seules requêtes réseau sont les **tuiles cartographiques** du fond de carte choisi. Vos
  données de trace ne sont jamais transmises, et il n'y a aucune statistique d'usage.
- Thème, langue, fond de carte et unités sont stockés dans le `localStorage` de votre appareil
  uniquement.

## Systèmes d'unités

WaySlice est livré en **métrique** par défaut et gère aussi l'**impérial**. Ouvrez le tiroir
`Paramètres` via la roue dentée de l'en-tête — les unités voisinent avec la langue et le thème :

| Affichage | Métrique | Impérial |
|---|---|---|
| Longue distance | km | mi |
| Courte distance / altitude | m | ft |
| Vitesse | km/h | mph |
| Allure | min/km | min/mi |
| Pente | % | % |

Tous les calculs et l'analyse restent en unités SI (mètres, mètres/seconde, secondes/kilomètre).
Changer d'unités ne fait que remettre en forme les nombres affichés : le fichier n'est pas réanalysé,
le secteur n'est pas recalculé, la géométrie de la trace ne bouge pas. La préférence est stockée
sous la clé `wayslice-units` et survit aux rechargements. Langue et unités sont deux réglages
indépendants : toute langue fonctionne avec l'un ou l'autre système.

## Notes de conception

- La **distance 3D** est calculée par segment comme `√(horizontal² + vertical²)` et présentée
  séparément de la distance horizontale.
- La **distance d'effort** = distance horizontale + dénivelé positif ÷ 100 (100 m de montée comptent
  pour 1 km).
- La **pente moyenne** est le dénivelé positif cumulé du segment divisé par la distance horizontale,
  pas la moyenne des pentes point par point ; un segment qui ne fait que descendre n'a aucun dénivelé
  positif à moyenner et affiche « — ». Les pentes max/min utilisent des fenêtres d'environ 50 m, pour
  qu'un bruit GPS ne puisse pas fabriquer un record de pente.
- Le **dénivelé positif/négatif** applique un filtre à hystérésis de 3 m : la variation d'altitude
  s'accumule jusqu'à franchir ±3 m et ne compte qu'à ce moment — le bruit inférieur à 3 m ne
  gonfle jamais les totaux.
- **VAM/VDM** divisent le dénivelé par le temps réellement passé à monter/descendre (la tendance
  d'altitude filtrée), pas par le temps total du secteur.
- Le **temps en mouvement** ne compte que les segments hors pauses (vitesse inférieure à 0,5 km/h
  maintenue 10 s ou plus).
- La **vitesse moyenne et l’allure moyenne** sont calculées à partir des vitesses en mouvement par
  segment et nettoyées comme la courbe du profil : avec des vitesses enregistrées, une fenêtre
  glissante de 5 points dilue le pic dans son voisinage ; sans vitesses enregistrées, seule la règle
  des 3 écarts-types s’applique. La **vitesse maximale** lit la courbe par points nettoyée du profil,
  pour que la liste et le graphique coïncident toujours.
- Le **GAP moyen** divise l'allure de chaque segment par le facteur de pente de Minetti (2002)
  (borné à ±45 % de pente) avant moyennage : l'allure sur le plat à effort égal. Dans le profil,
  vitesse/allure/GAP partagent un même emplacement de superposition.
- **Les courbes de vitesse du profil** choisissent la règle selon la source : les vitesses
  enregistrées sont d’abord contrôlées par rapport au dd/dt du segment (les lectures dépassant
  de 50 % sont écartées), puis lissées par une fenêtre glissante de 5 points (chaque valeur = la moyenne
  d’au plus cinq points centrés sur chacune) ; les vitesses calculées suivent directement la règle 3σ
  (hors limites remplacées par interpolation des voisines). Un zéro enregistré (une pause) est une donnée
  et participe à la moyenne comme les autres.
- La **simplification d'affichage** (Douglas–Peucker pour la carte, échantillonnage min–max par
  pixel pour le profil) ne touche jamais les points d'origine. Les métriques se calculent toujours
  sur les données complètes.
- Le **zoom du profil** descend jusqu'à une fenêtre de 1 km en mode distance et de 20 minutes en
  mode temps ; sur les appareils tactiles, le profil se zoome par pincement à deux doigts — pas de molette.
- Les grandes traces (100 000 points et plus) fonctionnent sans problème. Pendant le glissement
  d'une poignée, la recherche de borne repart du résultat précédent et élargit sa fenêtre au besoin.

## Tests

Ouvrez `tests/index.html` sur le même serveur :

```text
http://localhost:8080/tests/
```

La suite couvre les calculs de distance, l'interpolation entre points, les fenêtres de pente, les
métriques temporelles, l'analyse GPX/FIT/TCX/KML/KMZ (fichiers malformés et archives compris, avec
les variantes de puissance et d'extensions capteurs GPX), la matrice de préférences de thème
(système/manuel × clair/sombre de l'OS), la chaîne de repli des langues et les conversions
métrique/impérial (arrondi d'allure, VAM, persistance et pentes indépendantes des unités), plus
l'export de secteur (contenu csv/txt/md/gpx et noms de fichiers).

## Contribuer

### Structure du projet

```text
index.html              coquille + script de démarrage du thème (pas de flash de mauvais thème)
icons/                  ressources d'icônes (favicon.svg + tailles PNG/ICO, page d'aperçu)
site.webmanifest        métadonnées d'installation PWA (nom, couleurs de thème, icônes)
css/                    jetons de design (clair/sombre), base, mise en page, composants
js/
  parsers/              GPX / FIT / TCX / KML / KMZ → un seul tableau unifié de points de trace
  geo/                  haversine + distance 3D, interpolation, simplification
  metrics/              métriques de secteur (fonctions pures, testables indépendamment)
  sector/               état de sélection du secteur (source de vérité unique)
  map/                  vue MapLibre, catalogue de fonds de carte, poignées de secteur
  charts/               graphiques canvas (profil altimétrique, analyse à deux variables)
  theme/                système / clair / sombre avec synchronisation live de l'OS
  language/             noyau de langue + packs lang-*.js + modèle
  units/                préférence métrique / impériale, conversions SI d'affichage, libellés d'unités localisés
  ui/                   panneau de métriques, tiroir de paramètres, découpage auto, menus, feuilles, upload, icônes
  core/                 mini bus d'événements + stores
  utils/                formatage sensible au locale (Intl)
tests/                  suite de tests exécutable dans le navigateur (tests/index.html)
vendor/fit-parser/      boîte à outils fit-parser fournie (décodage FIT, MIT) + shim buffer
```

La logique de calcul vit à l'écart de l'UI : `computeSectorMetrics()` et les autres fonctions de
métrique ne touchent jamais au DOM, et la suite de tests les couvre.

### Ajouter une langue à l'interface

Le système de traduction n'a aucun framework derrière lui : **une langue est un seul fichier de
données**. Si vous savez éditer un fichier JavaScript, vous pouvez traduire l'application.

1. Copiez [`js/language/lang-template.js`](js/language/lang-template.js) en `lang-xx.js`
   (`xx` = un code BCP 47 comme `es`, `pt-BR`).
2. Traduisez les valeurs à droite. Gardez les clés et les `{placeholders}` tels quels, et gardez
   les termes techniques cohérents (Secteur, Distance 3D, Dénivelé positif/négatif, Pente, Allure,
   VAM).
3. Ajoutez une entrée au catalogue de [`js/language/langs.js`](js/language/langs.js) — code de
   langue, nom natif et chargeur paresseux. Les packs se chargent à la demande : au démarrage,
   seuls la langue du visiteur et l’anglais sont récupérés.
4. Ouvrez l'application, basculez vers votre langue et regardez la console. WaySlice valide les
   packs chargés contre les clés anglaises et signale les clés manquantes ou inconnues.
5. Soumettez une pull request.

Les clés manquantes retombent vers l'anglais (puis vers la clé elle-même), donc l'interface
n'affiche jamais `undefined`. Les choix de langue, de thème et de fond de carte survivent aux
rechargements dans le `localStorage`.

### Ajouter ou modifier des fonds de carte

Le catalogue des fonds de carte tient dans un seul fichier : [`js/map/sources.js`](js/map/sources.js).
Le menu Carte, la feuille de paramètres, la persistance et la création des couches de tuiles le
lisent tous — ajouter ou modifier une source ne demande aucun code d'interface.

**Ajouter une source** — ajoutez un objet à `MAP_SOURCES` :

```js
{
  id: 'esri-topo',           // unique ; sert aussi de clé de persistance
  labelKey: 'srcEsriTopo',   // clé de traduction du nom affiché
  group: 'outdoor',          // street | outdoor | satellite | minimal
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri',
},
```

| Champ | Signification |
|---|---|
| `id` | Identifiant unique et clé de persistance. Le changer équivaut à une nouvelle source (les sélections enregistrées retombent sur la valeur par défaut) ; supprimer une entrée retombe aussi en toute sécurité. |
| `labelKey` | Clé i18n du nom affiché. |
| `group` | Un de `street`, `outdoor`, `satellite`, `minimal`. |
| `url` | Gabarit de tuiles : `{z}` `{x}` `{y}`, optionnel `{s}` (nécessite `subdomains`) et `{r}` (retina). Attention à l'ordre des coordonnées du fournisseur — Esri utilise `{z}/{y}/{x}`. |
| `overlayUrl` | Optionnel : gabarit d'une couche d'étiquettes transparente posée sur les tuiles de fond. |
| `maxZoom` | Zoom maximal servi par le fournisseur. |
| `attribution` | Exigée légalement par OSM, OpenTopoMap, Thunderforest, Mapy, Stadia Maps et Esri — conservez-la. |
| `subdomains`, `crossOrigin`, `hintKey` | Optionnels : rotation de sous-domaines ; `crossOrigin: false` pour les serveurs de tuiles sans en-têtes CORS ; ligne d'aide grise dans le sélecteur. |

Ajoutez ensuite le nom affiché à **chaque** pack de langue — par exemple
`srcEsriTopo: 'Esri Topo',` dans `lang-en.js`, `lang-fr.js`, `lang-ko.js`, `lang-ja.js`, `lang-de.js`, `lang-es.js`, `lang-it.js` et `lang-template.js`. Le test de complétude des langues reste rouge
tant que tous les packs n'ont pas la clé ; c'est voulu.

**Modifier une source** en changeant `url`, `maxZoom`, les noms ou l'attribution sur place. Pour un
**nouveau groupe**, ajoutez-le au tableau `GROUP_ORDER`, utilisez-le sur vos sources et ajoutez une
clé `group<Nom>` (par ex. `groupTopo`). Les services qui exigent une clé d'API (Maptiler, Mapbox)
fonctionnent avec la clé incrustée dans `url`, mais ne commitez pas votre propre clé. Préférez des
tuiles en HTTPS : sur une page servie en HTTPS, le navigateur bloque les tuiles HTTP ou les force
en HTTPS. Pour vérifier : rechargez, ouvrez le menu `Carte`, et contrôlez les tuiles,
le zoom maximal et l'attribution.

### Remplacer les icônes du site

Toutes les icônes du site dérivent d'un fichier source unique, `icons/favicon.svg` — une tuile arrondie
de 1024×1024 avec deux crêtes de montagne orange sur un dégradé sombre, une ligne de trace GPX
blanche, et des points vert/rouge reprenant les poignées de secteur de l'application. À partir de
lui, régénérez `favicon.ico`, les PNG de 16 à 512 px, `apple-touch-icon.png`, les icônes Android
Chrome et `site.webmanifest`. Les moteurs de recherche ont leurs propres exigences (Google exige
un PNG de 48 px ou plus, le manifeste et un robots.txt explorables — d'où le `robots.txt` à la
racine du dépôt). `icons/icon-preview.html` montre toutes les tailles en local. Dans l'application,
l'en-tête et l'état vide réutilisent le logo `icons/favicon.svg` ; les icônes fonctionnelles proviennent
de la bibliothèque d'icônes Lucide (licence ISC) et sont réunies dans `js/ui/icons.js`. Le lien
GitHub de l’en-tête fait exception : il charge les fichiers de logo GitHub de `icons/` comme des
images (la marque Octocat et le logotype sont des marques déposées de GitHub, Inc., utilisées
uniquement pour renvoyer vers ce dépôt).

Pour mettre votre propre logo, modifiez `icons/favicon.svg`, régénérez les autres tailles à partir de
lui, et gardez les liens de `index.html` et de `site.webmanifest` synchronisés.

### Ajouter une traduction du README

Les traductions existantes ([English](README.md), [日本語](README.ja.md), [한국어](README.ko.md), [Deutsch](README.de.md),
[Español](README.es.md), [Italiano](README.it.md)) vous servent de
modèles. Pour en ajouter une :

1. Copiez ce `README.md` (ou n'importe quelle traduction existante) en `README.xx.md`
   (`xx` = un code BCP 47, par ex. `README.es.md`).
2. Traduisez le texte. Gardez la structure, l'ordre des sections, les tableaux, les blocs de code
   et les chemins de fichiers inchangés, pour que toutes les versions restent faciles à comparer
   et à maintenir.
3. Mettez à jour la ligne de bascule de langue sous le titre de **chaque** README : ajoutez votre
   langue comme lien ailleurs, en gardant le format `A | B | C | D`. Dans votre propre version,
   votre langue est l'entrée en texte simple.
4. Soumettez une pull request.

## Feuille de route

- Un meilleur algorithme de nettoyage des pics, prenant en compte la dérive GPS et l’échantillonnage clairsemé
- Un meilleur algorithme de détection des pentes pour le découpage auto (montée / descente / plat / mixte)
- Amélioration optionnelle de l'altitude depuis des services MNT externes (uniquement sur
  consentement — le défaut reste 100 % local)

## Licence

Publié sous [licence MIT](LICENSE). Libre d'usage commercial et privé — merci de laisser intactes
les attributions des fournisseurs de cartes :

- [MapLibre GL JS](https://maplibre.org) (BSD-3-Clause)
- © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL)
- [OpenTopoMap](https://opentopomap.org) (CC-BY-SA), [CyclOSM](https://github.com/cyclosm/cyclosm-cartocss-style)
- Fonds de carte [Thunderforest](https://www.thunderforest.com), [Mapy.com](https://mapy.com), [Stadia Maps](https://stadiamaps.com), [Esri World Imagery](https://www.esri.com)
- Icônes par [Lucide](https://lucide.dev) (ISC)

## Remerciements

- Le projet s'inspire librement de l'article [GPS data analysis](https://trailrunningmovement.com/training/gps-data-analysis/)
  de [Trail Running Movement](https://trailrunningmovement.com/).
- À [Ken Zemach](https://fastestknowntime.com/athlete/ken-zemach) pour sa [trace GPX](https://fastestknowntime.com/fkt/ken-zemach-bruksleden-100-miler-sweden-2020-08-02)
  du Bruksleden 100 Miler (Suède).
- À [polyvertex](https://github.com/polyvertex) pour ses [fichiers FIT](https://github.com/polyvertex/fitdecode/tree/master/tests/files).
- À [ToolElewaut](https://github.com/ToonElewaut) pour ses [fichiers TCX](https://github.com/ToonElewaut/TDF/tree/main/src/Data/Routes) du Tour de France 2020 - 2023.
- À [tingard](https://github.com/tingard) pour ses [fichiers TCX](https://github.com/tingard/cycling_power_analysis).
- À [pherris](https://github.com/pherris) pour son [fichier TCX](https://github.com/pherris/IOT-Value-Cycling/tree/master/rides) de sortie à vélo de longue distance avec puissance.
- À [Tommi](https://www.youtube.com/@bewarethemountainman) pour sa [trace GPX](https://drive.google.com/file/d/1lPVebrcOImAw035d9r0tqP63O-2yZe4E/view) de randonnée Kai Kung Leng - Tai To Yan - Tai Mo Shan à Hong Kong.

## Soutiens

Merci à toutes celles et ceux qui aident à maintenir WaySlice et à le faire tourner.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/I8U4273MZK)

### Ko-fi
