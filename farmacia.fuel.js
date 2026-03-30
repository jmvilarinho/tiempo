
function loadFarmacia(id_municipio, id_cofc) {
	$('#iconoFarmacia-' + id_cofc).css('display', 'none');
	fetch(proxyHostFarmacia + 'https://www.cofc.es/farmacia/index')
		.then(response => {
			if (!response.ok) {
				$('#iconoFarmacia-' + id_cofc).show()
				throw new Error('Network response was not ok');
			}
			return response.json();
		})
		.then(data => {
			var data = data["datos_json"];
			// --- filter by idPoblacion ---
			const result = data.filter(item => item.idPoblacion === id_cofc);

			if (result.length === 0) {
				html = "<p>No hay farmacias en esta población.</p>";
			} else {
				html = "<strong><a href=\"https://www.cofc.es/farmacia/index\"  target=\"_new\" rel=\"noopener\">Farmacia/s de guardia</a></strong><br>";

				// Sort by distance from current position
				getSafeLocation().then((pos) => {
					const currentLat = pos.latitude;
					const currentLon = pos.longitude;

					// Calculate distance for each pharmacy
					result.forEach(f => {
						const latitem = parseFloat(f.latitud);
						const lonitem = parseFloat(f.longitud);

						if (currentLat !== 0 && currentLon !== 0) {
							f._distance = distance(currentLat, currentLon, latitem, lonitem);
							console.log(`Distance to ${f.nombre}: ${f._distance.toFixed(2)} km`);
						} else {
							f._distance = Infinity;
						}
					});

					// Sort by distance
					result.sort((a, b) => a._distance - b._distance);

					cont = 0;
					result.forEach(f => {
						html += "<hr>";
						let distanceInfo = "";
						if (f._distance !== Infinity) {
							distanceInfo = `<br><small>(${f._distance.toFixed(2)} km desde tu ubicación)</small>`;
						}
						html += `
							<a href="#" onclick="openMaps(event,${f.latitud},${f.longitud})">
							<strong>${f.nombre}</a></strong>&nbsp;<img src='img/dot.png' height='15px'><br>
							Dirección: ${f.direccion}<br>
							Horario: ${f.horario}<br>
							Guardia: ${f.nombreGuardiaTipoTurno}<br>
							Teléfono: <a href='tel:${f.telefono}'>${f.telefono}</a><br>
							Población: ${f.nombrePoblacion}
							${distanceInfo}
						`;
						cont += 1;
					});
					html += "";

					const farmaciaDiv = document.getElementById("divFarmacia-" + id_cofc);
					if (farmaciaDiv) {
						farmaciaDiv.innerHTML = html;
					}
				});

				const existingDiv = document.getElementById("divFarmacia-" + id_cofc);
				if (!existingDiv) {
					const newRow = "<tr><td colspan=4 style=\"text-align: left;\"><div id=\"divFarmacia-" + id_cofc + "\"></div></td></tr>";
					const table = document.getElementById('tablaMunicipio-' + id_municipio);
					const targetTbody = table ? table.querySelector('tbody') : null;
					if (targetTbody) {
						targetTbody.insertAdjacentHTML('afterbegin', newRow);
					}
				}
				const farmaciaDiv = document.getElementById("divFarmacia-" + id_cofc);
				if (farmaciaDiv) {
					farmaciaDiv.innerHTML = html;
				}
			}
		})
		.catch(error => {
			$('#iconoFarmacia-' + id_cofc).show()
			alert('Error fetching content: ' + error.message);
		});
}


function getField(item, keys) {
	for (const key of keys) {
		if (item[key] !== undefined && item[key] !== null) {
			return item[key];
		}
	}
	return "";
}

// Haversine formula to compute distance in km
function distance(lat1, lon1, lat2, lon2) {
	const R = 6371; // km
	const toRad = deg => deg * Math.PI / 180;
	const dLat = toRad(lat2 - lat1);
	const dLon = toRad(lon2 - lon1);
	const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


// Convert price string to float
function parsePrice(priceStr) {
	if (!priceStr) return Infinity;
	return parseFloat(priceStr.replace(',', '.'));
}

function getSafeLocation() {
	try {
		return new Promise((resolve) => {
			if (!navigator.geolocation) {
				// Geolocation not supported
				resolve({ latitude: 0, longitude: 0 });
				return;
			}

			navigator.geolocation.getCurrentPosition(
				(position) => {
					resolve({
						latitude: position.coords.latitude,
						longitude: position.coords.longitude
					});
				},
				(error) => {
					// Permission denied or other error
					console.warn("Geolocation error:", error.message);
					resolve({ latitude: 0, longitude: 0 });
				},
				{ enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
			);
		});

	} catch (error) {
		console.warn("Error getting location: ", error.message);
		return Promise.resolve({ latitude: 0, longitude: 0 });
	}
}

const CCAA_CODES = {
	"Andalucía": "01",
	"Aragón": "02",
	"Asturias": "03",
	"Illes Balears": "04",
	"Canarias": "05",
	"Cantabria": "06",
	"Castilla y León": "07",
	"Castilla-La Mancha": "08",
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
	return comunidad ? [comunidad, CCAA_CODES[comunidad]] : [comunidad, null];
}

async function loadGasolinera(text, id_municipio, lat, lon, fuel_distancia_max_km = 10) {
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

	try {
		[comunidad, code] = await getCCAACode(lat, lon);
		url = `https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/FiltroCCAAProducto/${code}/4`;
	} catch (error) {
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
	fetch(url)
		.then(response => {
			if (!response.ok) {
				if (id_municipio != -1) $('#iconoGasolinera-' + id_municipio).show()
				throw new Error('Network response was not ok');
			}
			return response.json();
		})
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


			}, err => {
				console.log("Cannot get location: " + err.message);
			});


		})
		.catch(error => {
			if (id_municipio != -1) $('#iconoGasolinera-' + id_municipio).show()
			console.log('Error fetching content: ' + error.message);
		});


}
