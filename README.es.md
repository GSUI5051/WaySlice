> The README is machine-generated, if you find issues please submit a PR.
>
> Este README ha sido generado automáticamente; si encuentras problemas, envía una pull request.

<p align="center">
  <img src="./icons/android-chrome-512x512.png" alt="WaySlice">
</p>

<h1 align="center">WaySlice</h1>

<p align="center">
  <strong>Telemetry for every way. Sliced.</strong><br><strong>Todo camino recorrido se convierte en telemetría; toda telemetría se recorta y se analiza.</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a><br><a href="README.fr.md">Français</a> | <a href="README.de.md">Deutsch</a> | Español | <a href="README.it.md">Italiano</a>
</p>

WaySlice es un analizador de trazas de código abierto, cien por cien front-end, para trazas
GPX/FIT/TCX/KML/KMZ. Las estadísticas de la traza completa dicen poco: lo que quieres saber es cómo te
fue en la subida larga, en la bajada técnica, en los últimos 5 km de la carrera. WaySlice te permite
recortar cualquier tramo y analizarlo por separado, igual que se lee la telemetría de una carrera
automovilística o los registradores de datos de vuelo (QAR) de la aviación:

```text
Traza → Elegir un tramo → Analizar el tramo
```

<p align="center"><img src="./screenshots/overview.jpg" alt="image"></p>

<p align="center"><a href="./screenshots/README.es.md">Más capturas de pantalla</a></p>

