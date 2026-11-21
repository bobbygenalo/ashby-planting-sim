# Ashby Yard Planner

Browser-based 3D planner for the 10641 Ashby Ave lot. Build brief: `Ashby Yard Planner Requirements.md` (requirement IDs like SITE-1, SUN-4 refer to it).

## Status
- M1 (site model) and M2 (sunlight) are built.
- M3 (plants and growth) is partly built: growth curve, 33-species library (all values unverified, low confidence), palette select/deselect, placement, inspector, timeline to year 30, plant forms by habit, mature-width ring, plant shadows in the sun map, sun-need mismatch flags. Not yet done: ~17 more species to reach 50, custom species form (P1), leaf-off density (GR-4), bloom color on plants (POL-7), drag-to-move (move is by X/Y fields), bloom calendar and pollinator summary (M5).
- M4 to M7 (hardscape, water and soil, conflicts and suggestions, scenarios and sharing) are not started.
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
- Plants: `engine/growth.ts` (size curve, shadow solids, sun-fit), `engine/library.ts` (filters, palette). Species data is `src/data/species.json`; every coefficient is in `engine.json` under `growth` and `timeline`.
- SUN-6 fit uses a growing-season (Mar-Oct) sun map computed on the site without plants, so a plant is not judged by its own shade. The displayed map includes plant shade at the timeline year.
- Sun model is clear-sky geometry (NOAA algorithm in `solar.ts`). Sun-hours rasterizes shadow hulls per time step in a web worker.

## Known gaps
- ADU is one rectangle. The plan shows an L-shape with 616 SF, so the model overstates it (964 SF).
- Structure heights, tree positions and fence heights are placeholders flagged in `site.json`.
- Convex footprints only for shadow casting. Use several structures for L-shapes until parts are supported.
