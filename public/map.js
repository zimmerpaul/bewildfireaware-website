// Danger maps (Leaflet + CARTO Voyager basemap, boundaries + daily data from
// /map-data.json):
//   #danger-map — interactive region map (homepage, dispatch areas page)
//   #area-map[data-slug] — non-interactive locator map on each FDRA page
(function () {
  var DANGER_COLORS = {
    'Low': '#2e7d32',
    'Moderate': '#1565c0',
    'High': '#f9a825',
    'Very High': '#ef6c00',
    'Extreme': '#c62828',
    'Unknown': '#9e9e9e',
  };

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

  function dangerClass(level) {
    return 'danger-' + String(level || 'unknown').toLowerCase().replace(/\s+/g, '-');
  }

  function baseTiles() {
    return L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png', {
      maxZoom: 18,
      attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>',
    });
  }

  // Town dots + labels in a pane ABOVE the polygon fills (z450: above the
  // overlay pane at 400, below markers at 600) so the white-halo text stays
  // crisp instead of being tinted by the danger colors. Minor towns label
  // only when zoomed in.
  function addTowns(map) {
    map.createPane('towns');
    var pane = map.getPane('towns');
    pane.style.zIndex = 450;
    pane.style.pointerEvents = 'none';
    TOWNS.forEach(function (t) {
      L.circleMarker([t[1], t[2]], {
        pane: 'towns',
        radius: t[3] === 1 ? 3 : 2.25,
        color: '#3a3a3a', weight: 1.25, fillColor: '#fff', fillOpacity: 1, interactive: false,
      }).addTo(map).bindTooltip(t[0], {
        pane: 'towns',
        permanent: true, direction: 'right', offset: [6, 0], interactive: false,
        className: t[3] === 1 ? 'town-label' : 'town-label town-label-minor',
      }).openTooltip();
    });
    function update() {
      pane.classList.toggle('show-minor-towns', map.getZoom() >= MINOR_LABEL_ZOOM);
    }
    map.on('zoomend', update);
    update();
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

  function initRegionMap(el, geojson) {
    var map = L.map(el, { scrollWheelZoom: false, zoomSnap: 0.25, zoomDelta: 0.5 });
    baseTiles().addTo(map);

    var layer = L.geoJSON(geojson, {
      style: function (f) {
        return {
          color: '#ffffff',
          weight: 1.5,
          fillColor: DANGER_COLORS[f.properties.danger] || DANGER_COLORS.Unknown,
          fillOpacity: 0.4,
        };
      },
      onEachFeature: function (f, lyr) {
        lyr.bindPopup(popupHtml(f.properties));
        lyr.on('mouseover', function () { lyr.setStyle({ fillOpacity: 0.62, weight: 2.5 }); });
        lyr.on('mouseout', function () { lyr.setStyle({ fillOpacity: 0.4, weight: 1.5 }); });
      },
    }).addTo(map);

    map.fitBounds(layer.getBounds(), { padding: [6, 6] });
    map.setMinZoom(map.getZoom() - 1);
    L.control.scale({ imperial: true, metric: false }).addTo(map);
    addTowns(map);

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

  function initAreaMap(el, geojson) {
    var slug = el.getAttribute('data-slug');
    var map = L.map(el, {
      dragging: false, zoomControl: false, scrollWheelZoom: false, doubleClickZoom: false,
      boxZoom: false, keyboard: false, touchZoom: false,
    });
    baseTiles().addTo(map);

    var target = null;
    L.geoJSON(geojson, {
      interactive: false,
      style: function (f) {
        return f.properties.slug === slug
          ? { color: '#ffffff', weight: 2.5, fillColor: DANGER_COLORS[f.properties.danger] || DANGER_COLORS.Unknown, fillOpacity: 0.45 }
          : { color: '#aab2ab', weight: 1, fillColor: '#8a8f8a', fillOpacity: 0.12 };
      },
      onEachFeature: function (f, lyr) { if (f.properties.slug === slug) target = lyr; },
    }).addTo(map);

    if (target) map.fitBounds(target.getBounds().pad(0.4));
    L.control.scale({ imperial: true, metric: false }).addTo(map);
    addTowns(map);
  }

  function init() {
    if (typeof L === 'undefined') return;
    var region = document.getElementById('danger-map');
    var area = document.getElementById('area-map');
    if (!region && !area) return;
    fetch('/map-data.json').then(function (r) { return r.json(); }).then(function (geojson) {
      if (region) initRegionMap(region, geojson);
      if (area) initAreaMap(area, geojson);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
