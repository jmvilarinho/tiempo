// Correccións empíricas (minutos) para as horas de marea de Open-Meteo.
// O modelo é horario e mar adentro, polo que adianta os extremos respecto
// ás táboas oficiais. Preamar e baixamar teñen desfases distintos.
const MAREAS_CAPARICA_OFFSET_PREAMAR_MIN = 68;
const MAREAS_CAPARICA_OFFSET_BAIXAMAR_MIN = 56;

function isValidColor(strColor) {
	const s = new Option().style;
	s.color = strColor;
	return s.color !== '';
}


function setAncho(video) {
	const params = new URLSearchParams(window.location.search);
	const width = params.get('w');
	if (width) {
		video.style.width = `${width}px`;
	}
}
function getAncho() {
	const params = new URLSearchParams(window.location.search);
	const width = params.get('w');
	if (width) {
		return `${width}px`;
	} else {
		return '100%';
	}
}

function CambiaVista(e) {
	if (pagina == 'praias') {
		pagina = 'poboacions'
	} else {
		pagina = 'praias'
	}
	CambiaVistaUpdate(pagina);
	e.preventDefault();
	return false;
};

function openInNewTab(url) {
	window.open(url, '_blank').focus();
}

function openUrl(url) {
	const queryString = window.location.search.substring(1);
	if (queryString) {
		url += '?' + queryString;
	}
	window.open(url, '_self').focus();
}
function CambiaVistaUpdate(pagina) {
	if (!pagina || !(pagina == 'praias' || pagina == 'poboacions')) {
		pagina = 'praias'
	}


	geoFindMe("yourTemperature");

	contenido = pagina + '.html'
	console.log('Cargando página: ' + contenido)
	setCookie('pagina', pagina, 30);

	$(function () {
		$("#DivContent").load(contenido);
	});
	$("#OtherPage").html('');

	document.getElementById("data_prevision").innerHTML = ""
	document.getElementById("data_prevision_municipio").innerHTML = ""
	document.getElementById("data_mareas").innerHTML = ""


	var boton_favoritos = $('<input/>').attr({
		type: "button",
		class: (pagina == 'praias') ? 'none' : "back_button",
		id: "field",
		value: 'Praias',
		onclick: "CambiaVistaUpdate('praias')"
	});
	$('#OtherPage').append(boton_favoritos);

	var boton_favoritos = $('<input/>').attr({
		type: "button",
		class: (pagina == 'poboacions') ? 'none' : "back_button",
		id: "field",
		value: 'Poboacions',
		onclick: "CambiaVistaUpdate('poboacions')"
	});
	$('#OtherPage').append(boton_favoritos);

	var boton_meteogalicia = $('<input/>').attr({
		type: "button",
		class: 'back_button',
		id: "field",
		value: 'Meteogalicia',
		onclick: "openInNewTab(meteogalcia_url)"
	});
	$('#OtherPage').append(boton_meteogalicia);

	var boton_rfgf = $('<input/>').attr({
		type: "button",
		class: 'back_button',
		id: "field",
		value: 'RFGF',
		onclick: "openUrl('rfgf/')"
	});
	$('#OtherPage').append(boton_rfgf);

};

function includeHTML(file) {
	var i, elmnt, file, xhttp;
	/*loop through a collection of all HTML elements:*/
	elmnt = document.getElementById("bodyPage");

	/*search for elements with a certain atrribute:*/
	if (file) {
		/*make an HTTP request using the attribute value as the file name:*/
		xhttp = new XMLHttpRequest();
		xhttp.onreadystatechange = function () {
			if (this.readyState == 4) {
				if (this.status == 200) { elmnt.innerHTML = this.responseText; }
				if (this.status == 404) { elmnt.innerHTML = "Page not found."; }
			}
		}
		xhttp.open("GET", file, true);
		xhttp.send();
		/*exit the function:*/
		return;
	}

};

function setCookie(name, value, days) {
	var expires = "";
	if (days) {
		var date = new Date();
		date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
		expires = "; expires=" + date.toUTCString();
	}
	document.cookie = name + "=" + (value || "") + expires + "; path=/";
}
function getCookie(name) {
	var nameEQ = name + "=";
	var ca = document.cookie.split(';');
	for (var i = 0; i < ca.length; i++) {
		var c = ca[i];
		while (c.charAt(0) == ' ') c = c.substring(1, c.length);
		if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
	}
	return null;
}
function eraseCookie(name) {
	document.cookie = name + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
}

function aplanaTexto(texto) {
	if (texto === null)
		return ''
	else
		return texto.toLowerCase().replace(/ /g, "-").replace(/ñ/g, "n").replace(/á/g, "a").replace(/é/g, "e").replace(/í/g, "i").replace(/ó/g, "o").replace(/ú/g, "u").replace(/,/g, "")
}

// O proxy de AEMET devolve os campos literais (os que non veñen escapados no JSON, como
// "nombre" e "provincia") con dobre codificación: bytes UTF-8 lidos como ISO-8859-1.
// Asi, no JSON do proxy 'Marin' chega como "Mar\u00c3\u00adn" e 'Coruna' como "Coru\u00c3\u00b1a".
// Isto desfai ese mojibake volvendo aos bytes orixinais e decodificándoos como UTF-8.
// Só actúa cando se detecta a secuencia característica (Ã/Â seguido dun byte de
// continuación) e cando os bytes resultantes son UTF-8 válido, polo que os textos que xa
// veñen ben (a ruta que le 'datos' directamente en ISO-8859-1) quedan intactos.
function corrixeCodificacion(texto) {
	if (typeof texto !== 'string' || !/[\u00c2-\u00c3][\u0080-\u00bf]/.test(texto)) {
		return texto;
	}

	const bytes = new Uint8Array(texto.length);
	for (var i = 0; i < texto.length; i++) {
		const code = texto.charCodeAt(i);
		if (code > 0xff) {
			return texto; // ten caracteres fóra de Latin-1: non é mojibake
		}
		bytes[i] = code;
	}

	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch (error) {
		console.warn('Non se puido corrixir a codificación de: ' + texto);
		return texto;
	}
}

