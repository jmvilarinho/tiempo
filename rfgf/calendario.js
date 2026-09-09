var ec;
var favorite_load = [];
var arr_datos = [];
var arr_event = [];

async function load_calendario(addHistory = true) {
	displayLoading();
	setCookie('paginaRFGF', 'calendario', 30)
	if (addHistory)
		history.pushState(null, "", '#calendario');

	sanitizeEquiposCookies();

	calendario = getCookieArray('calendarioItems');
	if (calendario.length <= 0) {
		calendario = calendario_default;
	}
	setCookie('calendarioItems', JSON.stringify(calendario), 365);
	var arrayLength = calendario.length;

	$('#results').html('');
	add_back('calendario');
	$('#results').append('<div id="equipo_load">(Cargando datos ...)</div><main class="row" style="white-space: wrap;" ><div id="ec" class="col"></div></main>');

	creaCalendario();
	arr_datos = [];
	arr_event = [];
	favorite_load = [];
	for (var i = 0; i < arrayLength; i++) {
		favorite_load.push(calendario[i]);
		// limita concurrencia a 6
		while (favorite_load.length > 6)
			await new Promise(r => setTimeout(r, 300));
		get_data_equipo_async_calendario(calendario[i])
	}

	var arrayLength = equipos.length;
	var html_fav = '<table class="table_noborder"><tr><th colspan=3 class="table_noborder">Equipos</th></tr>';
	for (var i = 0; i < arrayLength; i++) {
		var start = '';
		var end = '';
		if (i % 3 == 0)
			start = '<tr>';
		if (i % 3 == 2)
			end = '</tr>';

		var checked = '';
		if (calendario.indexOf('' + equipos[i].id) >= 0) {
			checked = 'checked="true"';
		}
		html_fav += start + '<td class="table_noborder" id="td_' + equipos[i].id + '_color">'
			+ '<div  id="label_' + equipos[i].id + '_color" style="color: black;">'
			+ '<input type="checkbox" ' + checked + ' value="' + equipos[i].id + '" onclick="setArrayCookie(\'calendarioItems\',this)">&nbsp;' + equipos[i].name + '&nbsp;'
			+ '</div></td>' + end;
	}
	if (arrayLength % 3 != 0)
		html_fav += '</tr>';
	$('#results').append(html_fav + '<tr><td class="table_noborder" colspan=2 align="center">(Resaltado si hai datos)</td></tr></table><hr>');

	add_back('calendario');
	end_page();
	hideLoading();

	var x = 0;
	while (x < 60000) {
		$('#equipo_load').html(' (Cargando datos, pendientes ' + favorite_load.length + ')');
		if (favorite_load.length <= 0)
			break
		// sleep 300 ms
		await new Promise(r => setTimeout(r, 300));
		x += 500;
	}
	$('#equipo_load').html('');

	// Na lenda o texto vai en negro (posto no propio markup, así vale tamén para
	// os equipos sen datos) e en branco só nos equipos con partido esta semán,
	// que son os que levan a cor do equipo de fondo.
	var arrayLength = arr_datos.length;
	for (var i = 0; i < arrayLength; i++) {
		td = '#td_' + arr_datos[i] + '_color';
		$(td).css('backgroundColor', getEquipoColor(arr_datos[i]));
		if (arr_event.includes(arr_datos[i])) {
			label = '#label_' + arr_datos[i] + '_color';
			$(label).css('color', 'white');
		}
	}

	// O calendario amosa sempre a semán a partir do día actual: agóchanse os días
	// anteriores a hoxe. O bucle só chega a 5 (venres), así que sábado (6) e domingo
	// (0, o último coa opción firstDay: 1) quedan sempre visibles; se hoxe é domingo
	// agóchase ata o venres, para non deixar o domingo só.
	// Faise sempre, non só cando hai eventos: antes o rango calculábase desde o
	// primeiro partido (firstEvent, inicializado ao sábado seguinte), así que se
	// ningún equipo seleccionado xogaba antes do sábado desaparecía o día actual.
	var hiddenDays = [];
	var idxnow = new Date().getDay();
	var last_idx = (idxnow == 0) ? 6 : idxnow;
	for (var x = 1; x < last_idx; x++) {
		hiddenDays.push(x);
	}
	ec.setOption('hiddenDays', hiddenDays);

}

