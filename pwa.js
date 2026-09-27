/* Instalación como app do móbil (PWA). Compárteno as dúas apps.
 *
 * Só rexistra o service worker: sempre o da raíz, porque `sw.js` resólvese
 * contra a URL deste mesmo ficheiro e rfgf/ cárgao como `../pwa.js`, así que
 * o ámbito segue a ser /tiempo/. Sen un service worker con `fetch` os
 * navegadores non ofrecen instalar.
 *
 * Non hai botón propio de instalar (probouse e sobraba): a instalación faise
 * desde o menú do navegador, «Instalar aplicación» en Chrome/Edge e
 * Compartir > Engadir á pantalla de inicio en Safari. Como non interceptamos
 * `beforeinstallprompt`, Chrome pode amosar tamén o seu propio aviso.
 */

(function () {
	if (!('serviceWorker' in navigator)) return;

	var esteScript = document.currentScript;

	window.addEventListener('load', function () {
		var swUrl = new URL('sw.js', esteScript ? esteScript.src : location.href);
		// Ámbito = o directorio do propio sw.js (/tiempo/), non o da páxina:
		// así rfgf/ e a raíz comparten UN só rexistro, non dous.
		var scope = new URL('./', swUrl).href;
		navigator.serviceWorker.register(swUrl.href, { scope: scope }).catch(function (e) {
			console.log('Non se puido rexistrar o service worker: ' + e);
		});
	});
})();