// --------------------------------------------------------------------------------------------------
// Builds the URL of the latest archived webcam image on
// meteo-estaticos.xunta.gal for a given camera (e.g. "Aguete2").
// The archive publishes one image every 5 minutes, named:
//   <Cam>_YYYYMMDD_HHMM.jpg
// Times are in Europe/Madrid local time. We round down to the
// nearest 5-min slot and step back `offsetMinutes` to make sure
// the file has already been published.
function getUltimaXuntaCam(camName, offsetMinutes = 10) {
	return `https://meteo-estaticos.xunta.gal/datosred/camaras/MeteoGalicia/${camName}/ultima.jpg`;

	//no necesario
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Europe/Madrid',
		year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', hour12: false
	}).formatToParts(new Date()).reduce((o, p) => (o[p.type] = p.value, o), {});

	let d = new Date(Date.UTC(
		+parts.year, +parts.month - 1, +parts.day,
		+parts.hour, +parts.minute
	));
	d = new Date(d.getTime() - offsetMinutes * 60000);
	d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 5) * 5);

	const pad = n => String(n).padStart(2, '0');
	const ymd = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
	const hm = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`;
	return `https://meteo-estaticos.xunta.gal/datosred/camaras/MeteoGalicia/${camName}/000_dias/${camName}_${ymd}_${hm}.jpg`;
}

async function validURL(url) {
	result = await fetch(url, {
	})
		.then(response => {
			if (response.ok) {
				return true;
			}
			return false;
		})
		.catch(error => {
			console.error('Error:', error);
			return false;
		});

	return result;
}

function showAlternative(videoid, alternative, alternativeurl) {
	var alternativeObj = document.getElementById(videoid + "-alternative");
	alternativeObj.innerHTML = '<a href="#' + videoid + '"><p>' + alternative + '</p></a>';

	var ms = new Date().getTime();
	const keyDiv = document.createElement('div');
	var width = getAncho();
	keyDiv.innerHTML = '<img  id="' + videoid + '-alternative" width="680px" style="width: ' + width + '; height: auto; max-width: 1300px;" src="' + alternativeurl + '?nocache=' + ms + '">';

	var imageObj = document.getElementById(videoid + "-unavailable");
	imageObj.innerHTML = '';
	imageObj.appendChild(keyDiv);
}

function showOnlyAlternative(videoid, alternative, alternativeurl) {
	var video = document.getElementById(videoid);
	var image = document.getElementById(videoid + "-unavailable");

	image.style.visibility = "visible";
	video.remove();

	showAlternative(videoid, alternative, alternativeurl);
}

async function showVideo(url, videoid, alternative = '', alternativeurl = '', fallbackurl = '') {
	var video = document.getElementById(videoid);
	var image = document.getElementById(videoid + "-unavailable");
	let urlToUse = url;

	let exists = await validURL(url);
	if (!exists && fallbackurl) {
		urlToUse = fallbackurl;
		exists = await validURL(fallbackurl);
	}

	if (!exists) {
		image.style.visibility = "visible";
		video.remove();
		if (alternative != '') {
			showAlternative(videoid, alternative, alternativeurl);
		}

	} else {
		video.style.visibility = "visible";
		image.remove();
		if (Hls.isSupported()) {
			var hls = new Hls({
				debug: false,
			});
			hls.loadSource(urlToUse);
			hls.attachMedia(video);
			hls.on(Hls.Events.MEDIA_ATTACHED, function () {
				video.muted = true;
				video.play();
			});
		}
		// hls.js is not supported on platforms that do not have Media Source Extensions (MSE) enabled.
		// When the browser has built-in HLS support (check using `canPlayType`), we can provide an HLS manifest (i.e. .m3u8 URL) directly to the video element through the `src` property.
		// This is using the built-in support of the plain video element, without using hls.js.
		else if (video.canPlayType('application/vnd.apple.mpegurl')) {
			video.src = urlToUse;
			video.addEventListener('canplay', function () {
				video.play();
			});
		}
		setAncho(video);
	}
}

function alternateMediaSimple(baseid, urlImage, labelImage, urlVideo, labelVideo, intervalSeconds = 5) {
	const img = document.getElementById(baseid + '-img');
	const video = document.getElementById(baseid + '-video');
	const title = document.getElementById(baseid + '-title');
	const unavailable = document.getElementById(baseid + '-unavailable');

	if (!img || !video || !title) {
		console.error('Missing elements for alternateMediaSimple: ' + baseid);
		return;
	}

	let showingImage = true;
	let intervalId = null;
	let hlsInstance = null;

	const params = new URLSearchParams(window.location.search);
	const width = params.get('w');

	img.style.margin = '0 auto';
	img.style.display = 'block';
	video.style.margin = '0 auto';
	video.style.display = 'block';

	if (width) {
		img.style.width = width + 'px';
		img.style.maxWidth = width + 'px';
		video.style.width = width + 'px';
		video.style.maxWidth = width + 'px';
	}

	img.src = urlImage + '?nocache=' + Date.now();

	if (unavailable) {
		unavailable.style.display = 'none';
	}

	if (Hls.isSupported()) {
		hlsInstance = new Hls({ debug: false });
		hlsInstance.loadSource(urlVideo);
		hlsInstance.attachMedia(video);
	} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
		video.src = urlVideo;
	}

	function toggle() {
		try {
			if (showingImage) {
				img.style.display = 'none';
				video.style.display = 'block';
				video.muted = true;
				video.play().catch(e => console.log('Play error:', e));
				title.textContent = labelVideo;
				showingImage = false;
			} else {
				video.style.display = 'none';
				img.style.display = 'block';
				video.pause();
				title.textContent = labelImage;
				showingImage = true;
			}
		} catch (e) {
			console.error('Error in toggle:', e);
		}
	}

	function start() {
		if (intervalId) {
			clearInterval(intervalId);
		}
		intervalId = setInterval(() => {
			toggle();
		}, intervalSeconds * 1000);
	}

	start();
}

