// Interactive dispatch area danger map (Leaflet + OpenTopoMap).
// Polygons are colored by today's fire danger, baked into #map-data at build time.
(function () {
  var DANGER_COLORS = {
    'Low': '#2e7d32',
    'Moderate': '#1565c0',
    'High': '#f9a825',
    'Very High': '#ef6c00',
    'Extreme': '#c62828',
    'Unknown': '#9e9e9e',
  };

  function init() {
    var el = document.getElementById('danger-map');
    var dataEl = document.getElementById('map-data');
    if (!el || !dataEl || typeof L === 'undefined') return;
    var geojson = JSON.parse(dataEl.textContent);

    var map = L.map(el, { scrollWheelZoom: false });

    // Muted gray basemap so the danger colors stand out
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);

    var layer = L.geoJSON(geojson, {
      style: function (f) {
        return {
          color: '#ffffff',
          weight: 1.5,
          fillColor: DANGER_COLORS[f.properties.danger] || DANGER_COLORS.Unknown,
          fillOpacity: 0.5,
        };
      },
      onEachFeature: function (f, lyr) {
        var p = f.properties;
        lyr.bindPopup(
          '<div class="map-popup"><strong>' + p.name + '</strong><br>' +
          'Today\'s Fire Danger: <strong>' + p.danger + '</strong><br>' +
          '<a href="' + p.url + '">View forecast &amp; conditions &rarr;</a></div>'
        );
        lyr.on('mouseover', function () { lyr.setStyle({ fillOpacity: 0.75, weight: 2.5 }); });
        lyr.on('mouseout', function () { lyr.setStyle({ fillOpacity: 0.5, weight: 1.5 }); });
      },
    }).addTo(map);

    map.fitBounds(layer.getBounds(), { padding: [10, 10] });

    // Danger level legend
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
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
