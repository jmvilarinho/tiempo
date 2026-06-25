
// Prezos de combustible (gasóleo A) cerca dunha ubicación.
//  - España: ministerio (FUEL_PRICES_* en index.js), filtrado por CCAA.
//  - Portugal: DGEG (precoscombustiveis.dgeg.gov.pt), filtrado por distrito.
// A CCAA/distrito resólvese por xeocodificación inversa (Nominatim/OpenStreetMap).
//
// Helpers xeográficos compartidos (distance, getSafeLocation) están en common.js;
// as farmacias de guardia están en farmacia.cofc.js / farmacia.cofpo.js.

function getField(item, keys) {
	for (const key of keys) {
		if (item[key] !== undefined && item[key] !== null) {
			return item[key];
		}
	}
	return "";
}

// Convert price string to float
function parsePrice(priceStr) {
	if (!priceStr) return Infinity;
	return parseFloat(priceStr.replace(',', '.'));
}

// Cache de respostas de prezos no navegador (sessionStorage). Os botóns +/- 5 km só
// cambian o filtro de distancia (faise no cliente), polo que a resposta da API é a
// mesma URL; ao recargar reutilízase o JSON xa descargado en vez de volver pedilo.
const FUEL_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

async function fetchFuelJson(url) {
	const cacheKey = 'fuelcache:' + url;
	try {
		const cached = sessionStorage.getItem(cacheKey);
		if (cached) {
			const parsed = JSON.parse(cached);
			if (parsed && (Date.now() - parsed.t) < FUEL_CACHE_TTL_MS) {
				console.log('Fuel cache hit: ' + url);
				return parsed.data;
			}
		}
	} catch (e) {
		// sessionStorage non dispoñible ou JSON corrupto: ignórase e séguese co fetch.
	}

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error('Network response was not ok');
	}
	const data = await response.json();
	try {
		sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), data: data }));
	} catch (e) {
		// Cota superada ou modo privado: ignórase, simplemente non se cachea.
	}
	return data;
}

const CCAA_CODES = {
	"Andalucía": "01",
	"Aragón": "02",
	"Asturias": "03",
	"Illes Balears": "04",
	"Canarias": "05",
	"Cantabria": "06",
	"Castilla y León": "08",
	"Castilla-La Mancha": "07",
	"Cataluña": "09",
	"Comunidad Valenciana": "10",
	"Extremadura": "11",
	"Galicia": "12",
	"Madrid": "13",
	"Murcia": "14",
	"Navarra": "15",
	"País Vasco": "16",
	"La Rioja": "17",
	"Ceuta": "18",
	"Melilla": "19"
};

const normalize = (str) =>
	str
		?.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.trim();

const aliases = {
	"galicia": "Galicia",
	"galiza": "Galicia",

	"principality of asturias": "Asturias",

	"basque country": "País Vasco",
	"euskadi": "País Vasco",

	"catalonia": "Cataluña",
	"catalunya": "Cataluña",

	"valencian community": "Comunidad Valenciana",
	"comunitat valenciana": "Comunidad Valenciana",

	"community of madrid": "Madrid",

	"castile and leon": "Castilla y León",
	"castile-la mancha": "Castilla-La Mancha",

	"andalusia": "Andalucía",

	"balearic islands": "Illes Balears",
	"baleares": "Illes Balears",

	"canary islands": "Canarias",

	"navarre": "Navarra",
	"rioja": "La Rioja"
};

function mapToComunidad(raw) {
	if (!raw) return null;

	const norm = normalize(raw);

	// direct
	for (const c in CCAA_CODES) {
		if (normalize(c) === norm) return c;
	}

	// alias
	if (aliases[norm]) return aliases[norm];

	// partial
	for (const c in CCAA_CODES) {
		if (norm.includes(normalize(c))) return c;
	}

	return null;
}

