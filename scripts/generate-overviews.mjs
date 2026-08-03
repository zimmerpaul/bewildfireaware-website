// Generates a daily plain-language "Overview" for each FDRA using the Claude
// API (with web search), grounded in today's parsed data + the National
// Weather Service forecast/alerts for the area centroid.
//
// Runs in CI after fetch-data when ANTHROPIC_API_KEY is set; skips silently
// otherwise (pages render without the Overview section). A failed generation
// keeps the area's previous overview on disk.
//
// Output: src/data/overviews/<slug>.json { overview, sources[], generated }

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API_KEY = process.env.ANTHROPIC_API_KEY;
if (!API_KEY) {
  console.log('ANTHROPIC_API_KEY not set — skipping overview generation.');
  process.exit(0);
}

// Model is switchable via env; Sonnet default (Haiku trial produced weaker,
// narration-prone output).
const MODEL = process.env.OVERVIEW_MODEL || 'claude-sonnet-5';
const MAX_SEARCHES = Number(process.env.OVERVIEW_MAX_SEARCHES || 5);

// Optional: NICC sit report context (produced by fetch-sitrep.mjs)
let SITREP = null;
try {
  SITREP = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/data/sitrep.json'), 'utf8'));
} catch {}
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
${SITREP ? `
NATIONAL INTERAGENCY SITUATION REPORT (NICC${SITREP.reportDate ? `, ${SITREP.reportDate}` : ''}):
National Preparedness Level ${SITREP.nationalPL ?? 'n/a'}${SITREP.rmaPL ? `; Rocky Mountain Area PL ${SITREP.rmaPL}` : ''}.
${SITREP.excerpt}
(Mention sit-report incidents only if they are in or near this area's counties.)
` : ''}

TODAY IS ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.

Use web search (several searches as needed) to find: current fire restrictions and their stage/jurisdiction in those counties, active wildfires near this area (name, size, containment), and notable local fire developments.

FRESHNESS RULES:
- Only state incident sizes, containment, evacuations, or restrictions you can confirm from the last 48 hours. The sit report above is today's official snapshot — prefer it over news articles.
- Fire facts go stale fast: if a search result is more than ~2 days old, either omit it or find something newer; never present old numbers as current.

Write for the general public. Rules:
- Use ONLY the data above and what your searches actually return. Never invent numbers, fires, or restrictions.
- Be specific: name fires with acreage and containment, name restriction stages and who imposed them, give Red Flag Warning timing.
- Calm, plain, useful language.

FORMAT (exactly this structure, under 150 words total):
- First line: one bold sentence (**like this**) stating today's danger level and its headline driver.
- Then 3–6 lines each starting with "- ": one concrete fact per line — week-ahead trend, key weather driver, Red Flag Warning or watchout status, restrictions, nearby incidents.
- Output ONLY the overview itself. No preamble, no narration (never "I'll search…"), no headers, nothing after the last bullet.`;
}

async function callClaude(messages) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES }],
      messages,
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function generate(area, data, geo) {
  const nws = await nwsContext(...(geo.centroid ?? [39, -107.5]));
  const messages = [{ role: 'user', content: buildPrompt(area, data, geo, nws) }];
  let msg = await callClaude(messages);

  // Long web-search turns can come back paused (stop_reason "pause_turn") with
  // no final text yet: continue the same turn by passing the assistant content
  // back, keeping every response's blocks for parsing/citations.
  const content = [...msg.content];
  for (let i = 0; i < 3 && msg.stop_reason === 'pause_turn'; i++) {
    messages.push({ role: 'assistant', content: msg.content });
    msg = await callClaude(messages);
    content.push(...msg.content);
  }

  // The final answer is the text after the last tool interaction — earlier
  // text blocks are "I'll search for…" narration and must not be published.
  // Join with '' — the API splits the answer into multiple text blocks at each
  // citation boundary, so these are contiguous fragments of the same passage.
  let lastToolIdx = -1;
  content.forEach((b, i) => { if (b.type !== 'text') lastToolIdx = i; });
  let text = content.slice(lastToolIdx + 1)
    .filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  text = text.replace(/\n{3,}/g, '\n\n');
  // Extra guard: drop any lines before the bold lead sentence.
  const boldStart = text.indexOf('**');
  if (boldStart > 0) text = text.slice(boldStart).trim();
  if (text.length < 80) throw new Error(`overview too short (${text.length} chars, stop_reason=${msg.stop_reason})`);

  // Sources: the structured inputs, plus web pages Claude cited. When it
  // paraphrases without direct citations, fall back to the pages its
  // searches actually retrieved so readers always get reference linkouts.
  const cited = new Map();
  for (const b of content) {
    if (b.type === 'text' && b.citations) {
      for (const c of b.citations) if (c.url) cited.set(c.url, c.title || c.url);
    }
  }
  if (cited.size === 0) {
    for (const b of content) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const r of b.content) {
          if (r.type === 'web_search_result' && r.url && cited.size < 4) cited.set(r.url, r.title || r.url);
        }
      }
    }
  }
  const sources = [
    { name: 'FEMS / NFDRS via BeWildfireAware', url: null },
    { name: 'National Weather Service', url: 'https://www.weather.gov/' },
    ...(SITREP ? [{ name: 'NICC Incident Management Situation Report', url: 'https://www.nifc.gov/nicc-files/sitreprt.pdf' }] : []),
    ...[...cited].slice(0, 4).map(([url, name]) => ({ name, url })),
  ];

  // Plain-text lead for compact placements (homepage locate card):
  // prefer the bold lead sentence, fall back to the first non-bullet line.
  const boldMatch = /\*\*([^*]+)\*\*/.exec(text);
  const lead = (boldMatch?.[1]
    ?? text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('- '))?.replace(/\*\*/g, ''))
    ?.trim() ?? null;

  return {
    overview: text,
    lead,
    sources,
    generated: data.dateLabel ?? new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'long', day: 'numeric' }),
  };
}

let ok = 0;
for (const area of AREAS) {
  const outPath = join(OUT_DIR, `${area.slug}.json`);
  // Per-area toggle: "overview": true in dispatch_areas.json
  if (!area.overview) {
    if (existsSync(outPath)) { unlinkSync(outPath); console.log(`OFF ${area.slug}: overview disabled — removed stale file`); }
    else console.log(`OFF ${area.slug}: overview disabled`);
    continue;
  }
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