function showAlternatingOverlay(baseid, urlImage, labelImage, urlVideo, labelVideo, intervalSeconds = 5) {
	let currentMedia = 'image';
	let hlsInstance = null;
	let intervalId = null;
	let isPlaying = true;

	const params = new URLSearchParams(window.location.search);
	const width = params.get('w');

	const img = document.getElementById(baseid + '-img');
	const video = document.getElementById(baseid + '-video');
	const titleDiv = document.getElementById(baseid + '-title');
	const wrapper = document.getElementById(baseid + '-wrapper');

	if (!img || !video || !wrapper) {
		console.error('Missing required elements for: ' + baseid);
		return;
	}

	function applyWidth() {
		if (width) {
			wrapper.style.width = width + 'px';
			img.style.width = width + 'px';
			video.style.width = width + 'px';
		}
	}

	async function loadImage() {
		console.log('Loading image: ' + labelImage);
		const urlValid = await validURL(urlImage);
		if (!urlValid) {
			console.log('Image unavailable: ' + labelImage);
			return false;
		}
		img.src = urlImage + '?nocache=' + Date.now();
		return true;
	}

	async function loadVideo() {
		console.log('Loading video: ' + labelVideo);
		const urlValid = await validURL(urlVideo);
		if (!urlValid) {
			console.log('Video unavailable: ' + labelVideo);
			return false;
		}

		if (Hls.isSupported()) {
			if (hlsInstance) {
				hlsInstance.destroy();
			}
			hlsInstance = new Hls({ debug: false });
			hlsInstance.loadSource(urlVideo);
			hlsInstance.attachMedia(video);
		} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
			video.src = urlVideo;
		}
		return true;
	}

	function showImage() {
		console.log('Showing image: ' + labelImage);
		img.style.display = 'block';
		video.style.display = 'none';
		currentMedia = 'image';
		if (titleDiv) titleDiv.textContent = labelImage;
	}

	function showVideo() {
		console.log('Showing video: ' + labelVideo);
		img.style.display = 'none';
		video.style.display = 'block';
		video.muted = true;
		if (isPlaying) {
			video.play().catch(err => console.log('Play error:', err));
		}
		currentMedia = 'video';
		if (titleDiv) titleDiv.textContent = labelVideo;
	}

	function switchMedia() {
		if (currentMedia === 'image') {
			showVideo();
		} else {
			showImage();
		}
	}

	async function init() {
		console.log('Initializing alternating overlay: ' + baseid);
		applyWidth();
		await loadImage();
		await loadVideo();
		showImage();

		intervalId = setInterval(() => {
			if (isPlaying) {
				switchMedia();
			}
		}, intervalSeconds * 1000);
	}

	function stop() {
		isPlaying = false;
		if (intervalId) {
			clearInterval(intervalId);
			intervalId = null;
		}
	}

	init();

	video.addEventListener('pause', stop);
	video.addEventListener('play', () => {
		isPlaying = true;
		if (!intervalId) {
			init();
		}
	});
}

function showAlternatingMediaSmooth(baseid, urlImage, labelImage, urlVideo, labelVideo, intervalSeconds = 3) {
	let currentMedia = 'image';
	let hlsInstance = null;
	let intervalId = null;
	let isPlaying = true;
	let isLoading = false;

	const params = new URLSearchParams(window.location.search);
	const width = params.get('w');

	const img = document.getElementById(baseid + '-img');
	const video = document.getElementById(baseid + '-video');
	const titleDiv = document.getElementById(baseid + '-title');
	const container = document.getElementById(baseid + '-container');

	if (!img || !video || !container) {
		console.error('Missing required elements for alternating media');
		return;
	}

	function applyWidth() {
		if (width) {
			img.style.width = width + 'px';
			img.style.maxWidth = width + 'px';
			video.style.width = width + 'px';
			video.style.maxWidth = width + 'px';
			container.style.width = width + 'px';
		}
	}

	async function showImage() {
		if (isLoading) return;
		isLoading = true;

		console.log('Switching to image: ' + labelImage);

		const urlValid = await validURL(urlImage);
		if (!urlValid) {
			console.log('Image unavailable: ' + labelImage);
			isLoading = false;
			return;
		}

		if (hlsInstance) {
			hlsInstance.destroy();
			hlsInstance = null;
		}

		img.src = urlImage + '?nocache=' + Date.now();
		img.style.opacity = '1';
		video.style.opacity = '0';
		currentMedia = 'image';
		updateTitle();
		isLoading = false;
	}

	async function showVideoStream() {
		if (isLoading) return;
		isLoading = true;

		console.log('Switching to video: ' + labelVideo);

		const urlValid = await validURL(urlVideo);
		if (!urlValid) {
			console.log('Video unavailable: ' + labelVideo);
			isLoading = false;
			return;
		}

		if (Hls.isSupported()) {
			if (hlsInstance) {
				hlsInstance.destroy();
			}
			hlsInstance = new Hls({ debug: false });
			hlsInstance.loadSource(urlVideo);
			hlsInstance.attachMedia(video);

			hlsInstance.once(Hls.Events.MEDIA_ATTACHED, function () {
				console.log('HLS loaded for: ' + labelVideo);
				video.muted = true;
				img.style.opacity = '0';
				video.style.opacity = '1';
				if (isPlaying) {
					video.play().catch(err => console.log('Play error:', err));
				}
				currentMedia = 'video';
				updateTitle();
				isLoading = false;
			});
		} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
			video.src = urlVideo;
			video.muted = true;
			img.style.opacity = '0';
			video.style.opacity = '1';
			if (isPlaying) {
				video.play().catch(err => console.log('Play error:', err));
			}
			currentMedia = 'video';
			updateTitle();
			isLoading = false;
		}
	}

	function updateTitle() {
		if (titleDiv) {
			titleDiv.textContent = currentMedia === 'image' ? labelImage : labelVideo;
		}
	}

	function switchMedia() {
		if (currentMedia === 'image') {
			showVideoStream();
		} else {
			showImage();
		}
	}

	function startAlternating() {
		console.log('Starting alternating media');
		isPlaying = true;
		applyWidth();
		showImage();

		intervalId = setInterval(() => {
			if (isPlaying && !isLoading) {
				switchMedia();
			}
		}, intervalSeconds * 1000);
	}

	function stopAlternating() {
		isPlaying = false;
		if (intervalId) {
			clearInterval(intervalId);
			intervalId = null;
		}
	}

	applyWidth();
	startAlternating();

	video.addEventListener('pause', stopAlternating);
	video.addEventListener('play', () => {
		isPlaying = true;
		if (!intervalId) {
			startAlternating();
		}
	});

	img.addEventListener('pause', stopAlternating);
	img.addEventListener('play', () => {
		isPlaying = true;
		if (!intervalId) {
			startAlternating();
		}
	});
}

