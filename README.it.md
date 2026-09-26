> The README is machine-generated, if you find issues please submit a PR.
>
> Questo README è stato generato automaticamente; se trovi problemi, apri una pull request.

<p align="center">
  <img src="./icons/android-chrome-512x512.png" alt="WaySlice">
</p>

<h1 align="center">WaySlice</h1>

<p align="center">
  <strong>Telemetry for every way. Sliced.</strong><br><strong>Ogni strada percorsa diventa telemetria; ogni telemetria si ritaglia e si analizza.</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a><br><a href="README.fr.md">Français</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | Italiano
</p>

WaySlice è un analizzatore open source di tracce GPX/FIT/TCX/KML/KMZ che gira interamente nel browser.
Le statistiche sull'intera traccia dicono poco: quello che vuoi sapere è come hai affrontato la lunga
salita, la discesa tecnica, gli ultimi 5 km di gara. WaySlice ti permette di ritagliare qualsiasi
tratto e analizzarlo da sé, come si leggono le telemetrie delle corse automobilistiche o i
registratori di dati di volo (QAR) dell'aviazione:

```text
Traccia → Scegli un tratto → Analizza il tratto
```

<p align="center"><img src="./screenshots/overview.jpg" alt="image"></p>

<p align="center"><a href="./screenshots/README.it.md">Altri screenshot</a></p>