async function getCCAACode(lat, lon) {
	const res = await fetch(
		`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
		{
			headers: { "User-Agent": "vila-app" }
		}
	);
	const data = await res.json();
	const raw = data.address.state;
	const comunidad = mapToComunidad(raw);
	console.log(`Reverse geocoding: ${lat},${lon} -> ${raw} -> ${comunidad}`);
	return comunidad ? [comunidad, CCAA_CODES[comunidad]] : [comunidad, null];
}

async function loadGasolinera(text, id_municipio, lat, lon, fuel_distancia_max_km = 10) {

	// Detect country: if Portugal, delegate to the PT handler
	let comunidad = null;
	let code = null;
	let countryCode = '';
	try {
		const res = await fetch(
			`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
			{ headers: { "User-Agent": "vila-app" } }
		);
		const geoData = await res.json();
		countryCode = (geoData?.address?.country_code || '').toLowerCase();
		if (countryCode === 'pt') {
			return loadGasolineraPT(text, id_municipio, lat, lon, fuel_distancia_max_km);
		}
		const raw = geoData?.address?.state;
		comunidad = mapToComunidad(raw);
		code = comunidad ? CCAA_CODES[comunidad] : null;
		console.log(`Reverse geocoding: ${lat},${lon} -> ${raw} -> ${comunidad}`);
	} catch (e) {
		console.warn('Reverse geocoding failed:', e.message);
	}

	// Unsupported country: render notice and stop (only ES / PT are supported)
	if (countryCode && countryCode !== 'es') {
		const containerId = id_municipio != -1 ? "divGasolinera-" + id_municipio : "combustible_ubicacion";
		const container = document.getElementById(containerId);
		if (container) container.innerHTML = "";
		if (id_municipio != -1) {
			$('#iconoGasolinera-' + id_municipio).css('display', 'none');
		} else {
			$('#iconoGasolinera').css('display', 'none');
		}
		const table = document.createElement("table");
		table.style.borderCollapse = "collapse";
		table.style.border = "none";
		table.style.margin = "0 auto";
		const tbody = document.createElement("tbody");
		const row = document.createElement("tr");
		row.innerHTML = `<td colspan="2">Precios de combustible no soportados para ${countryCode.toUpperCase()} (solo ES y PT).</td>`;
		tbody.appendChild(row);
		showGasolinera(id_municipio, tbody, table);
		return;
	}

	const stepDistanceKm = 5;
	const minDistanceKm = 5;
	const downDistanceKm = Math.max(minDistanceKm, fuel_distancia_max_km - stepDistanceKm);
	const upDistanceKm = fuel_distancia_max_km + stepDistanceKm;
	const containerId = id_municipio != -1 ? "divGasolinera-" + id_municipio : "combustible_ubicacion";
	const container = document.getElementById(containerId);
	if (container) {
		container.innerHTML = "";
	}

	if (id_municipio != -1) {
		$('#iconoGasolinera-' + id_municipio).css('display', 'none');
		td_style = "style=\"border:none;\"";
	} else {
		$('#iconoGasolinera').css('display', 'none');
		td_style = "";
	}

	const table = document.createElement("table");
	table.style.borderCollapse = "collapse";
	table.style.border = "none";
	table.style.margin = "0 auto";
	const tbody = document.createElement("tbody");

	let url;
	if (code) {
		url = `${FUEL_PRICES_HOST}/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/FiltroCCAAProducto/${code}/4`;
	} else {
		url = FUEL_PRICES_API_URL;
		comunidad = "Galicia";
	}


	tbody.innerHTML += "<tr><td " + td_style + " colspan='2'>"
		+ "<img  src=\"img/down.png\" title=\"Distancia -5 km.\" height=\"15px\" onclick=\"loadGasolinera('" + text + "'," + id_municipio + "," + lat + "," + lon + "," + downDistanceKm + ")\" style=\"cursor: pointer;\"  >"
		+ "&nbsp;&nbsp;<b>Precios Gasóleo A</b>&nbsp;&nbsp;"
		+ "<img  src=\"img/up.png\" title=\"Distancia +5 km.\" height=\"15px\" onclick=\"loadGasolinera('" + text + "'," + id_municipio + "," + lat + "," + lon + "," + upDistanceKm + ")\" style=\"cursor: pointer;\"  >"
		+ "<br>"
		+ "<small>Cerca de " + text + "</small><br>"
		+ "<small>(distancia máxima: " + fuel_distancia_max_km + " km)</small></td></tr>";
	if (id_municipio != -1) tbody.innerHTML += "<tr><td " + td_style + " colspan='2'><hr></td></tr>";

	console.log('Get gasolinera data: ' + url);
	fetchFuelJson(url)
		.then(data => {
			//console.log('Gasolinera data: ', data);
			const list = data.ListaEESSPrecio || [];
			innerHTML = "";

			getSafeLocation().then((pos) => {
				const currentLat = pos.latitude;
				const currentLon = pos.longitude;

				const userLat = lat;
				const userLon = lon;

				// Compute distance for each station
				list.forEach(item => {
					//console.log('Gasolinera item: ', item);
					const latitem = parseFloat(item.Latitud.replace(',', '.'));
					const lonitem = parseFloat(item["Longitud (WGS84)"].replace(',', '.'));

					item._distance = distance(userLat, userLon, latitem, lonitem);
					item._price = parsePrice(item.PrecioProducto);
					item._lat = latitem;
					item._lon = lonitem;

					if (currentLat !== 0 && currentLon !== 0) {
						item._distanceCurrent = distance(currentLat, currentLon, latitem, lonitem);
					} else {
						item._distanceCurrent = "???";
					}
				});

				// 1. Filter by distance
				const nearby = list.filter(item => item._distance <= fuel_distancia_max_km);

				// 2. Sort by price, then by distance (prefer current location distance if available)
				nearby.sort((a, b) => {
					if (a._price !== b._price) return a._price - b._price;
					const aDist = a._distanceCurrent !== "???" ? a._distanceCurrent : a._distance;
					const bDist = b._distanceCurrent !== "???" ? b._distanceCurrent : b._distance;
					return aDist - bDist;
				});

				// 3. Take first 10
				let result = nearby.slice(0, 10);

				// 4. Include more if same price as last one
				if (nearby.length > 10) {
					const lastPrice = result[result.length - 1]._price;
					for (let i = 10; i < nearby.length; i++) {
						if (nearby[i]._price === lastPrice) {
							result.push(nearby[i]);
						} else {
							break;
						}
					}
				}

				// Sort by price ascending, then nearest distance (prefer current location distance if available)
				result.sort((a, b) => {
					if (a._price !== b._price) return a._price - b._price;
					const aDist = a._distanceCurrent !== "???" ? a._distanceCurrent : a._distance;
					const bDist = b._distanceCurrent !== "???" ? b._distanceCurrent : b._distance;
					return aDist - bDist;
				});

				// Render table
				result.forEach(item => {

					repostaje = 50 * item._price;
					if (item._distanceCurrent !== "???") {
						extra_info = `<br><small>(${item._distanceCurrent.toFixed(2)} km.)</small><br><small>50l: ${(repostaje).toFixed(2)}€</small></td>`;
					} else {
						extra_info = `<br><small>50l: ${(repostaje).toFixed(2)}€</small></td>`;
					}

					const row = document.createElement("tr");
					row.innerHTML = `
						<td ${td_style}>
						<a href="#" onclick="openMaps(event,${item._lat},${item._lon})">
						<strong>${getField(item, ["Rótulo", "Rotulo"])}</a>
						</strong>&nbsp;<img src='img/dot.png' height='15px'><br>
						<small>(${getField(item, ["Horario"])})</small><br>
						<small>${getField(item, ["Dirección", "Direccion"])}</small><br>
						<small>${getField(item, ["Localidad"])}</small></td>
						<td width=70 ${td_style}>${item._price.toFixed(3)} €/l
						${extra_info}
						`;

					tbody.appendChild(row);
					if (id_municipio != -1) tbody.innerHTML += "<tr><td " + td_style + " colspan='2'><hr></td></tr>";
				});

				if (nearby.length === 0) {
					tbody.innerHTML += "<tr><td " + td_style + " colspan='2'>Sin gasolineras en " + fuel_distancia_max_km + " km.</td></tr>";
				} else {
					const row = document.createElement("tr");
					row.innerHTML = "<td " + td_style + " colspan='2'><a href=https://geoportalgasolineras.es/geoportal-instalaciones/Inicio target=_new  rel=noopener >Geoportal (" + comunidad + ")</a> " + data.Fecha + "</td>";
					tbody.appendChild(row);
				}

				showGasolinera(id_municipio, tbody, table);

			}, err => {
				console.log("Cannot get location: " + err.message);
			});


		})
		.catch(error => {
			if (id_municipio != -1) $('#iconoGasolinera-' + id_municipio).show()
			console.log('Error obtendo precios gasolina: ' + error.message);
			const row = document.createElement("tr");
			row.innerHTML = `<td ${td_style} colspan="2">Error obtendo precios: ${error.message}	</td>`;

			tbody.appendChild(row);
			showGasolinera(id_municipio, tbody, table);
		});
}


