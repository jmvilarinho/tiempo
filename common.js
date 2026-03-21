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