import { describe, expect, it } from 'vitest';
import siteRaw from '../src/data/site.json';
import engineRaw from '../src/data/engine.json';
import speciesRaw from '../src/data/species.json';
import materialsRaw from '../src/data/materials.json';
import { generateConcept } from '../src/engine/concept';
import { distanceToPolygon, polygonsIntersect } from '../src/engine/geometry';
import { footprint } from '../src/engine/hardscape';
import { emptyScenarioData } from '../src/engine/scenario';
import { mulberry32 } from '../src/engine/shuffle';
import { activeStructures, loadSite } from '../src/engine/site';
import type { EngineConfig, Material, SpeciesLibrary } from '../src/engine/types';

const site = loadSite(siteRaw);
const engine = engineRaw as unknown as EngineConfig;
const lib = speciesRaw as unknown as SpeciesLibrary;
const mats = materialsRaw as unknown as Material[];
const structures = activeStructures(site, { aduEnabled: true });
const ctx = { site, structures, species: lib.species, materials: mats, engine, palette: emptyScenarioData(site).palette };
const OPTS = { hardscape: true, plants: true, starredOnly: false };
const hs = engine.hardscape;

const run = (seed: number) => generateConcept(ctx, OPTS, mulberry32(seed));
const touches = (path: ReturnType<typeof run>['data']['hardscape'][number], poly: [number, number][], slack = 0.6) =>
  distanceToPolygon(path.points[0][0], path.points[0][1], poly) < slack || distanceToPolygon(path.points[path.points.length - 1][0], path.points[path.points.length - 1][1], poly) < slack ||
  polygonsIntersect(footprint(path, hs), poly);

describe('paths join the places people go', () => {
  it('reach a door, and most doors, with the path touching the entry', () => {
    let doorsReached = 0, concepts = 0, doorsTotal = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = run(seed);
      const paths = r.data.hardscape.filter((e) => e.type === 'path' && !e.existing);
      concepts++;
      expect(paths.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const d of (site.doors ?? []).filter((x) => x.id !== 'garage-front')) { // the garage opens onto the driveway
        doorsTotal++;
        const hit = paths.some((p) => [p.points[0], p.points[p.points.length - 1]].some(([x, y]) => Math.hypot(x - d.point[0], y - d.point[1]) < 1));
        if (hit) doorsReached++;
      }
    }
    expect(concepts).toBe(40);
    expect(doorsReached / doorsTotal).toBeGreaterThan(0.75);
  });

  it('connects every lawn and every fruit tree it can', () => {
    let lawns = 0, lawnsJoined = 0, fruit = 0, fruitJoined = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const r = run(seed);
      const paths = r.data.hardscape.filter((e) => e.type === 'path' && !e.existing);
      for (const lawn of r.data.hardscape.filter((e) => e.type === 'lawn' && !e.existing)) {
        lawns++;
        const poly = footprint(lawn, hs);
        if (paths.some((p) => polygonsIntersect(footprint(p, hs), poly))) lawnsJoined++;
      }
      for (const i of r.data.instances) {
        const sp = lib.species.find((s) => s.id === i.speciesId)!;
        if (!sp.fruit) continue;
        fruit++;
        if (paths.some((p) => distanceToPolygon(i.position[0], i.position[1], footprint(p, hs)) < Math.min(sp.matureWidth / 2, 3) + 2.5)) fruitJoined++;
      }
    }
    expect(lawns).toBeGreaterThan(5);
    expect(lawnsJoined / lawns).toBeGreaterThan(0.6);
    expect(fruit).toBeGreaterThan(5);
    expect(fruitJoined / fruit).toBeGreaterThan(0.25); // only the four nearest fruit trees get a path
    void touches;
  });

  it('keeps paths off plants, buildings and the driveway', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = run(seed);
      for (const p of r.data.hardscape.filter((e) => e.type === 'path' && !e.existing)) {
        const poly = footprint(p, hs);
        for (const s of structures) expect(polygonsIntersect(poly, s.footprint), `${p.name} meets a building`).toBe(false);
        for (const old of r.data.hardscape.filter((e) => e.existing)) expect(polygonsIntersect(poly, footprint(old, hs))).toBe(false);
        for (const i of r.data.instances) expect(distanceToPolygon(i.position[0], i.position[1], poly), `${p.name} runs through a plant`).toBeGreaterThan(0.3);
      }
    }
  });

  it('is repeatable', () => {
    expect(run(9)).toEqual(run(9));
  });
});