function showGasolinera(id_municipio, tbody, table) {

	table.appendChild(tbody);
	if (id_municipio != -1) {
		const existingDiv = document.getElementById("divGasolinera-" + id_municipio);
		if (!existingDiv) {
			const newRow = "<tr><td colspan=4 style=\"text-align: left;\"><div id=\"divGasolinera-" + id_municipio + "\"></div></td></tr>";
			const tableMunicipio = document.getElementById('tablaMunicipio-' + id_municipio);
			const targetTbody = tableMunicipio ? tableMunicipio.querySelector('tbody') : null;
			if (targetTbody) {
				targetTbody.insertAdjacentHTML('afterbegin', newRow);
			}
		}
		document.getElementById("divGasolinera-" + id_municipio).appendChild(table);
	}
	else {
		document.getElementById("combustible_ubicacion").appendChild(table);
	}
}


// ============================================================
// Portugal - DGEG fuel prices (precoscombustiveis.dgeg.gov.pt)
// ============================================================

const PT_DISTRITO_CODES = {
	'Aveiro': 1, 'Beja': 2, 'Braga': 3, 'Bragança': 4, 'Braganca': 4,
	'Castelo Branco': 5, 'Coimbra': 6, 'Évora': 7, 'Evora': 7,
	'Faro': 8, 'Guarda': 9, 'Leiria': 10, 'Lisboa': 11, 'Lisbon': 11,
	'Portalegre': 12, 'Porto': 13, 'Santarém': 14, 'Santarem': 14,
	'Setúbal': 15, 'Setubal': 15, 'Viana do Castelo': 16,
	'Vila Real': 17, 'Viseu': 18, 'Açores': 19, 'Azores': 19, 'Madeira': 20
};

