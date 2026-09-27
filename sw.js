/* Service worker compartido polas dúas apps (raíz e rfgf/).
 *
 * Vive na raíz, así que o seu ámbito (/tiempo/) cobre as dúas: abonda con
 * rexistralo unha vez desde calquera das dúas páxinas (faino pwa.js).
 *
 * NON hai lista de ficheiros precacheados a propósito: habería que mantela en
 * sincronía cos `?nocache=` de cada HTML. En vez diso cáchease o que se vai
 * pedindo, e como as versións viaxan na URL (`index.js?nocache=40`), un bump
 * de nocache é unha URL nova => fallo de caché => rede. Custo: a primeira
 * visita necesita rede; a partir de aí a app abre sen conexión (sen datos).
 *
 * Estratexias:
 *   - Documentos (navegacións e os fragmentos .html cargados con $.load):
 *     rede primeiro, caché como reserva. Así un deploy vese de inmediato.
 *   - Resto de estáticos (js, css, fontes, imaxes propias): stale-while-
 *     revalidate, serve da caché e actualiza por detrás.
 *   - Todo o demais (as chamadas ás APIs e aos proxies, os .m3u8/.ts dos
 *     vídeos, as fotos das webcams): non se toca, pasa directo á rede. Cachear
 *     datos en vivo sería peor que non ter caché ningunha.
 */

const VERSION = 'v1';
const CACHE = 'tiempo-' + VERSION;

self.addEventListener('install', (event) => {
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		const nomes = await caches.keys();
		await Promise.all(nomes.map((n) => (n !== CACHE ? caches.delete(n) : null)));
		await self.clients.claim();
	})());
});

// Estáticos que paga a pena gardar. Ollo: as imaxes só as propias (iconas do
// tempo, frechas...); as das webcams son doutros dominios e cambian cada pouco.
function eStatico(request, mesmaOrixe) {
	const d = request.destination;
	if (d === 'script' || d === 'style' || d === 'font') return true;
	return mesmaOrixe && d === 'image';
}

function eDocumento(request, url, mesmaOrixe) {
	if (request.mode === 'navigate') return true;
	// praias.html / poboacions.html chegan como XHR ($.load), sen destination.
	return mesmaOrixe && url.pathname.endsWith('.html');
}

async function redePrimeiro(request) {
	const cache = await caches.open(CACHE);
	try {
		const resposta = await fetch(request);
		if (resposta && resposta.ok) cache.put(request, resposta.clone());
		return resposta;
	} catch (e) {
		const gardada = await cache.match(request);
		if (gardada) return gardada;
		throw e;
	}
}

async function caducaEActualiza(request) {
	const cache = await caches.open(CACHE);
	const gardada = await cache.match(request);
	const rede = fetch(request).then((resposta) => {
		// As respostas opacas (CDNs sen CORS) tamén valen para volver pintar a
		// páxina sen conexión, pero non se poden inspeccionar: gárdanse tal cal.
		if (resposta && (resposta.ok || resposta.type === 'opaque')) {
			cache.put(request, resposta.clone());
		}
		return resposta;
	}).catch(() => null);
	return gardada || rede.then((r) => r || Promise.reject(new Error('sen rede')));
}

self.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;

	let url;
	try {
		url = new URL(request.url);
	} catch (e) {
		return;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

	const mesmaOrixe = url.origin === self.location.origin;

	if (eDocumento(request, url, mesmaOrixe)) {
		event.respondWith(redePrimeiro(request));
	} else if (eStatico(request, mesmaOrixe)) {
		event.respondWith(caducaEActualiza(request));
	}
	// senón: sen respondWith, vai directo á rede.
});
