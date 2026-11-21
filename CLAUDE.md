# Ashby Yard Planner

Browser-based 3D planner for the 10641 Ashby Ave lot. Build brief: `Ashby Yard Planner Requirements.md` (requirement IDs like SITE-1, SUN-4 refer to it).

## Status
- M1 (site model) and M2 (sunlight) are built. M3 to M7 (plants, hardscape, water and soil, placement, scenarios and sharing) are not started.
- Sharing will sit behind a local stub until hosting is chosen.

## Commands
- `npm run dev` runs the app. Add `?mode=view` to the URL for read-only view mode.
- `npm test` runs Vitest. `npm run typecheck` runs tsc. `npm run build` does both checks plus the production build.

## Architecture rules (from the brief)
- `src/engine/` is pure functions with no React or three.js imports. Calculations live here and are unit tested.
- `src/data/site.json` is the only place site values live. `src/data/engine.json` holds every coefficient and default. Do not inline numbers in code.
- Scene and UI read config, reference data and the store. Changing `site.json` alone retargets the app.
- View mode blocks plan mutations in the store (`mutate` guard in `src/store/store.ts`), not only in the UI. Viewer controls (camera, time, layers) stay allowed.

## Conventions
- Site coordinates are decimal feet: X across the lot from the driveway side, Y from the street toward the rear, Z up. three.js gets (x, z, -y) through one rotated group in `SiteScene.tsx`.
- `rearBearingDeg` is the compass bearing of the +Y axis. `driveSide` says which side the driveway is on facing the house from the street. Both are unverified assumptions.
- Printed plan dimensions are listed in `site.json` under `printed`, each with a measure rule. `checkPrintedDimensions` verifies them to 1 inch, and the Plan check panel shows the result.
- Sun model is clear-sky geometry (NOAA algorithm in `solar.ts`). Sun-hours rasterizes shadow hulls per time step in a web worker.

## Known gaps
- ADU is one rectangle. The plan shows an L-shape with 616 SF, so the model overstates it (964 SF).
- Structure heights, tree positions and fence heights are placeholders flagged in `site.json`.
- Convex footprints only for shadow casting. Use several structures for L-shapes until parts are supported.
