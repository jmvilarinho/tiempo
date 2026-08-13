
// https://www.camaramar.com/webcam/9/stream-url
// https://www.camaramar.com/webcam/galicia_pontevedra_lanzada

//  <video
// id="webcam-video-9"
// poster="https://www.camaramar.com/uploads/webcam/753e6314-6cee-4ae2-aabc-623c248b1613.webp"
// muted autoplay playsinline webkit-playsinline preload="auto"
// class="video-js vjs-default-skin w-full h-full js-webcam-player"
// disablePictureInPicture
// data-player-id="webcam-video-9"
// data-stream-src="https://622a10e8864f7.streamlock.net/live/68_lanzada.stream/playlist.m3u8?jdtcbrndmrdstarttime=1786431073&jdtcbrndmrdendtime=1786432883&jdtcbrndmrdhash=y3E9rp-BJVy8oCq7AxMa04YYviNaHscMT6kicTrp_VE%3D"
// data-stream-expires-at="1786432883"
// data-stream-refresh-at="1786432583"
// data-stream-refresh-url="/webcam/9/stream-url"
// data-controls="1" data-loop="0"
// data-muted="1" data-webcam-id="9" data-telemetry-endpoint="/api/log/video-player" data-telemetry-sample-rate="1" data-telemetry-retry-ms-1="300" data-telemetry-retry-ms-2="1000" data-user-id="15847" data-user-type="freemium"></video>

//<video id="webcam-video-11" poster="https://www.camaramar.com/uploads/webcam/c914b0e1-5e2d-41cf-8c34-1f110a27c7c5.webp" muted autoplay playsinline webkit-playsinline preload="auto" class="video-js vjs-default-skin w-full h-full js-webcam-player" disablePictureInPicture data-player-id="webcam-video-11" data-stream-src="https://622a10e8864f7.streamlock.net/live/5_razo.stream/playlist.m3u8?jdtcbrndmrdstarttime=1786441069&amp;jdtcbrndmrdendtime=1786442879&amp;jdtcbrndmrdhash=LhRQwMK1lqADv56iA12yfJpbKJO1Ur0bSE3fOBTx-j8%3D" data-stream-expires-at="1786442879" data-stream-refresh-at="1786442579" data-stream-refresh-url="/webcam/11/stream-url" data-controls="1" data-loop="0" data-muted="1" data-webcam-id="11" data-telemetry-endpoint="/api/log/video-player" data-telemetry-sample-rate="1" data-telemetry-retry-ms-1="300" data-telemetry-retry-ms-2="1000" data-user-id="15847" data-user-type="freemium"></video>
//<video id="webcam-video-96" poster="https://www.camaramar.com/uploads/webcam/79d5d078-3b54-4bd6-b842-111acb0ecc20.webp" muted autoplay playsinline webkit-playsinline preload="auto" class="video-js vjs-default-skin w-full h-full js-webcam-player" disablePictureInPicture data-player-id="webcam-video-96" data-stream-src="https://622a10e8864f7.streamlock.net/live/61_perbes.stream/playlist.m3u8?jdtcbrndmrdstarttime=1786441681&amp;jdtcbrndmrdendtime=1786443491&amp;jdtcbrndmrdhash=-Qu31ce9yKWXADBTHxP4QRVHNB-ory1ekVXrpSeyPRI%3D" data-stream-expires-at="1786443491" data-stream-refresh-at="1786443191" data-stream-refresh-url="/webcam/96/stream-url" data-controls="1" data-loop="0" data-muted="1" data-webcam-id="96" data-telemetry-endpoint="/api/log/video-player" data-telemetry-sample-rate="1" data-telemetry-retry-ms-1="300" data-telemetry-retry-ms-2="1000" data-user-id="15847" data-user-type="freemium"></video>

var url_to_id = {
    "https://622a10e8864f7.streamlock.net/camaramar/68_lanzada.stream/playlist.m3u8": 9,
    "https://622a10e8864f7.streamlock.net/live/68_lanzada.stream/playlist.m3u8": 9,

    "https://622a10e8864f7.streamlock.net/live/5_razo.stream/playlist.m3u8": 11,
    "https://622a10e8864f7.streamlock.net/camaramar/5_razo.stream/playlist.m3u8": 11,

    "https://622a10e8864f7.streamlock.net/live/2_razo_art.stream/playlist.m3u8": 1034,
    "https://622a10e8864f7.streamlock.net/camaramar/2_razo_art.stream/playlist.m3u8": 1034,

    "https://622a10e8864f7.streamlock.net/live/61_perbes.stream/playlist.m3u8": 96,
    "https://622a10e8864f7.streamlock.net/camaramar/61_perbes.stream/playlist.m3u8": 96,

    "https://622a10e8864f7.streamlock.net/live/31_coroso.stream/playlist.m3u8": 103,
    "https://622a10e8864f7.streamlock.net/camaramar/31_coroso.stream/playlist.m3u8": 103,

    "https://622a10e8864f7.streamlock.net/live/48_menduina.stream/playlist.m3u8"    : 78,
    "https://622a10e8864f7.streamlock.net/camaramar/48_menduina.stream/playlist.m3u8"    : 78,
};

// Minutos que se considera válido o valor gardado na cookie.
var CACHE_MINUTOS = 1;