function creaCalendario() {
	// https://github.com/vkurko/calendar
	ec = new EventCalendar(document.getElementById('ec'), {
		view: 'timeGridWeek',
		headerToolbar: {
			start: '',
			center: 'title',
			end: ''
		},
		//resources: [
		//	{ id: 1, title: 'Resource A' }
		//],
		//scrollTime: '09:00:00',
		slotMinTime: '09:00:00',
		slotMaxTime: '23:00:00',
		//hiddenDays: [1, 2, 3, 4],
		eventClick: function (info) {
			load_portada(info.event.id);
		},
		// A icona de "xoga na casa" vai inline diante da hora, e constrúese aquí
		// (eventContent) e non en eventDidMount: a libraría reconstrúe o contido
		// do evento (setContent → replaceChildren) cada vez que cambian as datas
		// ou as opcións — por exemplo no setOption('hiddenDays') do final de
		// load_calendario — mentres que eventDidMount só se dispara no onMount,
		// así que o que se inxectaba no DOM desde alí víase e desaparecía.
		// eventContent reavalíase en cada reconstrución, así que a icona queda.
		eventContent: function (info) {
			if (info.event.display !== 'auto')
				return undefined;
			var titulo = info.event.title;
			if (titulo && titulo.html)
				titulo = titulo.html;
			var hora = '';
			if (!info.event.allDay) {
				var casa = '';
				var clases = 'ec-event-time';
				if (info.event.extendedProps.home) {
					casa = '<img class="home_widget_calendario" src=../img/home-black.png>';
					clases += ' hora_casa';
				}
				hora = '<time class="' + clases + '">' + casa + '<span class="hora_calendario">' + info.timeText + '</span></time>';
			}
			return { html: hora + '<h4 class="ec-event-title">' + titulo + '</h4>' };
		},
		flexibleSlotTimeLimits: false,
		dayMaxEvents: true,
		nowIndicator: true,
		selectable: false,
		firstDay: 1,
		allDaySlot: false,
		displayEventEnd: false,
		editable: false,
		slotEventOverlap: false
	});
}


async function get_data_equipo_async_calendario(cod_equipo) {
	var url = remote_url + "?type=getequipo&codequipo=" + cod_equipo;
	codgrupo = getEquipoGrupo(cod_equipo)
	if (codgrupo) {
		url += "&codgrupo=" + codgrupo;
	}
	codcompeticion = getEquipoCompeticion(cod_equipo)
	if (codcompeticion) {
		url += "&codcompeticion=" + codcompeticion;
	}
	if ( isRFEF(cod_equipo) ) {
		url += "&rfef=1";
	}
	//console.log("GET " + url);

	fetch(url)
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
				show_portada_equipo_calendario(data.data, cod_equipo);
				favorite_load.pop();
			} else {
				favorite_load.pop();
				throw new Error('No data found in response');
			}
		})
		.catch(error => {
			favorite_load.pop();
			console.error('Get equipo "' + cod_equipo + '" error:', error.message);  // Log the error
		});
}

function show_portada_equipo_calendario(data, cod_equipo) {
	if (data.competiciones_equipo.length > 0) {

		arr_datos.push(cod_equipo);

		jQuery.each(data.competiciones_equipo, function (index, item) {
			nombre_equipo = getEquipoName(cod_equipo, data.nombre_equipo);

			cont = 0;
			jQuery.each(item.partidos, function (index, item) {
				cont += 1
				var pattern = /(\d{2})\-(\d{2})\-(\d{4}) (\d{2})\:(\d{2})/;
				hora = item.fecha;
				if (item.hora && item.hora !== "00:00") {
					hora += ' ' + item.hora;
					var date_obj = new Date(hora.replace(pattern, '$3-$2-$1 $4:$5'));
					var date_now_obj = new Date(Date.now())
					if (isSameWeek(date_obj, date_now_obj)) {
						isHome = false;
						if (item.codequipo_casa == cod_equipo) {
							//nombre_equipo = '<img src=home.png  class="home_widget"> ' + nombre_equipo;
							isHome = true;
						}
						end = new Date(date_obj.getTime() + getEquipoDuracion(cod_equipo) * 60000);
						eventCalendar = {
							start: date_obj,
							end: end,
							id: cod_equipo,
							editable: false,
							startEditable: false,
							durationEditable: false,
							title: {
								html: nombre_equipo
							},
							extendedProps: {
								home: isHome
							},
							styles: ['font-size: 9px;'],
							color: getEquipoColor(cod_equipo),
							textColor: 'black',
						};
						ec.addEvent(eventCalendar);
						arr_event.push(cod_equipo);
					}
				}
			});
		});
	}
	return true;
}

