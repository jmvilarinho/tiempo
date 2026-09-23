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
					fecha: item.fecha || ''
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
			actualiza_directo(data.codigo_competicion || cod_competicion, data.codigo_grupo || codgrupo, data.jornada || jornada, rfef, directo_candidatos, xeracion_directo);

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

// Segunda fonte para os partidos en xogo, que o lambda garda só 90 s: os paneis
// de marcadores.rfef.es para a RFEF e a xornada da portada de resultados de
// futgal.es para a RFGF. Píntase por riba do marcador de getresultados ou
// getequipo cunha cor propia (marcador_directo) e o minuto, se o trae.
// Cada candidato leva o id da súa celda (celda) e, se a cor de fondo depende
// do marcador (xornadas: vitoria / empate / derrota), fondo(goles_casa, goles_fora)
async function actualiza_directo(cod_competicion, codgrupo, jornada, rfef, candidatos, xeracion, lenda = 'lenda_directo') {
	var valido = v => v && v != 'undefined';
	var url = remote_url + '?type=getdirecto';
	if (rfef) {
		if (!valido(cod_competicion))
			return;
		url += '&rfef=1&codcompeticion=' + cod_competicion;
		if (valido(codgrupo))
			url += '&codgrupo=' + codgrupo;
	} else {
		if (!valido(codgrupo) || !valido(jornada))
			return;
		url += '&codgrupo=' + codgrupo + '&jornada=' + jornada;
	}
	console.log("GET " + url);
	try {
		const response = await fetch(url);
		if (!response.ok)
			throw new Error('Network response was not ok');
		const data = await response.json();
		if (xeracion != xeracion_directo)
			return;
		if (!data || data.is_ok != 'true' || !data.data || !data.data.partidos)
			throw new Error('Sen datos do directo: ' + (data ? data.error : ''));

		var algun = false;
		jQuery.each(candidatos, function (index, candidato) {
			var p = busca_partido_directo(data.data.partidos, candidato);
			if (!p || p.Goles_casa === '' || p.Goles_visitante === '')
				return;
			if (p.estado != 'enjuego' && p.estado != 'prov')
				return;
			var html = '<span class="marcador_directo">' + p.Goles_casa + ' - ' + p.Goles_visitante + '</span>';
			if (p.minuto)
				html += '<br><span class="marcador_directo" style="font-size:10px;">min ' + p.minuto + '</span>';
			$('#' + candidato.celda).html(html);
			if (candidato.fondo)
				$('#' + candidato.celda).css('background-color', candidato.fondo(p.Goles_casa, p.Goles_visitante));
			algun = true;
		});
		if (algun)
			$('#' + lenda).show();
	} catch (error) {
		console.error('Directo:', error.message);
	}
}
