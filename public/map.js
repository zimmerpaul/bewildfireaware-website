// Danger maps (Leaflet + CARTO Voyager basemap, boundaries + daily data from
// /map-data.json):
//   #danger-map — interactive region map (homepage, dispatch areas page)
//   #area-map[data-slug] — non-interactive locator map on each FDRA page
(function () {
  var DANGER_COLORS = {
    'Low': '#2e7d32',
    'Moderate': '#1565c0',
    'High': '#ffd60a',
    'Very High': '#ef6c00',
    'Extreme': '#c62828',
    'Unknown': '#9e9e9e',
  };

  // Locator (per-FDRA) maps cap how many towns they draw so a single area stays
  // legible: curated landmarks first, then the largest by population.
  var LOCATOR_CAP = 8;

  function dangerClass(level) {
    return 'danger-' + String(level || 'unknown').toLowerCase().replace(/\s+/g, '-');
  }

  // Basemap: public-domain USGS "The National Map" tiles — no API key, no
  // usage restrictions (replaces CARTO, which now watermarks keyless tiles).
  // Shaded relief keeps the basemap label-free so our own town labels stay
  // authoritative; the hydro overlay adds rivers/lakes for orientation.
  // US-only coverage, which is all we need.
  function baseTiles() {
    return L.layerGroup([
      L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSShadedReliefOnly/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 16,
        attribution: '<a href="https://www.usgs.gov/programs/national-geospatial-program/national-map" target="_blank" rel="noopener">USGS The National Map</a>',
      }),
      L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSHydroCached/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 16,
      }),
    ]);
  }

  // Town dots + labels in a pane ABOVE the polygon fills (z450: above the
  // overlay pane at 400, below markers at 600) so the white-halo text stays
  // crisp instead of being tinted by the danger colors.
  //
  // towns: array of {name, lat, lon, pop, fdras:[slug], tier, curated, map}
  //   from /towns.json.
  // opts.fdra — locator maps pass a slug: draw that FDRA's towns (curated first,
  //   then largest, capped at LOCATOR_CAP), every one eligible to label since
  //   it's zoomed in on one area.
  // Otherwise (region/main map) only map:true towns are drawn (max ~3 per FDRA,
  //   chosen in build-towns.mjs); a greedy collision pass then thins whatever
  //   still overlaps so the statewide view stays legible.
  function addTowns(map, towns, opts) {
    opts = opts || {};
    if (opts.fdra) {
      towns = towns
        .filter(function (t) { return t.fdras.indexOf(opts.fdra) !== -1; })
        .sort(function (a, b) {
          return (a.curated ? 0 : 1) - (b.curated ? 0 : 1) || b.pop - a.pop;
        })
        .slice(0, LOCATOR_CAP);
    } else {
      towns = towns.filter(function (t) { return t.map; });
    }
    if (!towns.length) return;

    map.createPane('towns');
    var pane = map.getPane('towns');
    pane.style.zIndex = 450;
    pane.style.pointerEvents = 'none';

    var items = towns.map(function (t) {
      var m = L.circleMarker([t.lat, t.lon], {
        pane: 'towns',
        radius: t.tier === 1 ? 3 : 2.25,
        color: '#3a3a3a', weight: 1.25, fillColor: '#fff', fillOpacity: 1, interactive: false,
      }).addTo(map);
      m.bindTooltip(t.name, {
        pane: 'towns',
        permanent: true, direction: 'right', offset: [6, 0], interactive: false,
        className: 'town-label town-tier-' + t.tier,
      }).openTooltip();
      return { t: t, marker: m };
    });

    function toggle(el, on) { if (el) el.classList.toggle('town-hidden', !on); }

    // Greedy, priority-ordered label placement: keep a label only if its
    // approximate on-screen box clears every label already kept. Bigger, more
    // important places win the space.
    function update() {
      // Every drawn town is label-eligible (the main-map set is already thinned
      // to map:true, the locator set to LOCATOR_CAP); the collision pass below
      // decides which survive at the current zoom. Curated landmarks and bigger
      // places win the space.
      var eligible = items.slice();
      eligible.sort(function (a, b) {
        return (a.t.curated ? 0 : 1) - (b.t.curated ? 0 : 1) ||
          a.t.tier - b.t.tier || b.t.pop - a.t.pop;
      });
      var placed = [];
      var keepLabel = new Set();
      eligible.forEach(function (it) {
        var p = map.latLngToLayerPoint([it.t.lat, it.t.lon]);
        var w = it.t.name.length * 6.2 + 12;
        var box = { x1: p.x, y1: p.y - 8, x2: p.x + w, y2: p.y + 8 };
        var hit = placed.some(function (b) {
          return !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2);
        });
        if (!hit) { placed.push(box); keepLabel.add(it); }
      });
      items.forEach(function (it) {
        // Region map: show a dot only where its label survives, so dense metros
        // don't pile up unlabelled dots. Locator: every town gets a dot.
        var dotOn = opts.fdra ? true : keepLabel.has(it);
        toggle(it.marker._path, dotOn);
        var lbl = it.marker.getTooltip();
        toggle(lbl && lbl.getElement(), keepLabel.has(it));
      });
    }
    map.on('zoomend', update);
    map.on('moveend', update);
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

  function initRegionMap(el, geojson, towns) {
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
    if (towns) addTowns(map, towns);

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

  function initAreaMap(el, geojson, towns) {
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
    if (towns) addTowns(map, towns, { fdra: slug });
  }

  function init() {
    if (typeof L === 'undefined') return;
    var region = document.getElementById('danger-map');
    var area = document.getElementById('area-map');
    if (!region && !area) return;
    Promise.all([
      fetch('/map-data.json').then(function (r) { return r.json(); }),
      fetch('/towns.json').then(function (r) { return r.json(); }).catch(function () { return []; }),
    ]).then(function (res) {
      var geojson = res[0];
      var towns = res[1];
      if (region) initRegionMap(region, geojson, towns);
      if (area) initAreaMap(area, geojson, towns);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