function showAlternatingMedia(videoid, url1, type1, label1, url2, type2, label2, intervalSeconds = 3) {
	let currentStream = 0;
	const urls = [url1, url2];
	const types = [type1, type2];
	const labels = [label1, label2];
	let hlsInstance = null;
	let intervalId = null;
	let isPlaying = true;
	let isLoadingStream = false;

	const params = new URLSearchParams(window.location.search);
	const width = params.get('w');

	async function loadMedia(streamIndex) {
		if (isLoadingStream) {
			console.log('Already loading a stream, skipping');
			return;
		}

		isLoadingStream = true;
		const url = urls[streamIndex];
		const type = types[streamIndex];
		const video = document.getElementById(videoid);

		if (!video) {
			isLoadingStream = false;
			return;
		}

		console.log(`Loading ${type} ${streamIndex}: ${labels[streamIndex]} from ${url}`);

		const urlValid = await validURL(url);
		if (!urlValid) {
			console.log(`Stream ${streamIndex} (${labels[streamIndex]}) unavailable`);
			isLoadingStream = false;
			return;
		}

		try {
			if (type === 'image') {
				if (hlsInstance) {
					hlsInstance.destroy();
					hlsInstance = null;
				}
				video.style.display = 'none';
				let img = document.getElementById(videoid + '-img');
				if (!img) {
					img = document.createElement('img');
					img.id = videoid + '-img';
					img.style.width = width ? width + 'px' : '100%';
					img.style.maxWidth = '1300px';
					img.style.height = 'auto';
					img.style.display = 'block';
					img.style.margin = '0 auto';
					video.parentElement.insertBefore(img, video);
				}
				img.src = url + '?nocache=' + Date.now();
				img.style.display = 'block';
				console.log(`Image loaded: ${labels[streamIndex]}`);
			} else if (type === 'video') {
				const img = document.getElementById(videoid + '-img');
				if (img) img.style.display = 'none';
				video.style.display = 'block';

				if (hlsInstance) {
					hlsInstance.destroy();
					hlsInstance = null;
				}

				if (Hls.isSupported()) {
					hlsInstance = new Hls({ debug: false, autoStartLoad: true });
					hlsInstance.loadSource(url);
					hlsInstance.attachMedia(video);

					hlsInstance.once(Hls.Events.MEDIA_ATTACHED, function () {
						console.log(`HLS attached for stream ${streamIndex}`);
						video.muted = true;
						if (isPlaying) {
							video.play().catch(err => console.log('Play error:', err));
						}
						isLoadingStream = false;
					});
				} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
					video.src = url;
					video.muted = true;
					if (isPlaying) {
						video.play().catch(err => console.log('Play error:', err));
					}
					isLoadingStream = false;
				}
			}

			currentStream = streamIndex;
			updateTitle();
		} catch (err) {
			console.error('Error loading media:', err);
			isLoadingStream = false;
		}
	}

	function updateTitle() {
		const titleDiv = document.getElementById(videoid + '-title');
		if (titleDiv) {
			titleDiv.textContent = labels[currentStream];
		}
	}

	function switchMedia() {
		const nextStream = 1 - currentStream;
		console.log(`Switching from stream ${currentStream} to ${nextStream}`);
		loadMedia(nextStream);
	}

	function startAlternating() {
		console.log('Starting alternating media');
		isPlaying = true;
		loadMedia(0);
		intervalId = setInterval(() => {
			if (isPlaying && !isLoadingStream) {
				switchMedia();
			}
		}, intervalSeconds * 1000);
	}

	function stopAlternating() {
		console.log('Stopping alternating media');
		if (intervalId) {
			clearInterval(intervalId);
			intervalId = null;
		}
		isPlaying = false;
	}

	const video = document.getElementById(videoid);
	if (video) {
		console.log('Initializing alternating media for:', videoid);
		if (width) {
			video.style.width = width + 'px';
		} else {
			video.style.width = '100%';
		}
		video.style.maxWidth = '1300px';
		video.style.height = 'auto';
		video.style.visibility = 'visible';

		const unavailableDiv = document.getElementById(videoid + "-unavailable");
		if (unavailableDiv) {
			unavailableDiv.style.display = 'none';
		}

		startAlternating();

		video.addEventListener('pause', () => {
			console.log('Video paused');
			stopAlternating();
		});

		video.addEventListener('play', () => {
			console.log('Video playing');
			if (!intervalId) {
				startAlternating();
			}
		});
	} else {
		console.error('Video element not found:', videoid);
	}
}

function showError(text, element, text2 = '') {
	console.log('Error: ' + text)
	const keyDiv = document.createElement('div');
	html = '<table class="center">';
	html += '<tr><td><b>Erro obtendo previsión</b><br>' + text + '</td></tr>';
	if (text2 != '') {
		html += '<tr><td>' + text2 + '</td></tr>';
	}
	html += '</table>';
	keyDiv.innerHTML = html
	keyDiv.style.textAlign = "center";
	const mainDiv = document.getElementById(element);
	mainDiv.appendChild(keyDiv);
}

