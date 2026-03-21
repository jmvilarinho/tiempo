
function openMaps(lat, lng) {
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isAndroid) {
        // Opens directly in Maps app (no blank tab)
        window.location.href = `geo:${lat},${lng}?q=${lat},${lng}`;
    } else if (isiOS) {
        // Opens Apple Maps
        window.location.href = `https://maps.apple.com/?q=${lat},${lng}`;
    } else {
        // Desktop / Windows → open in new tab
        window.open(`https://www.google.com/maps?q=${lat},${lng}`, "_blank");
    }
}

function openMapsSearch(query,navigate = false) {
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isiOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

    const encodedQuery = encodeURIComponent(query);

    if (isAndroid) {
        // Opens directly in Maps app (no blank tab)
        window.location.href = `geo:0,0?q=${encodedQuery}`;
    } else if (isiOS) {
        // Apple Maps
        window.location.href = `https://maps.apple.com/?q=${encodedQuery}`;
    } else {
        // Desktop / Windows
        window.open(`https://www.google.com/maps/search/?api=1&query=${encodedQuery}&navigate=${navigate}`, "_blank");
    }
}
