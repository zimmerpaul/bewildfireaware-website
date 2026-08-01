// Builds src/data/towns.json — town/city reference labels for the FDRA maps.
//
// DATA SOURCE: US Census Bureau TIGERweb ArcGIS REST (public, no key):
//   https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020
//   layer 26 (Incorporated Places) + layer 28 (Census Designated Places).
// Each feature carries NAME, INTPTLAT/INTPTLON (internal point) and POP100
// (2020 decennial population) — everything we need in one keyless .gov source.
// (The api.census.gov data API now 302-redirects keyless calls to a "Missing
//  Key" page, so we read population straight off the TIGERweb layers instead.)
//
// For each place we spatial-join its internal point against the 21 FDRA
// polygons in src/data/fdra_boundaries.json (with a ~3km edge buffer so towns
// just outside a boundary, e.g. Glenwood Springs, still attach). Major
// orientation cities that fall outside every polygon but within ~15km of one
// are attached to the nearest FDRA so the maps stay legible.
//
// Emits [{name, lat, lon, pop, fdras:[slug], tier}] where
//   tier 1 = pop > 20k or a dispatch-center city  (always labelled)
//   tier 2 = 2k–20k                               (mid zoom)
//   tier 3 = < 2k                                 (high zoom; capped 3/FDRA)
// Every FDRA is guaranteed >= 2 towns, relaxing thresholds where the country
// is empty (Craig Zone 3, High Peaks, etc.).
//
// Rerunnable, NOT part of the daily cron. Commit the generated towns.json.
//   node scripts/build-towns.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const boundaries = JSON.parse(
  readFileSync(join(__dirname, '../src/data/fdra_boundaries.json'), 'utf8'),
);

const BUFFER_KM = 3; // edge towns just outside a boundary still attach
const ORIENT_KM = 15; // major cities outside all polygons attach to nearest FDRA
const ORIENT_POP = 20000; // "major" for orientation purposes
const TIER3_CAP = 3; // per-FDRA cap on the smallest (<2k) towns
const MIN_TOWNS = 2; // every FDRA gets at least this many labels

// Dispatch-center cities — always tier 1 even if small, they orient the map to
// the responsible dispatch center (fdopGroups in fdra_config.json).
const DISPATCH_CENTERS = new Set([
  'Grand Junction', 'Durango', 'Montrose', 'Craig', 'Fort Collins',
  'Pueblo', 'Colorado Springs', 'Kremmling',
]);

const LAYERS = [
  { id: 26, kind: 'incorporated' },
  { id: 28, kind: 'cdp' },
];
const BASE =
  'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer';

