// Public API v1: FDRA boundary polygons (GeoJSON FeatureCollection).
// Simplified from each dispatch center's Fire Danger Operating Plan
// boundaries (~150 m tolerance). Changes rarely — cache aggressively and
// join with /api/v1/fire-danger.json on properties.slug.
import boundaries from '../../../data/fdra_boundaries.json';
import fdraGeo from '../../../data/fdra_geo.json';
import areas from '../../../data/dispatch_areas.json';

const byASlug = Object.fromEntries(areas.map((a) => [a.slug, a]));

export function GET() {
  const features = boundaries.features.map((f) => ({
    ...f,
    properties: {
      slug: f.properties.slug,
      name: byASlug[f.properties.slug]?.name ?? f.properties.name,
      counties: fdraGeo[f.properties.slug]?.counties ?? [],
      centroid: fdraGeo[f.properties.slug]?.centroid ?? null,
    },
  }));
  return new Response(JSON.stringify({
    type: 'FeatureCollection',
    schema: 'bwa-fdra-boundaries/1',
    source: 'Fire Danger Operating Plan boundaries via BeWildfireAware.com (simplified ~150 m)',
    features,
  }), { headers: { 'Content-Type': 'application/json' } });
}