function getWebcamIdFromUrl(url) {
    if (!(url in url_to_id)) {
        console.log(`getWebcamIdFromUrl(${url}) = ${url_to_id[url]} params=undefined`);
        return "";
    }

    var params = getValorCache("webcam-params", url_to_id[url]);
    if (!params) {
        params = "";
    }
    console.log(`getWebcamIdFromUrl(${url}) = ${url_to_id[url]} params=${params}`);
    if (params != "")
        params = "?" + params;
    return params;

}

// Devolve a query da URL do stream ("jdtcbrndmrdstarttime=...&jdtcbrndmrdendtime=...&jdtcbrndmrdhash=...")
// ou "" se falla. A resposta do endpoint é:
//{"url":"https:\/\/622a10e8864f7.streamlock.net\/live\/68_lanzada.stream\/playlist.m3u8?jdtcbrndmrdstarttime=1786433230&jdtcbrndmrdendtime=1786435040&jdtcbrndmrdhash=Ghdy_RttnPwTv6W0_Spmp9VYnso9APWhfdArAVq5py0%3D","expires_at":1786435040,"refresh_at":1786434740,"protected":true}
// Síncrona a propósito: bloquea ata ter a resposta, así os chamantes non precisan await.
// Ojo: un XHR síncrono no fío principal NON admite timeout (o navegador lanza
// InvalidAccessError ao asignalo), polo que os 3 s só se aplican de verdade dentro dun
// Worker. Póñense en try/catch para que no documento siga funcionando (aí manda o
// timeout de rede do navegador).
function getParams(id) {
    var urlstream = `https://www.camaramar.com/webcam/${id}/stream-url`;

    //{"datos_json": {"estado": 200, "content": {"url": "https://622a10e8864f7.streamlock.net/live/68_lanzada.stream/playlist.m3u8?jdtcbrndmrdstarttime=1786435014&jdtcbrndmrdendtime=1786436824&jdtcbrndmrdhash=IRbLB7qytNaOso9JikqLqrTN-OhZjQ63qxklth9xr1o%3D", "expires_at": 1786436824, "refresh_at": 1786436524, "protected": true}, "timestamp": 1786435024}, "source": "live data", "timestamp": 1786435024, "estado": 200, "statusCode": 200, "headers": {"Content-Type": "application/json"}}

    var url = proxyHostCamaramar + encodeURIComponent(urlstream);
    try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);   // false = síncrono
        try { xhr.timeout = 3000; } catch (e) { /* no documento non está permitido */ }
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.send(null);

        if (xhr.status < 200 || xhr.status >= 300) {
            console.log(`stream-url ${id} devolveu ${xhr.status}`);
            return "";
        }
        var data = JSON.parse(xhr.responseText);

        // O proxy envolve a resposta en datos_json.content; a chamada directa a
        // camaramar devolve o obxecto raso ({url, expires_at, refresh_at, protected}).
        var content = (data && data.datos_json && data.datos_json.content) ? data.datos_json.content : data;

        if (!content || typeof content.url !== 'string') {
            console.log(`stream-url ${id}: resposta sen url -> ${xhr.responseText}`);
            return "";
        }
        var q = content.url.indexOf('?');
        if (q < 0) {
            console.log(`stream-url ${id}: url sen parámetros -> ${content.url}`);
            return "";
        }
        return content.url.substring(q + 1);
    } catch (e) {
        console.log(`Erro pedindo stream-url ${id}: ${e}`);
        return "";
    }
}

// Query en forma de obxecto: getUrlParams(url).jdtcbrndmrdhash
function getUrlParams(url) {
    var params = {};
    var q = (url || "").indexOf('?');
    if (q < 0) {
        return params;
    }
    new URLSearchParams(url.substring(q + 1)).forEach(function (value, key) {
        params[key] = value;
    });
    return params;
}


// A cookie garda "valor|timestamp" (o valor URI-codificado, para non romper o
// formato da cookie cos & = % das URLs dos streams).
function setValorCache(name, value) {
    var payload = encodeURIComponent(value || "") + "|" + Date.now();
    var date = new Date();
    date.setTime(date.getTime() + (24 * 60 * 60 * 1000));
    document.cookie = name + "=" + payload + "; expires=" + date.toUTCString() + "; path=/";
}

// Devolve o valor gardado se ten menos de CACHE_MINUTOS; se caducou reescribe a
// cookie con "nada" e devolve "nada". Se non existe devolve null.
function getValorCache(name, id) {
    name = name + "-" + id;

    var nameEQ = name + "=";
    var ca = document.cookie.split(';');
    var found = false;
    for (var i = 0; i < ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0) == ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) != 0) continue;

        var payload = c.substring(nameEQ.length, c.length);
        var sep = payload.lastIndexOf('|');
        if (sep < 0) {
            // Cookie en formato antigo/corrupto: trátase como caducada.
            var param = getParams(id);
            setValorCache(name, param);
            return param;
        }

        var valor = decodeURIComponent(payload.substring(0, sep));
        var timestamp = parseInt(payload.substring(sep + 1), 10);
        var idade = Date.now() - timestamp;

        if (isNaN(timestamp) || idade > CACHE_MINUTOS * 60 * 1000) {
            var param = getParams(id);
            setValorCache(name, param);
            return param;
        }
        return valor;
    }
    if (!found) {
        var param = getParams(id);
        setValorCache(name, param);
        return param;
    }
}



