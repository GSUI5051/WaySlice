> The README is machine-generated, if you find issues please submit a PR.
>
> Dieses README wurde maschinell erstellt. Wenn du Fehler findest, eröffne bitte einen Pull Request.

<p align="center">
  <img src="./icons/android-chrome-512x512.png" alt="WaySlice">
</p>

<h1 align="center">WaySlice</h1>

<p align="center">
  <strong>Telemetry for every way. Sliced.</strong><br><strong>Jeder Weg wird Telemetrie; jede Telemetrie wird geschnitten und analysiert.</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a><br><a href="README.fr.md">Français</a> | Deutsch | <a href="README.es.md">Español</a> | <a href="README.it.md">Italiano</a>
</p>

WaySlice ist ein Open-Source-Track-Analysator, der komplett im Browser läuft, für GPX/FIT/TCX/KML/KMZ-Tracks.
Statistiken über den ganzen Track sagen wenig aus: Wissen willst du, wie du den langen Anstieg gemeistert
hast, den technischen Abstieg, die letzten 5 km des Rennens. WaySlice schneidet dir jeden beliebigen
Abschnitt heraus, den du für sich allein analysierst – so, wie man Renntelemetrie oder die
Flugschreiberdaten (QAR) der Luftfahrt liest:

```text
Track → Abschnitt wählen → Abschnitt analysieren
```

<p align="center"><img src="./screenshots/overview.jpg" alt="image"></p>

<p align="center"><a href="./screenshots/README.de.md">Weitere Screenshots</a></p>

