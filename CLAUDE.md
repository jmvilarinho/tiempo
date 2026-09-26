# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, client-side web app (no build step, no package manager, no tests) served as
GitHub Pages under the path prefix `/tiempo/`. Vanilla JavaScript + jQuery only — there is
no bundler, transpiler, or framework. UI text is in Galician/Spanish.

It is actually **two separate apps** sharing helpers:

- **Root app** (`index.html`) — Galician weather/webcams: live HLS webcam streams, AEMET
  beach (`praias`) and town (`poboacions`) forecasts, sea tides, on-call pharmacies, and
  fuel prices.
- **`rfgf/` app** (`rfgf/index.html`) — a football (RFGF/futgal) results & standings viewer
  for a hardcoded set of teams.

## Running / developing

There is nothing to build. Serve the repo root over HTTP and open the page — opening files
via `file://` breaks `$.load()`, `fetch`, and relative paths. Because absolute URLs assume
the `/tiempo/` prefix (e.g. favicon `/tiempo/favicon.ico`), serve so the site lives under
`/tiempo/`, e.g.:

```
python -m http.server 8000   # then visit http://localhost:8000/tiempo/ if served from parent dir
```

Deployment is a `git push` to the GitHub Pages branch — no CI pipeline.

### Cache busting (important)

Script and stylesheet `<script src="...?nocache=N">` / `<link href="...?nocache=N">` tags
in the HTML files carry manual `?nocache=` version numbers. **After editing a `.js` or
`.css` file, bump its `nocache` value** in every HTML that includes it, or browsers (and
GitHub Pages caching) will serve the stale version.

## Architecture

### Cross-origin data flow via AWS proxies

The browser cannot call most upstream APIs directly (CORS / API keys), so requests go
through AWS Lambda / API Gateway proxies. These URLs are hardcoded constants:

- Root app weather proxies — `proxyHost` (AEMET), `proxyHostFarmacia`, `proxyHostMeteosix`,
  defined in `index.js`. Usage: `fetch(proxyHost + upstreamUrl)`. They all
  share one Lambda Function URL (`get_aemet`, in the separate `scripts_movil` repo) and differ
  only in `?type=`, so adding a source there means adding a `type` branch to that handler.
  (`?type=camaramar&url=` also still exists there as a plain JSON fetcher, handy for poking at
  `/webcam/<id>/stream-url` by hand, but nothing in the site calls it any more.)
