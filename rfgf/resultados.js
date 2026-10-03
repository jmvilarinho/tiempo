async function load_resultados(cod_grupo, cod_equipo, jornada, cod_competicion, addHistory = true, rfef = false) {
	displayLoading();
	setCookie('paginaRFGF', 'resultados', 30)
	setCookie('cod_equipo', cod_equipo, 30)
	setCookie('cod_grupo', cod_grupo, 30)
	setCookie('cod_competicion', cod_competicion, 30)

	if (addHistory)
		history.pushState(null, "", '#resultados/' + cod_equipo + '/' + cod_grupo + '/' + cod_competicion);

	var url = remote_url + '?type=getresultados&codequipo=' + cod_equipo + '&codgrupo=' + cod_grupo + '&jornada=' + jornada;
	if (cod_competicion != '')
		url += "&codcompeticion=" + cod_competicion;
	if (rfef || isRFEF(cod_equipo)) {
		url += "&rfef=1";
		rfef = true;
	}

	console.log("GET " + url);
	await fetch(url)
		.then(response => {
			if (!response.ok) {
				throw new Error('Network response was not ok');  // Handle HTTP errors
			}
			return response.json();
		})
		.then(data => {
			if (data) {
				show_error(data);
				$('#results').html('');
				add_back();
				show_resultados(data.data, cod_grupo, cod_equipo, jornada, cod_competicion, rfef);
				if ('src_url' in data['data']) {
					$('#ref_msg').html('<p style="font-size:12px;"><a href="' + data['data']['src_url'] + '" target="copyright" rel="noopener">Información obtida de fontes oficiais</a></p>');
				}
				add_back();
			} else {
				throw new Error('No data found in response');
			}
		})
		.catch(error => {
			console.error('Fetch error:', error.message);  // Log the error
		});
	hideLoading();
}

// Cada render de resultados ou xornadas leva un número: o marcador en directo
// que chegue dun render anterior (o usuario xa cambiou de páxina) descártase
var xeracion_directo = 0;

