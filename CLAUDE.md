# Ashby Yard Planner

Browser-based 3D planner for the 10641 Ashby Ave lot. Build brief: `Ashby Yard Planner Requirements.md` (requirement IDs like SITE-1, SUN-4 refer to it).

## Status
- M1 (site model) and M2 (sunlight) are built.
- M3 (plants and growth) is built: growth curve, 50-species library (all values unverified, low confidence), custom species form, palette select/deselect, placement with drag-to-move, inspector, timeline to year 30, plant forms by habit, mature-width ring, plant shadows in the sun map, leaf-off shade and drawing for deciduous plants, bloom color on plants, sun-need mismatch flags. Bloom calendar and pollinator summary are M5. Custom species are not persisted until M7.
- M4 (hardscape) is built: draw, reshape (corner handles), move and delete patios, paths, beds, lawn, decks, gravel, raised beds, walls and fences; 13-material library; takeoff with CSV; permeable vs impervious per zone; easement, root-zone and driveway warnings; snapping to corners, edges and grid; live dimensions; shade from walls, fences, decks and raised beds; undo/redo (Ctrl/Cmd+Z) across plants, palette and hardscape. Existing driveway can be removed per scenario. Not done: neighbor context (SITE-7), slope (SITE-8), raised-bed soil fill volume (WS-14).
- M5 (water and soil) is built: MWELO-method water demand per plant, hydrozone, yard zone and lot with a monthly chart and weekly watering figures; hydrozones with irrigation types and mixed-category warnings; establishment multipliers; optional effective rainfall; informational water budget; per-zone soil profiles with plant soil-fit flags; planting hole, excavation, amendment and mulch quantities; raised bed fill; tree rootable soil check; bloom calendar with gap flags and gap suggestions; pollinator summary and warnings (invasive, bee-attracting groundcover in a play area); plant schedule CSV; assumptions panel.
- **The monthly ETo values in `src/data/water.json` are a placeholder** (the official MWELO Appendix A row for Los Angeles could not be retrieved). Replace the twelve values and set `eto.status` to `verified`; the banner and the assumptions panel update from that field. Verified: the ETWU formula and 0.62, plant factor ranges, drip 0.81 and spray 0.75 efficiency, residential ETAF 0.55, Downtown LA 1991-2020 rainfall normals. Unverified: species water categories and soil needs, establishment multipliers, hand-watering efficiency, effective rainfall share, root ball sizes, tree soil target.
- M6 (conflicts and suggestions) is built: a monthly scan over 30 years reports the first year each conflict appears (canopy overlap, canopy touching a building or roof, trunk too close to a foundation, paving or the lot line, height past the easement cap), with red/amber rings in the yard and a Layout tab. The placement finder scores a 1 ft grid in a yard for one species on sun fit, clearance at mature size and hydrozone match with adjustable weights, shows a heatmap and the top five spots, and explains each score; placing a plant at a top spot yields no conflicts (tested). Equal scores break toward the cell with the most room.
- Conflict distances (`conflicts` and `suggest` in `engine.json`) and species root clearances (`roots` in `species.json`) are guidance, unverified. Conflicts from the placeholder site trees are listed separately.
- M7 (scenarios and sharing) is not started.
- Sharing will sit behind a local stub until hosting is chosen.

## Commands
- In dev, the store is on `window.__app` for inspecting state from the browser console.
- The Browser pane must be visible for the 3D canvas to repaint. A hidden pane runs the page as a background tab and screenshots go stale.
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
