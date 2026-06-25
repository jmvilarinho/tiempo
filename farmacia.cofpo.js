
// Farmacias de guardia da provincia de Pontevedra (Colexio Oficial de Farmacéuticos
// de Pontevedra). A diferenza de cofc.es (ver farmacia.cofc.js), cofpo.org permite
// CORS directo (Access-Control-Allow-Origin: *), polo que non se usa proxy. Devolve
// nun único array JSON todas as gardas da provincia; filtramos por idmunicipio e data.
//
// Estrutura de cada rexistro:
//   { id, nombre, direccion, telefono, tipo ("Diurno"/"Nocturno"), longitud, latitud,
//     foto, idmunicipio, municipio, fecha ("YYYY-MM-DD"), idHorario ("1"=día/"2"=noite),
//     observaciones, idPostWpsl, idHorarioDia }
//
// Reutiliza getSafeLocation() e distance() definidos en common.js.

const COFPO_URL = 'https://farmacias.cofpo.org/farmaciasguardia.php';

function loadFarmaciaCofpo(id_municipio, id_cofpo) {
	$('#iconoFarmaciaCofpo-' + id_cofpo).css('display', 'none');
	fetch(COFPO_URL)
		.then(response => {
			if (!response.ok) {
				$('#iconoFarmaciaCofpo-' + id_cofpo).show();
				throw new Error('Network response was not ok');
			}
			return response.json();
		})
		.then(data => {
			// Data de hoxe en formato local YYYY-MM-DD.
			const now = new Date();
			const pad = n => String(n).padStart(2, '0');
			const today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());

			// --- filtrar polo idmunicipio e a data de hoxe (gardas diúrna + nocturna) ---
			let result = data.filter(item =>
				String(item.idmunicipio) === String(id_cofpo) && item.fecha === today);

			// Se non hai rexistros para hoxe (datos atrasados), amosa todas as do municipio.
			if (result.length === 0) {
				result = data.filter(item => String(item.idmunicipio) === String(id_cofpo));
			}

			// Diúrno (idHorario 1) antes que nocturno (idHorario 2).
			result.sort((a, b) => Number(a.idHorario) - Number(b.idHorario));

			// --- deduplicar: a mesma farmacia aparece nun rexistro por quenda (Diurno /
			// Nocturno). Agrupamos por id de farmacia e xuntamos as quendas e observacións. ---
			const seen = new Map();
			result.forEach(f => {
				const key = f.id || (f.nombre + '|' + f.direccion);
				if (!seen.has(key)) {
					seen.set(key, Object.assign({}, f, { tipos: [], _obs: [] }));
				}
				const entry = seen.get(key);
				if (f.tipo && entry.tipos.indexOf(f.tipo) < 0) entry.tipos.push(f.tipo);
				if (f.observaciones && entry._obs.indexOf(f.observaciones) < 0) entry._obs.push(f.observaciones);
			});
			const farmacias = Array.from(seen.values());

			renderFarmaciaCofpo(id_municipio, id_cofpo, buildFarmaciaCofpoHtml(farmacias));

			// Engade a distancia desde a ubicación actual (asíncrono) e re-renderiza.
			getSafeLocation().then((pos) => {
				const currentLat = pos.latitude;
				const currentLon = pos.longitude;
				if (currentLat === 0 && currentLon === 0) {
					return;
				}

				farmacias.forEach(f => {
					const latitem = parseFloat(f.latitud);
					const lonitem = parseFloat(f.longitud);
					f._distance = distance(currentLat, currentLon, latitem, lonitem);
				});

				renderFarmaciaCofpo(id_municipio, id_cofpo, buildFarmaciaCofpoHtml(farmacias));
			});
		})
		.catch(error => {
			$('#iconoFarmaciaCofpo-' + id_cofpo).show();
			alert('Error fetching content: ' + error.message);
		});
}

// Constrúe o HTML dunha lista de farmacias xa deduplicadas (cada unha con .tipos e ._obs).
function buildFarmaciaCofpoHtml(farmacias) {
	if (farmacias.length === 0) {
		return "<p>No hay farmacias de guardia en esta población.</p>";
	}

	let html = "<strong><a href=\"" + COFPO_URL + "\" target=\"_new\" rel=\"noopener\">Farmacia/s de guardia</a></strong><br>";
	farmacias.forEach(f => {
		html += "<hr>";
		let distanceInfo = "";
		if (typeof f._distance === 'number' && f._distance !== Infinity) {
			distanceInfo = `<br><small>(${f._distance.toFixed(2)} km desde tu ubicación)</small>`;
		}
		const turno = f.tipos.length ? f.tipos.join(', ') : f.tipo;
		const obsText = f._obs.join(' ');
		const observaciones = obsText ? "Observacións: " + obsText + "<br>" : "";
		html += `
			<a href="#" onclick="openMaps(event,${f.latitud},${f.longitud})">
			<strong>${f.nombre}</a></strong>&nbsp;<img src='img/dot.png' height='15px'><br>
			Dirección: ${f.direccion}<br>
			Turno: ${turno}<br>
			${observaciones}
			Teléfono: <a href='tel:${f.telefono}'>${f.telefono}</a><br>
			Población: ${f.municipio}
			${distanceInfo}
		`;
	});
	return html;
}

function renderFarmaciaCofpo(id_municipio, id_cofpo, html) {
	const divId = "divFarmaciaCofpo-" + id_cofpo;
	let existingDiv = document.getElementById(divId);
	if (!existingDiv) {
		const newRow = "<tr><td colspan=4 style=\"text-align: left;\"><div id=\"" + divId + "\"></div></td></tr>";
		const table = document.getElementById('tablaMunicipio-' + id_municipio);
		const targetTbody = table ? table.querySelector('tbody') : null;
		if (targetTbody) {
			targetTbody.insertAdjacentHTML('afterbegin', newRow);
		}
		existingDiv = document.getElementById(divId);
	}
	if (existingDiv) {
		existingDiv.innerHTML = html;
	}
}