- `proxyHostCamaramarStream` (`index.js`, same Lambda, `?type=camaramar&cam=<webcam id>`)
  serves the **master manifest** of the camaramar.com webcams. Two gates sit on that manifest:
  a SecureToken (`jdtcbrndmrd*`) minted by `https://www.camaramar.com/webcam/<id>/stream-url`
  (which the browser could fetch itself) and, since they moved the streams to `/live/`, a
  mandatory `Referer: https://www.camaramar.com/` — any other referer, or none, gets a 403, and
  `Referer` is a forbidden header in `fetch`/XHR. Only the master goes through the proxy: the
  chunklist and the `.ts` segments carry the token inside their *file name* and are served with
  no `Referer` and `Access-Control-Allow-Origin: *`, so the Lambda just rewrites the master's
  relative URLs to absolute ones and the video goes straight from the CDN to the browser — one
  Lambda call per camera per reload, no video relayed (unlike `proxyHostNazare`). Don't call it
  directly: `camaramarStream('<wowza stream name>')` in `params.js` holds the stream-name →
  webcam-id map (get the id from the `data-webcam-id` of the `<video>` on camaramar's page).
  Its URL doesn't end in `.m3u8`, so turns need `stream: true`.
- `proxyHostNazare` (also `index.js`, same Lambda, `?type=nazare&cam=1|2|3`) relays the
  nazarewaves.com webcams, which the browser cannot reach on two independent counts: their
  session cookie (`jwtcam_N`) is HttpOnly on `.nazarewaves.com`, lives 120 s and is only minted
  by `GET /en/webcams`, and `blobN.nazarewaves.com` sends no `Access-Control-Allow-Origin`. The
  Lambda keeps one cookie cached (90 s TTL), rewrites the manifest's segment URLs to point back
  at itself (`?type=nazare&cam=N&file=<absolute url>`) and streams the `.ts` through base64.
  Two things there are load-bearing: the `file=` parameter is **allowlisted** to
  `https://blob<digits>.nazarewaves.com/memfs/` so the proxy can't be used as an open relay, and
  upstream 401/403/404/410 are **forwarded verbatim** instead of collapsing into 502 — a segment
  that has rolled out of the 12 s live window is a normal 404, and hls.js only recovers from it
  (reload the playlist and carry on) if it actually sees a 404. `&photo=1` returns a single JPEG
  instead of the stream: near-free compared to relaying ~1.5 Mbit/s per viewer through Lambda, and
  it is what every nazarewaves turn falls back to.
- Fuel prices come straight from `sedeaplicaciones.minetur.gob.es` (`FUEL_PRICES_*` in
  `index.js`), Spanish tides from `ideihm.covam.es`, current temperature from `api.open-meteo.com`.
- Portugal beaches (e.g. Costa de Caparica, Nazaré) call IPMA directly (`api.ipma.pt`,
  CORS-enabled, no proxy) for the forecast. Two different endpoints, picked by the last
  (`agregado`) argument of `getPrevisionIPMA`: `open-data/forecast/meteorology/cities/daily/<id>`
  covers only the 35 district capitals, so anywhere else (Praia da Nazaré is `1101121`) needs
  `public-data/forecast/aggregate/<id>`, whose payload is a flat list mixing `idPeriodo` 1 / 3 / 24
  and is normalised to the `cities/daily` shape by `ipmaAgregadoADiario` — keep new locations
  going through that converter rather than teaching the renderers a second shape. Location ids
  come from `public-data/forecast/locations.json`.
  IPMA exposes no water temperature nor tides, and the Spanish IHM
  tide API does not cover Portugal, so those (plus feels-like) come from Open-Meteo: the forecast
  API (`api.open-meteo.com`) for daily apparent temperature and the Marine API
  (`marine-api.open-meteo.com`) for sea-surface temperature and `sea_level_height_msl` (hourly
  sea level, from which high/low tides are derived). Both Open-Meteo APIs are keyless + CORS.
  Official tide tables (WorldTides) and IPMA's `oceanography` sea-state dataset were deliberately
  not used (paid / proxied via a nearby station); the Open-Meteo tide is approximate (see below).
- RFGF app — a single `remote_url` API Gateway endpoint (set in `rfgf/index.html`) called as
  `remote_url + "?type=<action>&..."`, returning JSON with a common envelope handled by
  `show_error(data)` in `rfgf/utils.js` (`is_ok`, `source`, `timestamp`, `data`).

When changing data sources, update these constants rather than scattering URLs.

### Root app structure

- `index.html` loads `common.js`, `index.js`, `farmacia.cofc.js`, `fuelprices.js`,
  `farmacia.cofpo.js`, `poboacions.js`. On-call pharmacies are split by provincial college:
  `farmacia.cofc.js` (cofc.es, A Coruña, via `proxyHostFarmacia`) and `farmacia.cofpo.js`
  (cofpo.org, Pontevedra, direct CORS). Fuel prices (ES + PT) live in `fuelprices.js`; the
  🗺️ row at the end of each price table (`fuelMapaRow`) opens `mapa.html` in a new tab — a
  Google Maps JS API page (key `GOOGLE_MAPS_API_KEY` in that file) that plots the listed
  stations labelled with their price plus the current location, all passed as JSON in the hash.
  The link itself is built by `mapaLink` in `common.js`, which both pharmacy lists also append
  at their end (points with a `null` price get a pharmacy-cross marker instead of a price label).
  The shared geo helpers `distance` (Haversine) and `getSafeLocation` are in `common.js`.
  `getSafeLocation()` is the single entry point for the current position: it tries a fast
  low-accuracy fix first and then GPS with a long timeout (Android needs far more than a
  few seconds), shares one in-flight request plus a 5-min position cache and a 1-min error
  cache across all callers, and resolves to `{latitude: 0, longitude: 0, ok: false}` on
  failure — never rejects. Never call `navigator.geolocation.getCurrentPosition` directly
  (no timeout means the callbacks may never fire on Android); use `geoResetCache()` before
  a user-triggered retry.
- The view toggles between two fragments, `praias.html` and `poboacions.html`, loaded into
  `#DivContent` via jQuery `$.load()`. `CambiaVistaUpdate(pagina)` in `index.js` drives this
  and persists the choice in the `pagina` cookie. The `RFGF` button navigates to `rfgf/`.
- Each fragment defines an array of entries — `praias_list` (`praias.html`) and
  `poboacions_list` (`poboacions.html`) — each `{ key, name, html, init() }` (plus optional
  `previsions` count; `previsions: 0` skips the `#hash`-scroll counter, used for IPMA beaches
  that don't call `getPrevision`). `renderSelector` (in `poboacions.js`) builds a checkbox
  selector, persists the selection in the `praiasItems` / `poboacionsItems` cookie, and only
  runs `init()` for selected entries. To add a beach/town, add an entry to that array — it is
  the single source of truth, like the RFGF `equipos` array.
  The entries load **in parallel**: `renderSelector` writes the whole selection's HTML in a
  single `innerHTML` assignment (one reflow) and then dispatches each `init()` through
  `tarefa()` — a `setTimeout(…, 0)` wrapper that returns a promise — so one entry's synchronous
  work (building the Hls players, table markup) doesn't delay the others' requests and the
  browser can paint in between. A plain microtask (`Promise.resolve().then`) would *not* work
  here: microtasks drain before the browser paints.
  `render_praias` / `render_poboacions` / `renderSelector` are `async` and resolve when every
  `init()` has finished, via `Promise.all`. An entry opts into being waited for by **returning**
  its promise (`return showVideo(...)` / `return alternateMediaVarias(...)`) — that is why the
  fragments' `init()` bodies end in `return`; an `init()` that returns nothing is only waited
  for up to its own launch. Each entry is caught separately, so one failure doesn't stop the
  rest. Everything up to the first `await` is still synchronous (selector markup, entry HTML,
  `beforeInit` → `total_elementos`), so callers may keep calling `render_*()` without `await`,
  as `praias.html` / `poboacions.html` and the checkbox toggles do.
  Because a re-render (checkbox click) replaces the content, each render bumps a generation
  counter in `renderGeneration` and pending `init()`s from a superseded render are dropped.
- `index.js` holds the bulk of weather logic: forecast rendering (`getPrevision` →
  `createPrevision`), tides (`getMareas`), geolocated current temperature
  (`geoFindMe` → `getTemperatura`), HLS webcam playback (`showVideo`, using `hls.light.min.js`).
- **Webcams and their fallbacks** (all in `index.js`). Each camera block in the fragments follows
  a naming convention: `#<key>` is the media element, `#<key>-unavailable` the placeholder div
  where a still image can be injected, and `#<key>-alternative` the caption/link div.
  - `showVideo(url, videoid, alternative, alternativeurl, fallbackurl)` plays an HLS stream and
    degrades to `alternativeurl` (a still image, shown via `showAlternative`) whenever the stream
    cannot play: manifest not reachable (checked with `validURL`, after trying `fallbackurl`),
    target element not a `<video>`, a **fatal `Hls.Events.ERROR` at runtime**, or an `error`
    event on the native-HLS path. The runtime cases matter because some manifests answer `200`
    while the chunklist is behind a session SecureToken (camaramar), so the failure only shows
    up during playback. For that reason the success path *hides* `#<key>-unavailable` with
    `display: none` instead of removing it — the fallback needs that div to still exist. Keep it
    that way when touching this function.
  - `showOnlyAlternative(videoid, ...)` for cameras with no stream at all (DGT traffic cams),
    `showSnapshot(url, imgid, refreshSeconds)` for still-image cameras that should auto-refresh,
    and `showAlternatingOverlay` / `showAlternatingMediaSmooth` to alternate image and video
    (their internal `switchToVideo` / `showVideoStream` are deliberately *not* named `showVideo`,
    to avoid shadowing the global one).
  - `alternateMediaVarias(baseid, quendas, intervalSeconds, isPausado)` drives the alternating
    blocks (Razo, Lapamán, Nazaré) with **any number of turns**. A turn is
    `{url, label, alternativa, stream}`. Its markup is `#<key>-img` + `#<key>-video` +
    `#<key>-title`. **Any turn may be an HLS stream or a still image** — `esStreamHls` decides by
    the `.m3u8` extension, and `stream: true|false` overrides it, which is what the Nazaré and
    camaramar turns need because the proxy URL carries the manifest in a query string. Each turn has its own
    fallback snapshot (`alternativa`), shown in the shared `<img>` when its stream can't play
    (`validURL` precheck, fatal/denied `Hls.Events.ERROR`, native-HLS `error`) or when its own
    snapshot fails to load. Every stream turn past the first gets its own `<video>`, cloned by
    `creaVideoExtra()` into `#<key>-video2`, `-video3`, …, so no stream has to be torn down on
    every switch, and `hls.stopLoad()` / `startLoad()` keep only the visible one downloading.
    **Never `stopLoad()` a player before its `Hls.Events.MANIFEST_PARSED`**: that aborts the
    manifest request, and `startLoad()` only resumes level and fragment loading — it never
    re-requests the manifest, so the turn stays black forever. Hence the `listo` flag on each
    turn: `arranca()` defers the hidden turn's stop into a `once(MANIFEST_PARSED)` handler and
    `oculta()` only stops a turn that is already `listo`.
    `alternateMediaVarias` is **`async`**, like `showVideo`: the block is painted synchronously
    (current turn, title and toggle button) and only the per-turn `validURL` manifest check is
    awaited, *before* creating that turn's `Hls` — so a dead stream never gets a player, and the
    caller's task is not blocked. Don't move `amosa` / `creaBoton` / `arrancaTemporizador` behind
    that `await`: `validURL` has no timeout, so an unresponsive host would leave the block empty
    and without a toggle forever. Two consequences of the await to keep in mind: `amosa()` must
    not call `play()` before the player exists (it checks `q.hls || q.video.src`, and `arranca` calls
    `amosa` again once the player is ready), and a turn whose manifest check outlived the
    rotation interval gets `stopLoad()`ed on the spot if it is no longer the visible one.
    It also injects a pause/resume toggle (`#<key>-toggle`, icons `img/pausa.svg` /
    `img/continuar.svg`) right after `#<key>-title`, which only starts/stops the rotation timer —
    the stream on screen keeps playing. It is an `<img>` with `preventDefault`/`stopPropagation`
    because the title usually sits inside the `<a>` to the camera's site.
  - Pobra (`Pobra` key in `praias.html`) is the reference case of a camera with no stream left:
    camaramar's `/camaramar/` Wowza application is gone (everything 404s) and no
    `/webcam/<id>/stream-url` resolves to `9_caraminal`, so it goes straight to
    `showOnlyAlternative` with the Xunta's Corón snapshot.
- `common.js` is shared with the RFGF app: maps/Waze deep-links (`openMaps`, `openWaze`,
  platform detection in `detectPlatform`).
- AEMET forecast JSON is fetched as ISO-8859-1 and decoded manually (see `getPrevisionDatos`).
- Weather icons live in `img/` named by AEMET sky-state codes (e.g. `img/11_g.png`).
- Portugal beaches are rendered by `getPrevisionIPMA` / `createPrevisionIPMA` / `ipmaRow` in
  `poboacions.js`; IPMA sky-state codes are mapped to the AEMET icon names via
  `IPMA_WEATHER_TO_AEMET_ICON`. Open-Meteo extras for these beaches: `getOpenMeteoDiario`
  (daily water-temp + feels-like rows, threaded into `ipmaRow` as `extras`) and `getMareasCaparica`
  (tides, in `index.js`). Tide times are computed from hourly `sea_level_height_msl` by finding
  curve extrema with parabolic interpolation, then shifted by the empirical constant
  `MAREAS_CAPARICA_OFFSET_MIN` (~25 min, tune in `index.js`) because the hourly/offshore model
  runs ahead of official tables; the tide source attribution renders in the `#data_mareas_pt`
  footer div (Spanish IHM tides use `#data_mareas`).

### RFGF app structure (single-page, hash-routed)

- **Routing:** hash fragments of the form `#pagina/cod_equipo/cod_grupo/cod_competicion/cod_club/cod_campo/cod_acta`.
  `update_vista()` (in `rfgf/utils.js`) parses the hash, falls back to cookies for any
  missing segment, and dispatches to the matching `load_*` function. Each `load_*` does
  `history.pushState` with the canonical hash and persists its codes to cookies, so back/forward
  and reloads restore state. `window.onpopstate` re-runs `update_vista`.
  The initial `update_vista()` in `rfgf/index.html` must **not** be chained behind a network
  call — doing so left the page showing only the *Menú* button. In particular, don't scrape
  `resultados.rfef.es` from the browser to fill in a missing `codgrupo`: it takes ~20 s per
  request, sends no CORS headers and redirects to a login page. Declare `codgrupo` in the
  `equipos` array, or add a new `type=` to the AWS proxy.
- **Pages** are one JS file each: `portada.js`, `resultados.js` (also clasificación/goleadores),
  `calendario.js`, `club.js`, `campo.js`, `acta.js`, `plantilla.js`, `favoritos.js`,
  `equipo.js`. Their `load_*`/`show_*` functions render directly into `#results` by appending
  HTML strings.
- **`rfgf/utils.js`** is the shared toolkit: routing, the nav button bar (`crea_botons`,
  `add_back`), cookies, team metadata lookups, result colouring (`color_goles`), week/date
  helpers, loading spinner.
- **Team/club registry:** `equipos` and `clubs` are plain arrays hardcoded inline in
  `rfgf/index.html`. Team properties (`id`, `name`, `color`, `duracion_min`, optional
  `codgrupo`, `codcompeticion`, `rfef`, `tv`) are read via the `getEquipo*`/`isRFEF` helpers
  in `utils.js`. To add or change a team, edit that array — it is the single source of truth,
  and the sidenav menus are generated from it. `duracion_min` is the category's playing time
  **plus half-time**, in minutes (football: senior/juvenil 2×45+15 = 105, cadete 2×40+15 = 95,
  infantil 2×35+15 = 85; futsal entries follow their own category rules). It sizes the
  calendar events and the live-score window, and `getEquipoDuracion` falls back to 90. `favoritos_default` / `calendario_default`
  set the initial favourites.
- **`version_reducida`** (set `true` in `rfgf/index.html`) gates which nav buttons appear in
  `crea_botons` — the reduced version hides Resultados/Clasificación/Goleadores unless a
  `cod_competicion` is known.
- **RFEF vs futgal:** some teams play in RFEF competitions (`rfef: 1`); the `rfef` flag is
  threaded through `load_*` calls and added as `&rfef=1` to proxy requests, selecting a
  different upstream source. The two upstreams do **not** return the same fields, so check
  before assuming a payload shape:
  - **Clasificación** now arrives from both sources as a base64 `html` blob (the upstream
    table, decoded by `base64_decode` and appended together with the local `css/*.css`); the
    JSON `clasificacion` array that `show_clasificacion` also knows how to render comes back
    empty. The futgal HTML embeds the team crests (absolute `futgal.es` URLs); the RFEF one
    has no `<img>` at all — RFEF publishes no crests in this data (nor in `getresultados` /
    `getequipo`, where `url_img_*` / `escudo_equipo_*` come back empty), and there is no
    guessable crest URL pattern either. Leaving RFEF standings without badges is a deliberate
    decision: don't add a local crest registry or a placeholder icon to fill the gap.
  - The RFEF clasificación also comes with `competicion` and `grupo` **empty**. The name is
    cached from the pages that do get it (`getequipo` → `show_xornadas` / `show_portada_equipo`,
    `getresultados` → `show_resultados`) via `setNombreCompeticion` / `getNombreCompeticion`
    in `utils.js` (cookie `nombresCompeticion`, keyed `cod_competicion/cod_grupo`,
    URL-encoded JSON, capped at 20 entries). On a cold start straight into
    `#clasificacion/...` nothing is cached yet, so `cache_nombre_competicion` (in `index.js`)
    fetches `getresultados` just for the name before rendering. Keep the header line
    tolerant of empty values — don't print `Competición ()` when the group is missing.
- **Live scores:** after a jornada renders, `show_resultados` (and `show_xornadas`, per
  competition block, recomputing the `color_goles` background of the cell; and the team's
  portada, `show_portada_data`, for the "Xornada actual" match only — there the two goals sit in
  separate rows, so the score cells are drawn even with no goals yet and the candidate brings its
  own `pinta(g1, g2, minuto)`) collects the matches that may be
  in play (`en_xogo_agora`: kick-off to kick-off + `duracion_min` + 120 min, or a provisional
  score today) and `actualiza_directo` asks `?type=getdirecto` in the background (`directo.py`
  in `scripts_movil`, cached 90 s per page and shared by all users). RFEF teams send
  `&rfef=1&codcompeticion=&codgrupo=` and get the panels of `marcadores.rfef.es/pnfg/?accion=1`;
  RFGF teams send `&codgrupo=&jornada=` and get `NFG_CmpResultados_POR_Exe`, the fragment the
  futgal.es results page (`NPortada?CodPortada=1000154`) loads (POST in the browser, but it
  takes the same parameters by GET, which is all the Google proxy does). Matches are paired by
  team codes when both sides have them (futgal) and otherwise by accent-insensitive names
  (`normaliza_nome`), then painted in `.marcador_directo` (violet) with the minute. All three views
  render into `#results`, so they share one render counter (`xeracion_directo`) and a late
  answer for a page the user already left is dropped. In xornadas only the current jornada
  can be in play, so each competition makes a single request with that match's `jornada`. The RFEF
  panels cover futsal and football from Primera Federación down, **not LaLiga Primera**
  (Deportivo / Celta get no live score). `rfef.es/es/resultados` was ruled out: Cloudflare
  JS challenge, even through the Google proxy.
  The futgal fragment only varies by `CodGrupo` and `CodJornada`: `IdCelda=10001540103` is the
  results page's cell and stays the same for every group (checked with Jogafan senior and
  juvenil, Oroso Juvenil and Ordes Cadete, futsal and football alike); without `CodJornada`
  futgal returns the current jornada, but the web always sends the one on screen. The group
  comes from what `getresultados` returns (`codigo_grupo`), which in turn comes from the team
  page (`getequipo`) when `equipos` has no `codgrupo`. Some futgal groups come back from
  `getresultados` without team codes, so the name fallback is not just for RFEF — names from
  the two futgal pages match exactly.
- `rfgf/data/` and `rfgf/samples/` hold captured HTML/JSON fixtures of upstream responses,
  useful for understanding payload shapes when working offline.

### State conventions

State lives entirely in cookies (no localStorage, no server session). Helpers are duplicated
in `index.js` and `rfgf/utils.js`: `setCookie`/`getCookie`/`eraseCookie`, plus array-valued
cookies in the RFGF app via `getCookieArray`/`setArrayCookie` (used for `favoritosItems` and
`calendarioItems`) and the competition-name cache in `nombresCompeticion` (see RFEF vs futgal
above; its JSON is URL-encoded because the names carry accents and spaces). `sanitizeEquiposCookies` / `pruneCookieItemsByEquipos` strip codes from
those cookies that no longer match a team in the `equipos` array — call after changing the
team list to clean stale selections.

### Conventions to match

- Rendering is string-concatenation of HTML appended via jQuery (`.append`, `.html`,
  `.innerHTML`); there is no templating or DOM-building abstraction. Match the surrounding
  style.
- Functions are global (no modules/imports); files share a flat global namespace.
- Known bad upstream data is patched inline at the render site (see the hardcoded score fix in
  `rfgf/index.js show_xornadas`) — follow that pattern with a logged comment when correcting a
  specific upstream error.