¿Primer contacto con los términos? Empieza por la sección de [Terminología](#terminología) — todas las
demás secciones emplean estas palabras exactamente con el sentido definido ahí.

## Índice

- [Terminología](#terminología)
- [Características](#características)
- [Formatos compatibles](#formatos-compatibles)
- [Primeros pasos](#primeros-pasos)
  - [Cómo analizar un tramo](#cómo-analizar-un-tramo)
- [Privacidad](#privacidad)
- [Sistemas de unidades](#sistemas-de-unidades)
- [Notas de diseño](#notas-de-diseño)
- [Pruebas](#pruebas)
- [Contribuir](#contribuir)
  - [Estructura del proyecto](#estructura-del-proyecto)
  - [Añadir un idioma a la interfaz](#añadir-un-idioma-a-la-interfaz)
  - [Añadir o editar mapas base](#añadir-o-editar-mapas-base)
  - [Sustituir los iconos del sitio](#sustituir-los-iconos-del-sitio)
  - [Añadir un README traducido](#añadir-un-readme-traducido)
- [Hoja de ruta](#hoja-de-ruta)
- [Licencia](#licencia)
- [Agradecimientos](#agradecimientos)
- [Colaboradores](#colaboradores)

## Terminología

Estos términos tienen un significado fijo en este README y en la interfaz de la aplicación. Cuando una
palabra aparece con mayúscula, hay que tomarla exactamente en este sentido:

| Término | Significado |
|------|---------|
| Traza (Track) | Una ruta grabada, cargada desde un único archivo: una lista ordenada de puntos de traza. |
| Punto de traza (Track point) | Una medición individual a lo largo de la traza: la posición, más la altitud, la marca de tiempo, la frecuencia cardíaca, la cadencia, la potencia y la temperatura cuando el archivo las proporciona. |
| **Tramo (Sector)** | El concepto central de WaySlice. Un tramo es la parte de la traza comprendida entre un punto de inicio y otro de fin que tú eliges. Los límites pueden quedar en cualquier punto entre dos puntos de traza (interpolados). Toda la traza también es un tramo: la «Toda la traza» por defecto. Cada métrica se calcula para el tramo actual. |
| Tirador del tramo (Sector handle) | El punto arrastrable que fija uno de los límites del tramo: verde = inicio, rojo = fin. Los tiradores aparecen a la vez en el mapa y en el perfil altimétrico y permanecen sincronizados. |
| Desnivel positivo / negativo (Elevation gain / loss) | Ascenso / descenso totales dentro del tramo, tras el filtro de ruido de 3 m (véase [Notas de diseño](#notas-de-diseño)). |
| VAM / VDM | Velocidad ascensional / de descenso en metros por hora: velocidad vertical en m/h, calculada solo con el tiempo empleado efectivamente en subir / bajar. |
| Tiempo en movimiento (Moving time) | Tiempo transcurrido menos las pausas: una pausa es una velocidad inferior a 0,5 km/h mantenida durante 10 s o más. |
| GAP | Ritmo ajustado a la pendiente (grade-adjusted pace): el ritmo del tramo dividido por el factor de pendiente de Minetti (2002) — el ritmo en llano al mismo esfuerzo. |
| Distancia equivalente (Effort distance) | Distancia horizontal + desnivel positivo ÷ 100: cada 100 m de ascenso cuentan como 1 km. |
| Distancia 3D (3D distance) | La distancia que sigue el terreno: suma segmento a segmento de √(horizontal² + vertical²), presentada por separado de la distancia horizontal. |
| Pendiente (Grade) | La inclinación en un punto o en un trecho: variación vertical ÷ distancia horizontal, mostrada en % (positiva = subida, negativa = bajada). |
| Ritmo (Pace) | El tiempo por unidad de distancia: min/km o min/mi. |
| Waypoint | Un lugar con nombre almacenado en el propio archivo de traza (etiquetas `<wpt>` de GPX, placemarks `<Point>` de KML). |
| Mapa base (Basemap) | La fuente de teselas cartográficas dibujada bajo tu traza. Por defecto OpenStreetMap. |

## Características

- **Mapa + perfil altimétrico.** Arrastra los tiradores del tramo en cualquiera de las dos superficies.
  Ambas permanecen sincronizadas en tiempo real, y un límite puede quedar en cualquier punto entre dos
  puntos de traza, interpolación incluida.
- **Waypoints en el mapa y el perfil.** Los waypoints de GPX (`<wpt>`) y KML (`<Point>`) se dibujan
  como chinchetas con su nombre en una ventana emergente — actívalos con el botón de chincheta situado
  bajo «Zoom a la traza». Al pasar el cursor sobre una chincheta se marca el punto correspondiente en
  el perfil altimétrico, y al hacer clic en ella el mapa se centra en ese punto sin cambiar el nivel de
  zoom.
- **Zoom con rueda en el perfil (escritorio), zoom por pellizco (táctil).** Coloca el cursor sobre el
  perfil altimétrico y haz scroll para hacer zoom en su eje de distancia/tiempo alrededor del cursor;
  Mayús + arrastre para desplazarlo; en pantallas táctiles, un dedo desplaza y un pellizco de dos dedos hace zoom. Doble
  clic en cualquier parte del perfil — o doble toque en pantalla táctil — restaura la traza completa.
- **División automática.** El botón de tijeras de la cabecera construye una lista de tramos para toda
  la traza: cortes en los waypoints (de CP en CP), a distancia fija (1 km / 5 km / personalizado — en
  millas cuando el sistema imperial está activo), o por pendiente en tramos de subida / bajada. Cada fila muestra número, rango, cápsula de tipo (subida, bajada, llano o mixto, según su relieve)
  y tiempo, ritmo y frecuencia cardíaca; en pantallas estrechas la fila se parte en dos, la
  cápsula lleva su texto y los datos se alinean con el inicio del rango; al desplegar una fila
  aparecen
  los detalles de ese tramo — distancia 3D, distancia equivalente, desnivel positivo/negativo, GAP,
  VAM/VDM — y el tramo principal pasa a él.
- **Métricas del tramo.** Distancia horizontal y 3D, distancia equivalente, desnivel
  positivo/negativo, pendientes, tiempo transcurrido y tiempo en movimiento, ritmo, velocidad, GAP,
  más frecuencia cardíaca, cadencia, potencia y temperatura cuando el archivo las lleva. Cuando falta
  un dato de entrada obtienes *No disponible*, no 0.
- **Análisis de dos variables.** El icono de dispersión junto a los controles del perfil abre un
  mapa de calor de densidad 2D para cualquier par válido de magnitudes — frecuencia cardíaca,
  velocidad, ritmo, GAP, cadencia, potencia, temperatura, pendiente, altitud. El análisis sigue
  el tramo seleccionado, y cada magnitud toma sus valores del mecanismo del propio panel de
  métricas: frecuencia cardíaca, cadencia y potencia descartan las lecturas en pausa y reciben
  el suavizado de 5 puntos del panel, la temperatura se mantiene en bruto (pausas incluidas),
  la pendiente usa las ventanas de gradiente de 50 m del panel, y la familia de velocidad es
  la serie de velocidad máxima del panel para el tramo. Al pasar el puntero se leen la X, la Y
  y la densidad relativa de la celda. Temas, unidades e idiomas se aplican al instante, y un módulo de gráfico
  independiente mantiene fluidas incluso las trazas de 100 000 puntos. En pantalla táctil, dos dedos hacen zoom y desplazan, un dedo recorre los datos y un
  doble toque recupera el intervalo completo.
- **Exportación.** Descarga el tramo actual — sus métricas como csv, txt o md, sus puntos de traza como
  archivo GPX. Las exportaciones siguen el idioma y el sistema de unidades activos en el momento del
  clic.
- **Unidades métricas / imperiales.** Cambia las unidades de visualización en cualquier momento. El
  sistema métrico es el valor por defecto y tu elección se guarda localmente.
- **Multilingüe.** English, 日本語, 한국어, Français, Deutsch, Español e Italiano vienen
  integrados. Cada idioma adicional es un único archivo de datos (véase [Contribuir](#contribuir)).
- **Privacidad por arquitectura.** No existe código de subida. Tu archivo se lee con la File API y
  después se procesa y se dibuja en tu navegador.
- **Sin paso de compilación.** Módulos ES tal cual. Léelos, ejecútalos, cámbialos.

## Formatos compatibles

| Formato | Geometría | Altitud | Marcas de tiempo |
|--------|----------|-----------|------------|
| `.gpx` | `<trk><trkseg><trkpt>` (multisegmento) | ✅ | ✅ |
| `.fit` | Archivos de actividad binarios Garmin FIT | ✅ | ✅ |
| `.tcx` | XML TrainingCenterDatabase | ✅ | ✅ |
| `.kml` | `LineString` + `gx:Track` | ✅ (de las coordenadas) | ✅ (`gx:Track` / `<when>`) |
| `.kmz` | ZIP → KML (`DecompressionStream` nativo, sin bibliotecas) | ✅ | ✅ |

El decodificado FIT lo realiza la biblioteca [fit-parser](https://github.com/jimmykane/fit-parser)
(MIT) incluida en `vendor/fit-parser/`; el TCX lo lee un analizador DOM integrado. Las extensiones de sensores
GPX se leen sin fijarse en el espacio de nombres: Garmin TrackPointExtension (frecuencia cardíaca,
cadencia, temperatura, velocidad, distancia) y las tres variantes habituales de potencia (`<power>`
desnuda, `PowerInWatts`, `ns3:Watts`). Todos los formatos desembocan en el mismo modelo de punto de
traza, así que las métricas del tramo funcionan igual con independencia del formato de origen.

## Primeros pasos

**Try it: https://wayslice.com**

Cualquier servidor de archivos estáticos sirve. No hay nada que compilar:

```bash
# Python
python -m http.server 8080

# o Node
npx serve .
```

Después abre <http://localhost:8080> y suelta un archivo GPX/FIT/TCX/KML/KMZ.

> Abrir `index.html` directamente mediante `file://` no funciona porque los navegadores bloquean las
> importaciones de módulos ES en URL `file://`.

### Cómo analizar un tramo

1. Suelta tu traza. Toda la traza está seleccionada por defecto.
2. **Arrastra los tiradores verdes/rojos del tramo** en el mapa o en el perfil altimétrico. También
   puedes hacer clic en la traza o en el perfil para mover el límite más cercano, o arrastrar sobre el
   perfil para seleccionar un nuevo rango. En pantallas táctiles, un dedo desplaza el perfil ampliado y
   un pellizco hace zoom; el tramo solo se cambia con los tiradores.
3. Cada cambio recalcula el tramo al instante: distancia, distancia 3D, desnivel positivo/negativo,
   pendientes, ritmo/velocidad, kilómetro más rápido / más lento.
4. Teclado: pon el foco en un tirador y usa las flechas (Mayús = ×10, Inicio/Fin = salto). `Esc` cierra
   los menús.
5. Los dispositivos táctiles usan gestos cooperativos: un dedo desplaza la página, dos dedos mueven y
   hacen zoom en el mapa (aparece una pista sobre el mapa).
6. Tramos listos para usar: el botón `División automática` de la cabecera construye una lista de
   tramos para toda la traza — por waypoint, a distancia fija o por pendiente.

## Privacidad

- Tu traza se procesa **solo** en tu navegador: analizar → calcular → dibujar, todo en local.
- Las únicas peticiones de red son las **teselas cartográficas** del mapa base que elijas. Los datos de
  tu traza nunca se transmiten y no hay estadísticas de uso.
- El tema, el idioma, el mapa base y las unidades se guardan solo en el `localStorage` de tu
  dispositivo.

## Sistemas de unidades

WaySlice viene con el sistema **métrico** por defecto y también admite el **imperial**. Abre el panel
de `Ajustes` desde el botón del engranaje de la cabecera — las unidades están junto al idioma y el
tema:

| Mostrado | Métrico | Imperial |
|---|---|---|
| Distancia larga | km | mi |
| Distancia corta / altitud | m | ft |
| Velocidad | km/h | mph |
| Ritmo | min/km | min/mi |
| Pendiente | % | % |

Todo el análisis y los cálculos se mantienen en unidades SI (metros, metros/segundo,
segundos/kilómetro). Cambiar de unidades solo vuelve a formatear los números que ves: el archivo no se
vuelve a analizar, el tramo no se recalcula y la geometría de la traza no cambia. La preferencia se
guarda con la clave `wayslice-units` y sobrevive a las recargas. Idioma y unidades son ajustes
independientes: cualquier idioma funciona con cualquiera de los dos sistemas.

## Notas de diseño

- La **distancia 3D** se calcula segmento a segmento como `√(horizontal² + vertical²)` y se presenta
  por separado de la distancia horizontal.
- La **distancia equivalente** = distancia horizontal + desnivel positivo ÷ 100 (100 m de ascenso
  cuentan como 1 km).
- La **pendiente media** es el ascenso acumulado del tramo dividido por la distancia horizontal, no la
  media de las pendientes punto a punto; un tramo que solo desciende no tiene ascenso que promediar y
  muestra «—». Las pendientes máxima/mínima usan ventanas de ~50 m para que
  el ruido del GPS no fabrique una pendiente récord.
- El **desnivel positivo/negativo** aplica un filtro de histéresis de 3 m: el cambio de altitud se
  acumula hasta superar ±3 m y solo entonces cuenta — el ruido inferior a 3 m nunca hincha los
  totales.
- **VAM/VDM** dividen el desnivel entre el tiempo realmente empleado en subir/bajar (la tendencia de
  altitud filtrada), no entre el tiempo total del tramo.
- El **tiempo en movimiento** cuenta solo los segmentos fuera de las pausas (velocidad inferior a
  0,5 km/h mantenida 10 s o más).
- La **velocidad media y el ritmo medio** se calculan a partir de las velocidades de movimiento por
  segmento y se depuran como la curva del perfil: con velocidades registradas, una ventana deslizante
  de 5 puntos diluye el pico en su vecindad; sin velocidades registradas, solo se aplica la regla de
  3 desviaciones estándar. La **velocidad máxima** lee la curva por puntos depurada del perfil, para
  que la lista y el gráfico coincidan siempre.
- El **GAP medio** divide el ritmo de cada segmento por el factor de pendiente de Minetti (2002)
  (limitado a ±45 % de pendiente) antes de promediar: el ritmo en llano al mismo esfuerzo. En el
  perfil, velocidad/ritmo/GAP comparten una única ranura de superposición.
- **Las curvas de velocidad del perfil** eligen la regla según la fuente: las velocidades registradas
  se comprueban primero frente al dd/dt del segmento (las lecturas más de un 50 % por encima se
  descartan) y después se suavizan con una ventana deslizante de 5 puntos (cada valor = la media de
  hasta cinco puntos centrados en cada uno); las calculadas siguen directamente la regla 3σ (fuera de
  rango se sustituyen por interpolación de las vecinas). Un cero registrado (una parada) es un dato y
  participa en la media como cualquier otro.
- La **simplificación de visualización** (Douglas–Peucker para el mapa, muestreo mín–máx por píxel
  para el perfil) nunca toca los puntos originales. Las métricas se calculan siempre con los datos
  completos.
- El **zoom del perfil** baja hasta una ventana de 1 km en modo distancia y de 20 minutos en modo
  tiempo; los dispositivos táctiles hacen zoom en el perfil con un pellizco de dos dedos — no hay rueda.
- Las trazas grandes (100 000 puntos o más) funcionan sin problema. Mientras arrastras un tirador, la
  búsqueda del límite parte de la coincidencia anterior y amplía su ventana según hace falta.

## Pruebas

Abre `tests/index.html` en el mismo servidor:

```text
http://localhost:8080/tests/
```

La suite cubre los cálculos de distancia, la interpolación entre puntos, las ventanas de pendiente,
las métricas temporales, el análisis GPX/FIT/TCX/KML/KMZ (incluidos archivos malformados y archivos
comprimidos, además de las variantes de potencia y extensiones de sensores GPX), la matriz de
preferencias de tema (sistema/manual × claro/oscuro del SO), la cadena de reserva de idiomas y las
conversiones métrico/imperial (incluidos el redondeo del ritmo, el VAM, la persistencia y las
pendientes independientes de las unidades), además de la exportación de tramos (contenido csv/txt/md/gpx y
nombres de archivo).

## Contribuir

### Estructura del proyecto

```text
index.html              carcasa + guion de arranque del tema (sin destello de tema equivocado)
icons/                  recursos de iconos (favicon.svg + tamaños PNG/ICO, vista previa)
site.webmanifest        metadatos de instalación PWA (nombre, colores de tema, iconos)
css/                    tokens de diseño (claro/oscuro), base, maquetación, componentes
js/
  parsers/              GPX / FIT / TCX / KML / KMZ → una única matriz unificada de puntos de traza
  geo/                  haversine + distancia 3D, interpolación, simplificación
  metrics/              métricas del tramo (funciones puras, verificables por separado)
  sector/               estado de selección del tramo (única fuente de verdad)
  map/                  vista MapLibre, catálogo de mapas base, tiradores del tramo
  charts/               gráficos en canvas (perfil altimétrico, análisis de dos variables)
  theme/                sistema / claro / oscuro con sincronización en vivo del SO
  language/             núcleo de idioma + paquetes lang-*.js + plantilla
  units/                preferencia métrico/imperial, conversiones SI de visualización, etiquetas de unidades localizadas
  ui/                   panel de métricas, panel de ajustes, división automática, menús, hojas, carga, iconos
  core/                 pequeño bus de eventos + stores
  utils/                formato sensible a la configuración regional (Intl)
tests/                  suite de pruebas ejecutable en el navegador (tests/index.html)
vendor/fit-parser/      kit de herramientas fit-parser incluido (decodificación FIT, MIT) + shim de buffer
```

La lógica de cálculo vive separada de la UI: `computeSectorMetrics()` y las demás funciones de métricas
nunca tocan el DOM, y la suite de pruebas las cubre.

### Añadir un idioma a la interfaz

El sistema de traducción no tiene ningún framework detrás: **un idioma es un único archivo de datos**.
Si sabes editar un archivo JavaScript, puedes traducir la aplicación.

1. Copia [`js/language/lang-template.js`](js/language/lang-template.js) como `lang-xx.js`
   (`xx` = un código BCP 47 como `de`, `pt-BR`).
2. Traduce los valores de la derecha. Deja las claves y los `{marcadores}` tal cual y mantén la
   coherencia de los términos técnicos (tramo, distancia 3D, desnivel positivo/negativo, pendiente,
   ritmo, VAM).
3. Añade una entrada al catálogo de [`js/language/langs.js`](js/language/langs.js) — código de
   idioma, nombre nativo y cargador diferido. Los paquetes se cargan bajo demanda: al arrancar solo
   se descargan el idioma del visitante y el inglés.
4. Abre la aplicación, cambia a tu idioma y mira la consola. WaySlice valida los paquetes cargados contra
   las claves inglesas y avisa de las claves que falten o sobren.
5. Envía una pull request.

Las claves que falten recurren al inglés (y después a la propia clave), así que la interfaz nunca
muestra `undefined`. El idioma, el tema y el mapa base elegidos sobreviven a las recargas en el
`localStorage`.

### Añadir o editar mapas base

El catálogo de mapas base vive en un único archivo: [`js/map/sources.js`](js/map/sources.js). El menú
del mapa, la hoja de ajustes, la persistencia y la creación de capas de teselas leen todos de él —
añadir o editar una fuente no requiere código de interfaz.

**Añadir una fuente** — añade un objeto a `MAP_SOURCES`:

```js
{
  id: 'esri-topo',           // único; sirve además como clave de persistencia
  labelKey: 'srcEsriTopo',   // clave i18n del nombre mostrado
  group: 'outdoor',          // street | outdoor | satellite | minimal
  url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
  maxZoom: 19,
  attribution: 'Tiles &copy; Esri',
},
```

| Campo | Significado |
|---|---|
| `id` | Identificador único y clave de persistencia. Cambiarlo equivale a una fuente nueva (las selecciones guardadas recurren al valor por defecto); eliminar una entrada también recurre de forma segura. |
| `labelKey` | Clave i18n del nombre mostrado. |
| `group` | Uno de `street`, `outdoor`, `satellite`, `minimal`. |
| `url` | Plantilla de teselas: `{z}` `{x}` `{y}`, opcionalmente `{s}` (requiere `subdomains`) y `{r}` (retina). Atento al orden de coordenadas del proveedor — Esri usa `{z}/{y}/{x}`. |
| `overlayUrl` | Opcional: plantilla de una capa de etiquetas transparente sobre las teselas base. |
| `maxZoom` | El zoom máximo que sirve el proveedor. |
| `attribution` | Lo exigen legalmente OSM, OpenTopoMap, Thunderforest, Mapy, Stadia Maps y Esri — consérvala. |
| `subdomains`, `crossOrigin`, `hintKey` | Opcionales: rotación de subdominios; `crossOrigin: false` para servidores de teselas sin cabeceras CORS; línea de pista gris en el selector. |

A continuación añade el nombre mostrado a **todos** los paquetes de idioma — `srcEsriTopo: 'Esri Topo',`
en `lang-en.js`, `lang-fr.js`, `lang-ko.js`, `lang-ja.js`,
`lang-de.js`, `lang-es.js`, `lang-it.js` y `lang-template.js`. La prueba de integridad de idiomas sigue
en rojo hasta que todos los paquetes tienen la clave; es deliberado.

**Editar una fuente** cambiando `url`, `maxZoom`, los nombres o la atribución en su sitio. Para un
**grupo nuevo**, añádelo al array `GROUP_ORDER`, úsalo en tus fuentes y añade una clave
`group<Nombre>` (p. ej. `groupTopo`). Los servicios que exigen clave de API (Maptiler, Mapbox)
funcionan con la clave incrustada en `url`, pero no subas la tuya. Mejor teselas en HTTPS: en una
página servida por HTTPS el navegador bloquea las teselas HTTP o las fuerza por HTTPS.
Para comprobarlo: recarga, abre el menú `Mapa` y revisa teselas, zoom máximo y atribución.

### Sustituir los iconos del sitio

Todos los iconos del sitio derivan de un único archivo fuente, `icons/favicon.svg` — una tesela redondeada
de 1024×1024 con dos crestas de montaña naranjas sobre un degradado oscuro, una línea de traza GPX
blanca y puntos verde/rojo que replican los tiradores de tramo de la aplicación. A partir de él se
regeneran `favicon.ico`, los tamaños PNG de 16 a 512 px, `apple-touch-icon.png`, los iconos de Android
Chrome y `site.webmanifest`. Los buscadores tienen sus propios requisitos (Google necesita un PNG de
48 px o más, el manifest y un robots.txt rastreable — de ahí el `robots.txt` en la raíz del
repositorio). `icons/icon-preview.html` muestra todos los tamaños en local. Dentro de la aplicación, la
cabecera y el estado vacío reutilizan la marca de `icons/favicon.svg`; los iconos funcionales provienen de
la biblioteca de iconos Lucide (licencia ISC) y están reunidos en `js/ui/icons.js`. El enlace a
GitHub de la cabecera es la única excepción: carga como imágenes los archivos de logotipo de
GitHub de `icons/` (la marca Octocat y el logotipo denominativo son marcas registradas de
GitHub, Inc., usadas solo para enlazar a este repositorio).

Para poner tu propia marca, edita `icons/favicon.svg`, regenera a partir de él los demás tamaños y mantén
sincronizados los enlaces de `index.html` y `site.webmanifest`.

### Añadir un README traducido

Las traducciones existentes ([English](README.md), [日本語](README.ja.md), [한국어](README.ko.md), [Français](README.fr.md), [Deutsch](README.de.md),
[Italiano](README.it.md)) te sirven de ejemplo. Para añadir una:

1. Copia este `README.md` (o cualquier traducción existente) como `README.xx.md`
   (`xx` = un código BCP 47, p. ej. `README.pt-BR.md`).
2. Traduce el texto. Mantén sin cambios la estructura, el orden de las secciones, las tablas, los
   bloques de código y las rutas de archivos, para que todas las versiones sigan siendo fáciles de
   comparar y mantener.
3. Actualiza la línea de cambio de idioma bajo el título en **todos** los README: añade tu idioma como
   enlace en los demás y conserva el formato `A | B | C | D`. En tu propia versión, tu idioma es la
   entrada en texto plano.
4. Envía una pull request.

## Hoja de ruta

- Un mejor algoritmo de depuración de picos que tenga en cuenta la deriva del GPS y el muestreo disperso
- Un mejor algoritmo de detección de pendientes para la división automática (subida / bajada / llano / mixto)
- Mejora opcional de la altitud con servicios DEM externos (solo con consentimiento — el valor por
  defecto sigue siendo 100 % local)

## Licencia

Publicado bajo la [licencia MIT](LICENSE). Libre para uso comercial y privado — por favor, conserva
intactas las atribuciones de los proveedores de mapas:

- [MapLibre GL JS](https://maplibre.org) (BSD-3-Clause)
- © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL)
- [OpenTopoMap](https://opentopomap.org) (CC-BY-SA), [CyclOSM](https://github.com/cyclosm/cyclosm-cartocss-style)
- Mapas base de [Thunderforest](https://www.thunderforest.com), [Mapy.com](https://mapy.com), [Stadia Maps](https://stadiamaps.com), [Esri World Imagery](https://www.esri.com)
- Iconos de [Lucide](https://lucide.dev) (ISC)

## Agradecimientos

- El proyecto está libremente inspirado en el artículo
  [GPS data analysis](https://trailrunningmovement.com/training/gps-data-analysis/) de
  [Trail Running Movement](https://trailrunningmovement.com/).
- A [Ken Zemach](https://fastestknowntime.com/athlete/ken-zemach) por su
  [traza GPX](https://fastestknowntime.com/fkt/ken-zemach-bruksleden-100-miler-sweden-2020-08-02) del
  Bruksleden 100 Miler (Suecia).
- A [polyvertex](https://github.com/polyvertex) por sus [archivos FIT](https://github.com/polyvertex/fitdecode/tree/master/tests/files).
- A [ToolElewaut](https://github.com/ToonElewaut) por sus [archivos TCX](https://github.com/ToonElewaut/TDF/tree/main/src/Data/Routes) del Tour de Francia 2020 - 2023.
- A [tingard](https://github.com/tingard) por sus [archivos TCX](https://github.com/tingard/cycling_power_analysis).
- A [pherris](https://github.com/pherris) por su [archivo TCX](https://github.com/pherris/IOT-Value-Cycling/tree/master/rides) de una salida ciclista de larga distancia con datos de potencia.
- A [Tommi](https://www.youtube.com/@bewarethemountainman) por su [traza GPX](https://drive.google.com/file/d/1lPVebrcOImAw035d9r0tqP63O-2yZe4E/view) de la ruta de senderismo Kai Kung Leng - Tai To Yan - Tai Mo Shan en Hong Kong.

## Colaboradores

Gracias a todas las personas que ayudan a mantener WaySlice y a que siga funcionando.

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/I8U4273MZK)

### Ko-fi
