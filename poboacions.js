
const precipitacion_metosix_test = 0; // Set to 1 to inject random test data for MeteoGalicia precipitation
const precipitacion_aemet_test = 0; // Set to 1 to inject random test data for AEMET precipitation
const precipitacion_debug = 0; // Set to 1 to enable debug logs for precipitation data

function getPrevisionMunicipio(id, element, id_cofc = 0, lat = 0, lon = 0) {
	const ms = Date.now();
	//var url = 'https://opendata.aemet.es/opendata/api/prediccion/especifica/municipio/diaria/' + id + '/?api_key=' + apiKey + "&nocache=" + ms
	//var url = 'https://opendata.aemet.es/opendata/api/prediccion/especifica/municipio/diaria/' + id + '/?api_key=' + apiKey;
	var url = 'https://opendata.aemet.es/opendata/api/prediccion/especifica/municipio/diaria/' + id;
	console.log('Get prevision municipio: ' + url)

	fetch(proxyHost + url)
		.then(async response => {
			const body = await response.text();
			//console.log('Response status: ' + body);
			if (body == "Internal Server Error") {
				noPrevision(element, 0, 'Timeout obtendo previsión, inténtao máis tarde');
				return false;
			}
			return JSON.parse(body);
		})
		.then(data => getPrevisionDatosMunicipio(data, element, id, id_cofc, lat, lon))
		.catch(error => {
			console.error('Error:', error.message);
			noPrevision(element, 0, error.message);
			return false;
		});
}

function getPrevisionDatosMunicipio(data, element, id_municipio, id_cofc = 0, lat = 0, lon = 0) {

	if (data['estado'] == 200) {
		if ('error' in data && data['error'] != "") {
			showError(data['error'], element);
			return;
		}
		if ("source" in data) {
			console.log("Datos de '" + id_municipio + "' from '" + data['source'] + "'");
		}
		if ("datos_json" in data) {
			console.log("Datos completos para " + id_municipio);
			createPrevisionMunicipio(data['datos_json'], element, id_municipio, id_cofc, lat, lon);
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
					createPrevisionMunicipio(JSON.parse(text), element, id_municipio, id_cofc, lat, lon);
				});
		}
	}
}

