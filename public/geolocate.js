// "Your local fire danger": browser geolocation matched against FDRA polygons.
// The FDRA match happens on-device. The coordinates are also sent from the
// visitor's browser DIRECTLY to public government services (never to us):
// NWS (weather/alerts), the interagency wildland-fire jurisdiction layer on
// NIFC's ArcGIS (land ownership), and the Census Bureau (county). The matched
// area (never the coordinates) is remembered in localStorage so returning
// visitors see their area immediately.
(function () {
  var STORE_KEY = 'bwa-my-area';

  // ---- Land status ("you appear to be on BLM land…") -----------------------
  // Phase 1 of the fire-restrictions feature: identify WHO sets the rules at
  // the visitor's location and deep-link to that authority. We never assert a
  // restriction stage here — that's Phase 2, from verified feeds only.
  var JURIS_URL = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/DMP_JurisdictionalUnits_Public/FeatureServer/0/query';
  var COUNTY_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query';

  // Display names + default restriction-info links per jurisdictional
  // category. JIM REVIEW: these links should be the official fire pages.
  var AGENCY_INFO = {
    'BLM':   { name: 'Bureau of Land Management land', url: 'https://www.blm.gov/programs/public-safety-and-fire/fire-and-aviation/regional-information/colorado', label: 'BLM Colorado fire restrictions' },
    'USFS':  { name: 'National Forest land', url: 'https://www.fs.usda.gov/r02/', label: 'Forest Service alerts' },
    'NPS':   { name: 'National Park Service land', url: 'https://www.nps.gov/state/co/index.htm', label: 'NPS Colorado parks' },
    'USFWS': { name: 'a National Wildlife Refuge (U.S. Fish & Wildlife)', url: 'https://www.fws.gov/', label: 'U.S. Fish & Wildlife' },
    'BIA':   { name: 'tribal land', url: 'https://www.bia.gov/regional-offices/southwest', label: 'BIA Southwest Region' },
    'BOR':   { name: 'Bureau of Reclamation land', url: 'https://www.usbr.gov/', label: 'Bureau of Reclamation' },
    'State': { name: 'Colorado state land', url: 'https://dfpc.colorado.gov/sections/wildfire-information-center/fire-restriction-information', label: 'Colorado DFPC fire restrictions' },
  };
  // Forest-specific alert pages (substring match on the unit name).
  var UNIT_LINKS = [
    ['Grand Mesa',   'https://www.fs.usda.gov/alerts/gmug/alerts-notices',       'GMUG alerts & closures'],
    ['Uncompahgre National Forest', 'https://www.fs.usda.gov/alerts/gmug/alerts-notices', 'GMUG alerts & closures'],
    ['Gunnison National Forest',    'https://www.fs.usda.gov/alerts/gmug/alerts-notices', 'GMUG alerts & closures'],
    ['San Juan',     'https://www.fs.usda.gov/alerts/sanjuan/alerts-notices',    'San Juan NF alerts & closures'],
    ['White River',  'https://www.fs.usda.gov/alerts/whiteriver/alerts-notices', 'White River NF alerts & closures'],
    ['Rio Grande',   'https://www.fs.usda.gov/alerts/riogrande/alerts-notices',  'Rio Grande NF alerts & closures'],
    ['Pike',         'https://www.fs.usda.gov/alerts/psicc/alerts-notices',      'PSICC alerts & closures'],
  ];
  var COUNTY_LINKS =
    '<a href="https://dfpc.colorado.gov/sections/wildfire-information-center/fire-restriction-information" target="_blank" rel="noopener">county restrictions (DFPC) ↗</a> · ' +
    '<a href="https://westslopefireinfo.com/" target="_blank" rel="noopener">West Slope Fire Info ↗</a>';

  function arcgisPointQuery(url, lat, lon, outFields) {
    var p = new URLSearchParams({
      f: 'json', geometry: lon + ',' + lat, geometryType: 'esriGeometryPoint', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects', outFields: outFields, returnGeometry: 'false',
    });
    return fetch(url + '?' + p).then(function (r) { return r.json(); })
      .then(function (d) { return (d.features && d.features[0] && d.features[0].attributes) || null; });
  }

  function renderLandStatus(el, lat, lon) {
    Promise.all([
      arcgisPointQuery(JURIS_URL, lat, lon, 'JurisdictionalUnitName,LocalName,JurisdictionalKind,JurisdictionalCategory,LandownerKind').catch(function () { return null; }),
      arcgisPointQuery(COUNTY_URL, lat, lon, 'NAME,STATE').catch(function () { return null; }),
    ]).then(function (res) {
      var j = res[0], c = res[1];
      if (!j && !c) return; // both lookups failed — say nothing rather than guess
      var county = c && c.NAME ? c.NAME.replace(/ County$/, '') : null;
      var inCounty = county ? ' in <strong>' + esc(county) + ' County</strong>' : '';
      var html;
      var kind = j && j.JurisdictionalKind;
      var cat = j && j.JurisdictionalCategory;
      var agency = cat && AGENCY_INFO[cat];
      if (j && kind === 'Federal' && agency) {
        var unit = j.LocalName || j.JurisdictionalUnitName || '';
        var link = agency.url, label = agency.label;
        for (var i = 0; i < UNIT_LINKS.length; i++) {
          if (unit.indexOf(UNIT_LINKS[i][0]) !== -1) { link = UNIT_LINKS[i][1]; label = UNIT_LINKS[i][2]; break; }
        }
        html = 'You appear to be on <strong>' + agency.name + '</strong>' +
          (unit ? ' (' + esc(unit) + ')' : '') + inCounty + '.' +
          ' Fire restrictions there are set by that agency; county rules apply on nearby private land.' +
          '<span class="land-links">Check current status: <a href="' + link + '" target="_blank" rel="noopener">' +
          label + ' ↗</a> · ' + COUNTY_LINKS + '</span>';
      } else if (j && kind === 'State' && AGENCY_INFO.State) {
        html = 'You appear to be on <strong>Colorado state land</strong>' + inCounty + '.' +
          '<span class="land-links">Check current status: <a href="' + AGENCY_INFO.State.url +
          '" target="_blank" rel="noopener">' + AGENCY_INFO.State.label + ' ↗</a> · ' + COUNTY_LINKS + '</span>';
      } else {
        // Private, city/county land, or unknown: county (sheriff) rules govern
        html = 'You appear to be on <strong>private or locally managed land</strong>' + inCounty +
          ' — fire restrictions and burn bans there are set by the county' + (county ? '' : ' or municipality') + '.' +
          '<span class="land-links">Check current status: ' + COUNTY_LINKS + '</span>';
      }
      el.innerHTML = '<h4>Whose fire rules apply here?</h4><p>' + html + '</p>' +
        '<p class="land-caveat">Land boundaries are approximate and ownership is patchy at small scales — always verify locally before lighting anything.</p>';
    }).catch(function () {});
  }

  function dangerClass(level) {
    return 'danger-' + String(level || 'unknown').toLowerCase().replace(/\s+/g, '-');
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Same markdown-lite rendering as the FDRA pages: **bold** lead + "- " bullets
  function ovHtml(text) {
    var lines = esc(text.trim()).split(/\r?\n/);
    var html = '', inList = false;
    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      if (line.indexOf('- ') === 0) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + line.slice(2) + '</li>';
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        html += '<p>' + line + '</p>';
      }
    });
    if (inList) html += '</ul>';
    return html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }

  // Homepage: executive summary (bold lead) + click-to-expand full overview.
  // No sources here — those live on the full forecast page.
  function overviewHtml(p) {
    var lines = p.overview.trim().split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    var leadIdx = -1;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('- ') !== 0) { leadIdx = i; break; }
    }
    var lead = leadIdx >= 0 ? lines[leadIdx].replace(/\*\*/g, '') : '';
    var rest = lines.filter(function (_, i) { return i !== leadIdx; }).join('\n');
    return '<div class="locate-overview">' +
      '<p class="ov-lead"><strong>' + esc(lead) + '</strong>' +
      '<span class="overview-credit"> — <a href="/data-sources.html#ai-overviews">overview generated by Claude</a></span></p>' +
      (rest
        ? '<details class="ov-details"><summary>Full overview</summary>' + ovHtml(rest) + '</details>'
        : '') +
      '</div>';
  }

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
        if (rf && container) {
          var b = document.createElement('span');
          b.className = 'redflag-badge';
          b.textContent = '⚠ ' + rf.properties.event + ' in effect (NWS)';
          container.appendChild(b);
        }
      })
      .catch(function () {});
  }

  function save(slug) { try { localStorage.setItem(STORE_KEY, slug); } catch (e) {} }
  function saved() { try { return localStorage.getItem(STORE_KEY); } catch (e) { return null; } }
  function clearSaved() { try { localStorage.removeItem(STORE_KEY); } catch (e) {} }

  // Curated "Current Local Info" (feeds/links from local_info.json via map-data)
  function localInfoHtml(p) {
    if (!p.localInfo || !p.localInfo.length) return '';
    var html = '<div class="locate-localinfo"><h4>Current Local Info</h4>';
    p.localInfo.forEach(function (item) {
      html += '<div class="local-info-card"><h3>' + esc(item.title) + '</h3>' +
        (item.note ? '<p class="local-info-note">' + esc(item.note) + '</p>' : '') +
        (item.playlist
          ? '<div class="video-embed"><iframe src="https://www.youtube-nocookie.com/embed/videoseries?list=' +
            esc(item.playlist) + '" title="' + esc(item.title) + '" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen loading="lazy"></iframe></div>'
          : '') +
        (item.facebook
          ? '<div class="fb-embed"><iframe src="https://www.facebook.com/plugins/page.php?href=' +
            encodeURIComponent(item.facebook) + '&tabs=timeline&width=500&height=600&small_header=true&adapt_container_width=true&hide_cover=false&show_facepile=false" ' +
            'width="500" height="600" scrolling="no" frameborder="0" allow="encrypted-media" loading="lazy" title="' + esc(item.title) + ' on Facebook"></iframe>' +
            '<p class="fb-fallback">Feed not loading? Some browsers block Facebook embeds — <a href="' + esc(item.facebook) + '" target="_blank" rel="noopener">view updates on Facebook ↗</a></p></div>'
          : '') +
        ((item.links || []).length
          ? '<ul class="local-info-links">' + item.links.map(function (l) {
              return '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.name) + ' ↗</a></li>';
            }).join('') + '</ul>'
          : '') +
        '</div>';
    });
    return html + '</div>';
  }

  function setLocating(active) {
    var btn = document.getElementById('locate-btn');
    if (!btn) return;
    btn.disabled = !!active;
    btn.classList.toggle('btn-disabled', !!active);
    btn.textContent = active ? 'Using your location ✓' : 'Use my location';
  }

  function renderHit(out, p, opts, coords) {
    out.innerHTML =
      '<div class="locate-hit">' +
      '<strong>' + p.name + '</strong>' +
      '<span class="danger-chip ' + dangerClass(p.danger) + '">' + p.danger + '</span>' +
      (p.watchout && p.watchout.isWatchout
        ? '<span class="locate-note">▲ ' + p.watchout.met + ' of ' + p.watchout.total + ' watchout thresholds met</span>' : '') +
      '<a class="btn" style="margin-top:0" href="' + p.url + '">Your full forecast &rarr;</a>' +
      (p.overview ? overviewHtml(p) : '') +
      localInfoHtml(p) +
      (coords ? '<div class="land-status"></div>' : '') +
      '<div class="wx-strip wx-strip-home"></div>' +
      (opts && opts.remembered
        ? '<span class="locate-remembered">Location remembered from last visit · <a href="#" id="locate-clear">forget</a></span>' : '') +
      '</div>';
    setLocating(true);
    var clear = document.getElementById('locate-clear');
    if (clear) clear.addEventListener('click', function (e) {
      e.preventDefault(); clearSaved(); out.innerHTML = ''; setLocating(false);
    });

    // Live weather + AQI: at the visitor's precise location when available,
    // otherwise the area centroid (remembered visits).
    var wx = out.querySelector('.wx-strip');
    var ll = coords || p.centroid;
    if (wx && ll && window.bwaWeather) window.bwaWeather.render(wx, ll[0], ll[1]);

    // Land status only for a fresh locate (remembered visits have no coords)
    var land = out.querySelector('.land-status');
    if (land && coords) renderLandStatus(land, coords[0], coords[1]);
  }

  function init() {
    var btn = document.getElementById('locate-btn');
    var out = document.getElementById('locate-result');
    if (!btn || !out) return;
    if (!('geolocation' in navigator)) { btn.style.display = 'none'; return; }

    // Returning visitor: show the remembered area with today's fresh data
    var rem = saved();
    if (rem) {
      fetch('/map-data.json').then(function (r) { return r.json(); }).then(function (geojson) {
        var f = geojson.features.find(function (x) { return x.properties.slug === rem; });
        if (f) renderHit(out, f.properties, { remembered: true });
        else clearSaved();
      });
    }

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
            save(hit.properties.slug);
            renderHit(out, hit.properties, null, [lat, lon]);
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