// --------------------------------------------------------------------------------------------------

// Data en formato YYYYMMDD, como pide o parámetro 'date' da API do IHM.
function getDataIHM(date = new Date()) {
	return '' + date.getFullYear() + padTo2Digits(date.getMonth() + 1) + padTo2Digits(date.getDate());
}

// Mareas oficiais do Instituto Hidrográfico de la Marina.
// A chamada sen 'date' estaba devolvendo HTTP 500, así que se pide explicitamente
// o día actual (date=YYYYMMDD), que é como invocan esta API outros clientes.
// Parámetros do endpoint: request=gettide, id=<código do porto> (ou port=<nome>),
// format=json|xml|txt|gra, e date=YYYYMMDD ou month=YYYYMM.
const MAREAS_IHM_URL = "https://ideihm.covam.es/api-ihm/getmarea?request=gettide&format=json";

async function getMareas(id, element = '') {
	url = MAREAS_IHM_URL + "&id=" + id + "&date=" + getDataIHM()
	console.log('Mareas: ' + url)

	let data = await fetch(url)
		.then(response => {
			if (!response.ok) {
				throw new Error('HTTP ' + response.status + ' en ' + url);
			}
			return response.json();
		})
		.then(data => {
			return createList(data, element);
		})
		.catch(error => {
			console.error('Error mareas IHM:', error);
			return noMareas();
		});
	return data;
}

function noMareas() {
	return '(Sin información sobre mareas)'
}

// Mareas para praias de Portugal (p.ex. Costa de Caparica): o IHM español non
// cobre Portugal e IPMA non dá mareas. Úsase o nivel do mar (sea_level_height_msl)
// da API mariña de Open-Meteo e calcúlanse os extremos (preamar/baixamar) do día.
// Resolución horaria => afínase o minuto con interpolación parabólica e aplícase
// MAREAS_CAPARICA_OFFSET_MIN. Devolve a cadea de mareas do día (ou '') para
// inserir na táboa de previsión, igual que getMareas nas praias de AEMET.
async function getMareasCaparica(latitude, longitude) {
	const url = "https://marine-api.open-meteo.com/v1/marine?latitude=" + latitude + "&longitude=" + longitude
		+ "&hourly=sea_level_height_msl&timezone=auto&past_days=1&forecast_days=2";
	console.log('Mareas Caparica: ' + url);
	try {
		const response = await fetch(url);
		const data = await response.json();
		return mareasCaparicaTexto(data);
	} catch (error) {
		console.error('Error mareas Caparica:', error);
		return '';
	}
}

function mareasCaparicaTexto(data) {
	const horas = (data && data.hourly) ? data.hourly.time : null;
	const niveis = (data && data.hourly) ? data.hourly.sea_level_height_msl : null;
	if (!Array.isArray(horas) || !Array.isArray(niveis) || horas.length < 3) {
		return '';
	}

	// Data de hoxe en hora local de Caparica (timezone=auto => Europe/Lisbon).
	// As horas de Open-Meteo veñen en hora local (sen sufixo de zona), así que
	// trabállase coa parte de texto (wall-clock) sen conversións de zona.
	const hoxe = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Lisbon' });

	var mareas = '';
	var cont = 0;
	var lastTipo = null;
	for (var i = 1; i < niveis.length - 1; i++) {
		const y0 = niveis[i - 1], y1 = niveis[i], y2 = niveis[i + 1];
		if (y0 === null || y1 === null || y2 === null) {
			continue;
		}
		const esMax = (y1 >= y0 && y1 >= y2 && !(y1 === y0 && y1 === y2));
		const esMin = (y1 <= y0 && y1 <= y2 && !(y1 === y0 && y1 === y2));
		if (!esMax && !esMin) {
			continue;
		}
		// Evitar duplicados: as mareas deben alternar (preamar/baixamar)
		const tipoActual = esMax ? 'preamar' : 'baixamar';
		if (tipoActual === lastTipo) {
			continue;
		}
		if (horas[i].substring(0, 10) !== hoxe) {
			continue;
		}

		// Interpolación parabólica: minuto estimado do pico respecto á hora i.
		const denom = (y0 - 2 * y1 + y2);
		var offset = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
		if (offset > 0.5) { offset = 0.5; }
		if (offset < -0.5) { offset = -0.5; }

		const hh = parseInt(horas[i].substring(11, 13), 10);
		const mm = parseInt(horas[i].substring(14, 16), 10);
		const offsetCorr = esMax ? MAREAS_CAPARICA_OFFSET_PREAMAR_MIN : MAREAS_CAPARICA_OFFSET_BAIXAMAR_MIN;
		var totalMin = hh * 60 + mm + Math.round(offset * 60) + offsetCorr;
		if (totalMin < 0) { totalMin = 0; }
		if (totalMin > 24 * 60 - 1) { totalMin = 24 * 60 - 1; }
		const hhmm = padTo2Digits(Math.floor(totalMin / 60)) + ':' + padTo2Digits(totalMin % 60);

		// Salto de liña tras 2 mareas, igual ca createList das praias de AEMET.
		if (cont > 0) {
			mareas += (cont === 2 ? '<br>' : ', ');
		}
		mareas += tipoActual + ': ' + hhmm;
		lastTipo = tipoActual;
		cont += 1;
	}

	return mareas;
}

function createList(data, element) {
	var ubicacion = data["mareas"]["puerto"];
	var fecha = getFechaES(data["mareas"]["fecha"]);
	var datos = data['mareas']['datos']['marea'];
	var mareas = '';

	var arrayLength = datos.length;
	for (var i = 0; i < arrayLength; i++) {
		if (i % 2) {
			mareas += ', ';
		} else if (i == 2) {
			mareas += '<br>';
		}
		mareas += datos[i]['tipo'] + ": " + getLocalTime(datos[i]['hora'])
	}

	if (element != '') {
		const keyDiv = document.createElement('div');
		keyDiv.innerHTML = `Mareas en ${ubicacion} (${fecha})<br> ${mareas}`;
		const mainDiv = document.getElementById(element);
		mainDiv.appendChild(keyDiv);
	}

	document.getElementById("data_mareas").innerHTML = "<p style='font-size:12px;'>"
		+ '<a href="https://ideihm.covam.es/portal/presentacion-geoportal/" target="copyright">Información mareas por IHM, ' + fecha + '</a></p>'
		+ "</a></p>";

	return mareas;
}

