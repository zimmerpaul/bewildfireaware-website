// Fetches each dispatch area's published Google Sheet tab as CSV and parses it
// into clean JSON consumed by the Astro build.
//
// Robustness: if a fetch or parse fails for an area, the previous JSON file
// (last good data) is left in place and the script reports the failure.
// Exit code is non-zero only if NO area could be fetched (total outage).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AREAS = JSON.parse(readFileSync(join(__dirname, '../src/data/dispatch_areas.json'), 'utf8'));
const OUT_DIR = join(__dirname, '../src/data/areas');

const csvUrl = (a) =>
  `https://docs.google.com/spreadsheets/d/e/${a.spreadsheet}/pub?gid=${a.gid}&single=true&output=csv`;

// Minimal CSV parser handling quoted fields with embedded commas/newlines.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const clean = (s) => (s ?? '').trim();
const firstNonEmpty = (row) => clean((row || []).find((c) => clean(c)));
const findRow = (rows, pred, from = 0) => {
  for (let i = from; i < rows.length; i++) if (rows[i].some((c) => pred(clean(c)))) return i;
  return -1;
};

// Note: no fetch timestamp in the output — identical data must produce identical
// files so the workflow only commits (and the git history only grows) on real changes.
function parseArea(rows, area) {
  const data = { slug: area.slug, name: area.name };

  data.dispatchTitle = firstNonEmpty(rows[0]);
  data.dateLabel = firstNonEmpty(rows[1]);

  // Area title + today's danger rating.
  // Montrose/GJ sheets: "<Area>\nToday's Fire Danger is:"; Durango: "<Area>\nFire Danger Rating"
  const dangerHdr = (c) => /(Fire Danger is:|Fire Danger Rating)/i.test(c);
  const dIdx = findRow(rows, dangerHdr);
  if (dIdx === -1) throw new Error('danger header not found');
  const dCell = clean(rows[dIdx].find((c) => dangerHdr(clean(c))));
  data.areaTitle = clean(dCell.split('\n')[0]);
  for (let i = dIdx + 1; i < rows.length; i++) {
    const v = firstNonEmpty(rows[i]);
    if (v) { data.danger = v; break; }
  }
  const KNOWN = ['Low', 'Moderate', 'High', 'Very High', 'Extreme'];
  if (!KNOWN.includes(data.danger)) throw new Error(`unexpected danger value: ${data.danger}`);

  // Last updated timestamp
  const luIdx = findRow(rows, (c) => c === 'Last Updated');
  if (luIdx !== -1)
    data.lastUpdated = clean(rows[luIdx].filter((c) => clean(c) && clean(c) !== 'Last Updated')[0]);

  // Fire restrictions text + link
  const rIdx = findRow(rows, (c) => /^Fire restrictions/i.test(c));
  if (rIdx !== -1) {
    data.restrictions = {
      text: clean(rows[rIdx].find((c) => /restrictions/i.test(c))),
      url: clean(rows[rIdx].find((c) => /^https?:\/\//.test(clean(c)))),
    };
  }

  // Today's observations: two label rows, each followed by a value row
  data.observations = [];
  for (const marker of ['ERC %', 'Max Temp']) {
    const i = findRow(rows, (c) => c === marker);
    if (i === -1 || !rows[i + 1]) continue;
    rows[i].forEach((cell, col) => {
      const label = clean(cell);
      if (label) data.observations.push({ label, value: clean(rows[i + 1][col]) });
    });
  }

  // Local thresholds text
  const tIdx = findRow(rows, (c) => /Local Thresholds/i.test(c));
  if (tIdx !== -1) {
    for (let i = tIdx + 1; i < rows.length; i++) {
      const v = firstNonEmpty(rows[i]);
      if (v) { data.thresholds = v; break; }
    }
  }

  // Extended forecast table
  const fIdx = findRow(rows, (c) => /Extended Forecast/i.test(c));
  if (fIdx !== -1) {
    data.forecast = { title: firstNonEmpty(rows[fIdx]), dates: [], rows: [] };
    // Header row: >=3 cells that look like dates (e.g. "3-Jul")
    let hIdx = -1, cols = [];
    for (let i = fIdx + 1; i < Math.min(fIdx + 8, rows.length); i++) {
      const dateCols = rows[i]
        .map((c, j) => (/^\d{1,2}-[A-Za-z]{3}$/.test(clean(c)) ? j : -1))
        .filter((j) => j !== -1);
      if (dateCols.length >= 3) { hIdx = i; cols = dateCols; break; }
    }
    if (hIdx !== -1) {
      data.forecast.dates = cols.map((j) => clean(rows[hIdx][j]));
      const hdrLabel = clean(rows[hIdx][1]);
      if (/^Fuel Model/i.test(hdrLabel)) data.fuelModel = hdrLabel; // e.g. "Fuel Model - Y"
      for (let i = hIdx + 1; i < rows.length; i++) {
        const label = clean(rows[i][1]);
        if (!label) continue;
        if (label.length > 80 || /Fires To Remember/i.test(label)) break;
        data.forecast.rows.push({ label, values: cols.map((j) => clean(rows[i][j])) });
      }
    }
  }

  // Fires To Remember table (optional; present on some sheets)
  const ftrIdx = findRow(rows, (c) => /^Fires To Remember/i.test(c));
  if (ftrIdx !== -1) {
    const hdr = rows[ftrIdx];
    const cols = hdr.map((c, j) => (clean(c) && j > 1 ? j : -1)).filter((j) => j !== -1);
    if (cols.length) {
      const table = { columns: cols.map((j) => clean(hdr[j])), rows: [] };
      for (let i = ftrIdx + 1; i < rows.length; i++) {
        const name = clean(rows[i][1]);
        const vals = cols.map((j) => clean(rows[i][j]));
        if (clean(rows[i].find((c) => clean(c).length > 80))) break; // RAWS paragraph
        if (!name && vals.every((v) => !v)) continue;
        table.rows.push({ name, values: vals });
      }
      if (table.rows.length) data.firesToRemember = table;
    }
  }

  computeWatchouts(data);

  // RAWS / stations footnote (long text mentioning RAWS or weather stations)
  const rawsIdx = findRow(rows, (c) => c.length > 80 && /(RAWS|Weather Stations)/i.test(c), tIdx + 2);
  if (rawsIdx !== -1)
    data.raws = clean(rows[rawsIdx].find((c) => clean(c).length > 80));

  return data;
}

// ---- Watchout thresholds ----
// Parses the per-area thresholds text (e.g. "ERC > 90%, BI > 90%, Wind Speed > 15 /
// Max Temp > 90, Min Rh < 15, 1000-hr Fuels < 13, Max RH < 55") into rules, then
// flags each observation that crosses its threshold. 3+ triggered = watchout.
function computeWatchouts(data) {
  if (!data.thresholds || !data.observations?.length) return;
  const t = data.thresholds;
  const grab = (re) => { const m = re.exec(t); return m ? Number(m[1]) : null; };
  const rules = [
    { key: 'erc',   match: /^ERC/i,                 op: '>', limit: grab(/ERC\s*>\s*(\d+)/i) },
    { key: 'bi',    match: /^BI/i,                  op: '>', limit: grab(/BI\s*>\s*(\d+)/i) },
    { key: 'wind',  match: /^Winds?$/i,             op: '>', limit: grab(/Wind Speed\s*>\s*(\d+)/i) },
    { key: 'maxT',  match: /^Max Temp/i,            op: '>', limit: grab(/Max Temp\s*>\s*(\d+)/i) },
    { key: 'minRh', match: /^Min Rh/i,              op: '<', limit: grab(/Min Rh\s*<\s*(\d+)/i) },
    { key: 'fuels', match: /^1000/i,                op: '<', limit: grab(/1000[-\s]?(?:hr|hour)s?(?:\s*Fuels)?\s*<\s*(\d+)/i) },
    { key: 'maxRh', match: /^Max Rh/i,              op: '<', limit: grab(/Max RH\s*<\s*(\d+)/i) },
  ].filter((r) => r.limit !== null);

  let met = 0;
  for (const obs of data.observations) {
    const rule = rules.find((r) => r.match.test(obs.label));
    if (!rule) continue;
    const v = parseFloat(String(obs.value).replace('%', ''));
    if (!Number.isFinite(v)) continue;
    obs.limit = `${rule.op} ${rule.limit}${/ERC|BI/i.test(obs.label) ? '%' : ''}`;
    obs.triggered = rule.op === '>' ? v > rule.limit : v < rule.limit;
    if (obs.triggered) met++;
  }
  data.watchout = { met, total: rules.length, isWatchout: met >= 3 };
}

// ---- Pocket card chart data (FireFamilyPlus-style export tab) ----
// Header row: Period,Mean,Min,Max,<year>,<year>,...,90th,,<yr> Observed,<yr> Forecasted,...
// then one row per calendar day ("1-Jan" ... "31-Dec"); missing values are "#N/A".

const MONTHS = { Jan: 0, Feb: 31, Mar: 59, Apr: 90, May: 120, Jun: 151, Jul: 181, Aug: 212, Sep: 243, Oct: 273, Nov: 304, Dec: 334 };
const dayOfYear = (s) => {
  const m = /^(\d{1,2})-([A-Za-z]{3})$/.exec(clean(s));
  return m && MONTHS[m[2]] !== undefined ? MONTHS[m[2]] + Number(m[1]) - 1 : null;
};
const num = (s) => {
  const v = parseFloat(clean(s));
  return Number.isFinite(v) ? v : null;
};

function parseChart(rows, area) {
  // The daily table can start at any column (Durango nests it beside a
  // frequency-distribution table), so locate the 'Period' cell anywhere.
  let hIdx = -1, pCol = -1;
  for (let i = 0; i < rows.length; i++) {
    const j = rows[i].findIndex((c) => clean(c) === 'Period');
    if (j !== -1) { hIdx = i; pCol = j; break; }
  }
  if (hIdx === -1) throw new Error('chart header row not found');
  const hdr = rows[hIdx].map(clean);

  // Column labels vary between sheets:
  //   Max | Max Actual;  90th | 90th % | 90th Actual;
  //   2026 Observed;  2026 Forecasted | 2026 Forcasted;  2018 | 2025 a (comparison years)
  const col = { max: -1, p90: -1, years: [], observed: -1, forecasted: -1 };
  hdr.forEach((label, j) => {
    if (j < pCol || !label) return;
    let m;
    if (/^Max( Actual)?$/i.test(label)) col.max = j;
    else if (/^90th( %| Actual)?$/i.test(label)) col.p90 = j;
    else if ((m = /^(\d{4})\s*Observed$/i.exec(label))) col.observed = j;
    else if (/^\d{4}\s*For\w*casted$/i.test(label)) col.forecasted = j;
    else if ((m = /^(\d{4})\b/.exec(label))) col.years.push({ label: m[1], j });
  });
  if (col.max === -1 || col.observed === -1)
    throw new Error(`chart columns not recognized (header: ${hdr.filter(Boolean).join(', ')})`);

  const series = { max: [], observed: [], forecasted: [] };
  const comparisons = col.years.map((y) => ({ label: y.label, points: [] }));
  let p90 = null;

  for (let i = hIdx + 1; i < rows.length; i++) {
    const day = dayOfYear(rows[i][pCol]);
    if (day === null) continue;
    const push = (arr, j) => { const v = num(rows[i][j]); if (v !== null) arr.push([day, v]); };
    push(series.max, col.max);
    push(series.observed, col.observed);
    if (col.forecasted !== -1) push(series.forecasted, col.forecasted);
    col.years.forEach((y, k) => push(comparisons[k].points, y.j));
    if (p90 === null && col.p90 !== -1) p90 = num(rows[i][col.p90]);
  }
  if (series.max.length < 250) throw new Error(`chart Max series too short (${series.max.length})`);

  // Sanity guard: some sheet tabs contain corrupt comparison-year columns
  // (values in the hundreds when ERC actuals run 0–80). Drop out-of-range
  // points; drop the whole series if most of it is bad.
  const maxPeak = Math.max(...series.max.map(([, v]) => v));
  const cap = maxPeak * 2;
  const cleanComparisons = comparisons.filter((c) => {
    const good = c.points.filter(([, v]) => v <= cap);
    const dropped = c.points.length - good.length;
    if (dropped > c.points.length * 0.3) {
      console.error(`WARN ${area.slug} chart: dropping "${c.label}" series (${dropped}/${c.points.length} values out of range — check the sheet)`);
      return false;
    }
    if (dropped > 0) {
      console.error(`WARN ${area.slug} chart: dropped ${dropped} out-of-range point(s) from "${c.label}"`);
      c.points = good;
    }
    return c.points.length > 0;
  });

  const allVals = [series.max, series.observed, series.forecasted, ...cleanComparisons.map((c) => c.points)]
    .flat().map(([, v]) => v);
  const yMax = Math.max(20, Math.ceil(Math.max(...allVals, p90 ?? 0) / 20) * 20);

  const obsLabel = hdr[col.observed].split(' ')[0]; // e.g. "2026"
  return {
    title: `${area.name} Pocket Card ERC's`,
    yMax,
    p90,
    observedYear: obsLabel,
    series,
    comparisons: cleanComparisons,
  };
}

let ok = 0, failed = [];
for (const area of AREAS) {
  const outPath = join(OUT_DIR, `${area.slug}.json`);
  const previous = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : null;
  try {
    const res = await fetch(csvUrl(area), { redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = parseArea(parseCsv(await res.text()), area);

    // Pocket card chart data (optional per-area). Failure keeps last good chart.
    if (area.chartGid) {
      const chartUrl = `https://docs.google.com/spreadsheets/d/e/${area.spreadsheet}/pub?gid=${area.chartGid}&single=true&output=csv`;
      try {
        const cres = await fetch(chartUrl, { redirect: 'follow' });
        if (!cres.ok) throw new Error(`HTTP ${cres.status}`);
        data.pocketCard = parseChart(parseCsv(await cres.text()), area);
      } catch (cerr) {
        if (previous?.pocketCard) data.pocketCard = previous.pocketCard;
        console.error(`WARN ${area.slug} chart: ${cerr.message}${previous?.pocketCard ? ' — keeping last good chart' : ''}`);
      }
    }

    writeFileSync(outPath, JSON.stringify(data, null, 2));
    console.log(`OK  ${area.slug}: ${data.danger} (updated ${data.lastUpdated ?? '?'})${data.pocketCard ? ` + chart (${data.pocketCard.series.observed.length} obs days)` : ''}`);
    ok++;
  } catch (err) {
    failed.push(area.slug);
    console.error(`FAIL ${area.slug}: ${err.message}${previous ? ' — keeping last good data' : ' — NO cached data!'}`);
  }
}
console.log(`\n${ok}/${AREAS.length} areas fetched.`);
if (ok === 0) process.exit(1);