async function createPrevisionMunicipio(data, element, id_municipio, id_cofc = 0, lat = 0, lon = 0) {
	const now = new Date();
	current_hour = now.getHours();

	var tabla = "<table id=\"tablaMunicipio-" + id_municipio + "\" class=\"center\">";
	tabla += "<tr><th colspan=4>";

	if (lat != 0 && lon != 0) {
		tabla += "<img id=\"iconoGasolinera-" + id_municipio + "\" src=\"img/gasolinera.png\" alt=\"Precios combustible\" height=\"16px\"/ onclick=\"loadGasolinera('" + data[0]["nombre"] + "'," + id_municipio + "," + lat + "," + lon + ")\" style=\"cursor: pointer;\" title=\"Precios combustible\" >";
		tabla += "&nbsp;&nbsp;";
	}
	tabla += '<a href="https://www.aemet.es/es/eltiempo/prediccion/municipios/' + aplanaTexto(data[0]["nombre"]) + '-id' + id_municipio + '#detallada" target="_new" rel="noopener" >'
		+ "Prevision para " + data[0]["nombre"]
		+ "</a>";
	if (id_cofc != 0) {
		tabla += "&nbsp;&nbsp;";
		tabla += "<img id=\"iconoFarmacia-" + id_cofc + "\" src=\"img/farmacia.png\" alt=\"Farmacia\" height=\"15px\"/ onclick=\"loadFarmacia(" + id_municipio + "," + id_cofc + ")\" style=\"cursor: pointer;\" title=\"Cofc.es - Farmacia de guardia\" >"; tabla += "&nbsp;&nbsp;";
	}
	tabla += "</th></tr>";

	var arrayLength = data[0]["prediccion"]["dia"].length;
	maxItems = 3;
	cont = 0;
	for (var i = 0; i < arrayLength; i++) {
		var datos = data[0]["prediccion"]["dia"][i];
		if (isToday(datos["fecha"])) {
			tabla += "<tr>"
				+ "<th>Temp. Min.</th><td>" + datos["temperatura"]["minima"] + "&deg;</td>"
				+ "<th>Temp. Max.</th><td>" + datos["temperatura"]["maxima"] + "&deg;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</td>"
				+ "</tr>";

			row = municipioRow(datos, 1);
			if (row != "" && current_hour <= 12) {
				tabla += row;
				cont += 1;
			}
			row = municipioRow(datos, 2);
			if (row != "" && current_hour <= 19) {
				tabla += row;
				cont += 1;
			}
			//tabla += municipioRow(datos, 4);
			//tabla += municipioRow(datos, 5);
			//tabla += municipioRow(datos, 6);
		}
		if (isTomorrow(datos["fecha"]) && cont < maxItems && (current_hour >= 12 || cont == 1)) {
			var datos2 = data[0]["prediccion"]["dia"][i];

			tabla += "<tr><th colspan=4>"
				+ getPrintDateHour(datos2["fecha"])
				+ "</th></tr>";

			tabla += "<tr>"
				+ "<th>Temp. Min.</th><td>" + datos2["temperatura"]["minima"] + "&deg;</td>"
				+ "<th>Temp. Max.</th><td>" + datos2["temperatura"]["maxima"] + "&deg;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</td>"
				+ "</tr>";
			row = municipioRow(datos, 1);
			if (row != "" && cont < maxItems) {
				tabla += row;
				cont += 1;
			}
			row = municipioRow(datos, 2);
			if (row != "" && cont < maxItems) {
				tabla += row;
				cont += 1;
			}

			//tabla += municipioRow(datos, 4);
			//tabla += municipioRow(datos, 5);
			//tabla += municipioRow(datos, 6);
		}
		//console.log(datos["fecha"],cont,maxItems,current_hour)
	}

	var dt = new Date(data[0]["elaborado"]);
	var fecha_prediccion = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false };

	tabla += '<tr "><td colspan=4>';
	tabla += '<a href="http://www.aemet.es" target="copyright">AEMET</a>: ' + dt.toLocaleDateString("es-ES", fecha_prediccion);
	tabla += '</td ></tr >';

	tabla += '<tr  id="trmunicipio' + id_municipio + '"><td colspan=4>';
	tabla += '<div id="divmunicipio' + id_municipio + '"><canvas hidden id="municipio' + id_municipio + '"></canvas></div>';
	tabla += '</td ></tr >';


	tabla += "</table>";

	const keyDiv = document.createElement('div');
	keyDiv.innerHTML = tabla
	keyDiv.style.textAlign = "center";
	const mainDiv = document.getElementById(element);
	mainDiv.appendChild(keyDiv);

	// document.getElementById("data_prevision_municipio").innerHTML = "<p style='font-size:12px;'>"
	// 	+ "<a href='http://www.aemet.es' target='copyright'>"
	// 	+ "Previsión poboacions por AEMET: "
	// 	+ dt.toLocaleDateString("es-ES", fecha_prediccion)
	// 	+ "</a></p>";


	const ms = Date.now();


	// Fetch Meteosix precipitation data and wait for completion
	await getMeteosixPrecipitacion(id_municipio, lat, lon, element);


	//url = 'https://opendata.aemet.es/opendata/api/prediccion/especifica/municipio/horaria/' + id_municipio + '/?api_key=' + apiKey + "&nocache=" + ms
	//url = 'https://opendata.aemet.es/opendata/api/prediccion/especifica/municipio/horaria/' + id_municipio + '/?api_key=' + apiKey;
	url = 'https://opendata.aemet.es/opendata/api/prediccion/especifica/municipio/horaria/' + id_municipio;
	console.log('Get precipitacion AEMET: ' + proxyHost + url);
	fetch(proxyHost + url)
		.then(response => response.json())
		.then(data => getPrevisionPrecipitacionMunicipio(data, element, id_municipio))
		.catch(error => {
			console.error('Error:', error);
			$('#divmunicipio' + id_municipio).html('Error obtendo precipitacións');
			return false;
		});
}

function municipioRow(datos, index) {
	if (datos["estadoCielo"][index]["value"] == "") {
		row = "";
	} else {
		rowspan = 2;
		snowLine = '';
		if (datos["cotaNieveProv"][index]["value"] != "") {
			rowspan += 1;
			snowLine += "<tr>"
				+ "<th>Neve</th><td style='text-align: left;' colspan=2>" + datos["cotaNieveProv"][index]["value"] + " m.</td>"
		}

		vientoLine = '';
		if (datos["viento"][index]["velocidad"] != '0') {
			rowspan += 1;
			viento = datos["viento"][index]["velocidad"] + ' km/h <img style="vertical-align:middle"  height=20px src="img/wind-' + datos["viento"][index]["direccion"] + '.png">';
			vientoLine = "<tr><th>Vento</th><td style='text-align: left;vertical-align:middle;border:0px;' colspan=2><div>" + viento + '</div></td>';
		}

		precipitacionLine = '';
		if (datos["probPrecipitacion"][index]["value"] != '0') {
			rowspan += 1;
			if (datos["probPrecipitacion"][index]["value"] == '100')
				precipitacion = 'Seguro que llueve';
			else
				precipitacion = datos["probPrecipitacion"][index]["value"] + '% probab. de lluvia';
			precipitacionLine = "<tr><th>Precip.</th><td style='text-align: left;' colspan=2>" + precipitacion + "</td>";
		}

		row = "<tr>"
			+ '<th rowspan=' + rowspan + '>' + datos["estadoCielo"][index]["periodo"] + ' h<br><img src="img/' + datos["estadoCielo"][index]["value"] + '_g.png" height="50px"></th>'
			+ "<tr>"
			+ "<th>Ceo</th><td style='text-align: left;' colspan=2>" + datos["estadoCielo"][index]["descripcion"] + "</td>"
			+ vientoLine
			+ precipitacionLine
			+ snowLine
			+ "</tr>";
	}
	return row;
}


