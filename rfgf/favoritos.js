var favorite_load = [];
// Bloques do marcador en directo: cada táboa de favoritos rexístrase aquí mentres
// se constrúe e pídense todos xuntos ao final (ver load_favoritos)
var directo_favoritos = [];
var directo_fav_seq = 0;

async function load_favoritos(addHistory = true) {
	displayLoading();
	setCookie('paginaRFGF', 'favoritos', 30)
	if (addHistory)
		history.pushState(null, "", '#favoritos');

	sanitizeEquiposCookies();

	favoritos = getCookieArray('favoritosItems');
	if (favoritos.length <= 0) {
		favoritos = favoritos_default;
	}
	setCookie('favoritosItems', JSON.stringify(favoritos), 365);
	var arrayLength = favoritos.length;;

	$('#results').html('');
	// render novo: o marcador en directo que chegue dun render anterior descártase
	xeracion_directo += 1;
	var xeracion = xeracion_directo;
	directo_favoritos = [];
	var arr = [];
	add_back('favoritos');
	$('#results').append('<div id="equipo_load">(Cargando datos ...)</div><div id="favoritos_tabla"></div><div id="favoritos_list"></div>');
	favorite_load = [];
	// Seis fíos que van collendo equipos da cola: cada un colle o seguinte en
	// canto remata o seu. Antes isto era un bucle que agardaba 300 ms por
	// quenda, e con oito favoritos e a caché quente eses 300 ms eran case toda
	// a carga (as peticións tardaban 26 ms). Non se agarda por elas aquí: o
	// resto da páxina píntase mentres chegan, e Promise.all está máis abaixo
	var por_cargar = favoritos.slice();
	var tarefas_favoritos = [];
	// o número de fíos calcúlase antes: os propios fíos van baleirando
	// por_cargar, así que na condición do for iría decrecendo
	var fios = Math.min(6, por_cargar.length);
	for (var fio = 0; fio < fios; fio++) {
		tarefas_favoritos.push((async function () {
			while (por_cargar.length > 0) {
				var equipo = por_cargar.shift();
				favorite_load.push(equipo);
				try {
					await get_data_equipo_async(equipo);
				} catch (e) {
					console.error('favoritos:', e.message);
				}
				if (favorite_load.length > 0)
					$('#equipo_load').html(' (Cargando datos, pendientes ' + favorite_load.length + ')');
			}
		})());
	}

	var arrayLength = equipos.length;
	var html_fav = '<hr><table class="table_noborder"><tr><th colspan=3 class="table_noborder">Lista Favoritos</th></tr>';
	for (var i = 0; i < arrayLength; i++) {
		var start = '';
		var end = '';
		if (i % 3 == 0)
			start = '<tr>';
		if (i % 3 == 2)
			end = '</tr>';

		var checked = '';
		if (favoritos.indexOf('' + equipos[i].id) >= 0) {
			checked = 'checked';
		}
		html_fav += start + '<td class="table_noborder"><label>'
			+ '<input type="checkbox" ' + checked + ' value="' + equipos[i].id + '" onclick="setArrayCookie(\'favoritosItems\',this)">' + equipos[i].name
			+ '&nbsp;</label></td>' + end;
	}
	if (arrayLength % 3 != 0)
		html_fav += '</tr>';
	$('#results').append(html_fav + '</table><hr>');

	add_back('favoritos');
	end_page();
	hideLoading();

	// Tope de seguridade: se algunha petición non contestase, non quedamos sen
	// ordenar a táboa (o bucle de sondeo vello rendíase aos ~36 s). API Gateway
	// corta aos 29 s, así que en condicións normais non se chega aquí
	await Promise.race([
		Promise.all(tarefas_favoritos),
		new Promise(r => setTimeout(r, 30000))
	]);
	$('#equipo_load').html('');

	//Ordenar resultados
	try {
		var toSort = document.getElementById('favoritos_tabla').children;
		toSort = Array.prototype.slice.call(toSort, 0);
		toSort.sort(function (a, b) {
			var aord = +a.id;
			var bord = +b.id;
			return aord - bord;
		});
		const parentElement = document.getElementById('favoritos_tabla');
		toSort.forEach(element => parentElement.appendChild(element));
		maxWitdh = 100;
		toSort.forEach(function (item) {
			if ($(item).width() > maxWitdh)
				maxWitdh = $(item).width();
		});
		toSort.forEach(function (item) {
			$(item).css("width", maxWitdh + "px");
		});
	} catch (e) {
		console.log(e);
	}

	// O directo pídese ao final, con todas as táboas xa pegadas: así todos os bloques
	// entran na mesma quenda e os da RFEF van nunha soa petición (un panel da RFEF
	// trae todas as competicións do deporte)
	jQuery.each(directo_favoritos, function (index, bloque) {
		pide_directo(bloque.cod_competicion, bloque.cod_grupo, bloque.jornada, bloque.rfef, [bloque.candidato], xeracion, bloque.lenda);
	});
}