function padTo2Digits(num) {
	return num.toString().padStart(2, '0');
}

function getLocalTime(time) {
	const now = new Date();
	const utcDate = now.getFullYear() + '-' + padTo2Digits(now.getMonth() + 1) + '-' + padTo2Digits(now.getDate()) + 'T' + time + ':00Z';
	const date = new Date(utcDate);

	return padTo2Digits(date.getHours()) + ':' + padTo2Digits(date.getMinutes());
}

// --------------------------------------------------------------------------------------------------


function getTemperatura(id, latitude, longitude, texto = "Temperatura actual", waze = true, fuel = false) {
	const ms = Date.now();
	const url = "https://api.open-meteo.com/v1/forecast?latitude=" + latitude + "&longitude=" + longitude + "&current=temperature_2m,wind_speed_10m"
	console.log('Get temperatura: ' + url);
	fetch(url)
		.then(response => response.json())
		.then(data => getTemperaturanDatos(data, id, latitude, longitude, texto, waze, fuel))
		.catch(error => {
			console.error('Error:', error);
			return false;
		});
}

function getTemperaturanDatos(data, element, latitude, longitude, texto, waze = true, fuel = false) {
	const date = new Date(data["current"]["time"] + ':00Z');
	temp = padTo2Digits(date.getHours()) + ':' + padTo2Digits(date.getMinutes());

	const keyDiv = document.createElement('div');
	html = '';

	if (fuel) {
		html += "<img id=\"iconoGasolinera\" src=\"img/gasolinera.png\" alt=\"Precios combustible\" height=\"16px\"/ onclick=\"loadGasolinera( 'ubicación actual',-1," + latitude + "," + longitude + ",35)\" style=\"cursor: pointer;\" title=\"Precios combustible\" >";
		html += "&nbsp;&nbsp;";
	}

	html += texto + " " + data["current"]["temperature_2m"] + "&deg;";
	if (waze) {
		//html += " <a href=waze://?ll=" + latitude + "," + longitude + "&z=100 target=_new  rel=noopener ><img src='img/waze.png' height='15px'></a>";
		html += " <a href=\"#\" onclick=\"openWaze(event," + latitude + "," + longitude + ")\" ><img src='img/waze.png' height='15px'></a>";
	} else {
		//html += " <a href=https://maps.google.com?q=" + latitude + "," + longitude + " target=_new  rel=noopener ><img src='img/dot.png' height='15px'></a>";
		html += " <a href=\"#\" onclick=\"openMaps(event," + latitude + "," + longitude + ")\" ><img src='img/dot.png' height='15px'></a>";
	}

	if (fuel) {
		html += "<div id=\"combustible_ubicacion\"></div>";
	}

	keyDiv.innerHTML = html
	keyDiv.style.textAlign = "center";
	const mainDiv = document.getElementById(element);
	mainDiv.innerHTML = "";
	mainDiv.appendChild(keyDiv);

	document.getElementById("data_temperatura").innerHTML = "<p style='font-size:12px;'>"
		+ "<a href='https://open-meteo.com/' target='copyright'>"
		+ "Temperatura actual por Open-Meteo: "
		+ temp
		+ "</a></p>";

}


// --------------------------------------------------------------------------------------------------
// Amosa a temperatura na ubicación actual. Usa getSafeLocation() (common.js), que fai
// dous intentos (rede e logo GPS con timeout longo) e comparte o fix con farmacias e
// gasolineiras. A versión anterior escribía nun elemento "status" que non existe: como
// window.status é unha cadea, "status.textContent" quedaba en undefined e a comparación
// final sempre era certa, polo que se pintaba o erro antes de rematar a xeolocalización.
function geoFindMe(divName) {
	if (!document.getElementById(divName)) return Promise.resolve(false);

	mensaxeUbicacion(divName, "Obtendo a túa ubicación…");

	return getSafeLocation().then((pos) => {
		if (!pos.ok || (pos.latitude === 0 && pos.longitude === 0)) {
			mensaxeUbicacion(divName, "Non se puido obter a túa ubicación", true);
			return false;
		}
		getTemperatura(divName, pos.latitude, pos.longitude, "Temperatura na túa ubicación", false, true);
		return true;
	});
}

function mensaxeUbicacion(divName, texto, reintentar = false) {
	const mainDiv = document.getElementById(divName);
	if (!mainDiv) return;

	var html = texto;
	if (reintentar) {
		html += " <a href=\"#\" onclick=\"return geoFindMeRetry(event,'" + divName + "')\">(reintentar)</a>";
	}

	const keyDiv = document.createElement('div');
	keyDiv.innerHTML = html;
	keyDiv.style.textAlign = "center";
	mainDiv.innerHTML = "";
	mainDiv.appendChild(keyDiv);
}

// Reintento manual: en Android o diálogo de permiso aparece de xeito máis fiable
// cando a petición vén dun toque do usuario.
function geoFindMeRetry(event, divName) {
	if (event) event.preventDefault();
	geoResetCache();
	geoFindMe(divName);
	return false;
}

// --------------------------------------------------------------------------------------------------

const proxyHost = "https://jl6dcfhxupw4gk4hvy4pxmhjoa0lmhwd.lambda-url.eu-west-1.on.aws/?type=aemet&url=";
const proxyHostFarmacia = "https://jl6dcfhxupw4gk4hvy4pxmhjoa0lmhwd.lambda-url.eu-west-1.on.aws/?type=farmacia&url=";
const proxyHostMeteosix = "https://jl6dcfhxupw4gk4hvy4pxmhjoa0lmhwd.lambda-url.eu-west-1.on.aws/?type=meteosix&url=";

