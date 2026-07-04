// "Your local fire danger": browser geolocation matched against FDRA polygons.
// Entirely client-side — coordinates never leave the visitor's device except
// for an optional National Weather Service alert lookup (api.weather.gov).
(function () {
  function dangerClass(level) {
    return 'danger-' + String(level || 'unknown').toLowerCase().replace(/\s+/g, '-');
  }

  // Ray-casting point-in-ring test
  function inRing(pt, ring) {
    var x = pt[0], y = pt[1], inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function inFeature(pt, geom) {
    var polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    return polys.some(function (poly) { return inRing(pt, poly[0]); });
  }

  function checkRedFlag(lat, lon, container) {
    fetch('https://api.weather.gov/alerts/active?point=' + lat + ',' + lon)
      .then(function (r) { return r.json(); })
      .then(function (alerts) {
        var rf = (alerts.features || []).find(function (a) {
          return /red flag|fire weather/i.test(a.properties.event);
        });
        if (rf) {
          var b = document.createElement('span');
          b.className = 'redflag-badge';
          b.textContent = '⚠ ' + rf.properties.event + ' in effect (NWS)';
          container.appendChild(b);
        }
      })
      .catch(function () {});
  }

  function init() {
    var btn = document.getElementById('locate-btn');
    var out = document.getElementById('locate-result');
    if (!btn || !out) return;
    if (!('geolocation' in navigator)) { btn.style.display = 'none'; return; }

    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = 'Locating…';
      navigator.geolocation.getCurrentPosition(function (pos) {
        var lat = pos.coords.latitude, lon = pos.coords.longitude;
        fetch('/map-data.json').then(function (r) { return r.json(); }).then(function (geojson) {
          var hit = geojson.features.find(function (f) { return inFeature([lon, lat], f.geometry); });
          btn.textContent = 'Use my location';
          btn.disabled = false;
          if (hit) {
            var p = hit.properties;
            out.innerHTML =
              '<div class="locate-hit">' +
              '<strong>' + p.name + '</strong>' +
              '<span class="danger-chip ' + dangerClass(p.danger) + '">' + p.danger + '</span>' +
              (p.watchout && p.watchout.isWatchout
                ? '<span class="locate-note">▲ ' + p.watchout.met + ' of ' + p.watchout.total + ' watchout thresholds met</span>' : '') +
              '<a class="btn" style="margin-top:0" href="' + p.url + '">Your full forecast &rarr;</a>' +
              '</div>';
            checkRedFlag(lat, lon, out.querySelector('.locate-hit'));
          } else {
            out.innerHTML =
              '<div class="locate-hit"><span class="locate-note">You appear to be outside our nine Western Colorado ' +
              'coverage areas. Browse the map below, or check ' +
              '<a href="https://www.wfas.net/" target="_blank" rel="noopener">the national fire danger map</a>.</span></div>';
            checkRedFlag(lat, lon, out.querySelector('.locate-hit'));
          }
        });
      }, function () {
        btn.textContent = 'Use my location';
        btn.disabled = false;
        out.innerHTML = '<div class="locate-hit"><span class="locate-note">Location unavailable or permission declined — no problem. Pick your area from the map below.</span></div>';
      }, { timeout: 10000, maximumAge: 300000 });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