async function get_data_equipo_async(cod_equipo, rfef = false) {
	var url = remote_url + "?type=getequipo&codequipo=" + cod_equipo;
	codgrupo = getEquipoGrupo(cod_equipo)
	if (codgrupo) {
		url += "&codgrupo=" + codgrupo;
	}
	codcompeticion = getEquipoCompeticion(cod_equipo)
	if (codcompeticion) {
		url += "&codcompeticion=" + codcompeticion;
	}
	if (isRFEF(cod_equipo)) {
		url += "&rfef=1";
		rfef = true
	}
	console.log("GET " + url);

	// devólvese a promesa: load_favoritos agárdaas con Promise.all, en vez de
	// sondear favorite_load cada 300 ms
	return fetch(url)
		.then(response => {
			if (!response.ok) {
				favorite_load.pop();
				throw new Error('Network response was not ok');  // Handle HTTP errors
			}
			return response.json();
		})
		.then(data => {
			if (data) {
				show_error(data);
				show_portada_equipo_favoritos(data.data, cod_equipo, rfef).forEach((element) => {
					$('#favoritos_tabla').append(element['html']);
				});
				favorite_load.pop();
			} else {
				favorite_load.pop();
				throw new Error('No data found in response');
			}
		})
		.catch(error => {
			favorite_load.pop();
			console.error('Fetch error:', error.message);  // Log the error
		});
}

function show_portada_equipo_favoritos(data, cod_equipo, rfef = false) {
	lineas = 0;
	map = {}
	var arr = [];

	if (data.competiciones_equipo.length > 0)
		jQuery.each(data.competiciones_equipo, function (index, item_competiciones) {
			title = data.nombre_equipo + ' - ' + item_competiciones.categoria;
			cont = 0;
			jQuery.each(item_competiciones.partidos, function (index, item) {
				cont += 1
				var pattern = /(\d{2})\-(\d{2})\-(\d{4}) (\d{2})\:(\d{2})/;
				hora = item.fecha;
				if (item.hora && item.hora !== "00:00")
					hora += ' ' + item.hora;
				else
					hora += ' 23:55'
				var date_obj = new Date(hora.replace(pattern, '$3-$2-$1 $4:$5'));
				var date_now_obj = new Date(Date.now())
				if (isSameWeek(date_obj, date_now_obj)) {
					lineas += 1;
					arr.push({
						data: date_obj.getTime(),
						html: show_portada_data_favoritos(title, cod_equipo, item, date_obj.getTime(), rfef, item_competiciones.cod_competicion, item_competiciones.cod_grupo)
					});
					//return false;
				}
				previous = item;
			});
		});
	else
		title = data.nombre_equipo;

	if (lineas == 0) {
		head = getEquipoName(cod_equipo, title);
		arr.push({
			data: 33284008833000,
			html: '<table id="33284008833000" class="portada">'
				+ '<tr>'
				+ '<th colspan=2  align="absmiddle">' + head + '</th>'
				+ '</tr>'
				+ '<tr>'
				+ '<td bgcolor="#e8e5e4" colspan=2>Non hai datos</td>'
				+ '</table>'
		});
	}

	return arr;
}

