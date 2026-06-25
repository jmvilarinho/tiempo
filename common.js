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

function getSafeLocation() {
    try {
        return new Promise((resolve) => {
            if (!navigator.geolocation) {
                // Geolocation not supported
                resolve({ latitude: 0, longitude: 0 });
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    resolve({
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude
                    });
                },
                (error) => {
                    // Permission denied or other error
                    console.warn("Geolocation error:", error.message);
                    resolve({ latitude: 0, longitude: 0 });
                },
                { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
            );
        });

    } catch (error) {
        console.warn("Error getting location: ", error.message);
        return Promise.resolve({ latitude: 0, longitude: 0 });
    }
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