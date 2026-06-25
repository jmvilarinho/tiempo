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
  `index.js`), tides from `ideihm.covam.es`, current temperature from `api.open-meteo.com`.
- RFGF app — a single `remote_url` API Gateway endpoint (set in `rfgf/index.html`) called as
  `remote_url + "?type=<action>&..."`, returning JSON with a common envelope handled by
  `show_error(data)` in `rfgf/utils.js` (`is_ok`, `source`, `timestamp`, `data`).

When changing data sources, update these constants rather than scattering URLs.

### Root app structure

- `index.html` loads `common.js`, `index.js`, `farmacia.fuel.js`, `poboacions.js`.
- The view toggles between two fragments, `praias.html` and `poboacions.html`, loaded into
  `#DivContent` via jQuery `$.load()`. `CambiaVistaUpdate(pagina)` in `index.js` drives this
  and persists the choice in the `pagina` cookie. The `RFGF` button navigates to `rfgf/`.
- `index.js` holds the bulk of weather logic: forecast rendering (`getPrevision` →
  `createPrevision`), tides (`getMareas`), geolocated current temperature
  (`geoFindMe` → `getTemperatura`), HLS webcam playback (`showVideo`, using `hls.light.min.js`).
- `common.js` is shared with the RFGF app: maps/Waze deep-links (`openMaps`, `openWaze`,
  platform detection in `detectPlatform`).
- AEMET forecast JSON is fetched as ISO-8859-1 and decoded manually (see `getPrevisionDatos`).
- Weather icons live in `img/` named by AEMET sky-state codes (e.g. `img/11_g.png`).

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
  different upstream source.
- `rfgf/data/` and `rfgf/samples/` hold captured HTML/JSON fixtures of upstream responses,
  useful for understanding payload shapes when working offline.

### State conventions

State lives entirely in cookies (no localStorage, no server session). Helpers are duplicated
in `index.js` and `rfgf/utils.js`: `setCookie`/`getCookie`/`eraseCookie`, plus array-valued
cookies in the RFGF app via `getCookieArray`/`setArrayCookie` (used for `favoritosItems` and
`calendarioItems`). `sanitizeEquiposCookies` / `pruneCookieItemsByEquipos` strip codes from
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