//const URL_MINISTERIO = "https://sedeaplicaciones.minetur.gob.es";
//const FUEL_PRICES_HOST = "https://energia.serviciosmin.gob.es";
const FUEL_PRICES_HOST = "https://sedeaplicaciones.minetur.gob.es";
const FUEL_PRICES_API_URL = FUEL_PRICES_HOST + "/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/FiltroCCAAProducto/12/4";


function getPrevision(id, element, idmareas = 0, lat = 0, lon = 0) {
	const ms = Date.now();
	// Playas     : https://opendata.aemet.es/opendata/api/prediccion/especifica/playa/1501902/?api_key=eyJhbGciO
	// Municipios : https://opendata.aemet.es/opendata/api/prediccion/especifica/municipio/diaria/27045/?api_key=eyJhb...
	//const url = 'https://opendata.aemet.es/opendata/api/prediccion/especifica/playa/' + id + '/?api_key=' + apiKey + "&nocache=" + ms
	//const url = 'https://opendata.aemet.es/opendata/api/prediccion/especifica/playa/' + id + '/?api_key=' + apiKey;
	const url = 'https://opendata.aemet.es/opendata/api/prediccion/especifica/playa/' + id;
	console.log('Get prevision playa: ' + proxyHost + url);

	fetch(proxyHost + url)
		.then(async response => {
			const body = await response.text();
			//console.log('Response status: ' + body);
			if (body == "Internal Server Error") {
				noPrevision(element, idmareas, 'Timeout obtendo previsión, inténtao máis tarde');
				return false;
			}
			return JSON.parse(body);
		})
		.then(data => getPrevisionDatos(data, element, idmareas, id, lat, lon))
		.catch(error => {
			console.error('Error:', error);
			noPrevision(element, idmareas, error.message);
			return false;
		});
}

async function noPrevision(element, idmareas = 0, error = '') {
	var tabla = '<table class="center">';
	tabla += '<tr><td>(Sin datos de previsión meteorolóxica)<br>' + error + '</td></tr>';
	if (idmareas > 0) {
		mareas = await getMareas(idmareas);
		tabla += '<tr><td>' + mareas + '</td></tr>';
	}
	tabla += "</table>";

	const keyDiv = document.createElement('div');
	keyDiv.innerHTML = tabla
	keyDiv.style.textAlign = "center";
	const mainDiv = document.getElementById(element);
	mainDiv.appendChild(keyDiv);
	total_elementos = total_elementos - 1;
}

async function getPrevisionDatos(data, element, idmareas, id_playa, lat = 0, lon = 0) {
	if (data['estado'] == 200) {
		if ('error' in data && data['error'] != "") {
			mareas = '';
			if (idmareas > 0) {
				mareas = await getMareas(idmareas);
			}
			showError(data['error'], element, mareas);
			return;
		}

		if ("source" in data) {
			console.log("Datos de '" + id_playa + "' from '" + data['source'] + "'");
		}
		if ("datos_json" in data) {
			console.log("Datos completos para " + id_playa);
			createPrevision(data['datos_json'], element, idmareas, id_playa, lat, lon);
		} else {

			console.log('Get prevision: ' + data['datos'])
			var myHeaders = new Headers();
			myHeaders.append('Content-Type', 'text/plain; charset=UTF-8');

			fetch(data['datos'], myHeaders)
				.then(function (response) {
					return response.arrayBuffer();
				})
				.then(function (buffer) {
					const decoder = new TextDecoder('iso-8859-1');
					const text = decoder.decode(buffer);
					createPrevision(JSON.parse(text), element, idmareas, id_playa, lat, lon);
				});
		}
	}
}

function getFechaES(fecha) {
	var options = { year: 'numeric', month: 'numeric', day: 'numeric' };
	var pattern = /(\d{4})[\-]*(\d{2})[\-]*(\d{2})/;

	var st = String(fecha);
	var dt = new Date(st.replace(pattern, '$2-$3-$1'));

	return dt.toLocaleDateString("es-ES", options)
}

