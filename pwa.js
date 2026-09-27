/* Instalación como app do móbil (PWA). Compárteno as dúas apps.
 *
 * Fai dúas cousas:
 *   1. Rexistra o service worker (sempre o da raíz: `sw.js` resólvese contra a
 *      URL deste mesmo ficheiro, así que rfgf/ carga `../pwa.js` e o ámbito
 *      segue a ser /tiempo/). Sen service worker con `fetch` os navegadores
 *      non ofrecen instalar.
 *   2. Amosa un botón flotante «Instalar» cando o navegador o permite
 *      (`beforeinstallprompt`, Chrome/Edge/Android). Safari non dispara ese
 *      evento: alí instálase desde Compartir > Engadir á pantalla de inicio, e
 *      para iso abonda co manifest e as metas apple-* do HTML.
 */

(function () {
	var esteScript = document.currentScript;

	if ('serviceWorker' in navigator) {
		window.addEventListener('load', function () {
			var swUrl = new URL('sw.js', esteScript ? esteScript.src : location.href);
			// Ámbito = o directorio do propio sw.js (/tiempo/), non o da páxina:
			// así rfgf/ e a raíz comparten UN só rexistro, non dous.
			var scope = new URL('./', swUrl).href;
			navigator.serviceWorker.register(swUrl.href, { scope: scope }).catch(function (e) {
				console.log('Non se puido rexistrar o service worker: ' + e);
			});
		});
	}

	var prompt_diferido = null;

	function xaInstalada() {
		return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
			navigator.standalone === true;
	}

	function creaBoton() {
		var b = document.getElementById('pwa-instalar');
		if (b) return b;
		b = document.createElement('button');
		b.id = 'pwa-instalar';
		b.type = 'button';
		b.innerHTML = '&#128241; Instalar';
		b.style.cssText = 'position:fixed; right:12px; bottom:12px; z-index:9999;' +
			'background-color:#52570f; color:white; border:none; border-radius:6px;' +
			'padding:10px 14px; font-size:15px; cursor:pointer;' +
			'box-shadow:0 2px 6px rgba(0,0,0,0.4);';
		b.addEventListener('click', function () {
			if (!prompt_diferido) return;
			b.style.display = 'none';
			prompt_diferido.prompt();
			prompt_diferido.userChoice.then(function (escolla) {
				// Se rexeita, o navegador xa non volve disparar o evento nesta
				// visita: non ten sentido deixar o botón aí.
				if (escolla && escolla.outcome !== 'accepted') b.remove();
				prompt_diferido = null;
			});
		});
		document.body.appendChild(b);
		return b;
	}

	window.addEventListener('beforeinstallprompt', function (e) {
		e.preventDefault();          // evita o banner automático, usamos o botón
		prompt_diferido = e;
		if (xaInstalada()) return;
		if (document.body) creaBoton();
		else window.addEventListener('DOMContentLoaded', creaBoton);
	});

	window.addEventListener('appinstalled', function () {
		prompt_diferido = null;
		var b = document.getElementById('pwa-instalar');
		if (b) b.remove();
	});
})();
