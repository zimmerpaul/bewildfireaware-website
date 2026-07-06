// Generates a daily plain-language "Overview" for each FDRA using the Claude
// API (with web search), grounded in today's parsed data + the National
// Weather Service forecast/alerts for the area centroid.
//
// Runs in CI after fetch-data when ANTHROPIC_API_KEY is set; skips silently
// otherwise (pages render without the Overview section). A failed generation
// keeps the area's previous overview on disk.
//
// Output: src/data/overviews/<slug>.json { overview, sources[], generated }

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.log('ANTHROPIC_API_KEY not set — skipping overview generation.');
  process.exit(0);
}

const MODEL = 'claude-sonnet-5';
const __dirname = dirname(fileURLToPath(import.meta.url));
const AREAS = JSON.parse(readFileSync(join(__dirname, '../src/data/dispatch_areas.json'), 'utf8'));
const GEO = JSON.parse(readFileSync(join(__dirname, '../src/data/fdra_geo.json'), 'utf8'));
const OUT_DIR = join(__dirname, '../src/data/overviews');
mkdirSync(OUT_DIR, { recursive: true });

const NWS_HEADERS = { 'User-Agent': 'bewildfireaware.com (gunnisonbc71@gmail.com)' };

async function nwsContext(lat, lon) {
  const out = { forecast: 'unavailable', alerts: 'none reported' };
  try {
    const point = await (await fetch(`https://api.weather.gov/points/${lat},${lon}`, { headers: NWS_HEADERS })).json();
    const fc = await (await fetch(point.properties.forecast, { headers: NWS_HEADERS })).json();
    out.forecast = fc.properties.periods.slice(0, 3)
      .map((p) => `${p.name}: ${p.detailedForecast}`).join('\n');
  } catch {}
  try {
    const al = await (await fetch(`https://api.weather.gov/alerts/active?point=${lat},${lon}`, { headers: NWS_HEADERS })).json();
    if (al.features?.length) {
      out.alerts = al.features.map((a) => `${a.properties.event}: ${a.properties.headline}`).join('\n');
    }
  } catch {}
  return out;
}

function buildPrompt(area, data, geo, nws) {
  const obs = (data.observations ?? []).map((o) => `${o.label}: ${o.value}${o.triggered ? ' (exceeds local threshold)' : ''}`).join('; ');
  const fc = (data.forecast?.rows ?? []).map((r) => `${r.label}: ${r.values.join(', ')}`).join('\n');
  return `You write the daily "Overview" for the ${area.name} Fire Danger Rating Area in Western Colorado, published on BeWildfireAware.com.

TODAY'S OFFICIAL DATA (FEMS/NFDRS via BeWildfireAware), ${data.dateLabel}:
- Fire danger rating: ${data.danger}
- Watchout status: ${data.watchout ? `${data.watchout.met} of ${data.watchout.total} local thresholds met${data.watchout.isWatchout ? ' — WATCHOUT conditions' : ''}` : 'n/a'}
- Observations: ${obs}
- 7-day forecast (dates ${data.forecast?.dates?.join(', ') ?? 'n/a'}):
${fc}

NATIONAL WEATHER SERVICE (near ${geo.centroid?.join(', ')}):
Forecast:
${nws.forecast}
Active alerts: ${nws.alerts}

This area spans parts of these Colorado counties: ${geo.counties?.join(', ') ?? 'unknown'}.

You may use web search (up to 3 searches) to check for current fire restrictions in those counties, active wildfires near this area, or notable local fire news from the past few days.

Write 3–5 sentences for the general public. Rules:
- Use ONLY the data above and what your searches actually return. Never invent numbers, fires, or restrictions.
- Lead with today's danger level and what is driving it.
- Note the week-ahead trend, any Red Flag Warning, and watchout status if it applies.
- If search finds current restrictions or nearby incidents, mention them briefly.
- Calm, plain, useful language. No headers, bullets, or preamble — just the paragraph.`;
}

async function generate(area, data, geo) {
  const nws = await nwsContext(...(geo.centroid ?? [39, -107.5]));
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 800,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      messages: [{ role: 'user', content: buildPrompt(area, data, geo, nws) }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const msg = await res.json();

  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
  if (text.length < 80) throw new Error(`overview too short (${text.length} chars)`);

  // Sources: the structured inputs, plus any web pages Claude actually cited
  const cited = new Map();
  for (const b of msg.content) {
    if (b.type === 'text' && b.citations) {
      for (const c of b.citations) if (c.url) cited.set(c.url, c.title || c.url);
    }
  }
  const sources = [
    { name: 'FEMS / NFDRS via BeWildfireAware', url: null },
    { name: 'National Weather Service', url: 'https://www.weather.gov/' },
    ...[...cited].slice(0, 4).map(([url, name]) => ({ name, url })),
  ];

  return {
    overview: text,
    sources,
    generated: data.dateLabel ?? new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'long', day: 'numeric' }),
  };
}

let ok = 0;
for (const area of AREAS) {
  const outPath = join(OUT_DIR, `${area.slug}.json`);
  try {
    const data = JSON.parse(readFileSync(join(__dirname, `../src/data/areas/${area.slug}.json`), 'utf8'));
    const geo = GEO[area.slug] ?? {};
    const result = await generate(area, data, geo);
    writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`OK  ${area.slug}: ${result.overview.slice(0, 90)}…`);
    ok++;
  } catch (err) {
    console.error(`FAIL ${area.slug}: ${err.message}${existsSync(outPath) ? ' — keeping previous overview' : ''}`);
  }
}
console.log(`\n${ok}/${AREAS.length} overviews generated.`);
