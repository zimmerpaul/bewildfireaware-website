// Exports FDRA boundary polygons from the Google My Maps map, simplifies the
// geometry, and writes src/data/fdra_boundaries.json (GeoJSON FeatureCollection).
//
// The My Maps map stays the source of truth for boundaries — rerun this script
// whenever boundaries change (they rarely do). Run: npm run update-map

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MAP_MID = '1-J_VEIRPmFNzhZ6BDQoWzloPLUTQ2us';
const TOLERANCE = 0.0015; // degrees (~150 m) — Douglas-Peucker simplification

// My Maps placemark name -> site slug
const NAME_TO_SLUG = {
  'GJ - High': 'grand_junction_high',
  'GJ - Middle': 'grand_junction_middle',
  'GJ - Lower': 'grand_junction_low',
  'Durango - Lower': 'durango_lower',
  'Durango - Upper': 'durango_upper',
  'Montrose - Montrose': 'montrose_montrose',
  'Montrose - Uncompahgre': 'montrose_uncompaghre',
  'Montrose - West': 'montrose_west',
  'Montrose - High Elevation': 'montrose_high',
};

// Iterative Douglas-Peucker (stack-based; rings can have tens of thousands of points)
function simplify(points, tol) {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [ax, ay] = points[a], [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1, maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      let d;
      if (len2 === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      }
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > tol * tol) {
      keep[maxI] = 1;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const res = await fetch(`https://www.google.com/maps/d/kml?mid=${MAP_MID}&forcekml=1`, { redirect: 'follow' });
if (!res.ok) throw new Error(`KML fetch failed: HTTP ${res.status}`);
const kml = await res.text();

const features = [];
let before = 0, after = 0;

for (const pm of kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)) {
  const block = pm[1];
  const name = /<name>([^<]*)<\/name>/.exec(block)?.[1]?.trim();
  const slug = NAME_TO_SLUG[name];
  if (!slug) {
    if (name) console.log(`skip: "${name}" (no slug mapping)`);
    continue;
  }
  const rings = [];
  for (const ob of block.matchAll(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)) {
    const pts = ob[1].trim().split(/\s+/).map((triple) => {
      const [lon, lat] = triple.split(',').map(Number);
      return [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
    });
    before += pts.length;
    const simp = simplify(pts, TOLERANCE);
    after += simp.length;
    if (simp.length >= 4) rings.push(simp);
  }
  if (!rings.length) { console.log(`skip: "${name}" (no polygon rings)`); continue; }
  features.push({
    type: 'Feature',
    properties: { slug, name },
    geometry: rings.length === 1
      ? { type: 'Polygon', coordinates: rings }
      : { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) },
  });
}

if (features.length !== Object.keys(NAME_TO_SLUG).length)
  console.warn(`WARNING: expected ${Object.keys(NAME_TO_SLUG).length} areas, got ${features.length}`);

const out = { type: 'FeatureCollection', features };
const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = join(__dirname, '../src/data/fdra_boundaries.json');
const json = JSON.stringify(out);
writeFileSync(outPath, json);
console.log(`${features.length} areas | ${before} -> ${after} points | ${(json.length / 1024).toFixed(0)} KB -> ${outPath}`);
