// Build-time endpoint: emits /map-data.json — FDRA boundaries merged with
// today's danger rating and headline observations. Consumed by map.js (danger
// map + popups) and geolocate.js (homepage "your local danger"), so the
// boundary geometry is downloaded once and only on pages that need it.
import areas from '../data/dispatch_areas.json';
import boundaries from '../data/fdra_boundaries.json';
import fdraGeo from '../data/fdra_geo.json';
import localInfo from '../data/local_info.json';

const dataFiles = import.meta.glob('../data/areas/*.json', { eager: true });
const overviewFiles = import.meta.glob('../data/overviews/*.json', { eager: true });
const byASlug = Object.fromEntries(areas.map((a) => [a.slug, a]));

const WANTED_OBS = ['ERC %', 'BI %', 'Winds', 'Max Temp'];

export function GET() {
  const features = boundaries.features.map((f) => {
    const slug = f.properties.slug;
    const d = dataFiles[`../data/areas/${slug}.json`];
    const data = d?.default ?? d ?? {};
    const obs = (data.observations ?? [])
      .filter((o) => WANTED_OBS.some((w) => o.label.toUpperCase().startsWith(w.toUpperCase().slice(0, 6))))
      .slice(0, 4)
      .map((o) => ({ label: o.label, value: o.value, triggered: !!o.triggered }));
    const ovMod = overviewFiles[`../data/overviews/${slug}.json`];
    const ov = ovMod?.default ?? ovMod;
    return {
      ...f,
      properties: {
        slug,
        name: byASlug[slug]?.name ?? f.properties.name,
        danger: data.danger ?? 'Unknown',
        updated: data.dateLabel ?? '',
        watchout: data.watchout ?? null,
        obs,
        overview: ov?.overview ?? null,
        overviewSources: ov?.sources ?? null,
        overviewGenerated: ov?.generated ?? null,
        centroid: fdraGeo[slug]?.centroid ?? null,
        localInfo: Array.isArray(localInfo[slug]) ? localInfo[slug] : null,
        url: `/dispatch_areas/${slug}.html`,
      },
    };
  });
  return new Response(JSON.stringify({ type: 'FeatureCollection', features }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