function getPrevisionPrecipitacionMunicipio(data, element, id_municipio) {
	if (data['estado'] == 200) {

		if ("source" in data) {
			console.log("Datos precipitacion de '" + id_municipio + "' from '" + data['source'] + "'");
		}
		if ("datos_json" in data) {
			console.log("Datos completos precipitacion para " + id_municipio);
			createPrevisionPrecipitacionMunicipio(data['datos_json'], element, id_municipio, null);
		} else {

			console.log('Get precipitacion: ' + data['datos'])
			var myHeaders = new Headers();
			myHeaders.append('Content-Type', 'text/plain; charset=UTF-8');

			fetch(data['datos'], myHeaders)
				.then(function (response) {
					return response.arrayBuffer();
				})
				.then(function (buffer) {
					const decoder = new TextDecoder('iso-8859-1');
					const text = decoder.decode(buffer);
					createPrevisionPrecipitacionMunicipio(JSON.parse(text), element, id_municipio, null);
				})
				.catch(error => {
					console.error('Error:', error);
					$('#divmunicipio' + id_municipio).html('Error obtendo precipitacións');
					return false;
				});
		}
	} else {
		$('#divmunicipio' + id_municipio).html('Error obtendo precipitacións');
	}
}

async function getMeteosixPrecipitacion(id_municipio, lat, lon, element) {
	// MeteoGalicia API endpoint for precipitation data

	const now = new Date();
	const formatLocalDateTime = (d) => {
		const pad = n => String(n).padStart(2, '0');
		const r = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
		return r;
	};
	const startTime = formatLocalDateTime(now);
	const enddate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
	const endTime = formatLocalDateTime(enddate);

	// curl "https://servizos.meteogalicia.gal/apiv5/findPlaces?location=ordes&API_KEY=2jBydgUAK6Op9eVTGmOW2De2Z0q1S3FKKe56bpuv7nd0S79jx1r9400A2sFoHF6a"
	if (!(id_municipio in id_map)) {
		console.warn('No MeteoGalicia ID for municipio ' + id_municipio);
		window.precipitacionDataByMunicipio = window.precipitacionDataByMunicipio || {};
		window.precipitacionDataByMunicipio[id_municipio] = null;
		window.precipitacionData = null;
		return;
	}

	const meteogaliciaUrl = `https://servizos.meteogalicia.gal/apiv5/getNumericForecastInfo?locationIds=${id_map[id_municipio]}&variables=precipitation_amount&startTime=${startTime}&endTime=${endTime}`;
	const proxiedMeteogaliciaUrl = proxyHostMeteosix + encodeURIComponent(meteogaliciaUrl);
	console.log('Get precipitacion MeteoGalicia: ' + proxiedMeteogaliciaUrl, id_municipio);

	// Timeout de 10 s: se MeteoGalicia tarda máis, abortamos e pintamos só con AEMET.
	const controller = new AbortController();
	const timeoutId = setTimeout(function () { controller.abort(); }, 10000);

	try {
		const response = await fetch(proxiedMeteogaliciaUrl, { signal: controller.signal });
		const data = await response.json();

		if (data && 'statusCode' in data && data.statusCode == 500) {
			console.warn('MeteoGalicia API error for ' + id_municipio + ': ' + (data.error || 'Unknown error'));
			window.precipitacionData = null;
			return;
		}

		// Inject random test precipitation data
		if (precipitacion_metosix_test == 1) {
			const values = [];
			for (let i = 0; i < 24; i++) {
				values.push({
					hour: String(i).padStart(2, '0'),
					value: Math.random() < 0.4 ? Number((Math.random() * 10).toFixed(1)) : 0
				});
			}

			data['datos_json'] = {
				content: {
					features: [{
						properties: {
							days: [
								{},
								{ variables: [{ values: values }] }
							]
						}
					}]
				}
			};
		}

		let meteosixPayload = data?.datos_json ?? data;
		if (typeof meteosixPayload === 'string') {
			try {
				meteosixPayload = JSON.parse(meteosixPayload);
			} catch (e) {
				console.warn('Could not parse MeteoGalicia datos_json string for ' + id_municipio);
			}
		}

		// Some proxy variants can still wrap payload one more level.
		if (meteosixPayload && meteosixPayload.datos_json) {
			meteosixPayload = meteosixPayload.datos_json;
		}

		window.precipitacionDataByMunicipio = window.precipitacionDataByMunicipio || {};
		window.precipitacionDataByMunicipio[id_municipio] = meteosixPayload;
		window.precipitacionData = meteosixPayload;
		if (window.chartData && window.chartData[id_municipio]) {
			renderChartWithBothDatasets(id_municipio);
		}
	} catch (error) {
		if (error && error.name === 'AbortError') {
			console.warn('MeteoGalicia timeout (10s) para ' + id_municipio + ', úsase só AEMET');
		} else {
			console.warn('Could not fetch MeteoGalicia data:', error);
		}
		window.precipitacionDataByMunicipio = window.precipitacionDataByMunicipio || {};
		window.precipitacionDataByMunicipio[id_municipio] = null;
		window.precipitacionData = null;
	} finally {
		clearTimeout(timeoutId);
	}
}

