// Public API v1: daily fire danger by FDRA (machine-readable).
// Rebuilt every morning with the site. Geometry lives separately in
// /api/v1/fdra-boundaries.json (large, rarely changes) — join on `slug`.
//
// Schema stability contract: keys in this file are append-only within v1.
// Breaking changes will ship as /api/v2/.
import areas from '../../../data/dispatch_areas.json';
import fdraGeo from '../../../data/fdra_geo.json';

const dataFiles = import.meta.glob('../../../data/areas/*.json', { eager: true });
const overviewFiles = import.meta.glob('../../../data/overviews/*.json', { eager: true });

const DANGER_INDEX = { 'Low': 1, 'Moderate': 2, 'High': 3, 'Very High': 4, 'Extreme': 5 };

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace('%', ''));
  return Number.isFinite(n) ? n : null;
};

export function GET() {
  const out = areas.map((a) => {
    const mod = dataFiles[`../../../data/areas/${a.slug}.json`];
    const d = mod?.default ?? mod ?? {};
    const ovMod = overviewFiles[`../../../data/overviews/${a.slug}.json`];
    const ov = ovMod?.default ?? ovMod ?? null;
    const geo = fdraGeo[a.slug] ?? {};

    return {
      slug: a.slug,
      name: a.name,
      dispatchArea: d.dispatchTitle ?? null,
      dateLabel: d.dateLabel ?? null,
      lastUpdated: d.lastUpdated ?? null,
      danger: d.danger ?? null,
      dangerIndex: DANGER_INDEX[d.danger] ?? null,
      counties: geo.counties ?? [],
      centroid: geo.centroid ? { lat: geo.centroid[0], lon: geo.centroid[1] } : null,
      fuelModel: d.fuelModel ?? null,
      indicators: (d.observations ?? []).map((o) => ({
        label: o.label,
        value: o.value,
        valueNum: num(o.value),
        threshold: o.limit ?? null,
        exceedsThreshold: o.triggered ?? null,
      })),
      watchout: d.watchout ?? null,
      thresholdsText: d.thresholds ?? null,
      forecast: d.forecast
        ? {
            dates: d.forecast.dates,
            rows: (d.forecast.rows ?? []).map((r) => ({
              label: r.label,
              values: r.values,
              valuesNum: r.values.map(num),
              exceedsThreshold: r.hits ?? null,
            })),
          }
        : null,
      restrictionsUrl: d.restrictions?.url ?? null,
      overview: ov
        ? { text: ov.overview, generated: ov.generated ?? null, sources: ov.sources ?? [] }
        : null,
      page: `https://bewildfireaware.com/dispatch_areas/${a.slug}.html`,
    };
  });

  const body = {
    schema: 'bwa-fire-danger/1',
    generatedAt: new Date().toISOString(),
    dateLabel: out.find((x) => x.dateLabel)?.dateLabel ?? null,
    source: 'FEMS/NFDRS via BeWildfireAware.com',
    notes: 'Underlying NFDRS data is U.S. Government work (public domain). Attribution to BeWildfireAware appreciated. Not for emergency decision-making — verify with official sources.',
    boundaries: 'https://bewildfireaware.com/api/v1/fdra-boundaries.json',
    docs: 'https://bewildfireaware.com/data-sources.html#api',
    areas: out,
  };
  return new Response(JSON.stringify(body, null, 1), {
    headers: { 'Content-Type': 'application/json' },
  });
}
