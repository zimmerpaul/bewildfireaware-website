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
