# Backlog

Ideas and planned features, roughly prioritized. (Day-to-day status lives in
PLAN.md at the workspace root; this is the idea parking lot.)

## Location → land type → fire restrictions
Geolocate, determine land ownership (private / BLM / USFS / municipal), and
point people at the restrictions that apply to them.

PHASE 1 SHIPPED (Sept 2026): homepage locate flow now shows "You appear to
be on <agency> land (<unit>) in <county> County" + official links. Live
browser point queries (both CORS-verified, government/interagency, no keys):
- Jurisdiction: NIFC DMP_JurisdictionalUnits_Public
  (services3.arcgis.com/T4QMspbfLg3qTGWY/.../DMP_JurisdictionalUnits_Public/
  FeatureServer/0) — fields JurisdictionalKind/Category, LocalName,
  LandownerKind. Private land comes from census block groups. Too fragmented
  to bake (2.7k BLM + 1.5k USFS polys in our region), hence live queries.
- County: Census TIGERweb State_County/MapServer/1 (NAME, STATE).
Links live as JIM REVIEW constants in geolocate.js (agency defaults +
per-forest alert pages + DFPC/West Slope county fallbacks).

Phase 2 — assert federal stages from verified feeds (all live-tested Sept
2026, anonymous, with restriction_status/stage + order URL):
- BLM RMA: Rocky_Mountain_Area_BLM_Fire_Restriction_Polygons_NEW_VIEW/0
  (statuses seen: "Stage 1", "Year Round"); Stage 3 closures:
  BLM_Fire_Closures_view/2.
- USFS R2, per forest: e.g. services1.arcgis.com/gGHDlz6USftL5Pau/
  .../GMUG_Fire_Restriction_Stages/FeatureServer/1 (FireRestriction per
  ranger district — returned "Stage 1 Fire Restrictions" live); PSICC
  equivalent exists; discover one per forest.
- NPS_Unit_Fire_Restrictions_(Public_VIew)/0, RMA FWS + BIA views (see the
  RMA Fire Restriction Dashboard webmap f0a56c48c00a4adfa7ceadba4fbdebe9
  for the full layer list, incl. WY county/state layers).
- Bake daily at build (few hundred polys — snapshot + "as of" date), don't
  query live; normalize statuses to an enum; absence of polygon renders as
  "no posted restriction found", never "no restrictions".

Phase 3 — Colorado county (sheriff) bans: NO feature service exists. DFPC
publishes per-county HTML (dfpc.colorado.gov/sections/
wildfire-information-center/fire-restriction-information) — scrape daily in
CI with a diff alert for Jim; fall back to links when parsing is uncertain.

Phase 4 — restrictions map overlay + /api/v1/restrictions.json for fire.ai.
Phase 5 — other states: UT (Utah_Fire_Restriction_Areas_Lookup), NV, ID,
MT (Fire_Restrictions_by_Jurisdiction) statewide layers exist; adapter per
state/GACC.

Caveats (all phases): checkerboard ownership at 40-acre scale + GPS error →
always "appears to be", show county rules alongside, disclaimer, never
assert a stage except from a verified feed.

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

## Public data API — SHIPPED July 2026
/api/v1/fire-danger.json (daily per-FDRA danger + indicators + forecast +
overview), /api/v1/fdra-boundaries.json (GeoJSON), /api/v1/index.json.
Documented at /data-sources.html#api. v1 fields are append-only.

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
