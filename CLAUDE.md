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

- Root app weather proxies — `proxyHost` (AEMET), `proxyHostFarmacia`, `proxyHostMeteosix`
  defined in `index.js`. Usage: `fetch(proxyHost + upstreamUrl)`.
- Fuel prices come straight from `sedeaplicaciones.minetur.gob.es` (`FUEL_PRICES_*` in
  `index.js`), Spanish tides from `ideihm.covam.es`, current temperature from `api.open-meteo.com`.
- Portugal beaches (e.g. Costa de Caparica) call IPMA directly (`api.ipma.pt`, CORS-enabled,
  no proxy) for the forecast. IPMA exposes no water temperature nor tides, and the Spanish IHM
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
  (cofpo.org, Pontevedra, direct CORS). Fuel prices (ES + PT) live in `fuelprices.js`.
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
  - `alternateMediaSimple(baseid, url1, label1, url2, label2, intervalSeconds, url1Alternative,
    url2Alternative)` is the one in use for the alternating blocks (Razo, Lapamán). Its markup is
    `#<key>-img` + `#<key>-video` + `#<key>-title`. **Either turn may be an HLS stream or a still
    image** — `esStreamHls` decides by the `.m3u8` extension — and each turn has its own fallback
    snapshot (`url1Alternative` / `url2Alternative`), shown in the shared `<img>` when its stream
    can't play (`validURL` precheck, fatal/denied `Hls.Events.ERROR`, native-HLS `error`) or when
    its own snapshot fails to load. When *both* turns are streams the function clones the `<video>`
    into `#<key>-video2` so neither stream has to be torn down on every switch, and calls
    `hls.stopLoad()` / `startLoad()` on the hidden one so only the visible stream downloads.
    It also injects a pause/resume toggle (`#<key>-toggle`, icons `img/pausa.svg` /
    `img/continuar.svg`) right after `#<key>-title`, which only starts/stops the rotation timer —
    the stream on screen keeps playing. It is an `<img>` with `preventDefault`/`stopPropagation`
    because the title usually sits inside the `<a>` to the camera's site.
  - Perbes (`Mino` key in `praias.html`) is the reference case of a camera whose element is an
    `<img>`, not a `<video>`: its camaramar stream is token-locked, so `showVideo` short-circuits
    to the public snapshot.
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
  and the sidenav menus are generated from it. `favoritos_default` / `calendario_default`
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