function show_resultados(data, codgrupo, cod_equipo, jornada, cod_competicion, rfef = false) {
	xeracion_directo += 1;
	var directo_candidatos = [];
	$('#results').append('<br>');
	linea_competicion = data.nombre_competicion ? data.nombre_competicion : '';
	if (data.nombre_grupo && data.nombre_grupo != '')
		linea_competicion += ' (' + data.nombre_grupo + ')';
	if (linea_competicion != '')
		$('#results').append(linea_competicion + '<br>');
	setNombreCompeticion(data.codigo_competicion, data.codigo_grupo, data.nombre_competicion, data.nombre_grupo);
	crea_botons('resultados', cod_equipo, codgrupo, cod_competicion, rfef);

	j = parseInt(data.jornada);
	if ((j - 1) > 0) {
		back = "<a href=\"javascript:load_resultados('" + codgrupo + "','" + cod_equipo + "','" + (j - 1) + "','" + cod_competicion + "',false," + rfef + ")\"><img class=\"escudo_widget\" src=../img/back.png></a>&nbsp;&nbsp;&nbsp;";
	} else {
		back = '';
	}

	if (data.listado_jornadas && data.listado_jornadas.length > 0 && data.listado_jornadas[0].jornadas && data.jornada < data.listado_jornadas[0].jornadas.length)
		forward = "&nbsp;&nbsp;&nbsp;<a href=\"javascript:load_resultados('" + codgrupo + "','" + cod_equipo + "','" + (j + 1) + "','" + cod_competicion + "',false," + rfef + ")\"><img class=\"escudo_widget\" src=../img/forward.png></a>";
	else
		forward = '';

	fecha_jornada = data.fecha_jornada ? ' - ' + fecha_barras(data.fecha_jornada) : '';

	if (data.partidos && data.partidos.length > 0) {

		$('#results').append('<table border >');
		$('#results').append(
			'<tr>'
			+ '<th colspan="5" align="center">' + back + 'Xornada ' + data.jornada + fecha_jornada + forward + '</th>'
			+ '</tr><tr>'
			+ '<th>Data</th>'
			+ '<th align="right"></th>'
			+ '<th align="center">Resultado</th>'
			+ '<th align="left"></th>'
			+ '<th align="center">Día</th>'
			+ '</tr>'
		);
		cont = 0;
		hai_temporal = false;

		jQuery.each(data.partidos, function (index, item) {
			if (en_xogo_agora(item, cod_equipo))
				directo_candidatos.push({
					celda: 'marcador_' + index,
					cod_local: item.CodEquipo_local || '',
					cod_visitante: item.CodEquipo_visitante || '',
					local: item.Nombre_equipo_local || '',
					visitante: item.Nombre_equipo_visitante || '',
					fecha: item.fecha || '',
					goles_local: item.Goles_casa,
					goles_visitante: item.Goles_visitante,
					provisional: marcador_provisional(item)
				});
			background = getBackgroundColor(cont, (item.CodEquipo_local == cod_equipo || item.CodEquipo_visitante == cod_equipo));
			cont += 1

			$('#results').append('<tr>');

			// os tags poden non vir no payload: trátanse como baleiros
			nome_local = item.Nombre_equipo_local || '';
			nome_visitante = item.Nombre_equipo_visitante || '';

			if (nome_local == 'Descansa') {
				casa = nome_local;
			} else if (item.CodEquipo_local) {
				casa = '<a href="javascript:load_xornadas(\'' + item.CodEquipo_local + '\',false,' + rfef + ',\'' + codgrupo + '\',\'' + cod_competicion + '\')">' + nome_local + '</a>';
			} else {
				casa = nome_local;
			}

			if (nome_local != 'Descansa' && item.url_img_local)
				casa = casa + '&nbsp;<img src="https://www.futgal.es' + item.url_img_local + '" align="absmiddle" class="escudo_widget">';

			if (nome_visitante == 'Descansa') {
				fuera = nome_visitante;
			} else if (item.CodEquipo_visitante) {
				fuera = '<a href="javascript:load_xornadas(\'' + item.CodEquipo_visitante + '\',false,' + rfef + ',\'' + codgrupo + '\',\'' + cod_competicion + '\')">' + nome_visitante + '</a>';
			} else {
				fuera = nome_visitante;
			}
			if (nome_visitante != 'Descansa' && item.url_img_visitante)
				fuera = '<img src="https://www.futgal.es' + item.url_img_visitante + '" align="absmiddle" class="escudo_widget">&nbsp;' + fuera;

			situacion_juego = item.situacion_juego || '';

			//if (marcador_provisional(item))
			//	xogo = '<br>(en xogo)';
			//else
				xogo = '';
			if (!(situacion_juego == '1' || situacion_juego == '' || situacion_juego == '2'))
				xogo += '<br>situacion_juego: "' + situacion_juego + '"';

			if (item.hora && item.hora !== "00:00")
				hora = ' - ' + item.hora;
			else
				hora = '';

			fecha = fecha_barras(item.fecha);

			// sen hora de partido non hai día confirmado, non amosamos o día da semana
			if (item.fecha && hora)
				dia = dia_semana_sp(item.fecha);
			else
				dia = '';

			goles_html = '';
			goles_casa = item.Goles_casa || '';
			goles_visitante = item.Goles_visitante || '';
			if (goles_casa != '' && goles_visitante != '') {
				marcador = goles_casa + ' - ' + goles_visitante;
				// resultado provisional (partido en xogo): o marcador aínda é temporal, resáltase en amarelo
				if (marcador_provisional(item)) {
					marcador = '<span class="marcador_temporal">' + marcador + '</span>';
					hai_temporal = true;
				}
				goles_html = marcador + xogo;
				if (item.codacta) {
					goles_html = '<a href="javascript:load_acta(\'' + item.codacta + '\')">' + goles_html + '</a>';
				}
			}


			$('#results').append('<tr>'
				+ '<td style="background-color:' + background + ';" >' + fecha + hora + '</td>'
				+ '<td style="background-color:' + background + ';" align="right" >' + casa + '</td>'
				+ '<td id="marcador_' + index + '" style="background-color:' + background + ';" align="center" >' + goles_html + '</td>'
				+ '<td style="background-color:' + background + ';" align="left" >' + fuera + '</td>'
				+ '<td style="background-color:' + background + ';" align="center" >' + dia + '</td>'
				+ '</tr>');
		});
		if (hai_temporal)
			$('#results').append('<tr>'
				+ '<td colspan="5" align="left" style="background-color:#ffffff;font-size:12px;"><span class="marcador_temporal">&nbsp;&nbsp;Marcador temporal</span></td>'
				+ '</tr>');
		// a lenda do directo só se amosa se chega algún marcador
		if (directo_candidatos.length > 0)
			$('#results').append('<tr id="lenda_directo" style="display:none;">'
				+ '<td colspan="5" align="left" style="background-color:#ffffff;font-size:12px;"><span class="marcador_directo">&nbsp;&nbsp;Marcador en directo (' + (rfef ? 'marcadores.rfef.es' : 'futgal.es') + ')</span></td>'
				+ '</tr>');
		$('#results').append('</table>');

		if (directo_candidatos.length > 0)
			pide_directo(data.codigo_competicion || cod_competicion, data.codigo_grupo || codgrupo, data.jornada || jornada, rfef, directo_candidatos, xeracion_directo);

	} else {
		$('#results').append('<br><p>Non se atoparon resultados.</p><br>');
	}

}

