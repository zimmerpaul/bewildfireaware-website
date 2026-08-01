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
// MAIN-MAP SELECTION (map:true) — per owner feedback ("at least one town per
// FDRA, no more than ~3; the old hand-curated mountain towns win"). For each
// FDRA we pick min 1 / max 3 labels for the statewide danger map: CURATED
// towns first (the locals' landmarks below — Gunnison, Aspen, …), then fill the
// remaining slots by population. A town shared across FDRAs counts against each
// FDRA's cap but is a single entry (map:true if picked for ANY FDRA). Every
// place from the full Census join is still emitted (locator maps + Communities
// lines read the fuller set); only map:true render on the main map.
//
// Emits [{name, lat, lon, pop, fdras:[slug], tier, curated, map, censusMatch?}]
//   tier 1 = pop > 20k or a dispatch-center city
//   tier 2 = 2k–20k
//   tier 3 = < 2k
//   curated = one of the hand-curated landmark towns (wins map slots + label
//             collisions); censusMatch:false marks a curated town that matched
//             no Census place (kept on its old hardcoded coords).
//   map = drawn on the statewide main map (max 3 / min 1 per FDRA).
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
const TIER3_CAP = 3; // per-FDRA cap on the smallest (<2k) towns (locator/full set)
const MIN_TOWNS = 2; // every FDRA gets at least this many labels in the full set
const MAP_MIN = 1; // min main-map labels per FDRA
const MAP_MAX = 3; // max main-map labels per FDRA

// Hand-curated landmark towns, recovered from the original public/map.js TOWNS
// array. These are the locals' orientation points on the Western Slope; they
// win a main-map slot over any raw-population pick in the same FDRA. Matched by
// name (case-insensitive) against the Census places for accurate coords/pop; a
// curated town matching no Census place keeps these coords and is flagged
// censusMatch:false. [name, lat, lon, tier]
const CURATED = [
  ['Grand Junction', 39.0639, -108.5506, 1],
  ['Montrose', 38.4783, -107.8762, 1],
  ['Gunnison', 38.5458, -106.9253, 1],
  ['Durango', 37.2753, -107.8801, 1],
  ['Cortez', 37.3489, -108.5859, 1],
  ['Glenwood Springs', 39.5505, -107.3248, 1],
  ['Aspen', 39.1911, -106.8175, 1],
  ['Telluride', 37.9375, -107.8123, 1],
  ['Pagosa Springs', 37.2694, -107.0098, 1],
  ['Delta', 38.7422, -108.069, 2],
  ['Crested Butte', 38.8697, -106.9878, 2],
  ['Ouray', 38.0228, -107.6714, 2],
  ['Ridgway', 38.1525, -107.7568, 2],
  ['Paonia', 38.8683, -107.592, 2],
  ['Silverton', 37.8117, -107.6645, 2],
  ['Lake City', 38.03, -107.315, 2],
  ['Rifle', 39.5347, -107.7831, 2],
  ['Carbondale', 39.4022, -107.2112, 2],
  ['Norwood', 38.1319, -108.2929, 2],
  ['Nucla', 38.2678, -108.5484, 2],
  ['Hotchkiss', 38.7994, -107.7176, 2],
];
const curatedByName = new Map(CURATED.map((c) => [c[0].toLowerCase(), c]));

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
  // TIGERweb intermittently 503s; retry a few times with backoff.
  let lastErr;
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`TIGERweb layer ${id}: HTTP ${res.status}`);
      const data = await res.json();
      if (data.exceededTransferLimit) throw new Error(`layer ${id} paged — raise limit`);
      return data.features.map((f) => f.attributes);
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
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

// --- mark curated Census matches; synthesise curated towns with no match ----
// If a curated name matches more than one Census place (e.g. an incorporated
// town + a same-name CDP), curated wins on the largest.
const matchedCurated = new Set();
for (const c of CURATED) {
  const matches = places.filter((p) => p.name.toLowerCase() === c[0].toLowerCase());
  if (!matches.length) continue;
  matches.sort((a, b) => b.pop - a.pop);
  matches[0].curated = true;
  matchedCurated.add(c[0]);
}
const missing = CURATED.filter((c) => !matchedCurated.has(c[0]));
for (const c of missing) {
  const [name, lat, lon, tier] = c;
  places.push({ geoid: `curated:${name}`, name, lat, lon, pop: 0, curated: true, censusMatch: false, tierOverride: tier });
  console.warn(`  ! curated "${name}" matched no Census place — using hardcoded coords`);
}

