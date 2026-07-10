# Backlog

Ideas and planned features, roughly prioritized. (Day-to-day status lives in
PLAN.md at the workspace root; this is the idea parking lot.)

## Location → land type → fire restrictions
Geolocate, determine land ownership (private / BLM / USFS / municipal), and
point people at the restrictions that apply to them.

Research findings (July 2026):
- Land type from a point is proven: Esri Living Atlas "USA Federal Lands"
  point query returned "Bureau of Land Management" for a test point west of
  Montrose. Authoritative source is USGS PAD-US (public domain), which also
  knows the unit (forest name, BLM field office).
- Preferred build: extract + simplify PAD-US polygons for the 9-FDRA region
  at build time (like derive-counties), client-side point-in-polygon. No
  runtime dependency, clean licensing.
- V1: "You appear to be on BLM land (Uncompahgre Field Office) in Ouray
  County" + curated deep links (~20 jurisdiction URLs: field offices,
  forests, county sheriffs, West Slope Fire Info). Never assert the stage.
- V2 (later): assert current stage only from a verified feed — investigate
  whether Colorado DFPC's statewide fire-restrictions map is queryable.
- Caveats: checkerboard ownership at 40-acre scale + GPS error → always
  "appears to be", show county rules alongside, disclaimer.

## Logo decision
Candidates: "Pine in Flame" (negative-space tree) and the fire-danger-sign
concepts (roadside sign / dial badge / trailhead shield) per Jim's idea.
Note: Smokey Bear himself is protected (Smokey Bear Act) — sign motif only.
Bonus option: needle position rebuilt daily to reflect the region's actual
danger (site + favicon).

## Data pipeline
- FEMS-direct: pull the FEMS API in Actions, retire the Google Sheets +
  Apps Script. Enables pocket-card data without published tabs.
- Enable AI overviews for all 9 areas at go-live (flip `overview` flags).
- Fix GJ High's corrupt 2018 pocket-card column in the source sheet.

## Features
- Re-add featured-video block on redesign when wanted (config exists in git
  history: commit a553026).
- Watch Duty deep links if they ever document a URL scheme.
- PurpleAir sensor data on FDRA pages (needs API key + their ToS review).
- Email/SMS daily danger alerts via hosted service (Buttondown/Twilio) —
  interest already proven by the PDF-by-email list.
- Optional gray "context" city labels outside the region (Moab, Denver) on
  the nolabels basemap.
- Self-host source favicons (replace Google favicon service).

## Pre-launch checklist
- Logo final + regenerate favicon/touch icons
- Mobile QA pass with Jim (real devices)
- Add ANTHROPIC_API_KEY to primary repo; enable overviews per budget
- Merge redesign → main (test domain), soak, then production DNS cutover
  (steps in PLAN.md); decommission preview repo + subdomain