// Partido que pode estar en xogo agora mesmo: dende a hora de comezo ata
// duracion_min (xogo + descanso) máis dúas horas de marxe por atrasos e
// porque as actas tardan en pecharse, ou
// con marcador provisional do mesmo día
function en_xogo_agora(item, cod_equipo) {
	var m = String(item.fecha || '').match(/(\d{2})\D(\d{2})\D(\d{4})/);
	if (!m)
		return false;
	var agora = new Date();
	var hoxe = agora.getDate() == parseInt(m[1], 10) && (agora.getMonth() + 1) == parseInt(m[2], 10) && agora.getFullYear() == parseInt(m[3], 10);
	if (marcador_provisional(item) && hoxe)
		return true;
	var h = String(item.hora || '').match(/(\d{1,2}):(\d{2})/);
	if (!h || item.hora == '00:00')
		return false;
	var inicio = new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10), parseInt(h[1], 10), parseInt(h[2], 10));
	var fin = inicio.getTime() + (getEquipoDuracion(cod_equipo) + 120) * 60000;
	return agora.getTime() >= inicio.getTime() && agora.getTime() <= fin;
}

// Os nomes non sempre coinciden letra a letra entre resultados.rfef.es e
// marcadores.rfef.es: compáranse sen acentos, maiúsculas nin signos
function normaliza_nome(nome) {
	return String(nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function busca_partido_directo(partidos, candidato) {
	// futgal.es trae os códigos de equipo: son máis fiables que os nomes
	if (candidato.cod_local && candidato.cod_visitante)
		for (var j = 0; j < partidos.length; j++)
			if (partidos[j].CodEquipo_local == candidato.cod_local && partidos[j].CodEquipo_visitante == candidato.cod_visitante)
				return partidos[j];
	var local = normaliza_nome(candidato.local);
	var visitante = normaliza_nome(candidato.visitante);
	var dia = String(candidato.fecha).substring(0, 5).replace(/-/g, '/');
	var parcial = null;
	for (var i = 0; i < partidos.length; i++) {
		var p = partidos[i];
		var pl = normaliza_nome(p.Nombre_equipo_local);
		var pv = normaliza_nome(p.Nombre_equipo_visitante);
		if (pl == local && pv == visitante)
			return p;
		// un dos dous nomes igual e o mesmo día
		if (!parcial && (pl == local || pv == visitante) && p.fecha == dia)
			parcial = p;
	}
	return parcial;
}

// O directo pode vir atrasado (a lambda cachéao 90 s, os paneis de orixe actualízanse
// a saltos e ás veces corta o antiscraper): se o marcador que xa está pintado (o de
// getresultados ou getequipo, definitivo ou temporal) ten máis goles, é ese o máis
// recente e non se pisa. Os goles non baixan nunca, así que o total vale de reloxo.
// Co mesmo total só se pinta o directo se o que hai é temporal, para engadirlle o
// minuto; se xa é definitivo déixase como está.
function directo_mais_recente(candidato, p) {
	var baleiro = g => g === '' || g === null || g === undefined;
	if (baleiro(candidato.goles_local) || baleiro(candidato.goles_visitante))
		return true;
	var total = (a, b) => (parseInt(a, 10) || 0) + (parseInt(b, 10) || 0);
	var diferenza = total(p.Goles_casa, p.Goles_visitante) - total(candidato.goles_local, candidato.goles_visitante);
	return diferenza > 0 || (diferenza == 0 && candidato.provisional);
}

// Segunda fonte para os partidos en xogo, que o lambda garda só 90 s: os paneis
// de marcadores.rfef.es para a RFEF e a xornada da portada de resultados de
// futgal.es para a RFGF. Píntase por riba do marcador de getresultados ou
// getequipo cunha cor propia (marcador_directo) e o minuto, se o trae.
// Cada candidato leva o id da súa celda (celda) e, se a cor de fondo depende
// do marcador (xornadas: vitoria / empate / derrota), fondo(goles_casa, goles_fora).
// Se o marcador non cabe nunha celda (portada: un gol en cada fila), o candidato
// trae pinta(goles_casa, goles_fora, html_minuto) e encárgase el.
// Todos levan tamén o marcador que xa está pintado (goles_local, goles_visitante e
// provisional) para non deixar que un directo atrasado pise un resultado máis novo
// (directo_mais_recente).
//
// Os bloques non piden cada un o seu: rexístranse aquí e resólvense xuntos na
// tarefa seguinte, cando o render xa rematou de pendurar todos (por iso o
// setTimeout, e non un microtask). Un panel da RFEF trae todas as competicións
// do deporte, así que todos os bloques RFEF da páxina van nunha soa petición,
// coas competicións e os grupos en listas paralelas. O fragmento de futgal.es
// só sabe dar un grupo — sen CodGrupo devolve a páxina baleira —, así que aí
// segue habendo unha petición por grupo e xornada e só se xuntan os idénticos.
var pendentes_directo = [];
var temporizador_directo = null;

function pide_directo(cod_competicion, codgrupo, jornada, rfef, candidatos, xeracion, lenda = 'lenda_directo') {
	var valido = v => v && v != 'undefined';
	if (!candidatos || candidatos.length == 0)
		return;
	if (rfef ? !valido(cod_competicion) : !(valido(codgrupo) && valido(jornada)))
		return;
	pendentes_directo.push({
		rfef: rfef,
		cod_competicion: valido(cod_competicion) ? String(cod_competicion) : '',
		codgrupo: valido(codgrupo) ? String(codgrupo) : '',
		jornada: valido(jornada) ? String(jornada) : '',
		candidatos: candidatos,
		xeracion: xeracion,
		lenda: lenda
	});
	if (temporizador_directo === null)
		temporizador_directo = setTimeout(lanza_directo, 0);
}

function lanza_directo() {
	var bloques = pendentes_directo;
	pendentes_directo = [];
	temporizador_directo = null;
	var peticions = {};
	jQuery.each(bloques, function (index, bloque) {
		var chave = bloque.rfef ? 'rfef' : 'futgal/' + bloque.codgrupo + '/' + bloque.jornada;
		if (!peticions[chave])
			peticions[chave] = [];
		peticions[chave].push(bloque);
	});
	for (var chave in peticions)
		actualiza_directo(peticions[chave]);
}

// Unha resposta pode traer varias competicións e varios grupos: quédanse os
// partidos deste bloque. Os códigos só se comparan cando veñen, para que siga
// valendo unha resposta da lambda vella (que non manda codcompeticion)
function partidos_do_bloque(partidos, bloque) {
	return partidos.filter(function (p) {
		if (p.codcompeticion && bloque.cod_competicion && p.codcompeticion != bloque.cod_competicion)
			return false;
		if (p.codgrupo && bloque.codgrupo && p.codgrupo != bloque.codgrupo)
			return false;
		return true;
	});
}

async function actualiza_directo(bloques) {
	var url = remote_url + '?type=getdirecto';
	if (bloques[0].rfef)
		// listas paralelas: a competición i xógase no grupo i
		url += '&rfef=1&codcompeticion=' + bloques.map(b => b.cod_competicion).join(',')
			+ '&codgrupo=' + bloques.map(b => b.codgrupo).join(',');
	else
		url += '&codgrupo=' + bloques[0].codgrupo + '&jornada=' + bloques[0].jornada;
	console.log("GET " + url);
	try {
		const response = await fetch(url);
		if (!response.ok)
			throw new Error('Network response was not ok');
		const data = await response.json();
		if (!data || data.is_ok != 'true' || !data.data || !data.data.partidos)
			throw new Error('Sen datos do directo: ' + (data ? data.error : ''));

		jQuery.each(bloques, function (index, bloque) {
			if (bloque.xeracion != xeracion_directo)
				return;
			var partidos = partidos_do_bloque(data.data.partidos, bloque);
			var algun = false;
			jQuery.each(bloque.candidatos, function (index, candidato) {
				var p = busca_partido_directo(partidos, candidato);
				if (!p || p.Goles_casa === '' || p.Goles_visitante === '')
					return;
				if (p.estado != 'enjuego' && p.estado != 'prov')
					return;
				if (!directo_mais_recente(candidato, p))
					return;
				var minuto = p.minuto ? '<br><span class="marcador_directo" style="font-size:10px;">min ' + p.minuto + '</span>' : '';
				if (candidato.pinta) {
					candidato.pinta(p.Goles_casa, p.Goles_visitante, minuto);
				} else {
					$('#' + candidato.celda).html('<span class="marcador_directo">' + p.Goles_casa + ' - ' + p.Goles_visitante + '</span>' + minuto);
					if (candidato.fondo)
						$('#' + candidato.celda).css('background-color', candidato.fondo(p.Goles_casa, p.Goles_visitante));
				}
				algun = true;
			});
			if (algun)
				$('#' + bloque.lenda).show();
		});
	} catch (error) {
		console.error('Directo:', error.message);
	}
}