Prima volta con questi termini? Parti dalla sezione [Terminologia](#terminologia) — tutte le altre
sezioni usano queste parole esattamente con il significato definito lì.

## Indice

- [Terminologia](#terminologia)
- [Funzionalità](#funzionalità)
- [Formati supportati](#formati-supportati)
- [Per iniziare](#per-iniziare)
  - [Come analizzare un tratto](#come-analizzare-un-tratto)
- [Privacy](#privacy)
- [Sistemi di unità](#sistemi-di-unità)
- [Note di progettazione](#note-di-progettazione)
- [Test](#test)
- [Contribuire](#contribuire)
  - [Struttura del progetto](#struttura-del-progetto)
  - [Aggiungere una lingua all'interfaccia](#aggiungere-una-lingua-allinterfaccia)
  - [Aggiungere o modificare mappe di base](#aggiungere-o-modificare-mappe-di-base)
  - [Sostituire le icone del sito](#sostituire-le-icone-del-sito)
  - [Aggiungere un README tradotto](#aggiungere-un-readme-tradotto)
- [Roadmap](#roadmap)
- [Licenza](#licenza)
- [Ringraziamenti](#ringraziamenti)
- [Sostenitori](#sostenitori)

## Terminologia

Questi termini hanno un significato fisso in questo README come nell'interfaccia dell'app. Quando una
parola compare con la maiuscola, va presa esattamente in questo senso:

| Termine | Significato |
|------|---------|
| Traccia (Track) | Un percorso registrato, caricato da un unico file: un elenco ordinato di punti della traccia. |
| Punto della traccia (Track point) | Una singola misurazione lungo la traccia: la posizione, più quota, marca temporale, frequenza cardiaca, cadenza, potenza e temperatura quando il file le fornisce. |
| **Tratto (Sector)** | Il concetto centrale di WaySlice. Un tratto è la parte della traccia compresa tra un punto di inizio e uno di fine scelti da te. I confini possono stare in qualsiasi punto tra due punti della traccia (interpolati). Anche l'intera traccia è un tratto: la «Traccia completa» predefinita. Ogni metrica è calcolata per il tratto corrente. |
| Maniglia del tratto (Sector handle) | Il punto trascinabile che fissa un confine del tratto: verde = inizio, rosso = fine. Le maniglie compaiono sia sulla mappa sia sul profilo altimetrico e restano sincronizzate. |
| Dislivello positivo / negativo (Elevation gain / loss) | Salita / discesa totali all'interno del tratto, dopo il filtro del rumore di 3 m (vedi [Note di progettazione](#note-di-progettazione)). |
| VAM / VDM | Velocità ascensionale / di discesa in metri all'ora: velocità verticale in m/h, calcolata solo sul tempo effettivamente speso a salire / scendere. |
| Tempo in movimento (Moving time) | Tempo trascorso meno le pause: una pausa è una velocità sotto 0,5 km/h prolungata per 10 s o più. |
| GAP | Ritmo adeguato alla pendenza (grade-adjusted pace): il ritmo del tratto diviso il fattore di pendenza di Minetti (2002) — il ritmo in piano a pari sforzo. |
| Distanza equivalente (Effort distance) | Distanza orizzontale + dislivello positivo ÷ 100: ogni 100 m di salita contano come 1 km. |
| Distanza 3D (3D distance) | La distanza che segue il terreno: somma per segmento di √(orizzontale² + verticale²), riportata separatamente dalla distanza orizzontale. |
| Pendenza (Grade) | La ripidezza in un punto o su un tratto di percorso: variazione verticale ÷ distanza orizzontale, mostrata in % (positiva = salita, negativa = discesa). |
| Ritmo (Pace) | Il tempo per unità di distanza: min/km o min/mi. |
| Waypoint | Un luogo con nome memorizzato nel file della traccia stessa (tag `<wpt>` GPX, placemark `<Point>` KML). |
| Mappa di base (Basemap) | La fonte di tile cartografiche disegnata sotto la tua traccia. Predefinita OpenStreetMap. |

## Funzionalità

- **Mappa + profilo altimetrico.** Trascina le maniglie del tratto su una delle due superfici. Le due
  restano sincronizzate in tempo reale e un confine può stare in qualsiasi punto tra due punti della
  traccia, interpolazione compresa.
- **Waypoint su mappa e profilo.** I waypoint GPX (`<wpt>`) e KML (`<Point>`) sono mostrati come
  puntine con il nome in una soffietta — attivale con il bottone a puntina sotto «Zoom sulla traccia».
  Passando sopra una puntina, il punto corrispondente viene marcato sul profilo altimetrico;
  cliccandola la mappa si centra su di essa senza cambiare il livello di zoom.
- **Zoom a rotella del profilo (desktop), zoom a pizzico (touch).** Passa col cursore sul profilo
  altimetrico e scorri per ingrandire l'asse distanza/tempo attorno al cursore; Maiusc + trascinamento
  per spostarlo; sul touch, un dito sposta e un pizzico di due dita fa zoom. Un doppio clic in un punto qualsiasi del
  profilo — o un doppio tocco su schermo tattile — ripristina la traccia completa.
- **Suddivisione automatica.** Il bottone a forbici dell'intestazione costruisce un elenco di tratti
  per l'intera traccia: tagli ai waypoint (da CP a CP), a distanza fissa (1 km / 5 km / personalizzato
  — in miglia con l'imperiale attivo), o per pendenza in segmenti di salita / discesa. Ogni riga mostra numero, intervallo, capsula di tipo (salita, discesa, piatto o misto, in base
  al dislivello), poi tempo, ritmo e frequenza cardiaca; sugli schermi stretti la riga si divide
  in due, la capsula porta il suo testo e i dati si allineano all'inizio dell'intervallo;
  espansa una riga appaiono i dettagli di quel
  tratto — distanza 3D, distanza equivalente, dislivello positivo/negativo, GAP, VAM/VDM — e il tratto
  principale vi passa.
- **Metriche del tratto.** Distanza orizzontale e 3D, distanza equivalente, dislivello
  positivo/negativo, pendenze, tempo totale e tempo in movimento, ritmo, velocità, GAP, più frequenza
  cardiaca, cadenza, potenza e temperatura quando il file le porta. Manca un dato di input? Ottieni
  *Non disponibile*, non 0.
- **Analisi a due variabili.** L'icona a dispersione accanto ai controlli del profilo apre una
  mappa di densità 2D per qualsiasi coppia valida di grandezze — frequenza cardiaca, velocità,
  ritmo, GAP, cadenza, potenza, temperatura, pendenza, quota. L'analisi segue il tratto
  selezionato, e ogni grandezza prende i valori dal meccanismo del pannello delle metriche
  stesso: frequenza cardiaca, cadenza e potenza scartano le letture in pausa e ricevono la
  media mobile a 5 punti del pannello, la temperatura resta grezza (pause incluse), la pendenza
  usa le finestre di gradiente da 50 m del pannello, e la famiglia velocità è la serie di
  velocità massima del pannello per il tratto. Passando il puntatore si leggono X, Y e la
  densità relativa della cella. Temi, unità e lingue
  si applicano in tempo reale, e un modulo grafico dedicato tiene fluidi anche i tracciati da
  100 000 punti. Sul touch due dita fanno zoom e spostano, un dito scorre i dati, un doppio tocco
  riporta all'intervallo completo.
- **Esportazione.** Scarica il tratto corrente — le metriche come csv, txt o md, i punti della traccia come
  file GPX. Le esportazioni seguono la lingua e il sistema di unità attivi al momento del clic.
- **Unità metriche / imperiali.** Cambia unità di visualizzazione quando vuoi. Il metrico è il
  predefinito e la scelta resta salvata in locale.
- **Multilingua.** English, 日本語, 한국어, Français, Deutsch, Español e Italiano sono
  integrati. Ogni lingua in più è un solo file di dati (vedi [Contribuire](#contribuire)).
- **Privacy per architettura.** Non esiste codice di caricamento. Il tuo file viene letto con la File
  API, poi analizzato e disegnato nel tuo browser.
- **Nessun passaggio di build.** Semplici moduli ES. Da leggere, eseguire e modificare così come sono.

## Formati supportati

| Formato | Geometria | Quota | Marcature temporali |
|--------|----------|-----------|------------|
| `.gpx` | `<trk><trkseg><trkpt>` (multi-segmento) | ✅ | ✅ |
| `.fit` | File di attività binari Garmin FIT | ✅ | ✅ |
| `.tcx` | XML TrainingCenterDatabase | ✅ | ✅ |
| `.kml` | `LineString` + `gx:Track` | ✅ (dalle coordinate) | ✅ (`gx:Track` / `<when>`) |
| `.kmz` | ZIP → KML (`DecompressionStream` nativo, senza librerie) | ✅ | ✅ |

La decodifica FIT è affidata alla libreria [fit-parser](https://github.com/jimmykane/fit-parser)
(MIT) inclusa in `vendor/fit-parser/`; il TCX è letto da un parser DOM integrato. Le estensioni sensori GPX
sono lette in modo agnostico rispetto al namespace: Garmin TrackPointExtension (frequenza cardiaca,
cadenza, temperatura, velocità, distanza) e le tre varianti comuni di potenza (`<power>` nuda,
`PowerInWatts`, `ns3:Watts`). Tutti i formati confluiscono nello stesso modello di punto della traccia,
così le metriche del tratto funzionano identicamente a prescindere dal formato di origine.

## Per iniziare

**Try it: https://wayslice.com**

Va bene qualsiasi server di file statici. Non c'è nulla da compilare:

```bash
# Python
python -m http.server 8080

# o Node
npx serve .
```

Poi apri <http://localhost:8080> e trascina un file GPX/FIT/TCX/KML/KMZ.

> Aprire `index.html` direttamente via `file://` non funziona perché i browser bloccano gli import di
> moduli ES sugli URL `file://`.

### Come analizzare un tratto

1. Trascina la tua traccia. Per impostazione predefinita è selezionata l'intera traccia.
2. **Trascina le maniglie verdi/rosse del tratto** sulla mappa o sul profilo altimetrico. Puoi anche
   fare clic sulla traccia o sul profilo per spostare il confine più vicino, o trascinare sul profilo
   per selezionare un nuovo intervallo. Sul touch, un dito sposta il profilo ingrandito e un pizzico
   fa zoom; il tratto si cambia solo trascinando le maniglie.
3. Ogni modifica ricalcola il tratto all'istante: distanza, distanza 3D, dislivello positivo/negativo,
   pendenze, ritmo/velocità, chilometro più veloce / più lento.
4. Tastiera: dai il focus a una maniglia e usa le frecce (Maiusc = ×10, Inizio/Fine = salto). `Esc`
   chiude i menu.
5. I dispositivi touch usano gesti cooperativi: un dito scorre la pagina, due dita spostano e
   ingrandiscono la mappa (un suggerimento compare sulla mappa).
6. Tratti pronti all'uso: il bottone `Suddivisione auto` dell'intestazione costruisce un elenco di
   tratti per l'intera traccia — per waypoint, a distanza fissa o per pendenza.

## Privacy

- La tua traccia viene elaborata **solo** nel tuo browser: parsing → analisi → rendering, tutto in
  locale.
- Le uniche richieste di rete sono i **tile cartografici** della mappa di base che scegli. I dati della
  tua traccia non vengono mai trasmessi e non ci sono statistiche d'uso.
- Tema, lingua, mappa di base e unità sono salvati solo nel `localStorage` del tuo dispositivo.

## Sistemi di unità

WaySlice nasce con le unità **metriche** e supporta anche quelle **imperiali**. Apri il pannello
`Impostazioni` dal bottone a ingranaggio dell'intestazione — le unità stanno accanto a lingua e tema:

| Visualizzato | Metrico | Imperiale |
|---|---|---|
| Distanza lunga | km | mi |
| Distanza corta / quota | m | ft |
| Velocità | km/h | mph |
| Ritmo | min/km | min/mi |
| Pendenza | % | % |

Tutto il parsing e i calcoli restano in unità SI (metri, metri/secondo, secondi/chilometro). Cambiare
unità riformatta solo i numeri che vedi: il file non viene riletto, il tratto non viene ricalcolato e
la geometria della traccia non cambia. La preferenza è salvata con la chiave `wayslice-units` e
sopravvive ai ricaricamenti. Lingua e unità sono impostazioni indipendenti: ogni lingua funziona con
entrambi i sistemi.

## Note di progettazione

- La **distanza 3D** è calcolata per segmento come `√(orizzontale² + verticale²)` e riportata
  separatamente dalla distanza orizzontale.
- La **distanza equivalente** = distanza orizzontale + dislivello positivo ÷ 100 (100 m di salita
  contano come 1 km).
- La **pendenza media** è il dislivello positivo cumulato del tratto diviso la distanza orizzontale,
  non la media delle pendenze punto per punto; un tratto in sola discesa non ha salite da mediare e
  mostra «—». Le pendenze max/min usano finestre di circa 50 m, così il rumore GPS
  non può fabbricare una pendenza record.
- Il **dislivello positivo/negativo** applica un filtro a isteresi di 3 m: la variazione di quota si
  accumula finché non supera ±3 m e solo allora conta — il rumore sotto i 3 m non gonfia mai i
  totali.
- **VAM/VDM** dividono il dislivello per il tempo effettivamente speso a salire/scendere (la tendenza
  di quota filtrata), non per il tempo totale del tratto.
- Il **tempo in movimento** conta solo i segmenti fuori pausa (velocità sotto 0,5 km/h prolungata per
  10 s o più).
- **Velocità media e ritmo medio** sono calcolate dalle velocità di movimento per segmento e
  ripulite come la curva del profilo: con velocità registrate, una finestra scorrevole di 5 punti
  diluisce il picco nel suo intorno; senza velocità registrate, si applica solo la regola delle 3
  deviazioni standard. La **velocità massima** legge la curva per punto ripulita del profilo, così
  elenco e grafico coincidono sempre.
- Il **GAP medio** divide il ritmo di ogni segmento per il fattore di pendenza di Minetti (2002)
  (limitato a ±45% di pendenza) prima di fare la media: il ritmo in piano a pari sforzo. Nel profilo,
  velocità/ritmo/GAP condividono uno stesso slot di sovrapposizione.
- **Le curve di velocità del profilo** scelgono la regola in base alla fonte: le velocità registrate
  vengono prima verificate confrontandole con il dd/dt del segmento (le letture oltre il 50 % vengono
  scartate) e poi smussate con una finestra scorrevole di 5 punti (ogni valore = la media di al più
  cinque punti centrati su ciascuno); quelle calcolate seguono direttamente la regola 3σ (fuori
  soglia sostituite con l'interpolazione dei vicini). Uno zero registrato (una pausa) è un dato e
  partecipa alla media come gli altri.
- La **semplificazione di visualizzazione** (Douglas–Peucker per la mappa, campionamento min–max per
  pixel per il profilo) non tocca mai i punti originali. Le metriche girano sempre sui dati completi.
- Lo **zoom del profilo** scende fino a una finestra di 1 km in modalità distanza e 20 minuti in
  modalità tempo; i dispositivi touch fanno zoom sul profilo con un pizzico di due dita — niente rotella.
- Le tracce grandi (100.000 punti o più) funzionano bene. Mentre trascini una maniglia, la ricerca del
  confine parte dalla corrispondenza precedente e amplia la finestra di ricerca al bisogno.

## Test

Apri `tests/index.html` sullo stesso server:

```text
http://localhost:8080/tests/
```

La suite copre i calcoli di distanza, l'interpolazione tra punti, le finestre di pendenza, le metriche
temporali, il parsing GPX/FIT/TCX/KML/KMZ (file malformati e archivi compresi, oltre alle varianti di
potenza ed estensioni sensori GPX), la matrice delle preferenze di tema (sistema/manuale × chiaro/scuro
dell'OS), la catena di fallback delle lingue e le conversioni metrico/imperiale (arrotondamento del
ritmo, VAM, persistenza e pendenze indipendenti dalle unità comprese), più l'esportazione del tratto
(contenuto csv/txt/md/gpx e nomi dei file).

## Contribuire

### Struttura del progetto

```text
index.html              guscio + script di avvio del tema (nessun flash del tema sbagliato)
icons/                  risorse icona (favicon.svg + dimensioni PNG/ICO, pagina di anteprima)
site.webmanifest        metadati di installazione PWA (nome, colori del tema, icone)
css/                    token di design (chiaro/scuro), base, layout, componenti
js/
  parsers/              GPX / FIT / TCX / KML / KMZ → un unico array unificato di punti della traccia
  geo/                  haversine + distanza 3D, interpolazione, semplificazione
  metrics/              metriche del tratto (funzioni pure, testabili in modo indipendente)
  sector/               stato di selezione del tratto (unica fonte di verità)
  map/                  vista MapLibre, catalogo mappe di base, maniglie del tratto
  charts/               grafici su canvas (profilo altimetrico, analisi a due variabili)
  theme/                sistema / chiaro / scuro con sincronizzazione live dell'OS
  language/             nucleo lingua + pacchetti lang-*.js + modello
  units/                preferenza metrico/imperiale, conversioni SI di visualizzazione, etichette di unità localizzate
  ui/                   pannello metriche, pannello impostazioni, suddivisione auto, menu, sheet, upload, icone
  core/                 piccolo event bus + store
  utils/                formattazione locale-aware (Intl)
tests/                  suite di test eseguibile nel browser (tests/index.html)
vendor/fit-parser/      toolkit fit-parser incluso (decodifica FIT, MIT) + shim per buffer
```

La logica di calcolo vive separata dalla UI: `computeSectorMetrics()` e le altre funzioni di metrica
non toccano mai il DOM, e la suite di test le copre.

### Aggiungere una lingua all'interfaccia

Il sistema di traduzione non ha framework alle spalle: **una lingua è un solo file di dati**. Se sai
modificare un file JavaScript, puoi tradurre l'app.

1. Copia [`js/language/lang-template.js`](js/language/lang-template.js) in `lang-xx.js`
   (`xx` = un codice BCP 47 come `es`, `pt-BR`).
2. Traduci i valori a destra. Lascia le chiavi e i `{segnaposto}` come sono e mantieni coerenti i
   termini tecnici (tratto, distanza 3D, dislivello positivo/negativo, pendenza, ritmo, VAM).
3. Aggiungi una voce al catalogo in [`js/language/langs.js`](js/language/langs.js) — codice lingua,
   nome nativo e caricatore lazy. I pacchetti si caricano su richiesta: all'avvio vengono scaricati
   solo la lingua del visitatore e l’inglese.
4. Apri l'app, passa alla tua lingua e guarda la console. WaySlice valida i pacchetti caricati contro le
   chiavi inglesi e avvisa di quelle mancanti o sconosciute.
5. Invia una pull request.

Le chiavi mancanti ripiegano sull'inglese (poi sulla chiave stessa), quindi l'interfaccia non mostra
mai `undefined`. Le scelte di lingua, tema e mappa di base sopravvivono ai ricaricamenti nel
`localStorage`.

### Aggiungere o modificare mappe di base

Il catalogo delle mappe di base sta in un solo file: [`js/map/sources.js`](js/map/sources.js). Il menu
Mappa, il pannello impostazioni, la persistenza e la creazione dei layer di tile leggono tutti da lì —
aggiungere o modificare una fonte non richiede codice di interfaccia.

**Aggiungere una fonte** — aggiungi un oggetto a `MAP_SOURCES`:

```js
{
  id: 'esri-topo',           // univoco; fa anche da chiave di persistenza
  labelKey: 'srcEsriTopo',   // chiave i18n del nome mostrato
  group: 'outdoor',          // street | outdoor | satellite | minimal
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri',
},
```

| Campo | Significato |
|---|---|
| `id` | Id univoco e chiave di persistenza. Cambiarlo equivale a una nuova fonte (le scelte salvate ripiegano sul predefinito); rimuovere una voce ripiega allo stesso modo in sicurezza. |
| `labelKey` | Chiave i18n del nome mostrato. |
| `group` | Uno tra `street`, `outdoor`, `satellite`, `minimal`. |
| `url` | Template dei tile: `{z}` `{x}` `{y}`, opzionalmente `{s}` (richiede `subdomains`) e `{r}` (retina). Attenzione all'ordine delle coordinate del provider — Esri usa `{z}/{y}/{x}`. |
| `overlayUrl` | Opzionale: template di un livello etichette trasparente sopra i tile di base. |
| `maxZoom` | Lo zoom massimo servito dal provider. |
| `attribution` | Richiesta legalmente da OSM, OpenTopoMap, Thunderforest, Mapy, Stadia Maps, OpenFreeMap, EOX e Esri — conservala. |
| `subdomains`, `crossOrigin`, `hintKey` | Opzionali: rotazione dei sottodomini; `crossOrigin: false` per i server di tile senza header CORS; riga di suggerimento grigia nel selettore. |

Poi aggiungi il nome mostrato a **ogni** pacchetto lingua — `srcEsriTopo: 'Esri Topo',` in
`lang-en.js`, `lang-fr.js`, `lang-ko.js`, `lang-ja.js`, `lang-de.js`,
`lang-es.js`, `lang-it.js` e `lang-template.js`. Il test di completezza delle lingue resta rosso finché
tutti i pacchetti non hanno la chiave; è voluto.

**Modificare una fonte** cambiando `url`, `maxZoom`, nomi o attribuzione sul posto. Per un **gruppo
nuovo**, aggiungilo all'array `GROUP_ORDER`, usalo sulle tue fonti e aggiungi una chiave
`group<Nome>` (es. `groupTopo`). I servizi che richiedono una chiave API (Maptiler, Mapbox)
funzionano con la chiave incorporata in `url`, ma non committare la tua. Meglio tile in HTTPS: su
una pagina servita in HTTPS il browser blocca i tile HTTP o li forza in HTTPS.
Per verificare: ricarica, apri il menu `Mappa` e controlla tile, zoom massimo e attribuzione.

### Sostituire le icone del sito

Tutte le icone del sito derivano da un unico file sorgente, `icons/favicon.svg` — un tile arrotondato da
1024×1024 con due creste montuose arancioni su un gradiente scuro, una linea di traccia GPX bianca e
puntini verde/rosso che riprendono le maniglie del tratto dell'app. Da lì si rigenerano `favicon.ico`,
le dimensioni PNG da 16 a 512 px, `apple-touch-icon.png`, le icone Android Chrome e `site.webmanifest`.
I motori di ricerca hanno requisiti propri (Google richiede un PNG da almeno 48 px, il manifest e un
robots.txt esplorabile — da qui il `robots.txt` alla radice del repository). `icons/icon-preview.html` mostra
tutte le dimensioni in locale. Nell'app, intestazione e stato vuoto riutilizzano il marchio di
`icons/favicon.svg`; le icone funzionali provengono dalla libreria di icone Lucide (licenza ISC) e sono
raccolte in `js/ui/icons.js`. L'unica eccezione è il link a GitHub nell'intestazione: carica come
immagini i file del logo GitHub in `icons/` (il marchio Octocat e il logotipo sono marchi di
GitHub, Inc., usati solo per rimandare a questo repository).

Per mettere il tuo marchio, modifica `icons/favicon.svg`, rigenera da lì le altre dimensioni e tieni
sincronizzati i link in `index.html` e `site.webmanifest`.

### Aggiungere un README tradotto

Le traduzioni esistenti ([English](README.md), [日本語](README.ja.md), [한국어](README.ko.md), [Français](README.fr.md), [Deutsch](README.de.md),
[Español](README.es.md)) sono il tuo esempio. Per aggiungerne una:

1. Copia questo `README.md` (o qualsiasi traduzione esistente) in `README.xx.md`
   (`xx` = un codice BCP 47, es. `README.pt-BR.md`).
2. Traduci il testo. Mantieni invariati struttura, ordine delle sezioni, tabelle, blocchi di codice e
   percorsi dei file, così tutte le versioni restano facili da confrontare e mantenere.
3. Aggiorna la riga di cambio lingua sotto il titolo in **ogni** README: aggiungi la tua lingua come
   link altrove e mantieni il formato `A | B | C | D`. Nella tua versione, la tua lingua è la voce in
   testo semplice.
4. Invia una pull request.

## Roadmap

- Un algoritmo migliore per la pulizia dei picchi che consideri la deriva GPS e il campionamento rado
- Un algoritmo migliore di rilevamento delle pendenze per la suddivisione automatica (salita / discesa / piatto / misto)
- Miglioramento opzionale della quota da servizi DEM esterni (solo opt-in — il predefinito resta
  completamente locale)

## Licenza

Distribuito sotto [licenza MIT](LICENSE). Libero per uso commerciale e privato — per favore mantieni
intatte le attribuzioni dei fornitori di mappe:

- [MapLibre GL JS](https://maplibre.org) (BSD-3-Clause)
- © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL)
- [OpenTopoMap](https://opentopomap.org) (CC-BY-SA), [CyclOSM](https://github.com/cyclosm/cyclosm-cartocss-style)
- Mappe di base di [Thunderforest](https://www.thunderforest.com), [Mapy.com](https://mapy.com), [Stadia Maps](https://stadiamaps.com), [OpenFreeMap](https://openfreemap.org), [EOX](https://tiles.maps.eox.at), [Esri World Imagery](https://www.esri.com)
- Icone di [Lucide](https://lucide.dev) (ISC)

## Ringraziamenti

- Il progetto è liberamente ispirato all'articolo
  [GPS data analysis](https://trailrunningmovement.com/training/gps-data-analysis/) di
  [Trail Running Movement](https://trailrunningmovement.com/).
- A [Ken Zemach](https://fastestknowntime.com/athlete/ken-zemach) per la sua
  [traccia GPX](https://fastestknowntime.com/fkt/ken-zemach-bruksleden-100-miler-sweden-2020-08-02) del
  Bruksleden 100 Miler (Svezia).
- A [polyvertex](https://github.com/polyvertex) per i suoi [file FIT](https://github.com/polyvertex/fitdecode/tree/master/tests/files).
- A [ToolElewaut](https://github.com/ToonElewaut) per i suoi [file TCX](https://github.com/ToonElewaut/TDF/tree/main/src/Data/Routes) del Tour de France 2020 - 2023.
- A [tingard](https://github.com/tingard) per i suoi [file TCX](https://github.com/tingard/cycling_power_analysis).
- A [pherris](https://github.com/pherris) per il suo [file TCX](https://github.com/pherris/IOT-Value-Cycling/tree/master/rides) di un'uscita in bici di lunga distanza con dati di potenza.
- A [Tommi](https://www.youtube.com/@bewarethemountainman) per la sua [traccia GPX](https://drive.google.com/file/d/1lPVebrcOImAw035d9r0tqP63O-2yZe4E/view) dell'escursione Kai Kung Leng - Tai To Yan - Tai Mo Shan a Hong Kong.

## Sostenitori

Grazie a chi contribuisce a mantenere WaySlice e a farlo funzionare.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/I8U4273MZK)

### Ko-fi
