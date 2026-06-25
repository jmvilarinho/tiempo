
// Farmacias de guardia do Colexio Oficial de Farmacéuticos da Coruña (cofc.es).
// A petición vai a través do proxy AWS (proxyHostFarmacia, definido en index.js) porque
// cofc.es non permite CORS. A resposta tráese en "datos_json" e fíltrase por idPoblacion.
//
// Helpers xeográficos compartidos (distance, getSafeLocation) están en common.js;
// loadGasolinera e o resto de prezos de combustible están en fuelprices.js.

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