// Precompute distance from every place to every FDRA (km) and containment.
for (const p of places) {
  p.tier = p.tierOverride || tierFor(p);
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
// Curated towns get the same nearest-FDRA fallback so a landmark just outside
// every boundary still attaches to the closest area.
for (const p of places) {
  if (p.fdras.size) continue;
  if (p.pop < ORIENT_POP && !p.curated) continue;
  let best = null;
  for (const f of fdras) {
    if (p.dist[f.slug] <= ORIENT_KM && (!best || p.dist[f.slug] < p.dist[best])) best = f.slug;
  }
  if (best) p.fdras.add(best);
}

// --- tier-3 cap: keep the 3 largest <2k towns per FDRA (curated exempt) -----
for (const f of fdras) {
  const t3 = places
    .filter((p) => p.fdras.has(f.slug) && p.tier === 3 && !p.curated)
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

// --- main-map selection: per FDRA, curated first then population, 1..3 ------
// A town gets a single entry but is SHARED across every FDRA it touches, so a
// map:true town counts against the cap of *each* of its FDRAs. We enforce the
// per-FDRA cap globally (leak-aware) so no FDRA's region shows more than
// MAP_MAX labels on the statewide map.
for (const p of places) p.map = false;
const mapCount = {}; // slug -> current # of map:true towns attached
for (const f of fdras) mapCount[f.slug] = 0;
const attachedSlugs = (p) => [...p.fdras];
// Would flipping p to map:true keep every one of its FDRAs within the cap?
const fits = (p) => attachedSlugs(p).every((s) => mapCount[s] < MAP_MAX);
function select(p) {
  p.map = true;
  for (const s of attachedSlugs(p)) mapCount[s] += 1;
}

// Phase 1 — curated landmarks win their slots unconditionally (they never
// exceed the cap within a single FDRA: at most 3 curated attach to any one).
for (const p of places) {
  if (p.curated && p.fdras.size) select(p);
}

// Phase 2 — guarantee MAP_MIN per FDRA: any FDRA still empty gets its largest
// attached town (subject to the leak-aware cap).
for (const f of fdras) {
  if (mapCount[f.slug] >= MAP_MIN) continue;
  const cand = places
    .filter((p) => !p.map && p.fdras.has(f.slug) && fits(p))
    .sort((a, b) => a.tier - b.tier || b.pop - a.pop || a.name.localeCompare(b.name))[0];
  if (cand) select(cand);
}

// Phase 3 — fill remaining slots by population, globally, so the largest towns
// claim space first and shared towns thin the dense corridors. Each add is
// gated by the leak-aware cap, so every FDRA stays at MAP_MAX or below.
const byPop = places
  .filter((p) => !p.map && p.fdras.size)
  .sort((a, b) => a.tier - b.tier || b.pop - a.pop || a.name.localeCompare(b.name));
for (const p of byPop) {
  // Only worth a slot if at least one of its FDRAs still has room.
  if (attachedSlugs(p).some((s) => mapCount[s] < MAP_MAX) && fits(p)) select(p);
}

// --- emit -------------------------------------------------------------------
const towns = places
  .filter((p) => p.fdras.size)
  .map((p) => {
    const t = {
      name: p.name,
      lat: +p.lat.toFixed(5),
      lon: +p.lon.toFixed(5),
      pop: p.pop,
      fdras: [...p.fdras].sort(),
      tier: p.tier,
      curated: !!p.curated,
      map: !!p.map,
    };
    if (p.censusMatch === false) t.censusMatch = false;
    return t;
  })
  .sort((a, b) =>
    Number(b.map) - Number(a.map) ||
    Number(b.curated) - Number(a.curated) ||
    a.tier - b.tier || b.pop - a.pop || a.name.localeCompare(b.name),
  );

writeFileSync(join(__dirname, '../src/data/towns.json'), JSON.stringify(towns, null, 2) + '\n');

// --- report -----------------------------------------------------------------
const byTier = { 1: 0, 2: 0, 3: 0 };
towns.forEach((t) => (byTier[t.tier] += 1));
const mapTowns = towns.filter((t) => t.map);
const curatedTowns = towns.filter((t) => t.curated);
console.log(
  `\nWrote src/data/towns.json — ${towns.length} towns ` +
    `(t1=${byTier[1]} t2=${byTier[2]} t3=${byTier[3]}); ` +
    `${mapTowns.length} on main map; ${curatedTowns.length} curated ` +
    `(${curatedTowns.filter((t) => t.censusMatch === false).length} without Census match)`,
);

console.log('\nPer-FDRA main-map counts (curated * marked):');
const mapPer = {};
for (const f of fdras) {
  const list = towns.filter((t) => t.map && t.fdras.includes(f.slug));
  mapPer[f.slug] = list.length;
  const names = list.map((t) => (t.curated ? '*' : '') + t.name).join(', ');
  console.log(`  ${f.slug.padEnd(22)} ${String(list.length).padStart(2)}  ${names}`);
}
const mv = Object.values(mapPer);
console.log(`\nmain-map min/FDRA=${Math.min(...mv)} max/FDRA=${Math.max(...mv)} total=${mapTowns.length}`);

// Full-set per-FDRA counts (locator maps / Communities line read these).
const fullPer = {};
for (const f of fdras) fullPer[f.slug] = towns.filter((t) => t.fdras.includes(f.slug)).length;
const fv = Object.values(fullPer);
console.log(`full-set min/FDRA=${Math.min(...fv)} max/FDRA=${Math.max(...fv)}`);

// Sanity checks — expected towns must land in the right FDRAs & the curated
// mountain landmarks must be back on the main map.
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
console.log('\nSanity checks (FDRA attach):');
for (const [name, re] of expect) {
  const t = towns.find((x) => x.name === name);
  const ok = t && t.fdras.some((s) => re.test(s));
  console.log(`  ${ok ? 'OK ' : 'MISS'} ${name.padEnd(16)} -> ${t ? t.fdras.join(', ') : '(not found)'}`);
}
console.log('\nCurated on main map:');
for (const c of CURATED) {
  const t = towns.find((x) => x.name === c[0]);
  const on = t && t.map;
  console.log(`  ${on ? 'MAP ' : t ? 'off ' : 'MISS'} ${c[0]}`);
}
