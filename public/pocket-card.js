// Pocket card rollover: crosshair + daily values tooltip.
// Progressive enhancement over the build-time SVG chart (works with mouse and touch).
(function () {
  var MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function dateLabel(day) {
    for (var m = 11; m >= 0; m--) {
      if (day >= MONTH_STARTS[m]) return (day - MONTH_STARTS[m] + 1) + '-' + MONTH_NAMES[m];
    }
    return '';
  }

  function setup(figure) {
    var dataEl = figure.querySelector('script[data-pocket-card]');
    var svg = figure.querySelector('svg');
    if (!dataEl || !svg) return;
    var cfg = JSON.parse(dataEl.textContent);
    var g = cfg.geo;

    // day -> value lookup per series
    var series = cfg.series.map(function (s) {
      var byDay = {};
      s.points.forEach(function (p) { byDay[p[0]] = p[1]; });
      return { label: s.label, color: s.color, byDay: byDay };
    });

    var xFor = function (day) { return g.ml + (day / 365) * g.pw; };

    var NS = 'http://www.w3.org/2000/svg';
    var cross = document.createElementNS(NS, 'line');
    cross.setAttribute('y1', g.mt);
    cross.setAttribute('y2', g.mt + g.ph);
    cross.setAttribute('stroke', '#666');
    cross.setAttribute('stroke-width', '1.5');
    cross.setAttribute('stroke-dasharray', '4 4');
    cross.style.display = 'none';
    svg.appendChild(cross);

    var tip = document.createElement('div');
    tip.className = 'pc-tooltip';
    tip.style.display = 'none';
    figure.appendChild(tip);

    function hide() {
      cross.style.display = 'none';
      tip.style.display = 'none';
    }

    function show(clientX) {
      var rect = svg.getBoundingClientRect();
      var vx = (clientX - rect.left) * (g.W / rect.width);
      if (vx < g.ml - 10 || vx > g.ml + g.pw + 10) return hide();
      var day = Math.round(((vx - g.ml) / g.pw) * 365);
      day = Math.max(0, Math.min(364, day));

      var rows = '';
      series.forEach(function (s) {
        var v = s.byDay[day];
        if (v === undefined) return;
        rows += '<div class="pc-row"><span class="pc-swatch" style="background:' + s.color + '"></span>' +
          s.label + ': <strong>' + (Math.round(v * 10) / 10) + '</strong></div>';
      });
      if (!rows) return hide();

      cross.setAttribute('x1', xFor(day));
      cross.setAttribute('x2', xFor(day));
      cross.style.display = '';

      tip.innerHTML = '<div class="pc-date">' + dateLabel(day) + '</div>' + rows;
      tip.style.display = '';
      var px = (xFor(day) / g.W) * rect.width;   // pixel x within figure
      var flip = px > rect.width / 2;
      tip.style.left = flip ? '' : (px + 16) + 'px';
      tip.style.right = flip ? (rect.width - px + 16) + 'px' : '';
      tip.style.top = ((g.mt / g.H) * rect.height + 10) + 'px';
    }

    svg.addEventListener('mousemove', function (e) { show(e.clientX); });
    svg.addEventListener('mouseleave', hide);
    svg.addEventListener('touchstart', function (e) { show(e.touches[0].clientX); }, { passive: true });
    svg.addEventListener('touchmove', function (e) { show(e.touches[0].clientX); }, { passive: true });
    svg.addEventListener('touchend', hide);
  }

  function init() {
    document.querySelectorAll('.pocket-card').forEach(setup);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
