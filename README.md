# BeWildfireAware

Astro-based static site for [bewildfireaware.com](https://bewildfireaware.com). Daily NFDRS fire danger data is fetched from published Google Sheets at build time and rendered as native HTML (no more iframes).

## How it works

1. `npm run fetch-data` pulls each dispatch area's published Google Sheet tab as CSV and parses it into `src/data/areas/<slug>.json`. If a fetch fails, the previous JSON (last good data) is kept.
2. `npm run build` renders every page as static HTML into `dist/`, including one page per dispatch area from `src/pages/dispatch_areas/[slug].astro`.
3. GitHub Actions (`.github/workflows/deploy.yml`) runs on every push and on a daily cron at ~3:20am MT (just after the sheet's ~3:11am update), then deploys to GitHub Pages.

## Common tasks

**Local development**

```
npm install
npm run fetch-data   # refresh data from the sheets
npm run dev          # local dev server
npm run build        # production build into dist/
```

**Add a dispatch area**: add one entry to `src/data/dispatch_areas.json` (slug, display name, published spreadsheet ID, tab gid). The page, nav menus, and data fetch all follow automatically.

**Edit page content**: pages live in `src/pages/` (`.astro` files, mostly plain HTML). Shared header/nav/footer are in `src/layouts/Base.astro` and `src/components/NavLinks.astro`. Styles are in `public/styles.css`.

**Manual data refresh/deploy**: run the "Build and deploy" workflow from the GitHub Actions tab (workflow_dispatch).

**Update map boundaries**: `npm run update-map` re-exports FDRA polygons from the Google My Maps map (source of truth), simplifies them, and rewrites `src/data/fdra_boundaries.json`. Only needed when boundaries change. The dispatch-areas map colors each polygon with that day's danger rating at build time (Leaflet + CARTO basemap, `public/map.js`).

**Pocket card rollover**: `public/pocket-card.js` adds crosshair + daily-value tooltips (mouse and touch) over the build-time SVG chart. Chart renders fully without JS.

## Data source

The Google Sheets are populated from FEMS by a Google Apps Script (legacy pipeline). Planned evolution: pull the FEMS API directly in the Actions workflow and retire the sheets — only `scripts/fetch-data.mjs` needs to change; page templates consume the intermediate JSON and stay untouched.