const PT_FUEL_GASOLEO_SIMPLES = 2101;
const DGEG_API_URL = 'https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/PesquisarPostos';

async function getDistritoPT(lat, lon) {
	try {
		const res = await fetch(
			`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,
			{ headers: { "User-Agent": "vila-app" } }
		);
		const data = await res.json();
		const raw = data?.address?.district || data?.address?.state || data?.address?.county || '';
		const code = PT_DISTRITO_CODES[raw];
		console.log(`Reverse geocoding PT: ${lat},${lon} -> ${raw} -> ${code}`);
		return [raw, code];
	} catch (e) {
		console.warn('PT reverse geocode failed:', e.message);
		return [null, null];
	}
}

async function loadGasolineraPT(text, id_municipio, lat, lon, fuel_distancia_max_km = 10) {
	const stepDistanceKm = 5;
	const minDistanceKm = 5;
	const downDistanceKm = Math.max(minDistanceKm, fuel_distancia_max_km - stepDistanceKm);
	const upDistanceKm = fuel_distancia_max_km + stepDistanceKm;

	const isInline = (id_municipio === -1 || id_municipio === '-1');
	const containerId = isInline ? "combustible_ubicacion" : ("divGasolinera-" + id_municipio);
	const container = document.getElementById(containerId);
	if (container) container.innerHTML = "";

	let td_style;
	if (!isInline) {
		$('#iconoGasolinera-' + id_municipio).css('display', 'none');
		td_style = "style=\"border:none;\"";
	} else {
		$('#iconoGasolinera').css('display', 'none');
		td_style = "";
	}

	const table = document.createElement("table");
	table.style.borderCollapse = "collapse";
	table.style.border = "none";
	table.style.margin = "0 auto";
	const tbody = document.createElement("tbody");

	const [distritoName, distritoCode] = await getDistritoPT(lat, lon);

	let url = `${DGEG_API_URL}?idsTiposComb=${PT_FUEL_GASOLEO_SIMPLES}&qtdPorPagina=1000&pagina=1`;
	if (distritoCode) url += `&idsDistritos=${distritoCode}`;

	const idArg = (typeof id_municipio === 'string') ? `'${id_municipio}'` : id_municipio;
	tbody.innerHTML += "<tr><td " + td_style + " colspan='2'>"
		+ "<img src=\"img/down.png\" title=\"Distância -5 km.\" height=\"15px\" onclick=\"loadGasolineraPT('" + text + "'," + idArg + "," + lat + "," + lon + "," + downDistanceKm + ")\" style=\"cursor:pointer;\">"
		+ "&nbsp;&nbsp;<b>Preços Gasóleo</b>&nbsp;&nbsp;"
		+ "<img src=\"img/up.png\" title=\"Distância +5 km.\" height=\"15px\" onclick=\"loadGasolineraPT('" + text + "'," + idArg + "," + lat + "," + lon + "," + upDistanceKm + ")\" style=\"cursor:pointer;\">"
		+ "<br><small>Perto de " + text + "</small>"
		+ "<br><small>(distância máxima: " + fuel_distancia_max_km + " km)</small></td></tr>";
	if (!isInline) tbody.innerHTML += "<tr><td " + td_style + " colspan='2'><hr></td></tr>";

	console.log('Get gasolinera PT data: ' + url);
	try {
		const data = await fetchFuelJson(url);
		const list = data.resultado || [];

		const pos = await getSafeLocation();
		const currentLat = pos.latitude;
		const currentLon = pos.longitude;

		list.forEach(item => {
			const latitem = Number(item.Latitude);
			const lonitem = Number(item.Longitude);
			item._distance = distance(lat, lon, latitem, lonitem);
			item._price = parsePrice(String(item.Preco || '').replace('€', '').trim());
			item._lat = latitem;
			item._lon = lonitem;
			item._distanceCurrent = (currentLat !== 0 && currentLon !== 0)
				? distance(currentLat, currentLon, latitem, lonitem)
				: "???";
		});

		const nearby = list.filter(item =>
			Number.isFinite(item._distance) && Number.isFinite(item._price) && item._distance <= fuel_distancia_max_km
		);

		nearby.sort((a, b) => {
			if (a._price !== b._price) return a._price - b._price;
			const aDist = a._distanceCurrent !== "???" ? a._distanceCurrent : a._distance;
			const bDist = b._distanceCurrent !== "???" ? b._distanceCurrent : b._distance;
			return aDist - bDist;
		});

		let result = nearby.slice(0, 10);
		if (nearby.length > 10) {
			const lastPrice = result[result.length - 1]._price;
			for (let i = 10; i < nearby.length; i++) {
				if (nearby[i]._price === lastPrice) result.push(nearby[i]);
				else break;
			}
		}

		result.forEach(item => {
			const repostaje = 50 * item._price;
			const extra_info = (item._distanceCurrent !== "???")
				? `<br><small>(${item._distanceCurrent.toFixed(2)} km.)</small><br><small>50l: ${repostaje.toFixed(2)}€</small></td>`
				: `<br><small>50l: ${repostaje.toFixed(2)}€</small></td>`;

			const row = document.createElement("tr");
			row.innerHTML = `
				<td ${td_style}>
				<a href="#" onclick="openMaps(event,${item._lat},${item._lon})">
				<strong>${item.Marca || item.Nome || '-'}</strong></a>&nbsp;<img src='img/dot.png' height='15px'><br>
				<small>${item.TipoPosto || ''}</small><br>
				<small>${item.Morada || ''}</small><br>
				<small>${item.Localidade || ''}</small></td>
				<td width=70 ${td_style}>${item._price.toFixed(3)} €/l
				${extra_info}
			`;
			tbody.appendChild(row);
			if (!isInline) tbody.innerHTML += "<tr><td " + td_style + " colspan='2'><hr></td></tr>";
		});

		if (nearby.length === 0) {
			tbody.innerHTML += "<tr><td " + td_style + " colspan='2'>Sem postos em " + fuel_distancia_max_km + " km.</td></tr>";
		} else {
			const lastDate = list[0]?.DataAtualizacao || '';
			const row = document.createElement("tr");
			row.innerHTML = "<td " + td_style + " colspan='2'><a href='https://precoscombustiveis.dgeg.gov.pt' target=_new rel=noopener>DGEG (" + (distritoName || 'Portugal') + ")</a> " + lastDate + "</td>";
			tbody.appendChild(row);
		}

		showGasolinera(id_municipio, tbody, table);
	} catch (error) {
		if (!isInline) $('#iconoGasolinera-' + id_municipio).show();
		console.log('Error obtendo precios gasolina PT: ' + error.message);
		const row = document.createElement("tr");
		row.innerHTML = `<td ${td_style} colspan="2">Error obtendo preços: ${error.message}</td>`;
		tbody.appendChild(row);
		showGasolinera(id_municipio, tbody, table);
	}
}