async function fetchLayer(id) {
  const url =
    `${BASE}/${id}/query?where=${encodeURIComponent("STATE='08'")}` +
    '&outFields=NAME,INTPTLAT,INTPTLON,POP100,GEOID' +
    '&returnGeometry=false&f=json&resultRecordCount=5000';
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TIGERweb layer ${id}: HTTP ${res.status}`);
  const data = await res.json();
  if (data.exceededTransferLimit) throw new Error(`layer ${id} paged — raise limit`);
  return data.features.map((f) => f.attributes);
}

// "Grand Junction city" / "Sawpit town" / "Blue Sky CDP" -> base name
function cleanName(name) {
  return name
    .replace(/\s+(city|town|village|CDP|municipality)$/i, '')
    .replace(/\s+\(balance\)$/i, '')
    .trim();
}

// --- geometry helpers -------------------------------------------------------
// A polygon "part" is a list of rings (outer + holes). MultiPolygon = many
// parts. Even-odd ray casting across every ring of a part handles holes.
function parts(geom) {
  return geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
}

function inPart(pt, rings) {
  const [x, y] = pt;
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

const inGeom = (pt, geom) => parts(geom).some((rings) => inPart(pt, rings));

// Distance (km) from a lon/lat point to the nearest polygon edge, using a
// local equirectangular projection (accurate at these scales).
function kmToGeom(pt, geom) {
  const [lon, lat] = pt;
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const ky = 110.57;
  const px = lon * kx;
  const py = lat * ky;
  let best = Infinity;
  for (const rings of parts(geom)) {
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const ax = ring[j][0] * kx, ay = ring[j][1] * ky;
        const bx = ring[i][0] * kx, by = ring[i][1] * ky;
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy || 1e-9;
        let t = ((px - ax) * dx + (py - ay) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + t * dx, cy = ay + t * dy;
        const d = Math.hypot(px - cx, py - cy);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

// --- load places ------------------------------------------------------------
const raw = [];
for (const { id } of LAYERS) {
  const feats = await fetchLayer(id);
  for (const a of feats) {
    const lat = parseFloat(a.INTPTLAT);
    const lon = parseFloat(a.INTPTLON);
    const pop = Number(a.POP100) || 0;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    raw.push({ geoid: a.GEOID, name: cleanName(a.NAME), lat, lon, pop });
  }
}
// Dedup by GEOID (defensive) and drop uninhabited ghost places.
const seen = new Set();
const places = raw.filter((p) => {
  if (seen.has(p.geoid) || p.pop <= 0) return false;
  seen.add(p.geoid);
  return true;
});
console.log(`Loaded ${places.length} populated CO places (inc + CDP)`);

const fdras = boundaries.features.map((f) => ({ slug: f.properties.slug, geom: f.geometry }));

function tierFor(p) {
  if (DISPATCH_CENTERS.has(p.name) || p.pop > 20000) return 1;
  if (p.pop >= 2000) return 2;
  return 3;
}

// Precompute distance from every place to every FDRA (km) and containment.
for (const p of places) {
  p.tier = tierFor(p);
  p.dist = {}; // slug -> km (0 if inside)
  for (const f of fdras) {
    p.dist[f.slug] = inGeom([p.lon, p.lat], f.geom) ? 0 : kmToGeom([p.lon, p.lat], f.geom);
  }
  p.fdras = new Set();
}

// --- attach: inside or within buffer ---------------------------------------
for (const p of places) {
  for (const f of fdras) {
    if (p.dist[f.slug] <= BUFFER_KM) p.fdras.add(f.slug);
  }
}
// Orientation cities: major, outside every polygon -> nearest FDRA <= 15km.
for (const p of places) {
  if (p.fdras.size || p.pop < ORIENT_POP) continue;
  let best = null;
  for (const f of fdras) {
    if (p.dist[f.slug] <= ORIENT_KM && (!best || p.dist[f.slug] < p.dist[best])) best = f.slug;
  }
  if (best) p.fdras.add(best);
}

// --- tier-3 cap: keep the 3 largest <2k towns per FDRA ---------------------
for (const f of fdras) {
  const t3 = places
    .filter((p) => p.fdras.has(f.slug) && p.tier === 3)
    .sort((a, b) => b.pop - a.pop);
  t3.slice(TIER3_CAP).forEach((p) => p.fdras.delete(f.slug));
}

// --- guarantee >= MIN_TOWNS per FDRA (relax thresholds in empty country) ---
for (const f of fdras) {
  let members = places.filter((p) => p.fdras.has(f.slug));
  if (members.length >= MIN_TOWNS) continue;
  const pool = places
    .filter((p) => !p.fdras.has(f.slug))
    .sort((a, b) => a.dist[f.slug] - b.dist[f.slug]);
  for (const p of pool) {
    if (members.length >= MIN_TOWNS) break;
    p.fdras.add(f.slug);
    members = places.filter((q) => q.fdras.has(f.slug));
  }
}

// --- emit -------------------------------------------------------------------
const towns = places
  .filter((p) => p.fdras.size)
  .map((p) => ({
    name: p.name,
    lat: +p.lat.toFixed(5),
    lon: +p.lon.toFixed(5),
    pop: p.pop,
    fdras: [...p.fdras].sort(),
    tier: p.tier,
  }))
  .sort((a, b) => a.tier - b.tier || b.pop - a.pop || a.name.localeCompare(b.name));

writeFileSync(join(__dirname, '../src/data/towns.json'), JSON.stringify(towns, null, 2) + '\n');

// --- report -----------------------------------------------------------------
const byTier = { 1: 0, 2: 0, 3: 0 };
towns.forEach((t) => (byTier[t.tier] += 1));
console.log(`\nWrote src/data/towns.json — ${towns.length} towns (t1=${byTier[1]} t2=${byTier[2]} t3=${byTier[3]})`);
console.log('\nPer-FDRA counts:');
const counts = {};
for (const f of fdras) {
  const list = towns.filter((t) => t.fdras.includes(f.slug));
  counts[f.slug] = list.length;
  const names = list.slice(0, 6).map((t) => t.name).join(', ');
  console.log(`  ${f.slug.padEnd(22)} ${String(list.length).padStart(2)}  ${names}`);
}
const vals = Object.values(counts);
console.log(`\nmin/FDRA=${Math.min(...vals)} max/FDRA=${Math.max(...vals)}`);

// Sanity checks — expected towns must land in the right FDRAs.
const expect = [
  ['Grand Junction', /^grand_junction_/],
  ['Rifle', /^grand_junction_/],
  ['Craig', /^crc_/],
  ['Meeker', /^crc_/],
  ['Rangely', /^crc_/],
  ['Durango', /^durango_/],
  ['Cortez', /^durango_/],
  ['Gunnison', /^montrose_/],
  ['Montrose', /^montrose_/],
  ['Estes Park', /ftc_east_divide/],
];
console.log('\nSanity checks:');
for (const [name, re] of expect) {
  const t = towns.find((x) => x.name === name);
  const ok = t && t.fdras.some((s) => re.test(s));
  console.log(`  ${ok ? 'OK ' : 'MISS'} ${name.padEnd(16)} -> ${t ? t.fdras.join(', ') : '(not found)'}`);
}
