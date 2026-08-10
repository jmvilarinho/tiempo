# Tiempo

Aplicación web estática (sin build, sin dependencias de paquetes) de información
meteorológica y webcams, servida en GitHub Pages bajo `/tiempo/`. JavaScript vanilla +
jQuery. Textos en gallego/castellano.

En realidad son **dos apps** que comparten helpers:

- **App principal** (`index.html`) — tiempo y webcams de Galicia (y alguna playa de
  Portugal): streams HLS en directo, previsión de **playas** (`praias`) y **poblaciones**
  (`poboacions`) de AEMET, mareas, farmacias de guardia y precios de combustible.
- **App `rfgf/`** (`rfgf/index.html`) — resultados y clasificaciones de fútbol (RFGF/futgal)
  para un conjunto de equipos.

## Fuentes de datos

- **AEMET** (previsión de playas y municipios) y **farmacias** vía proxies AWS Lambda
  (CORS / API key) — constantes `proxyHost*` en `index.js`.
- **MeteoGalicia** (precipitación), **combustible** (ES + PT) e **mareas españolas**
  (`ideihm.covam.es`) directos.
- **IPMA** (`api.ipma.pt`) para la previsión de playas de Portugal (p. ej. Costa de Caparica).
- **Open-Meteo** (`api.open-meteo.com` y `marine-api.open-meteo.com`, sin API key) para la
  temperatura actual y, en playas de Portugal, temperatura del agua, sensación térmica y
  mareas (estas últimas aproximadas, derivadas del nivel del mar horario).
- **Webcams**: streams HLS de camaramar y cámaras de MeteoGalicia y DGT (estas últimas solo
  imagen fija).

## Webcams y alternativas

Los streams caen a menudo (cámara apagada, o URL protegida por un token de sesión que caduca).
Por eso cada cámara puede declarar una **imagen alternativa**: si el vídeo no arranca —o falla
en mitad de la reproducción— se muestra la instantánea en su lugar. Algunas cámaras (Perbes,
tráfico de DGT) no tienen stream utilizable y van directamente a la imagen fija, que se
refresca cada pocos minutos.

## Fútbol (app `rfgf/`)

Los datos vienen de un único API Gateway que hace de proxy sobre dos fuentes: **futgal**
(RFGF) y **RFEF** para los equipos marcados con `rfef: 1` en el registro `equipos` de
`rfgf/index.html`. Las dos fuentes no devuelven lo mismo:

- La **clasificación** llega como HTML de la web original. La de futgal trae los escudos de
  los equipos; la de la RFEF no trae ninguno (la RFEF no publica escudos en estos datos), así
  que ahí la tabla se queda sin iconos a propósito.
- La clasificación de la RFEF tampoco trae el nombre de la competición. Se guarda en la cookie
  `nombresCompeticion` cuando lo devuelven otras páginas (portada, xornadas, resultados) y, si
  se entra directamente por la URL `#clasificacion/...`, se pide una vez a los resultados.

## Desarrollo

No hay nada que compilar. Sirve la raíz del repo por HTTP y abre la página — abrir con
`file://` rompe `$.load()`, `fetch` y las rutas relativas. Como las URLs absolutas asumen el
prefijo `/tiempo/`, sirve de forma que el sitio quede bajo `/tiempo/`:

```
python -m http.server 8000   # luego visita http://localhost:8000/tiempo/ si sirves desde el directorio padre
```

### Caché (importante)

Las etiquetas `<script src="...?nocache=N">` / `<link href="...?nocache=N">` llevan un número
de versión manual. **Tras editar un `.js` o `.css`, sube su `?nocache=`** en cada HTML que lo
incluya, o el navegador (y la caché de GitHub Pages) servirá la versión antigua.

## Despliegue

`git push` a la rama de GitHub Pages — sin pipeline de CI.

## Más detalle

Ver [`CLAUDE.md`](CLAUDE.md) para la arquitectura (flujo de datos por proxies, estructura de
cada app, convenciones de estado en cookies y de renderizado).