async function createPrevision(data, element, idmareas, id_playa, lat = 0, lon = 0) {
	var tabla = '<table id="tablaMunicipio-' + id_playa + '" class="center">';
	var datos;
	var datos2;

	for (var i = 0; i < data[0]["prediccion"]["dia"].length; i++) {
		if (isTodayStr(data[0]["prediccion"]["dia"][i]["fecha"])) {
			var datos = data[0]["prediccion"]["dia"][i];
			var datos2 = data[0]["prediccion"]["dia"][i + 1];
		}
	}

	var date = new Date;
	var hour = date.getHours();

	tabla += "<tr><th colspan=4>";

	if (lat != 0 && lon != 0) {
		tabla += "<img id=\"iconoGasolinera-" + id_playa + "\" src=\"img/gasolinera.png\" alt=\"Precios combustible\" height=\"16px\"/ onclick=\"loadGasolinera('" + data[0]["nombre"] + "'," + id_playa + "," + lat + "," + lon + ")\" style=\"cursor: pointer;\" title=\"Precios combustible\" >";
		tabla += "&nbsp;&nbsp;";
	}

	tabla += '<a href="https://www.aemet.es/es/eltiempo/prediccion/playas/' + aplanaTexto(data[0]["nombre"]) + '-' + id_playa + '" target="_new" rel="noopener" >'
		+ "Prevision para " + data[0]["nombre"]
		+ '</a>'
		+ "</th></tr>";

	tabla += "<tr>"
		+ "<th>Temp. Auga</th><td>" + datos["tAgua"]["valor1"] + "&deg;</td>"
		+ "<th>Temp. Max.</th><td>" + datos["tMaxima"]["valor1"] + "&deg;</td>"
		+ "</tr><tr>"
		+ "<th colspan=2>Sensacion térmica</th><td colspan=2>" + datos["sTermica"]["descripcion1"] + "</td>"
		+ "</tr>";

	if (hour <= 12) {
		tabla += "<tr>"
			+ '<th rowspan=4>Mañá<br><img src="img/' + datos["estadoCielo"]["f1"] + '.png" height="50px"></th>'
			+ "<tr>"
			+ "<th>Ceo</th><td style='text-align: left;' colspan=2>" + datos["estadoCielo"]["descripcion1"] + "</td>"
			+ "<tr>"
			+ "<th>Vento</th><td style='text-align: left;' colspan=2>" + datos["viento"]["descripcion1"] + "</td>"
			+ "<tr>"
			+ "<th>Oleaxe</th><td style='text-align: left;' colspan=2>" + datos["oleaje"]["descripcion1"] + "</td>"
			+ "</tr>";
	}
	if (hour <= 19) {
		tabla += "<tr>"
			+ '<th rowspan=4>Tarde<br><img src="img/' + datos["estadoCielo"]["f2"] + '.png" height="50px"></th>'
			+ "<tr>"
			+ "<th>Ceo</th><td style='text-align: left;' colspan=2>" + datos["estadoCielo"]["descripcion2"] + "</td>"
			+ "<tr>"
			+ "<th>Vento</th><td style='text-align: left;' colspan=2>" + datos["viento"]["descripcion2"] + "</td>"
			+ "<tr>"
			+ "<th>Oleaxe</th><td style='text-align: left;' colspan=2>" + datos["oleaje"]["descripcion2"] + "</td>"
			+ "</tr>";
	}
	if (idmareas > 0) {
		mareas = await getMareas(idmareas);
		tabla += '<tr><td colspan=4>' + mareas + '</td></tr>';
	}

	if (hour > 12) {
		tabla += "<tr><th colspan=4>" + getPrintDate(datos2["fecha"]) + "</th></tr>";
		tabla += "<tr>"
			+ "<th>Temp. Auga</th><td>" + datos2["tAgua"]["valor1"] + "&deg;</td>"
			+ "<th>Temp. Max.</th><td>" + datos2["tMaxima"]["valor1"] + "&deg;</td>"
			+ "</tr>";
		tabla += "<tr>"
			+ '<th rowspan=4>Mañá<br><img src="img/' + datos2["estadoCielo"]["f1"] + '.png" height="50px"></th>'
			+ "<tr>"
			+ "<th>Ceo</th><td style='text-align: left;' colspan=2>" + datos2["estadoCielo"]["descripcion1"] + "</td>"
			+ "<tr>"
			+ "<th>Vento</th><td style='text-align: left;' colspan=2>" + datos2["viento"]["descripcion1"] + "</td>"
			+ "<tr>"
			+ "<th>Oleaxe</th><td style='text-align: left;' colspan=2>" + datos2["oleaje"]["descripcion1"] + "</td>"
			+ "</tr>";
	}
	if (hour > 19) {
		tabla += "<tr>"
			+ '<th rowspan=4>Tarde<br><img src="img/' + datos2["estadoCielo"]["f2"] + '.png" height="50px"></th>'
			+ "<tr>"
			+ "<th>Ceo</th><td style='text-align: left;' colspan=2>" + datos2["estadoCielo"]["descripcion2"] + "</td>"
			+ "<tr>"
			+ "<th>Vento</th><td style='text-align: left;' colspan=2>" + datos2["viento"]["descripcion2"] + "</td>"
			+ "<tr>"
			+ "<th>Oleaxe</th><td style='text-align: left;' colspan=2>" + datos2["oleaje"]["descripcion2"] + "</td>"
			+ "</tr>";
	}

	var dt = new Date(data[0]["elaborado"]);
	var fecha_prediccion = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false };

	tabla += '<tr "><td colspan=4>';
	tabla += '<a href="http://www.aemet.es" target="copyright">AEMET</a>: ' + dt.toLocaleDateString("es-ES", fecha_prediccion);
	tabla += '</td ></tr >';

	tabla += "</table>";

	// document.getElementById("data_prevision").innerHTML = "<p style='font-size:12px;'>"
	// 	+ "<a href='http://www.aemet.es' target='copyright'>"
	// 	+ "Previsión praias por AEMET: "
	// 	+ dt.toLocaleDateString("es-ES", fecha_prediccion)
	// 	+ "</a></p>";

	const keyDiv = document.createElement('div');
	keyDiv.innerHTML = tabla
	keyDiv.style.textAlign = "center";
	const mainDiv = document.getElementById(element);
	mainDiv.appendChild(keyDiv);
	total_elementos = total_elementos - 1;
}

function isToday(d1) {
	// 2024-07-25T00:00:00
	var now = new Date();
	var todayStr = now.getFullYear() + '-' + padTo2Digits(now.getMonth() + 1) + '-' + padTo2Digits(now.getDate()) + 'T00:00:00';
	return (todayStr == d1);
}

function isTodayStr(d1) {
	// 20240725
	var now = new Date();
	var todayStr = now.getFullYear() + padTo2Digits(now.getMonth() + 1) + padTo2Digits(now.getDate());
	return (todayStr == d1);
}

function isTomorrow(d1) {
	const today = new Date();
	const tomorrow = new Date();
	// change tomorrow to next day
	tomorrow.setDate(today.getDate() + 1);
	var todayStr = tomorrow.getFullYear() + '-' + padTo2Digits(tomorrow.getMonth() + 1) + '-' + padTo2Digits(tomorrow.getDate()) + 'T00:00:00';
	return (todayStr == d1);
}

function getPrintDate(dateInput) {
	const dateStr = String(dateInput);
	const match = dateStr.match(/^(\d{4})(\d{2})(\d{2})$/);

	if (match) {
		const [, year, month, day] = match;
		const dt = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
		var daySTR = padTo2Digits(dt.getDate()) + "/" + + padTo2Digits(dt.getMonth() + 1) + '/' + dt.getFullYear();
		return daySTR
	} else {
		console.error("Invalid date format, " + dateStr);
	}

	return "null"
}

