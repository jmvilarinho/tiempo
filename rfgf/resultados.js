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

function show_resultados(data, codgrupo, cod_equipo, jornada, cod_competicion, rfef = false) {
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
				+ '<td style="background-color:' + background + ';" align="center" >' + goles_html + '</td>'
				+ '<td style="background-color:' + background + ';" align="left" >' + fuera + '</td>'
				+ '<td style="background-color:' + background + ';" align="center" >' + dia + '</td>'
				+ '</tr>');
		});
		if (hai_temporal)
			$('#results').append('<tr>'
				+ '<td colspan="5" align="left" style="background-color:#ffffff;font-size:12px;"><span class="marcador_temporal">Marcador temporal</span> (partido en xogo)</td>'
				+ '</tr>');
		$('#results').append('</table>');

	} else {
		$('#results').append('<br><p>Non se atoparon resultados.</p><br>');
	}

}
