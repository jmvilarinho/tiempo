/* =========================
   GEO HELPERS (compartidos por farmacia.cofc.js, farmacia.cofpo.js, fuelprices.js)
========================= */

// Haversine formula to compute distance in km
function distance(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Ubicación actual. En Android o fix de GPS pode tardar decenas de segundos (moito máis
// dos 5s que se pedían antes), e navigator.geolocation.getCurrentPosition() sen timeout
// pode non chamar nunca aos callbacks. Por iso:
//   1) primeiro intento rápido de baixa precisión, aceptando unha posición cacheada,
//   2) se falla (agás permiso denegado) reintento con GPS e timeout longo,
//   3) o resultado gárdase e as peticións simultáneas compárten a mesma promesa, para non
//      lanzar unha petición de GPS por cada widget (farmacias, gasolineiras, temperatura).
const GEO_CACHE_MS = 5 * 60 * 1000;    // reutiliza un fix recente sen volver preguntar
const GEO_FAST_TIMEOUT_MS = 8000;      // 1º intento: rede/wifi
const GEO_GPS_TIMEOUT_MS = 30000;      // 2º intento: GPS (Android tarda en fixar)
const GEO_ERROR_CACHE_MS = 60 * 1000;  // tras un fallo, non repetir a espera decontado

let _geoLastPosition = null;           // { latitude, longitude, accuracy, receivedAt }
let _geoLastError = null;              // { message, receivedAt }
let _geoPending = null;                // petición en curso compartida

function _geoRequest(options) {
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
            (position) => resolve({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy
            }),
            reject,
            options
        );
    });
}

async function _geoLocate() {
    try {
        return await _geoRequest({
            enableHighAccuracy: false,
            timeout: GEO_FAST_TIMEOUT_MS,
            maximumAge: GEO_CACHE_MS
        });
    } catch (error) {
        // PERMISSION_DENIED (1): reintentar non serve de nada.
        if (error && error.code === 1) throw error;
        console.warn("Geolocation (rápida) fallou, probando con GPS:", error && error.message);
    }

    return await _geoRequest({
        enableHighAccuracy: true,
        timeout: GEO_GPS_TIMEOUT_MS,
        maximumAge: 0
    });
}

function getSafeLocation() {
    // Os chamadores detectan o fallo con latitude === 0 && longitude === 0.
    const failed = (message) => ({ latitude: 0, longitude: 0, ok: false, error: message });

    try {
        if (!navigator.geolocation) {
            return Promise.resolve(failed("Xeolocalización non soportada"));
        }

        // Chrome en Android só permite xeolocalización en contexto seguro (https/localhost).
        if (window.isSecureContext === false) {
            console.warn("Geolocation require HTTPS");
            return Promise.resolve(failed("A xeolocalización require HTTPS"));
        }

        if (_geoLastPosition && (Date.now() - _geoLastPosition.receivedAt) < GEO_CACHE_MS) {
            return Promise.resolve({
                latitude: _geoLastPosition.latitude,
                longitude: _geoLastPosition.longitude,
                accuracy: _geoLastPosition.accuracy,
                ok: true
            });
        }

        // Se acaba de fallar (p.ex. timeout de 30s de GPS), non facer esperar de novo
        // a cada widget que pida a ubicación.
        if (_geoLastError && (Date.now() - _geoLastError.receivedAt) < GEO_ERROR_CACHE_MS) {
            return Promise.resolve(failed(_geoLastError.message));
        }

        if (!_geoPending) {
            _geoPending = _geoLocate()
                .then((pos) => {
                    _geoLastError = null;
                    _geoLastPosition = {
                        latitude: pos.latitude,
                        longitude: pos.longitude,
                        accuracy: pos.accuracy,
                        receivedAt: Date.now()
                    };
                    return { latitude: pos.latitude, longitude: pos.longitude, accuracy: pos.accuracy, ok: true };
                })
                .catch((error) => {
                    console.warn("Geolocation error:", error && (error.message || error.code));
                    const message = (error && error.message) ? error.message : "Erro de xeolocalización";
                    _geoLastError = { message: message, receivedAt: Date.now() };
                    return failed(message);
                })
                .finally(() => { _geoPending = null; });
        }

        return _geoPending;

    } catch (error) {
        console.warn("Error getting location: ", error.message);
        return Promise.resolve(failed(error.message));
    }
}

// Esquece o fix (e o fallo) gardados para que a seguinte chamada pida a posición de novo
// (úsase ao reintentar manualmente despois de conceder o permiso).
function geoResetCache() {
    _geoLastPosition = null;
    _geoLastError = null;
}

function detectPlatform() {
    return {
        isAndroid: /Android/i.test(navigator.userAgent),
        isiOS: /iPhone|iPad|iPod/i.test(navigator.userAgent)
    };
}

function safePrevent(event) {
    if (event) event.preventDefault();
}

/* =========================
   GOOGLE / SYSTEM MAPS
========================= */

function openMaps(event, lat, lng) {
    safePrevent(event);

    const { isAndroid, isiOS } = detectPlatform();
    const coords = `${lat},${lng}`;

    if (isAndroid) {
        // Native Android maps (best UX)
        window.location.href = `geo:${coords}?q=${coords}`;
    } else if (isiOS) {
        // Apple Maps
        window.location.href = `https://maps.apple.com/?q=${coords}`;
    } else {
        // Desktop
        window.open(`https://www.google.com/maps?q=${coords}`, "_blank");
    }
}

function openMapsSearch(event, query) {
    safePrevent(event);

    const { isAndroid, isiOS } = detectPlatform();
    const q = encodeURIComponent(query);

    if (isAndroid) {
        window.location.href = `geo:0,0?q=${q}`;
    } else if (isiOS) {
        window.location.href = `https://maps.apple.com/?q=${q}`;
    } else {
        window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, "_blank");
    }
}

/* =========================
   WAZE
========================= */

function openWaze(event, lat, lng) {
    safePrevent(event);

    const { isAndroid, isiOS } = detectPlatform();
    const coords = `${lat},${lng}`;

    if (isAndroid) {
        // Try app first
        window.location.href = `waze://?ll=${coords}&navigate=yes`;

        // Fallback if app not installed
        setTimeout(() => {
            window.location.href = `https://waze.com/ul?ll=${coords}&navigate=yes`;
        }, 1200);

    } else if (isiOS) {
        // Better: use Waze web instead of Apple Maps (more consistent)
        window.location.href = `https://waze.com/ul?ll=${coords}&navigate=yes`;

    } else {
        window.open(`https://waze.com/ul?ll=${coords}&navigate=yes`, "_blank");
    }
}

function openWazeSearch(event, query, navigate = true) {
    safePrevent(event);

    const { isAndroid, isiOS } = detectPlatform();
    const q = encodeURIComponent(query);
    const nav = navigate ? "yes" : "no";

    if (isAndroid) {
        window.location.href = `waze://?q=${q}&navigate=${nav}`;

        setTimeout(() => {
            window.location.href = `https://waze.com/ul?q=${q}&navigate=${nav}`;
        }, 1200);

    } else if (isiOS) {
        window.location.href = `https://waze.com/ul?q=${q}&navigate=${nav}`;

    } else {
        window.open(`https://waze.com/ul?q=${q}&navigate=${nav}`, "_blank");
    }
}