function extractMeteosixPrecipitacion(meteosixData, labels) {
	// Parse MeteoGalicia API response: data items are {time: "2026-03-25T06:00:00Z", value: 0.5}
	// Build a map from hour string ("06") -> precipitation value, then align with AEMET labels
	const hourMap = {};

	const normalizeHourLabel = (raw) => {
		if (raw === undefined || raw === null) return null;
		const s = String(raw).trim();
		// Supports labels like "16", "16-17", "16-18", "1600", etc.
		const m = s.match(/(\d{1,2})/);
		if (!m) return null;
		const h = Number(m[1]);
		if (Number.isNaN(h) || h < 0 || h > 23) return null;
		return String(h).padStart(2, '0');
	};

	const getHourFromItem = (item) => {
		if (item.hour !== undefined) {
			return normalizeHourLabel(item.hour);
		}

		const candidateTime = item.timeInstant ?? item.time ?? item.date ?? item.datetime;
		if (candidateTime !== undefined) {
			const t = String(candidateTime);
			const directHourMatch = t.match(/T(\d{2}):(\d{2})/);
			if (directHourMatch) {
				return directHourMatch[1];
			}

			const d = new Date(candidateTime);
			if (!Number.isNaN(d.getTime())) {
				return String(d.getHours()).padStart(2, '0');
			}
		}

		if (item.periodo !== undefined) {
			return normalizeHourLabel(item.periodo);
		}

		return null;
	};

	const buildHourMap = (values) => {
		const map = {};
		values.forEach(item => {
			// support {hour}, {time}, {timeInstant}, {periodo}
			const h = getHourFromItem(item);
			if (h !== null) {
				map[h] = (map[h] || 0) + (Number(item.value) || 0);
			}
		});
		return map;
	};

	const mapByHour = (map) => labels.map(label => {
		const key = normalizeHourLabel(label);
		if (key === null) return 0;
		return map[key] !== undefined ? map[key] : 0;
	});

	try {
		if (Array.isArray(meteosixData) && meteosixData.length > 0) {
			return mapByHour(buildHourMap(meteosixData));
		}

		const features = meteosixData?.content?.features;
		if (Array.isArray(features) && features.length > 0) {
			const allValues = [];
			features.forEach(feature => {
				const days = feature?.properties?.days;
				if (!Array.isArray(days)) return;
				days.forEach(day => {
					const variables = day?.variables;
					if (!Array.isArray(variables)) return;
					const precipVar = variables.find(v => v?.name === 'precipitation_amount') || variables[0];
					const values = precipVar?.values;
					if (Array.isArray(values)) {
						allValues.push(...values);
					}
				});
			});

			if (allValues.length > 0) {
				return mapByHour(buildHourMap(allValues));
			}
		}

		if (meteosixData && meteosixData.results && meteosixData.results.length > 0) {
			const result = meteosixData.results[0];
			if (result.variables && result.variables.length > 0) {
				const precipVar = result.variables[0];
				if (precipVar.data && precipVar.data.length > 0) {
					precipVar.data.forEach(item => {
						// item.time is ISO string like "2026-03-25T06:00:00Z"
						const hourStr = String(new Date(item.time).getHours()).padStart(2, '0');
						hourMap[hourStr] = (hourMap[hourStr] || 0) + (Number(item.value) || 0);
					});
				}
			}
		}
	} catch (error) {
		console.error('Error parsing MeteoGalicia data:', error);
	}

	// Return values aligned with AEMET labels
	return labels.map(label => {
		const key = normalizeHourLabel(label);
		if (key === null) return 0;
		return hourMap[key] !== undefined ? hourMap[key] : 0;
	});
}

