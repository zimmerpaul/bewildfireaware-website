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

## Fires to Remember → Research page
New "Research" page in the Learn More dropdown housing the "Fires to
Remember" program: for each notable historical fire, publish the ERC
research (what the ERC/BI/weather looked like at ignition and during major
growth) used to determine local ERC cutoffs/breakpoints.

- Data model: per-fire entries (name, date, FDRA, acreage, ERC/BI/RH/wind
  at ignition + at major runs, narrative, sources) in a JSON/markdown
  collection — same authoring pattern as local_info.json so Jim can add
  fires easily.
- Cross-link: each FDRA page's existing "Fires to Remember" table (parsed
  from the sheets when present) links into the Research page entries.
- Could reuse the pocket-card chart component to plot each fire's year with
  ignition markers — visualizing WHY the cutoff sits where it does.
- Nav: Learn More → Research (between Fuel Models and Terminology?).

## WFIGS layer for fire.ai (researched July 2026 — viable)
WFDSS itself is authenticated-only (no public API), but its data flows via
IRWIN into NIFC Open Data / WFIGS — free public ArcGIS services, verified
by live query (returned Gold Mountain 37,734 ac / 13% / Ouray County with
WFDSS StrategicDecisionPublishDate):
- Incident locations: services3.arcgis.com/T4QMspbfLg3qTGWY/.../
  WFIGS_Incident_Locations_Current — query by POOState/POOCounty; fields:
  IncidentName, IncidentSize, PercentContained, FireDiscoveryDateTime, etc.
- Incident perimeters service: actual fire polygons.
Uses: (1) feed authoritative incident facts into AI overview generation
(replaces web-search guesswork for acreage/containment); (2) live fire
perimeter overlay on the danger map, auto-appearing/clearing; (3) could
auto-populate Current Local Info incident cards.
Also: FEMS public REST API is coming/partial — pairs with the FEMS-direct
item below.

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