Neu bei diesen Begriffen? Starte mit dem Kapitel [Terminologie](#terminologie) — alle übrigen Kapitel
benutzen diese Wörter genau so, wie sie dort definiert sind.

## Inhaltsverzeichnis

- [Terminologie](#terminologie)
- [Funktionen](#funktionen)
- [Unterstützte Formate](#unterstützte-formate)
- [Erste Schritte](#erste-schritte)
  - [Einen Abschnitt analysieren](#einen-abschnitt-analysieren)
- [Datenschutz](#datenschutz)
- [Einheitensysteme](#einheitensysteme)
- [Anmerkungen zum Design](#anmerkungen-zum-design)
- [Tests](#tests)
- [Mitwirken](#mitwirken)
  - [Projektstruktur](#projektstruktur)
  - [Eine UI-Sprache hinzufügen](#eine-ui-sprache-hinzufügen)
  - [Basiskarten hinzufügen oder bearbeiten](#basiskarten-hinzufügen-oder-bearbeiten)
  - [Website-Icons austauschen](#website-icons-austauschen)
  - [Ein übersetztes README hinzufügen](#ein-übersetztes-readme-hinzufügen)
- [Roadmap](#roadmap)
- [Lizenz](#lizenz)
- [Danksagung](#danksagung)
- [Unterstützer](#unterstützer)

## Terminologie

Diese Begriffe haben in diesem README wie in der App-Oberfläche feste Bedeutungen. Taucht ein Wort
großgeschrieben auf, gilt es genau in dieser Bedeutung:

| Begriff | Bedeutung |
|------|---------|
| Track | Eine aufgezeichnete Route, geladen aus einer einzigen Datei: eine geordnete Liste von Trackpunkten. |
| Trackpunkt (Track point) | Eine einzelne Messung entlang des Tracks: die Position, plus Höhe, Zeitstempel, Herzfrequenz, Trittfrequenz, Leistung und Temperatur, wo immer die Datei sie liefert. |
| **Abschnitt (Sector)** | Der Kernbegriff von WaySlice. Ein Abschnitt ist der Teil eines Tracks zwischen einem Anfangs- und einem Endpunkt, den du wählst. Die Grenzen können an jeder Stelle zwischen zwei Trackpunkten liegen (interpoliert). Auch der ganze Track ist ein Abschnitt: der voreingestellte „Gesamter Track“. Jeder Messwert wird für den aktuellen Abschnitt berechnet. |
| Abschnittsgriff (Sector handle) | Der ziehbare Punkt, der eine Grenze des Abschnitts setzt: grün = Anfang, rot = Ende. Die Griffe erscheinen sowohl auf der Karte als auch im Höhenprofil und bleiben synchron. |
| Anstieg / Abstieg (Elevation gain / loss) | Gesamter Aufstieg / Abstieg innerhalb des Abschnitts, nach dem 3-m-Rauschfilter (siehe [Anmerkungen zum Design](#anmerkungen-zum-design)). |
| VAM / VDM | Aufstiegs- / Abstiegsrate in Metern pro Stunde: vertikale Geschwindigkeit in m/h, berechnet nur aus der Zeit, in der tatsächlich gestiegen / abgestiegen wird. |
| Bewegungszeit (Moving time) | Verstrichene Zeit minus Pausen: eine Pause ist eine Geschwindigkeit unter 0,5 km/h, die 10 s oder länger anhält. |
| GAP | Steigungsangepasstes Tempo (grade-adjusted pace): das Tempo des Abschnitts dividiert durch den Minetti-Faktor (2002) – das Flachlandtempo bei gleichem Aufwand. |
| Aufwandsdistanz (Effort distance) | Horizontale Distanz + Anstieg ÷ 100: je 100 m Anstieg zählen als 1 km. |
| 3D-Distanz (3D distance) | Die Distanz, die dem Gelände folgt: Summe je Segment aus √(horizontal² + vertikal²), getrennt von der horizontalen Distanz ausgewiesen. |
| Steigung (Grade) | Die Steilheit an einem Punkt oder über eine Strecke: vertikale Änderung ÷ horizontale Distanz, angezeigt in % (positiv = bergauf, negativ = bergab). |
| Tempo (Pace) | Die Zeit pro Entfernungseinheit: min/km oder min/mi. |
| Wegpunkt (Waypoint) | Ein benannter Ort, der in der Trackdatei selbst gespeichert ist (GPX `<wpt>`, KML-Placemarks `<Point>`). |
| Basiskarte (Basemap) | Die Kartenkachel-Quelle, die unter deinem Track gezeichnet wird. Standard ist OpenStreetMap. |

## Funktionen

- **Karte + Höhenprofil.** Ziehe die Abschnittsgriffe auf einer der beiden Flächen. Beide bleiben in
  Echtzeit synchron, und eine Grenze kann an jeder Stelle zwischen zwei Trackpunkten liegen,
  Interpolation eingeschlossen.
- **Wegpunkte auf Karte und Profil.** GPX- (`<wpt>`) und KML-Wegpunkte (`<Point>`) erscheinen als Pins
  mit Namens-Tooltip — ein- und ausschalten über den Pin-Button unter „Auf Track zoomen“. Fährst du mit
  der Maus über einen Pin, wird die passende Stelle im Höhenprofil markiert; ein Klick zentriert die
  Karte darauf, ohne die Zoomstufe zu ändern.
- **Profil-Zoom mit dem Mausrad (Desktop), Pinch-Zoom (Touchscreen).** Fahre über das Höhenprofil
  und scrolle, um seine Distanz-/Zeitachse um den Zeiger herum zu zoomen; mit Umschalt + Ziehen
  verschiebst du es; am Touchscreen verschiebt ein Finger und zoomt ein Zwei-Finger-Pinch. Ein Doppelklick irgendwo auf das
  Profil — oder Doppel-Tipp am Touchscreen — stellt den ganzen Track wieder her.
- **Automatisches Teilen.** Der Scherenknopf im Kopfbereich baut eine Abschnittsliste für den ganzen
  Track: Schnitt an Wegpunkten (von CP zu CP), an fester Distanz (1 km / 5 km / benutzerdefiniert — in
  Meilen, wenn Imperial aktiv ist), oder nach Steigung in Anstiegs-/Abstiegsstrecken. Jede Zeile zeigt Abschnittsnummer, Bereich, Typkapsel (Anstieg, Abstieg, flach oder gemischt, aus
  dem Relief), dann Zeit, Tempo und Herzfrequenz; auf schmalen Bildschirmen teilt sich die Zeile
  in zwei Zeilen, die Kapsel trägt ihren Text, der Datenblock richtet sich am Bereichsanfang
  aus; geklappt offenbart sie die
  Details des Abschnitts — 3D-Distanz, Aufwandsdistanz, Anstieg/Abstieg, GAP, VAM/VDM — und der
  Hauptabschnitt springt darauf.
- **Abschnittsmesswerte.** Horizontale und 3D-Distanz, Aufwandsdistanz, Anstieg/Abstieg, Steigungen,
  verstrichene und Bewegungszeit, Tempo, Geschwindigkeit, GAP, plus Herzfrequenz, Trittfrequenz,
  Leistung und Temperatur, wenn die Datei sie mitbringt. Fehlen Eingabedaten, bekommst du
  *Nicht verfügbar*, nicht 0.
- **Zweivariablen-Analyse.** Das Streudiagramm-Symbol neben den Profil-Steuerungen öffnet eine
  2D-Dichte-Heatmap für jedes gültige Größenpaar — Herzfrequenz, Geschwindigkeit, Tempo, GAP,
  Trittfrequenz, Leistung, Temperatur, Steigung, Höhe. Pausen, Ausrollen (Geschwindigkeit ohne
  Leistung) und Trittpausen (Geschwindigkeit ohne Trittfrequenz) werden vor dem Binning
  gefiltert; beim Überfahren liest der Tooltip X, Y und die relative Dichte der Zelle. Helle und
  dunkle Themen, Einheiten und Sprachen werden sofort übernommen, und ein eigenes Chart-Modul
  hält auch 100.000-Punkte-Tracks flüssig. Am Touchscreen zoomen und verschieben zwei Finger die Karte, ein Finger liest die Werte ab, ein Doppel-Tipp holt
  den vollen Bereich zurück.
- **Export.** Lade den aktuellen Abschnitt herunter — seine Messwerte als csv, txt oder md, seine
  Trackpunkte als GPX-Datei. Exporte folgen der Sprache und dem Einheitensystem, die beim Klick aktiv
  sind.
- **Metrisch / Imperial.** Wechsle die Anzeigeeinheiten jederzeit. Metrisch ist die Voreinstellung,
  deine Wahl wird lokal gespeichert.
- **Mehrsprachig.** English, 日本語, 한국어, Français, Deutsch, Español und Italiano sind
  eingebaut. Jede weitere Sprache ist eine einzige Datendatei (siehe [Mitwirken](#mitwirken)).
- **Datenschutz durch Architektur.** Es gibt keinen Upload-Code. Deine Datei wird über die File API
  gelesen, dann im Browser geparst, analysiert und gerendert.
- **Kein Build-Schritt.** Nackte ES-Module. Lesen, laufen lassen, ändern — so wie sie sind.

## Unterstützte Formate

| Format | Geometrie | Höhe | Zeitstempel |
|--------|----------|-----------|------------|
| `.gpx` | `<trk><trkseg><trkpt>` (mehrere Segmente) | ✅ | ✅ |
| `.fit` | Binäre Garmin-FIT-Aktivitätsdateien | ✅ | ✅ |
| `.tcx` | TrainingCenterDatabase-XML | ✅ | ✅ |
| `.kml` | `LineString` + `gx:Track` | ✅ (aus den Koordinaten) | ✅ (`gx:Track` / `<when>`) |
| `.kmz` | ZIP → KML (nativer `DecompressionStream`, ohne Bibliothek) | ✅ | ✅ |

Das FIT-Dekodieren übernimmt die mitgelieferte Bibliothek
[fit-parser](https://github.com/jimmykane/fit-parser) (MIT) in `vendor/fit-parser/`; TCX liest ein
eingebauter DOM-Parser. GPX-Sensorerweiterungen werden unabhängig vom Namespace gelesen: Garmin
TrackPointExtension (Herzfrequenz, Trittfrequenz, Temperatur, Geschwindigkeit, Distanz) und die drei
gängigen Leistungsvarianten (nacktes `<power>`, `PowerInWatts`, `ns3:Watts`). Alle Formate münden in
dasselbe Trackpunkt-Modell, die Abschnittsmesswerte funktionieren also identisch, egal woher die Datei
stammt.

## Erste Schritte

Jeder statische Dateiserver taugt. Es gibt nichts zu bauen:

```bash
# Python
python -m http.server 8080

# oder Node
npx serve .
```

Dann öffne <http://localhost:8080> und ziehe eine GPX-/FIT-/TCX-/KML-/KMZ-Datei hinein.

> `index.html` direkt über `file://` zu öffnen funktioniert nicht, weil Browser ES-Modul-Importe auf
> `file://`-URLs blockieren.

### Einen Abschnitt analysieren

1. Zieh deinen Track hinein. Der ganze Track ist standardmäßig ausgewählt.
2. **Ziehe die grünen/roten Abschnittsgriffe** auf der Karte oder im Höhenprofil. Du kannst auch auf
   den Track oder das Profil klicken, um die nächste Grenze zu verschieben, oder auf dem Profil
   ziehen, um einen neuen Bereich auszuwählen. Am Touchscreen verschiebt ein Finger das gezoomte
   Profil und ein Pinch zoomt — die Auswahl ändert sich nur über die Griffe.
3. Jede Änderung berechnet den Abschnitt sofort neu: Distanz, 3D-Distanz, Anstieg/Abstieg, Steigungen,
   Tempo/Geschwindigkeit, schnellster/langsamster Kilometer.
4. Tastatur: Gib einem Griff den Fokus und nutze die Pfeiltasten (Umschalt = ×10, Pos1/Ende = Sprung).
   `Esc` schließt Menüs.
5. Touchgeräte nutzen kooperative Gesten: ein Finger scrollt die Seite, zwei Finger verschieben und
   zoomen die Karte (ein Hinweis erscheint auf der Karte).
6. Fertige Abschnitte: Der Knopf `Automatisch teilen` im Kopfbereich baut eine Abschnittsliste für den
   ganzen Track — nach Wegpunkt, fester Distanz oder Steigung.

## Datenschutz

- Dein Track wird **nur** in deinem Browser verarbeitet: parsen → analysieren → rendern, alles lokal.
- Die einzigen Netzwerkanfragen sind **Kartenkacheln** der Basiskarte deiner Wahl. Deine Trackdaten
  werden nie übertragen, und es gibt keine Nutzungsstatistik.
- Design, Sprache, Basiskarte und Einheiten werden nur im `localStorage` deines Geräts gespeichert.

## Einheitensysteme

WaySlice startet mit **Metrisch** und beherrscht auch **Imperial**. Öffne die
`Einstellungen`-Seitenleiste über den Zahnradknopf im Kopfbereich — die Einheiten liegen neben Sprache
und Design:

| Anzeige | Metrisch | Imperial |
|---|---|---|
| Lange Distanz | km | mi |
| Kurze Distanz / Höhe | m | ft |
| Geschwindigkeit | km/h | mph |
| Tempo | min/km | min/mi |
| Steigung | % | % |

Alle Berechnungen bleiben in SI-Einheiten (Meter, Meter/Sekunde, Sekunden/Kilometer). Der
Einheitenwechsel formatiert nur die Zahlen neu, die du siehst: Die Datei wird nicht neu geparst, der
Abschnitt nicht neu berechnet, und die Trackgeometrie ändert sich nicht. Die Einstellung liegt unter
dem Schlüssel `wayslice-units` und überlebt Neuladen. Sprache und Einheiten sind unabhängige
Einstellungen — jede Sprache funktioniert mit beiden Systemen.

## Anmerkungen zum Design

- Die **3D-Distanz** wird je Segment als `√(horizontal² + vertikal²)` berechnet und getrennt von der
  horizontalen Distanz ausgewiesen.
- Die **Aufwandsdistanz** = horizontale Distanz + Anstieg ÷ 100 (100 m Anstieg zählen als 1 km).
- Die **durchschnittliche Steigung** ist der kumulierte Anstieg des Abschnitts dividiert durch die
  horizontale Distanz, nicht der Mittelwert der Steigungen einzelner Punkte; ein Abschnitt, der nur
  abwärts führt, hat keinen Anstieg und zeigt „—" an. Maximal-/Minimalsteigungen nutzen
  ca. 50-m-Fenster, damit GPS-Rauschen keine Rekordsteigung vortäuschen kann.
- **Anstieg/Abstieg** wenden einen 3-m-Hysteresefilter an: Höhenänderungen summieren sich, bis sie
  ±3 m überschreiten, und zählen erst dann — Rauschen unter 3 m bläht die Summen nie auf.
- **VAM/VDM** teilen Anstieg/Abstieg durch die Zeit, die tatsächlich mit Steigen/Absteigen verbracht
  wird (der gefilterte Höhentrend), nicht durch die gesamte Abschnittszeit.
- Die **Bewegungszeit** zählt nur Segmente außerhalb von Pausen (Geschwindigkeit unter 0,5 km/h, 10 s
  oder länger anhaltend).
- **Durchschnittsgeschwindigkeit und Durchschnittstempo** werden aus den
  Bewegungsgeschwindigkeiten je Segment berechnet und wie im Profil gereinigt: mit aufgezeichneten
  Geschwindigkeiten glättet ein gleitendes 5-Punkte-Fenster die Segmente; ohne aufgezeichnete
  Geschwindigkeiten greift nur der 3-Standardabweichungen-Ausschluss. Die **Höchstgeschwindigkeit**
  liest die gereinigte Punktfolge des Profils, sodass Liste und Diagramm immer übereinstimmen.
- Das **durchschnittliche GAP** teilt das Tempo jedes Segments durch den Minetti-Faktor (2002)
  (begrenzt auf ±45 % Steigung), bevor gemittelt wird: das Flachlandtempo bei gleichem Aufwand. Im
  Profil teilen sich Geschwindigkeit/Tempo/GAP einen Überlagerungsplatz.
- Die **Geschwindigkeitskurven im Profil** wählen die Regel nach Quelle: aufgezeichnete
  Geschwindigkeiten werden zuerst mit dem dd/dt des Segments abgeglichen (Messwerte mehr als 50 %
  darüber werden verworfen) und dann mit einem gleitenden 5-Punkte-Fenster geglättet (jeder Wert = das
  Mittel aus bis zu fünf um ihn zentrierten Punkten); berechnete folgen direkt der 3σ-Regel (Ausreißer
  durch Nachbarinterpolation ersetzt). Ein aufgezeichneter Nullwert (eine Pause) ist ein Datenwert
  und geht wie jeder andere in das Fenstermittel ein.
- Die **Anzeige-Vereinfachung** (Douglas–Peucker für die Karte, Min-Max-Abtastung je Pixelspalte für
  das Profil) fasst die Originalpunkte nie an. Messwerte rechnen immer mit den vollständigen Daten.
- Der **Profilzoom** reicht bis zu einem 1-km-Fenster im Distanzmodus und 20 Minuten im Zeitmodus;
  Touchgeräte zoomen per Zwei-Finger-Pinch — ein Rad gibt es nicht.
- Große Tracks (100.000+ Punkte) funktionieren problemlos. Während du einen Griff ziehst, startet die
  Grenzsuche vom letzten Treffer und weitet ihr Suchfenster bei Bedarf.

## Tests

Öffne `tests/index.html` auf demselben Server:

```text
http://localhost:8080/tests/
```

Die Suite deckt ab: Distanzmathematik, Interpolation zwischen Punkten, Steigungsfenster,
Zeitmesswerte, GPX-/FIT-/TCX-/KML-/KMZ-Parsing (einschließlich fehlerhafter Dateien und Archive, dazu
die GPX-Leistungs- und Sensorerweiterungsvarianten), die Design-Präferenzmatrix (System/manuell ×
Hell/Dunkel des Betriebssystems), die Sprach-Fallback-Kette und die metrisch/imperial-Umrechnungen
(einschließlich Tempo-Rundung, VAM, Beständigkeit und einheitenunabhängiger Steigungen), dazu den
Abschnittsexport (csv/txt/md/gpx-Inhalt und Dateinamen).

## Mitwirken

### Projektstruktur

```text
index.html              Hülle + Design-Boot-Skript (kein Aufblitzen des falschen Designs)
icons/                  Website-Icon-Assets (favicon.svg + PNG/ICO-Größen, Vorschauseite)
site.webmanifest        PWA-Installationsmetadaten (Name, Designfarben, Icons)
css/                    Design-Tokens (hell/dunkel), Basis, Layout, Komponenten
js/
  parsers/              GPX / FIT / TCX / KML / KMZ → ein einziges, vereinheitlichtes Trackpunkt-Feld
  geo/                  Haversine + 3D-Distanz, Interpolation, Vereinfachung
  metrics/              Abschnittsmesswerte (reine Funktionen, unabhängig testbar)
  sector/               Abschnittsauswahl-Zustand (einzige Quelle der Wahrheit)
  map/                  Leaflet-Ansicht, Basiskartenkatalog, Abschnittsgriffe
  charts/               Canvas-Diagramme (Höhenprofil, Zweivariablen-Analyse)
  theme/                System / hell / dunkel mit Live-Sync zum Betriebssystem
  language/             Sprachkern + lang-*.js-Pakete + Vorlage
  units/                Metrisch/Imperial-Einstellung, SI-Anzeigenumrechnung, lokalisierte Einheitsbeschriftungen
  ui/                   Messwerttafel, Einstellungsseitenleiste, automatisches Teilen, Menüs, Sheets, Upload, Icons
  core/                 Winziger Ereignisbus + Stores
  utils/                Locale-bewusste Formatierung (Intl)
tests/                  Im Browser lauffähige Testsuite (tests/index.html)
vendor/fit-parser/      Mitgelieferter fit-parser-Werkzeugkasten (FIT-Dekodierung, MIT) + Buffer-Shim
```

Die Berechnungslogik lebt getrennt von der UI: `computeSectorMetrics()` und die anderen
Messwertfunktionen fassen das DOM nie an, und die Testsuite deckt sie ab.

### Eine UI-Sprache hinzufügen

Das Übersetzungssystem hat kein Framework dahinter: **eine Sprache ist eine Datendatei**. Wer eine
JavaScript-Datei editieren kann, kann die App übersetzen.

1. Kopiere [`js/language/lang-template.js`](js/language/lang-template.js) zu `lang-xx.js`
   (`xx` = ein BCP-47-Code wie `es`, `pt-BR`).
2. Übersetze die Werte auf der rechten Seite. Lass die Schlüssel und `{Platzhalter}` unangetastet und
   halte die Fachbegriffe konsistent (Abschnitt, 3D-Distanz, Anstieg/Abstieg, Steigung, Tempo, VAM).
3. Ergänze im Katalog in [`js/language/langs.js`](js/language/langs.js) einen Eintrag — Sprachcode,
   Name in der Sprache selbst und Lazy-Loader. Pakete werden bei Bedarf geladen: Beim Start kommen
   nur die Sprache des Besuchers und Englisch über die Leitung.
4. Öffne die App, wechsle zu deiner Sprache und wirf einen Blick auf die Konsole. WaySlice prüft die
   geladenen Pakete gegen die englischen Schlüssel und warnt vor fehlenden oder unbekannten.
5. Reiche einen Pull Request ein.

Fehlende Schlüssel fallen auf Englisch zurück (danach auf den Schlüssel selbst), die Oberfläche zeigt
also nie `undefined`. Sprache, Design und Basiskartenwahl überleben Neuladen im `localStorage`.

### Basiskarten hinzufügen oder bearbeiten

Der Basiskartenkatalog liegt in einer einzigen Datei: [`js/map/sources.js`](js/map/sources.js). Das
Kartenmenü, das Einstellungs-Sheet, die Persistenz und die Erstellung der Kachelebenen lesen alle
daraus — eine Quelle hinzuzufügen oder zu ändern verlangt keinen UI-Code.

**Quelle hinzufügen** — häng ein Objekt an `MAP_SOURCES` an:

```js
{
  id: 'esri-topo',           // eindeutig; dient zugleich als Persistenzschlüssel
  labelKey: 'srcEsriTopo',   // Übersetzungsschlüssel des Anzeigenamens
  group: 'outdoor',          // street | outdoor | satellite | minimal
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri',
},
```

| Feld | Bedeutung |
|---|---|
| `id` | Eindeutige ID und zugleich Persistenzschlüssel. Sie zu ändern wirkt wie eine neue Quelle (gespeicherte Auswahlen fallen auf die Voreinstellung zurück); einen Eintrag zu löschen fällt ebenfalls sicher zurück. |
| `labelKey` | i18n-Schlüssel des Anzeigenamens. |
| `group` | Einer aus `street`, `outdoor`, `satellite`, `minimal`. |
| `url` | Kachelvorlage: `{z}` `{x}` `{y}`, optional `{s}` (braucht `subdomains`) und `{r}` (Retina). Achte auf die Koordinatenreihenfolge des Anbieters — Esri nutzt `{z}/{y}/{x}`. |
| `overlayUrl` | Optional: transparente Beschriftungsebene über den Basiskacheln. |
| `maxZoom` | Höchste Zoomstufe, die der Anbieter liefert. |
| `attribution` | Von OSM, OpenTopoMap, Thunderforest, Mapy, Stadia Maps und Esri gesetzlich verlangt — lass sie stehen. |
| `subdomains`, `crossOrigin`, `hintKey` | Optional: Subdomain-Rotation; `crossOrigin: false` für Kachelserver ohne CORS-Header; graue Hinweiszeile im Wähler. |

Dann trag den Anzeigenamen in **jedes** Sprachpaket ein — `srcEsriTopo: 'Esri Topo',` in `lang-en.js`,
`lang-fr.js`, `lang-ko.js`, `lang-ja.js`, `lang-de.js`, `lang-es.js`,
`lang-it.js` und `lang-template.js`. Der Sprachvollständigkeitstest bleibt rot, bis alle Pakete den
Schlüssel haben; das ist Absicht.

**Quelle bearbeiten**, indem du `url`, `maxZoom`, Namen oder Attribution an Ort und Stelle änderst.
Für eine **neue Gruppe**: nimm sie ins `GROUP_ORDER`-Array auf, benutze sie auf deinen Quellen und
ergänze einen `group<Name>`-Schlüssel (z. B. `groupTopo`). Dienste mit API-Schlüssel (Maptiler,
Mapbox) funktionieren mit dem Schlüssel in der `url`, aber committe nicht deinen eigenen. HTTPS-Kacheln
sind erste Wahl: Auf HTTPS-Seiten blockieren Browser HTTP-Kacheln oder erzwingen HTTPS.
Zum Prüfen: neu laden, das Menü `Karte` öffnen, Kacheln, Maximalzoom und
Attribution kontrollieren.

### Website-Icons austauschen

Alle Website-Icons stammen aus einer einzigen Quelldatei, `icons/favicon.svg` — eine abgerundete Kachel von
1024×1024 mit zwei orangen Berggraten auf dunklem Farbverlauf, einer weißen GPX-Tracklinie und
grünen/roten Punkten, die den Abschnittsgriffen in der App entsprechen. Aus ihr werden `favicon.ico`,
die PNG-Größen von 16–512 px, `apple-touch-icon.png`, die Android-Chrome-Icons und `site.webmanifest`
regeneriert. Suchmaschinen haben eigene Anforderungen (Google braucht ein PNG von mindestens 48 px,
das Manifest und eine crawlbare robots.txt — daher die `robots.txt` im Repo-Root). `icons/icon-preview.html`
zeigt alle Größen lokal. In der App nutzen Kopfzeile und Leerzustand das Markenzeichen aus der
`icons/favicon.svg`; die funktionalen Icons stammen aus der Lucide-Icon-Bibliothek (ISC-Lizenz) und sind in
`js/ui/icons.js` gesammelt. Die einzige Ausnahme ist der GitHub-Link in der Kopfzeile: er lädt
die GitHub-Logodateien in `icons/` als Bilder (Octocat-Marke und Wortmarke sind Marken von
GitHub, Inc. und werden nur verwendet, um auf dieses Repository zu verlinken).

Um ein eigenes Zeichen einzusetzen: editiere `icons/favicon.svg`, erzeuge die übrigen Größen daraus neu und
halte die Verweise in `index.html` und `site.webmanifest` synchron.

### Ein übersetztes README hinzufügen

Die vorhandenen Übersetzungen ([English](README.md), [日本語](README.ja.md), [한국어](README.ko.md), [Français](README.fr.md), [Español](README.es.md),
[Italiano](README.it.md)) sind deine Vorbilder. So fügst du eine hinzu:

1. Kopiere dieses `README.md` (oder eine beliebige vorhandene Übersetzung) zu `README.xx.md`
   (`xx` = ein BCP-47-Code, z. B. `README.pt-BR.md`).
2. Übersetze den Fließtext. Lass Struktur, Kapitelreihenfolge, Tabellen, Codeblöcke und Dateipfade
   unverändert, damit alle Versionen leicht zu vergleichen und zu pflegen bleiben.
3. Aktualisiere die Sprachwechselleiste unter dem Titel in **jedem** README: Ergänze deine Sprache in
   den anderen Versionen als Link und halte das Format `A | B | C | D` bei. In deiner eigenen Version
   ist deine Sprache der Eintrag als reiner Text.
4. Reiche einen Pull Request ein.

## Roadmap

- Besserer Algorithmus zur Bereinigung von Geschwindigkeits-Spikes, der GPS-Drift und spärliche Abtastung berücksichtigt
- Besserer Steigungserkennungs-Algorithmus für das automatische Teilen (Anstieg / Abstieg / flach / gemischt)
- Optionale Höhenanreicherung aus externen DEM-Diensten (nur mit Zustimmung — die Voreinstellung
  bleibt komplett lokal)

## Lizenz

Veröffentlicht unter der [MIT-Lizenz](LICENSE). Frei für kommerzielle und private Nutzung — bitte lass
die Zuschreibungen der Kartenanbieter unangetastet:

- [Leaflet](https://leafletjs.com) (BSD-2-Clause)
- © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL)
- [OpenTopoMap](https://opentopomap.org) (CC-BY-SA), [CyclOSM](https://github.com/cyclosm/cyclosm-cartocss-style)
- Basiskarten von [Thunderforest](https://www.thunderforest.com), [Mapy.com](https://mapy.com), [Stadia Maps](https://stadiamaps.com), [Esri World Imagery](https://www.esri.com)
- Icons von [Lucide](https://lucide.dev) (ISC)

## Danksagung

- Das Projekt ist lose inspiriert vom Artikel
  [GPS data analysis](https://trailrunningmovement.com/training/gps-data-analysis/) von
  [Trail Running Movement](https://trailrunningmovement.com/).
- An [Ken Zemach](https://fastestknowntime.com/athlete/ken-zemach) für seinen Bruksleden 100 Miler
  (Schweden)-[GPX-Track](https://fastestknowntime.com/fkt/ken-zemach-bruksleden-100-miler-sweden-2020-08-02).
- An [polyvertex](https://github.com/polyvertex) für seine [FIT-Dateien](https://github.com/polyvertex/fitdecode/tree/master/tests/files).
- An [ToolElewaut](https://github.com/ToonElewaut) für seine [TCX-Dateien](https://github.com/ToonElewaut/TDF/tree/main/src/Data/Routes) der Tour de France 2020 - 2023.
- An [tingard](https://github.com/tingard) für seine [TCX-Dateien](https://github.com/tingard/cycling_power_analysis).
- An [pherris](https://github.com/pherris) für seine [TCX-Datei](https://github.com/pherris/IOT-Value-Cycling/tree/master/rides) einer langen Fahrt mit Leistung.
- An [Tommi](https://www.youtube.com/@bewarethemountainman) für seine [GPX-Strecke](https://drive.google.com/file/d/1lPVebrcOImAw035d9r0tqP63O-2yZe4E/view) der Wanderung Kai Kung Leng - Tai To Yan - Tai Mo Shan in Hongkong.

## Unterstützer

Danke an alle, die dazu beitragen, WaySlice zu pflegen und am Laufen zu halten.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/I8U4273MZK)

### Ko-fi
