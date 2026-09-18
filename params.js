// Webcams de camaramar.com.
//
// O manifesto mestre do seu Wowza (622a10e8864f7.streamlock.net) leva un SecureToken
// (jdtcbrndmrd*) que se pide en /webcam/<id>/stream-url —iso o navegador aínda o
// podía facer—, pero ademais esixe agora 'Referer: https://www.camaramar.com/': sen
// el, ou con calquera outro referer, responde 403. Referer é unha cabeceira prohibida
// en fetch/XHR, así que desde a nosa páxina non hai xeito de mandalo e o mestre ten
// que vir polo proxy (proxyHostCamaramarStream, en index.js).
//
// Só o mestre pasa polo proxy: a chunklist e os segmentos .ts levan o token embebido
// no nome do ficheiro e sérvense sen Referer e con Access-Control-Allow-Origin: *,
// polo que o vídeo vai directo do CDN ao navegador.
//
// A clave é o nome do stream en Wowza (o que identifica a cámara e aparece nas URLs
// vellas) e o valor o id da webcam no sitio de camaramar, que é o que entende
// /webcam/<id>/stream-url. Para engadir unha cámara, mira o data-webcam-id do seu
// <video> na páxina de camaramar.
var CAMARAMAR_WEBCAMS = {
	'5_razo': 11,
	'2_razo_art': 1034,
	'4_barranan': 15,
	'3_aguieira': 17,
	'33_carnota': 56,
	'68_lanzada': 9,
	'48_menduina': 78,
	'61_perbes': 96,
	'31_coroso': 103
};

// URL do manifesto dunha cámara de camaramar, lista para showVideo ou para unha quenda
// de alternateMediaVarias. Ollo: non remata en .m3u8, así que as quendas teñen que
// levar 'stream: true' (esStreamHls tomaríaa por instantánea).
function camaramarStream(nome) {
	var id = CAMARAMAR_WEBCAMS[nome];
	if (!id) {
		console.error('camaramarStream: cámara descoñecida ' + nome);
		return '';
	}
	return proxyHostCamaramarStream + id;
}