async function createPrevisionPrecipitacionMunicipio(data, element, id_municipio, meteosixData = null) {
	var datos_array = [];
	const now = new Date();
	current_hour = now.getHours()

	// Inject random test precipitation data
	if (precipitacion_aemet_test == 1) {
		const periodos = ["00", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19", "20", "21", "22", "23"];
		data[0]["prediccion"]["dia"].forEach(dia => {
			dia["precipitacion"] = periodos.map(p => ({
				periodo: p,
				value: (Math.random() < 0.4 ? (Math.random() * 10).toFixed(1) : "0")
			}));
		});
	}

	var datos_array_dia = data[0]["prediccion"]["dia"];
	var arrayLength = datos_array_dia.length;

	var today_encontrado = false;
	for (var i = 0; i < arrayLength; i++) {
		if (today_encontrado) {
			today_encontrado = false;
			manana = datos_array_dia[i]['precipitacion'];
			for (var x = 0; x < manana.length; x++) {
				hora = Number(manana[x]['periodo']);
				if (hora < current_hour) {
					datos_array.push(manana[x]);
				}
			}
		}
		if (isToday(datos_array_dia[i]['fecha'])) {
			today_encontrado = true;
			hoy = datos_array_dia[i]['precipitacion'];
			for (var x = 0; x < hoy.length; x++) {
				hora = Number(hoy[x]['periodo']);
				if (hora >= current_hour) {
					datos_array.push(hoy[x]);
				}
			}
		}
	}

	var arrayLength = datos_array.length;
	if (arrayLength == 0) {
		$('#divmunicipio' + id_municipio).html('Non hai datos de precipitacións');
		return;
	}

	var labels = [];
	var data_aemet = [];
	var max = 0;

	for (var i = 0; i < arrayLength; i++) {
		hora = Number(datos_array[i]['periodo']);
		precipitacion = Number(datos_array[i]['value']);
		if (hora >= current_hour || true) {
			labels.push(datos_array[i]['periodo']);
			data_aemet.push(precipitacion);
			if (precipitacion > max) {
				max = precipitacion;
			}
		}
	}

	// Store chart context for later updates
	window.chartData = window.chartData || {};
	window.chartData[id_municipio] = {
		labels: labels,
		data_aemet: data_aemet,
		canvas_id: 'municipio' + id_municipio,
		container_id: 'divmunicipio' + id_municipio,
		row_id: 'trmunicipio' + id_municipio,
		max: max
	};

	// Initial render with AEMET data only
	renderChart(id_municipio);
}



function renderChart(id_municipio) {
	if (!window.chartData || !window.chartData[id_municipio]) return;

	const chartInfo = window.chartData[id_municipio];
	const max = chartInfo.max;
	const labels = chartInfo.labels;
	const data_aemet = chartInfo.data_aemet;

	// Extract MeteoGalicia data if available
	let data_meteosix = null;

	const meteosixForMunicipio = window.precipitacionDataByMunicipio?.[id_municipio] ?? window.precipitacionData;
	if (meteosixForMunicipio) {
		data_meteosix = extractMeteosixPrecipitacion(meteosixForMunicipio, labels);
	}
	if (precipitacion_debug) {
		console.log('MeteoGalicia data for ' + id_municipio + ': ', data_meteosix);
		console.log('AEMET data for ' + id_municipio + ': ', data_aemet);
	}

	const hasAemet = data_aemet !== null && data_aemet.some(v => v !== null && v !== undefined && Number(v) > 0);
	const hasMeteosix = data_meteosix !== null && data_meteosix.some(v => v !== null && v !== undefined && Number(v) > 0);

	// Compute effective max across whichever datasets have data
	let effectiveMax = 0;
	if (hasAemet) effectiveMax = Math.max(effectiveMax, ...data_aemet.map(v => Number(v) || 0));
	if (hasMeteosix) effectiveMax = Math.max(effectiveMax, ...data_meteosix.map(v => Number(v) || 0));
	chartInfo.max = effectiveMax;


	if (effectiveMax > 0 || hasAemet || hasMeteosix) {

		const canvas = document.getElementById(chartInfo.canvas_id);
		if (!canvas) return;

		canvas.style.visibility = "visible";

		// Destroy previous chart if it exists
		if (window.chartInstances && window.chartInstances[id_municipio]) {
			window.chartInstances[id_municipio].destroy();
		}

		if (!window.chartInstances) {
			window.chartInstances = {};
		}

		var myContext = canvas.getContext('2d');
		var datasets = [];
		const isAemetTestData = precipitacion_aemet_test === 1;
		const isMeteosixTestData = precipitacion_metosix_test === 1;
		const hasTestData = isAemetTestData || isMeteosixTestData;
		const titleSource = hasAemet && !hasMeteosix ? 'AEMET' : (!hasAemet && hasMeteosix ? 'MeteoGalicia' : null);
		const titleText = titleSource ? `Precipitación ${titleSource} (mm/hora)` : 'Precipitación (mm/hora)';

		// Show AEMET if it has data
		if (hasAemet) {
			datasets.push({
				label: isAemetTestData ? 'AEMET (TEST)' : 'AEMET',
				backgroundColor: "rgba(30, 100, 220, 0.75)",
				borderColor: "rgba(30, 100, 220, 1)",
				borderWidth: 1,
				data: data_aemet,
				order: 1
			});
		}

		// Show MeteoGalicia if it has data
		if (hasMeteosix) {
			datasets.push({
				label: isMeteosixTestData ? 'MeteoGalicia (TEST)' : 'MeteoGalicia',
				backgroundColor: "rgba(230, 120, 0, 0.75)",
				borderColor: "rgba(230, 120, 0, 1)",
				borderWidth: 1,
				data: data_meteosix,
				order: 2
			});
		}


		const backgroundBands = {
			id: 'backgroundBands',
			beforeDraw(chart) {
				const { ctx, chartArea, scales } = chart;
				const x = scales.x;

				if (!x || !chartArea) return;

				const ticks = x.ticks;

				ctx.save();

				for (let i = 0; i < ticks.length; i++) {

					// 👉 every 2 ticks
					if (i % 2 !== 0) continue;

					// current tick pixel
					const xCurrent = x.getPixelForTick(i);

					// next tick pixel (or extrapolate for last)
					const xNext = i < ticks.length - 1
						? x.getPixelForTick(i + 1)
						: xCurrent + (xCurrent - x.getPixelForTick(i - 1));

					// previous tick pixel (or extrapolate for first)
					const xPrev = i > 0
						? x.getPixelForTick(i - 1)
						: xCurrent - (x.getPixelForTick(1) - xCurrent);

					// 👉 boundaries at midpoints
					const xStart = (xPrev + xCurrent) / 2;
					const xEnd = (xCurrent + xNext) / 2;

					ctx.fillStyle = 'rgba(0, 0, 0, 0.10)';
					ctx.fillRect(
						xStart,
						chartArea.top,
						xEnd - xStart,
						chartArea.bottom - chartArea.top
					);
				}

				ctx.restore();
			}
		};

		var myChart = new Chart(myContext, {
			type: 'bar',
			data: {
				labels: labels,
				datasets: datasets,
			},
			options: {
				plugins: {
					title: {
						display: true,
						text: titleText
					},
					legend: {
						display: datasets.length > 1,
						position: 'bottom',
						labels: {
							boxWidth: 10,
							boxHeight: 10,
							padding: 2,
							font: {
								size: 9
							}
						}
					},
					tooltip: {
						callbacks: {
							title: (items) => {
								const raw = items?.[0]?.label;
								return raw !== undefined && raw !== null ? `${raw} h` : '';
							},
							label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y !== null ? ctx.parsed.y.toFixed(1) : 'N/D'} mm`
						}
					}
				},
				scales: {
					y: {
						beginAtZero: true,
						suggestedMin: 0,
						suggestedMax: Math.max(4, effectiveMax),
						title: {
							display: true,
							text: 'mm'
						}
					},


					x: {
						type: 'category',
						grid: {
							color: 'rgba(0,0,0,0.1)',
							tickLength: 0,
						},
						ticks: {
							autoSkip: false,
							align: 'start',
							labelOffset: 4,
							callback: function (value, index) {
								return index % 2 === 0 ? this.getLabelForValue(value) : '';
							}
						},

					}



				}
			},
			plugins: [backgroundBands]
		});

		window.chartInstances[id_municipio] = myChart;
	} else {
		const row = document.getElementById(chartInfo.row_id);
		if (row) {
			row.remove();
			if (precipitacion_debug) {
				console.warn('No precipitation data to display for ' + id_municipio + ', hiding chart.');
			}
		}
	}
}

function renderChartWithBothDatasets(id_municipio) {
	// Re-render chart when MeteoGalicia data is available
	renderChart(id_municipio);
}

function getPrintDateHour(dateInput) {
	const dateStr = String(dateInput);
	const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2}).*$/);

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

// ============================================================
// IPMA (Instituto Português do Mar e da Atmosfera) - Portugal
// ============================================================

const IPMA_WEATHER_TO_AEMET_ICON = {
	1: '11', 2: '12', 3: '13', 4: '16', 5: '14',
	6: '25', 7: '23', 8: '27', 9: '25', 10: '23',
	11: '27', 12: '24', 13: '23', 14: '27', 15: '23',
	16: '43', 17: '44', 18: '33', 19: '51', 20: '52',
	21: '34', 22: '11', 23: '54', 24: '17', 25: '13',
	26: '44', 27: '16', 28: '33', 29: '35', 30: '35'
};

const IPMA_WEATHER_DESCRIPTIONS = {
	0: 'Sen información', 1: 'Ceo despexado', 2: 'Pouco nuboso',
	3: 'Intervalos nubosos', 4: 'Moi nuboso ou cuberto', 5: 'Nubes altas',
	6: 'Chuvascos/chuvia', 7: 'Chuvascos febles', 8: 'Chuvascos fortes',
	9: 'Chuvia/chuvascos', 10: 'Chuvia feble', 11: 'Chuvia forte',
	12: 'Períodos de chuvia', 13: 'Períodos de chuvia feble', 14: 'Períodos de chuvia forte',
	15: 'Chuvisca', 16: 'Brétema', 17: 'Néboa', 18: 'Neve',
	19: 'Trebóns', 20: 'Chuvascos e trebóns', 21: 'Sarabia', 22: 'Xeada',
	23: 'Chuvia e trebóns', 24: 'Nubes convectivas', 25: 'Períodos moi nubosos',
	26: 'Néboa', 27: 'Nuboso', 28: 'Chuvascos de neve',
	29: 'Chuvia e neve', 30: 'Chuvia e neve'
};

const IPMA_WIND_DESCRIPTIONS = { 1: 'Feble', 2: 'Moderado', 3: 'Forte', 4: 'Moi forte' };

function getPrevisionIPMA(globalIdLocal, element, nombre = '', lat = 0, lon = 0, urllink = null) {
	const url = 'https://api.ipma.pt/open-data/forecast/meteorology/cities/daily/' + globalIdLocal + '.json';
	console.log('Get prevision IPMA: ' + url);
	fetch(url)
		.then(response => response.json())
		.then(data => createPrevisionIPMA(data, element, globalIdLocal, nombre, lat, lon, urllink))
		.catch(error => {
			console.error('Error IPMA:', error);
			noPrevision(element, 0, error.message);
		});
}

function ipmaRow(forecast, label) {
	const id = Number(forecast.idWeatherType);
	const icon = IPMA_WEATHER_TO_AEMET_ICON[id] || '11';
	const desc = IPMA_WEATHER_DESCRIPTIONS[id] || '';
	const wind = IPMA_WIND_DESCRIPTIONS[Number(forecast.classWindSpeed)] || '';
	const prob = Number(forecast.precipitaProb);

	let row = '';
	if (label) {
		row += '<tr><th colspan=4>' + label + '</th></tr>';
	}
	row += '<tr>'
		+ '<th>Temp. Min.</th><td>' + forecast.tMin + '&deg;</td>'
		+ '<th>Temp. Max.</th><td>' + forecast.tMax + '&deg;</td>'
		+ '</tr>';

	let rowspan = 1;
	let ventoLine = '';
	let precipLine = '';
	if (wind) {
		rowspan += 1;
		ventoLine = '<tr><th>Vento</th><td style="text-align:left;" colspan=2>' + wind + ' (' + forecast.predWindDir + ')</td></tr>';
	}
	if (prob > 0) {
		rowspan += 1;
		const text = prob >= 100 ? 'Seguro que chove' : prob + '% probab. de choiva';
		precipLine = '<tr><th>Precip.</th><td style="text-align:left;" colspan=2>' + text + '</td></tr>';
	}
	row += '<tr>'
		+ '<th rowspan=' + rowspan + '><img src="img/' + icon + '_g.png" height="50px"></th>'
		+ '<th>Ceo</th><td style="text-align:left;" colspan=2>' + desc + '</td>'
		+ '</tr>'
		+ ventoLine
		+ precipLine;
	return row;
}

function createPrevisionIPMA(data, element, globalIdLocal, nombre, lat, lon, url) {
	if (!data || !data.data || data.data.length === 0) {
		noPrevision(element, 0, 'Sen datos IPMA');
		return;
	}

	const displayName = nombre || ('IPMA ' + globalIdLocal);
	const idKey = 'ipma-' + globalIdLocal;

	let tabla = '<table id="tablaMunicipio-' + idKey + '" class="center">';
	tabla += '<tr><th colspan=4>';
	if (lat != 0 && lon != 0) {
		tabla += '<img id="iconoGasolinera-' + idKey + '" src="img/gasolinera.png" alt="Preços combustível" height="16px" onclick="loadGasolineraPT(\'' + displayName + '\',\'' + idKey + '\',' + lat + ',' + lon + ')" style="cursor:pointer;" title="Preços combustível">';
		tabla += '&nbsp;&nbsp;';
	}

	if (url == null) {
		url = 'https://www.ipma.pt/pt/index.html';
	}

	tabla += '<a href="' + url + '" target="_new" rel="noopener">'
		+ 'Prevision para ' + displayName + '</a>';
	tabla += '</th></tr>';

	const now = new Date();
	const todayStr = now.getFullYear() + '-' + padTo2Digits(now.getMonth() + 1) + '-' + padTo2Digits(now.getDate());
	const todayIdx = data.data.findIndex(d => d.forecastDate === todayStr);
	const startIdx = todayIdx >= 0 ? todayIdx : 0;

	if (data.data[startIdx]) {
		tabla += ipmaRow(data.data[startIdx], null);
	}
	if (data.data[startIdx + 1]) {
		tabla += ipmaRow(data.data[startIdx + 1], getPrintDateHour(data.data[startIdx + 1].forecastDate));
	}

	const dt = new Date(data.dataUpdate);
	const fechaFmt = { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: false };
	tabla += '<tr><td colspan=4><a href="https://www.ipma.pt" target="copyright">IPMA</a>: '
		+ dt.toLocaleDateString('es-ES', fechaFmt) + '</td></tr>';
	tabla += '</table>';

	const keyDiv = document.createElement('div');
	keyDiv.innerHTML = tabla;
	keyDiv.style.textAlign = 'center';
	const mainDiv = document.getElementById(element);
	if (mainDiv) mainDiv.appendChild(keyDiv);
}

// ============================================================
// Selector de checkboxes (estilo favoritos do RFGF) reutilizable.
// Cada páxina (poboacions.html, praias.html) define a súa lista de entradas
// { key, name, html, init() } e chama ao seu wrapper (render_poboacions /
// render_praias). A selección persístese nunha cookie e só se cargan (init)
// as entradas seleccionadas.
// ============================================================

function getCookieArray(cname) {
	var cookieValue = getCookie(cname);
	try {
		return cookieValue ? JSON.parse(cookieValue) : [];
	} catch (e) {
		return [];
	}
}

function setArrayCookie(name, checkbox) {
	var selectedItems = getCookieArray(name);
	if (checkbox.checked) {
		if (selectedItems.indexOf(checkbox.value) < 0) {
			selectedItems.push(checkbox.value);
		}
	} else {
		var index = selectedItems.indexOf(checkbox.value);
		if (index > -1) {
			selectedItems.splice(index, 1);
		}
	}
	setCookie(name, JSON.stringify(selectedItems), 365);
}

function getSelectedKeys(cookieName, list, defaultKeys) {
	var selected = getCookieArray(cookieName);
	if (!Array.isArray(selected) || selected.length === 0) {
		selected = (defaultKeys && defaultKeys.length)
			? defaultKeys.slice()
			: list.map(function (p) { return p.key; });
	}
	// Mantén só keys que sigan existindo na lista.
	var validKeys = list.map(function (p) { return p.key; });
	return selected.filter(function (k) { return validKeys.indexOf(k) >= 0; });
}

// opts: { list, defaultKeys, cookieName, selectorId, contentId, title, toggleFn, beforeInit }
function renderSelector(opts) {
	var list = opts.list;
	if (typeof list === 'undefined' || !list) {
		return;
	}

	var selected = getSelectedKeys(opts.cookieName, list, opts.defaultKeys);
	setCookie(opts.cookieName, JSON.stringify(selected), 365);

	// --- selector de checkboxes ---
	var sel = '<div style="text-align:center; margin:8px 0;"><b>' + opts.title + '</b><br>';
	for (var i = 0; i < list.length; i++) {
		var p = list[i];
		var checked = selected.indexOf(p.key) >= 0 ? 'checked' : '';
		sel += '<label style="display:inline-block; margin:2px 10px; white-space:nowrap;">'
			+ '<input type="checkbox" ' + checked + ' value="' + p.key + '" onclick="' + opts.toggleFn + '(this)"> '
			+ p.name + '</label>';
	}
	sel += '</div>';
	var selDiv = document.getElementById(opts.selectorId);
	if (selDiv) {
		selDiv.innerHTML = sel;
	}

	// --- contido: só as entradas seleccionadas (na orde da lista) ---
	var content = document.getElementById(opts.contentId);
	if (!content) {
		return;
	}
	content.innerHTML = '';

	var selectedEntries = list.filter(function (p) { return selected.indexOf(p.key) >= 0; });

	// Hook previo á inicialización (ex: axustar total_elementos en praias).
	if (typeof opts.beforeInit === 'function') {
		opts.beforeInit(selectedEntries);
	}

	var separador = '<center><img width="200" style="width: 100%; height: auto; max-width: 1300px;" src=img/line.png></center>';
	for (var i = 0; i < selectedEntries.length; i++) {
		var p = selectedEntries[i];
		if (i > 0) {
			content.insertAdjacentHTML('beforeend', separador);
		}
		content.insertAdjacentHTML('beforeend', p.html);
		try {
			p.init();
		} catch (e) {
			console.error('Error inicializando ' + p.key + ':', e);
		}
	}

	if (selectedEntries.length === 0) {
		content.innerHTML = '<p style="text-align:center;">(Selecciona algunha opción)</p>';
	}
}

// ---- Poboacións ----
function render_poboacions() {
	renderSelector({
		list: (typeof poboacions_list !== 'undefined') ? poboacions_list : null,
		defaultKeys: (typeof poboacions_default !== 'undefined') ? poboacions_default : null,
		cookieName: 'poboacionsItems',
		selectorId: 'poboacions_selector',
		contentId: 'poboacions_content',
		title: 'Poboacións',
		toggleFn: 'toggle_poboacion'
	});
}

function toggle_poboacion(checkbox) {
	setArrayCookie('poboacionsItems', checkbox);
	render_poboacions();
}

// ---- Praias ----
function render_praias() {
	renderSelector({
		list: (typeof praias_list !== 'undefined') ? praias_list : null,
		defaultKeys: (typeof praias_default !== 'undefined') ? praias_default : null,
		cookieName: 'praiasItems',
		selectorId: 'praias_selector',
		contentId: 'praias_content',
		title: 'Praias',
		toggleFn: 'toggle_praia',
		beforeInit: function (selectedEntries) {
			// total_elementos controla o scroll a #hash (goto en praias.html):
			// conta as previsións que se van cargar nas praias seleccionadas.
			var total = 0;
			for (var i = 0; i < selectedEntries.length; i++) {
				var n = selectedEntries[i].previsions;
				total += (typeof n === 'number') ? n : 1;
			}
			total_elementos = total;
		}
	});
}

function toggle_praia(checkbox) {
	setArrayCookie('praiasItems', checkbox);
	render_praias();
}