function show_portada_data_favoritos(title, cod_equipo, item, id, rfef = false, cod_competicion = '', cod_grupo = '') {

	// os tags poden non vir no payload: trátanse como baleiros
	equipo_casa = item.equipo_casa || '';
	equipo_fuera = item.equipo_fuera || '';
	goles_casa = item.goles_casa || '';
	goles_fuera = item.goles_fuera || '';

	// partido que pode estar en xogo: o marcador en directo chega despois, así que as
	// celdas do marcador píntanse aínda sen goles
	var directo = cod_competicion && !(equipo_casa == 'Descansa' || equipo_fuera == 'Descansa') && en_xogo_agora(item, cod_equipo);
	// as táboas de favoritos comparten id (a hora do partido): as celdas levan o seu
	var id_directo = directo ? 'directo_fav_' + (++directo_fav_seq) : '';

	campo = '';
	if (equipo_casa == 'Descansa' || equipo_fuera == 'Descansa') {
		dia_str = fecha_barras(item.fecha);
		id = "33284008833000";
	} else {
		if (item.hora && item.hora !== "00:00") {
			dia_str = fecha_barras(item.fecha) + ' - ' + item.hora + ' (' + dia_semana(item.fecha) + ')';
		} else {
			dia_str = fecha_barras(item.fecha) + ' ???';
		}

		if (item.campo && String(item.campo).trim() != '' && !String(item.campo).includes('Pendiente')) {
			//campo = '<a href="https://waze.com/ul?q=' + encodeURIComponent(item.campo) + '&navigate=yes" target="_blank">' + item.campo + '</a> <img src="../img/waze.png" height="15px">';
			//campo = '<a href="https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(item.campo) + '" target="_blank">' + item.campo + '</a> <img src="../img/dot.png" height="15px">';
			//campo = '<a href="https://maps.google.com?q=' + encodeURIComponent(item.campo) + '" target="_blank">' + item.campo + '</a> <img src="../img/dot.png" height="15px">';
			campoEscape = String(item.campo).replace(/"/g, '').replace(/'/g, '');
			campo = "<a href=\"#\" onclick=\"openMapsSearch(event,'" + campoEscape + "')\">" + item.campo + '</a> <img src="../img/dot.png" height="15px">';
		} else {
			campo = item.campo || '';
		}
	}

	if (equipo_casa != 'Descansa' && item.escudo_equipo_casa) {
		casa = '<a href="javascript:load_portada(\'' + item.codequipo_casa + '\',true,' + rfef + ',\'' + cod_grupo + '\',\'' + cod_competicion + '\')">' + equipo_casa + '</a>';
		casa = '<a href="javascript:load_plantilla(\'' + item.codequipo_casa + '\')" title="Plantilla">'
			+ '<img src="https://www.futgal.es' + item.escudo_equipo_casa + '" align="absmiddle" class="escudo_logo_medio"></a>&nbsp;&nbsp;' + casa + '&nbsp;';
	} else {
		if (item.codequipo_casa)
			casa = '<a href="javascript:load_portada(\'' + item.codequipo_casa + '\',true,' + rfef + ',\'' + cod_grupo + '\',\'' + cod_competicion + '\')">' + equipo_casa + '</a>';
		else
			casa = '&nbsp;' + equipo_casa + '&nbsp;';
	}

	if (equipo_fuera != 'Descansa' && item.escudo_equipo_fuera) {
		fuera = '<a href="javascript:load_portada(\'' + item.codequipo_fuera + '\',true,' + rfef + ',\'' + cod_grupo + '\',\'' + cod_competicion + '\')">' + equipo_fuera + '</a>';
		fuera = '<a href="javascript:load_plantilla(\'' + item.codequipo_fuera + '\')" title="Plantilla">'
			+ '<img src="https://www.futgal.es' + item.escudo_equipo_fuera + '" align="absmiddle" class="escudo_logo_medio"></a>&nbsp;&nbsp;' + fuera + '&nbsp;';
	} else {
		if (item.codequipo_fuera)
			fuera = '<a href="javascript:load_portada(\'' + item.codequipo_fuera + '\',true,' + rfef + ',\'' + cod_grupo + '\',\'' + cod_competicion + '\')">' + equipo_fuera + '</a>';
		else
			fuera = '&nbsp;' + equipo_fuera + '&nbsp;';
	}

	if (goles_casa == "" && goles_fuera == "" && !directo) {
		datos = '<tr>'
			+ '<td bgcolor="white" colspan=2>' + casa + '</td>'
			+ '</tr>'
			+ '<tr>'
			+ '<td bgcolor="white" colspan=2>' + fuera + '</td>'
			+ '</tr>';

	} else {
		color_resultado = color_goles('white', cod_equipo, item.codequipo_casa, item.codequipo_fuera, goles_casa, goles_fuera);

		goles_casa_html = goles_casa;
		goles_fuera_html = goles_fuera;
		// resultado provisional (partido en xogo): o marcador aínda é temporal, resáltase en amarelo
		if (marcador_provisional(item)) {
			xogo = '<br>(en xogo)';
			goles_casa_html = '<span class="marcador_temporal">' + goles_casa_html + '</span>';
			goles_fuera_html = '<span class="marcador_temporal">' + goles_fuera_html + '</span>';
		} else
			xogo = '';

		if (item.codacta)
			click = ' title="Acta" onclick="javascript:load_acta(\'' + item.codacta + '\');" ';
		else
			click = '';


		var id_casa = directo ? ' id="' + id_directo + '_casa"' : '';
		var id_fora = directo ? ' id="' + id_directo + '_fora"' : '';

		datos = '<tr>'
			+ '<td bgcolor="white">' + casa + '</td>'
			+ '<td' + id_casa + ' ' + click + ' bgcolor="white" style="background-color:' + color_resultado + ';" align="center">&nbsp;' + goles_casa_html + '&nbsp;' + xogo + '</td>'
			+ '</tr>'
			+ '<tr>'
			+ '<td bgcolor="white">' + fuera + '</td>'
			+ '<td' + id_fora + ' ' + click + ' bgcolor="white" style="background-color:' + color_resultado + ';" align="center">&nbsp;' + goles_fuera_html + '&nbsp;' + xogo + '</td>'
			+ '</tr>';
	}

	if (directo) {
		// o marcador píntase nas dúas celdas (un gol en cada fila), como na portada
		var celda_casa = '#' + id_directo + '_casa';
		var celda_fora = '#' + id_directo + '_fora';
		var codequipo_casa = item.codequipo_casa;
		var codequipo_fuera = item.codequipo_fuera;
		directo_favoritos.push({
			cod_competicion: cod_competicion,
			cod_grupo: cod_grupo,
			jornada: item.jornada || '',
			rfef: rfef,
			lenda: 'lenda_' + id_directo,
			candidato: {
				cod_local: codequipo_casa || '',
				cod_visitante: codequipo_fuera || '',
				local: equipo_casa,
				visitante: equipo_fuera,
				fecha: item.fecha || '',
				goles_local: goles_casa,
				goles_visitante: goles_fuera,
				pinta: function (g1, g2, minuto) {
					var fondo = color_goles('white', cod_equipo, codequipo_casa, codequipo_fuera, g1, g2);
					// o minuto só unha vez, baixo o gol do visitante
					$(celda_casa).html('&nbsp;<span class="marcador_directo">' + g1 + '</span>&nbsp;').css('background-color', fondo);
					$(celda_fora).html('&nbsp;<span class="marcador_directo">' + g2 + '</span>' + minuto + '&nbsp;').css('background-color', fondo);
				}
			}
		});
	}

	return '<table id="' + id + '" class="favoritos">'
		+ '<tr>'
		+ '<th colspan=2  align="absmiddle">' + title + '</th>'
		+ '</tr>'
		+ '<tr>'
		+ '<td bgcolor="#e8e5e4" colspan=2><b>Data:</b>&nbsp;' + dia_str + '</td>'
		+ '</tr>'
		+ '<tr>'
		+ '<td bgcolor="#e8e5e4" colspan=2><b>Campo:</b>&nbsp;' + campo + '</td>'
		+ '</tr>'
		+ datos
		+ (directo ? '<tr id="lenda_' + id_directo + '" style="display:none;"><td colspan=2 bgcolor="white" style="font-size:10px;"><span class="marcador_directo">Marcador en directo</span> (' + (rfef ? 'marcadores.rfef.es' : 'futgal.es') + ')</td></tr>' : '')
		+ '<tr>'
		+ '<td class="table_noborder">&nbsp;</td>'
		+ '</tr>'
		+ '</table>';
}

