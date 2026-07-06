// Interactive dispatch area danger map (Leaflet + CARTO basemap).
// Boundaries + today's data come from /map-data.json (generated at build time).
(function () {
  var DANGER_COLORS = {
    'Low': '#2e7d32',
    'Moderate': '#1565c0',
    'High': '#f9a825',
    'Very High': '#ef6c00',
    'Extreme': '#c62828',
    'Unknown': '#9e9e9e',
  };

  function dangerClass(level) {
    return 'danger-' + String(level || 'unknown').toLowerCase().replace(/\s+/g, '-');
  }

  // Western Colorado towns for orientation. Tier 1 is always labeled;
  // tier 2 labels appear once zoomed past MINOR_LABEL_ZOOM (declutters the
  // region-wide view where 21 labels collide).
  var MINOR_LABEL_ZOOM = 9;
  var TOWNS = [
    ['Grand Junction', 39.0639, -108.5506, 1],
    ['Montrose', 38.4783, -107.8762, 1],
    ['Gunnison', 38.5458, -106.9253, 1],
    ['Durango', 37.2753, -107.8801, 1],
    ['Cortez', 37.3489, -108.5859, 1],
    ['Glenwood Springs', 39.5505, -107.3248, 1],
    ['Aspen', 39.1911, -106.8175, 1],
    ['Telluride', 37.9375, -107.8123, 1],
    ['Pagosa Springs', 37.2694, -107.0098, 1],
    ['Delta', 38.7422, -108.0690, 2],
    ['Crested Butte', 38.8697, -106.9878, 2],
    ['Ouray', 38.0228, -107.6714, 2],
    ['Ridgway', 38.1525, -107.7568, 2],
    ['Paonia', 38.8683, -107.5920, 2],
    ['Silverton', 37.8117, -107.6645, 2],
    ['Lake City', 38.0300, -107.3150, 2],
    ['Rifle', 39.5347, -107.7831, 2],
    ['Carbondale', 39.4022, -107.2112, 2],
    ['Norwood', 38.1319, -108.2929, 2],
    ['Nucla', 38.2678, -108.5484, 2],
    ['Hotchkiss', 38.7994, -107.7176, 2],
  ];

  function popupHtml(p) {
    var html = '<div class="map-popup">' +
      '<div class="map-popup-title">' + p.name + '</div>' +
      '<span class="danger-chip ' + dangerClass(p.danger) + '">' + p.danger + '</span>';
    if (p.obs && p.obs.length) {
      html += '<div class="map-popup-stats">';
      p.obs.forEach(function (o) {
        html += '<span>' + o.label + ': <strong>' + o.value + '</strong>' + (o.triggered ? ' ▲' : '') + '</span>';
      });
      html += '</div>';
    }
    if (p.watchout && p.watchout.isWatchout) {
      html += '<div class="map-popup-watchout">▲ Watchout: ' + p.watchout.met + ' of ' + p.watchout.total + ' thresholds met</div>';
    }
    html += '<a href="' + p.url + '">Full forecast &amp; conditions &rarr;</a></div>';
    return html;
  }

  function init() {
    var el = document.getElementById('danger-map');
    if (!el || typeof L === 'undefined') return;

    fetch('/map-data.json').then(function (r) { return r.json(); }).then(function (geojson) {
      // zoomSnap 0.25 lets fitBounds land much closer to the areas instead of
      // rounding down to a distant whole zoom level
      var map = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.25, zoomDelta: 0.5 });

      // Voyager basemap: towns, roads, and terrain labels so people can find
      // themselves, while staying muted enough for danger colors to read.
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 18,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/attributions">CARTO</a>',
      }).addTo(map);

      var layer = L.geoJSON(geojson, {
        style: function (f) {
          return {
            color: '#ffffff',
            weight: 1.5,
            fillColor: DANGER_COLORS[f.properties.danger] || DANGER_COLORS.Unknown,
            fillOpacity: 0.55,
          };
        },
        onEachFeature: function (f, lyr) {
          lyr.bindPopup(popupHtml(f.properties));
          lyr.on('mouseover', function () { lyr.setStyle({ fillOpacity: 0.78, weight: 2.5 }); });
          lyr.on('mouseout', function () { lyr.setStyle({ fillOpacity: 0.55, weight: 1.5 }); });
        },
      }).addTo(map);

      map.fitBounds(layer.getBounds(), { padding: [6, 6] });
      map.setMinZoom(map.getZoom() - 1); // keep people from getting lost zooming out
      L.control.scale({ imperial: true, metric: false }).addTo(map);

      // Town dots + labels, rendered in a pane BELOW the FDRA polygons
      // (tiles are z200, our pane z350, overlay polygons z400) so the danger
      // colors and hover effects sit on top of the labels.
      map.createPane('towns');
      var townsPane = map.getPane('towns');
      townsPane.style.zIndex = 350;
      townsPane.style.pointerEvents = 'none';
      TOWNS.forEach(function (t) {
        L.circleMarker([t[1], t[2]], {
          pane: 'towns',
          radius: t[3] === 1 ? 3.5 : 2.5,
          color: '#444', weight: 1.25, fillColor: '#fff', fillOpacity: 1, interactive: false,
        }).addTo(map).bindTooltip(t[0], {
          pane: 'towns',
          permanent: true, direction: 'right', offset: [6, 0], interactive: false,
          className: t[3] === 1 ? 'town-label' : 'town-label town-label-minor',
        }).openTooltip();
      });
      function updateTownLabels() {
        townsPane.classList.toggle('show-minor-towns', map.getZoom() >= MINOR_LABEL_ZOOM);
      }
      map.on('zoomend', updateTownLabels);
      updateTownLabels();

      var legend = L.control({ position: 'bottomleft' });
      legend.onAdd = function () {
        var div = L.DomUtil.create('div', 'map-legend');
        var html = '<strong>Fire Danger</strong>';
        ['Low', 'Moderate', 'High', 'Very High', 'Extreme'].forEach(function (lvl) {
          html += '<div><span class="map-legend-swatch" style="background:' + DANGER_COLORS[lvl] + '"></span>' + lvl + '</div>';
        });
        div.innerHTML = html;
        return div;
      };
      legend.addTo(map);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
